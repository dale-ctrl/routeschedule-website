import { prisma } from '@/lib/prisma'
import {
  assignToTrucks,
  optimizeStopOrder,
  planSlots,
  computeRunTime,
  computeStopSchedule,
  sequenceForTimeWindows,
  hasTimeConstraints,
  estimateDurationMatrix,
  EXTRA_VAN_CAPACITY,
  MAX_WORKING_DAY_MIN,
  DEFAULT_DAY_START_MIN,
  type TruckSlot,
  type TruckAssignment,
  type Stop,
  type Schedule,
} from '@/lib/route-optimizer'
import { getRouteDetails, osrmTripOptimize, osrmDurationMatrix, type RouteResult } from '@/lib/routing'
import { parseRule, getRouteWeightLimit, getMinTruckLoadPct, getMaxRouteTime } from '@/lib/rules-engine'
import { effectiveWindow, parseFlags, clockToMinutes, formatClock } from '@/lib/special-instructions'

/**
 * Find or create real Truck DB rows to back any Extra Van placeholder slots.
 * Reuses existing active Extra Van trucks on the depot first, creates new ones as needed.
 */
async function resolveExtraVans(
  slots: TruckSlot[],
  depotKey: string | null,
  extraVanCapacity: number
): Promise<TruckSlot[]> {
  const placeholderCount = slots.filter((s) => s.isExtraVan).length
  if (placeholderCount === 0) return slots

  const existing = await prisma.truck.findMany({
    where: { type: 'Extra Van', depot: depotKey, active: true },
    orderBy: { createdAt: 'asc' },
  })

  const pool: { id: string; name: string }[] = existing.map((t) => ({ id: t.id, name: t.name }))

  while (pool.length < placeholderCount) {
    const idx = pool.length + 1
    const name = `Extra Van ${idx}${depotKey ? ` (${depotKey})` : ''}`
    const created = await prisma.truck.create({
      data: {
        name,
        capacity: extraVanCapacity,
        type: 'Extra Van',
        depot: depotKey,
        active: true,
      },
    })
    pool.push({ id: created.id, name: created.name })
  }

  let vanCursor = 0
  return slots.map((s) => {
    if (!s.isExtraVan) return s
    const resolved = pool[vanCursor++]
    return { ...s, truckId: resolved.id, truckName: resolved.name }
  })
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { day, date, truckIds, includeUnassigned, depot } = body as {
      day: string
      date: string
      truckIds?: string[]
      includeUnassigned?: boolean
      depot?: string
    }

    if (!day || !date) {
      return Response.json({ error: 'day and date are required' }, { status: 400 })
    }

    // Pull both pending and pallet-network statuses — the dispatcher manually
    // marks orders as pallet_network on the Orders page, and the generator
    // then materialises them as single-stop routes on the Pallet Network truck
    // (handled inside the depot loop). Without that pickup, manually-flagged
    // orders would just sit in pallet_network status forever.
    const allCandidates = await prisma.order.findMany({
      where: {
        status: { in: ['pending', 'pallet_network'] },
        lat: { not: null },
        lng: { not: null },
      },
    })

    const orders = allCandidates.filter((o) => {
      if (depot && o.depot !== depot) return false
      // When sales tagged an exact delivery date at import (BKG_START), it's
      // authoritative — only route the order on that specific date. This is
      // what stops Dorset and London being routed together when they were for
      // different actual dates.
      if (o.deliveryDate) {
        return o.deliveryDate.toISOString().slice(0, 10) === date
      }
      if (!o.scheduledDay) return includeUnassigned === true
      return o.scheduledDay.split(',').map((d) => d.trim()).includes(day)
    })

    if (orders.length === 0) {
      return Response.json(
        {
          error: includeUnassigned
            ? `No geocoded pending orders found for ${day} or unassigned.`
            : `No geocoded pending orders scheduled for ${day}. Try enabling "Include unassigned orders" to route orders that haven't been assigned a day by rules.`,
        },
        { status: 400 }
      )
    }

    // Optional: the first active Pallet Network truck becomes the home for any
    // stops the pallet-network filter pulls out of regular routing. We match
    // either type='Pallet Network' OR a name containing "pallet network", so a
    // truck the user just called "Pallet Network" (with default type) still
    // gets picked up. We collect IDs first so we can also exclude these trucks
    // from the regular fleet pool — otherwise the same truck could end up in
    // both buckets.
    const palletNetworkTrucks = await prisma.truck.findMany({
      where: {
        active: true,
        OR: [
          { type: 'Pallet Network' },
          { name: { contains: 'pallet network' } },
          { name: { contains: 'Pallet Network' } },
        ],
      },
      orderBy: { createdAt: 'asc' },
    })
    const palletNetworkTruck = palletNetworkTrucks[0] ?? null
    const palletNetworkTruckIds = palletNetworkTrucks.map((t) => t.id)

    // Build the id filter carefully — if both a truckIds whitelist and a
    // pallet-network blacklist are present we need to combine them, not
    // overwrite one with the other via spread.
    const idFilter: { in?: string[]; notIn?: string[] } = {}
    if (truckIds && truckIds.length > 0) idFilter.in = truckIds
    if (palletNetworkTruckIds.length > 0) idFilter.notIn = palletNetworkTruckIds

    const trucks = await prisma.truck.findMany({
      where: {
        active: true,
        // Extra Vans are provisioned on demand. Pallet Network trucks are
        // handled separately above, so exclude them from the regular fleet
        // pool regardless of whether they were tagged by name or by type.
        type: { not: 'Extra Van' },
        ...(Object.keys(idFilter).length > 0 ? { id: idFilter } : {}),
      },
    })

    if (trucks.length === 0) {
      return Response.json({ error: 'No active trucks available.' }, { status: 400 })
    }

    const allRules = await prisma.rule.findMany({ where: { active: true } })
    const parsedRules = allRules.map(parseRule)
    const ordersForRules = orders.map((o) => ({
      id: o.id, postcode: o.postcode, area: o.area, weight: o.weight,
      customer: o.customer, notes: o.notes, reference: o.reference,
      deliveryTime: o.deliveryTime, specialInstructions: o.specialInstructions,
      scheduledDay: o.scheduledDay, priority: o.priority, depot: o.depot,
    }))
    const routeWeightLimit = getRouteWeightLimit(parsedRules, ordersForRules)
    const minTruckLoadPct = getMinTruckLoadPct(parsedRules, ordersForRules)
    const ruleMaxRouteTime = getMaxRouteTime(parsedRules, ordersForRules)
    // Working-day cap used by the replan loop. The dispatcher's set_max_route_time
    // rule fully overrides the built-in 9h default — including loosening it —
    // because the dispatcher is the one who knows what's compliant for their drivers.
    const maxWorkingDayMin = ruleMaxRouteTime ?? MAX_WORKING_DAY_MIN

    // When the first run leaves the depot — the anchor for ETAs and therefore
    // for whether AM / "before 10" windows can be met.
    const startSetting = await prisma.setting.findUnique({ where: { key: 'ROUTE_START_TIME' } })
    const dayStartMin = clockToMinutes(startSetting?.value) ?? DEFAULT_DAY_START_MIN
    const dayMidnightMs = new Date(date + 'T00:00:00.000Z').getTime()

    const depotKeys: (string | null)[] = depot
      ? [depot]
      : [...new Set(orders.map((o) => o.depot ?? null))]

    const createdRoutes: { routeId: string; routeName: string; stops: number; isExtraVan: boolean; runNumber: number }[] = []
    const errors: string[] = []
    const extraVansCreated: string[] = []
    let palletNetworkFlagged = 0

    for (const depotKey of depotKeys) {
      const depotOrders = depot ? orders : orders.filter((o) => (o.depot ?? null) === depotKey)

      const depotTrucks = (truckIds && truckIds.length > 0)
        ? trucks
        : trucks.filter((t) => (t.depot ?? null) === depotKey)

      if (depotTrucks.length === 0) {
        errors.push(`No active trucks assigned to ${depotKey ?? 'unassigned'} depot — ${depotOrders.length} order(s) skipped.`)
        continue
      }

      let depotLocation = { lat: 51.5, lng: -1.8 }
      if (depotKey) {
        const depotRecord = await prisma.depot.findUnique({ where: { name: depotKey } })
        if (depotRecord?.lat && depotRecord?.lng) {
          depotLocation = { lat: depotRecord.lat, lng: depotRecord.lng }
        }
      }

      const trucksWithLimit = depotTrucks.map((t) => ({
        id: t.id,
        name: t.name,
        capacity: routeWeightLimit !== null ? Math.min(t.capacity, routeWeightLimit) : t.capacity,
        type: t.type ?? null,
      }))

      // Pull manually-flagged pallet-network orders out of the normal routing
      // flow — they go onto the Pallet Network truck as single-stop routes,
      // not into clustering. The Orders page surfaces a soft warning for stops
      // beyond PALLET_NETWORK_WARNING_KM and lets dispatchers flip them to
      // 'pallet_network' status; nothing here decides for them automatically.
      const palletNetworkIds: string[] = []
      const inAreaOrders = depotOrders.filter((o) => {
        if (o.status === 'pallet_network') {
          palletNetworkIds.push(o.id)
          return false
        }
        return true
      })

      if (palletNetworkIds.length > 0) {
        palletNetworkFlagged += palletNetworkIds.length

        if (palletNetworkTruck) {
          // Materialise each flagged stop as its own single-stop route on the
          // Pallet Network truck. No clustering, no OSRM call — these don't
          // share a vehicle day with anything else, the partner handles the
          // actual delivery, and dispatchers just need them visible per stop.
          const dayLabel = day.charAt(0).toUpperCase() + day.slice(1)
          const flaggedOrders = depotOrders.filter((o) => palletNetworkIds.includes(o.id))

          for (const order of flaggedOrders) {
            const routeName = `Pallet Network - ${dayLabel} ${date} - ${order.customer}`
            const route = await prisma.route.create({
              data: {
                name: routeName,
                date: new Date(date + 'T08:00:00.000Z'),
                truckId: palletNetworkTruck.id,
                status: 'planned',
                totalWeight: order.weight,
                depot: depotKey ?? null,
              },
            })
            await prisma.routeStop.create({
              data: {
                routeId: route.id,
                orderId: order.id,
                truckId: palletNetworkTruck.id,
                sequence: 1,
              },
            })
            await prisma.order.update({
              where: { id: order.id },
              data: { status: 'scheduled' },
            })
            createdRoutes.push({
              routeId: route.id,
              routeName,
              stops: 1,
              isExtraVan: false,
              runNumber: 1,
            })
          }
        } else {
          // Dispatcher marked these as pallet_network on the Orders page but
          // there's no Pallet Network truck configured to receive them — leave
          // them in pallet_network status and surface a warning so they're
          // visible. Adding a "Pallet Network" truck and re-generating will
          // pick them up automatically.
          errors.push(
            `${depotKey ?? 'unassigned'}: ${palletNetworkIds.length} order(s) marked as pallet network but no Pallet Network truck exists — add a truck with type "Pallet Network" to route these automatically.`
          )
        }
      }

      if (inAreaOrders.length === 0) continue

      const stops: Stop[] = inAreaOrders.map((o) => {
        const window = effectiveWindow(o)
        const flags = parseFlags(o.instructionFlags)
        return {
          id: o.id, lat: o.lat!, lng: o.lng!, weight: o.weight,
          customer: o.customer, postcode: o.postcode, address: o.address,
          deliveryTime: o.deliveryTime, priority: o.priority,
          preferredTruckType: o.preferredTruckType ?? null,
          windowStart: window.start,
          windowEnd: window.end,
          pin: flags.includes('first_drop') ? 'first' : flags.includes('last_drop') ? 'last' : null,
        }
      })

      const totalWeight = stops.reduce((s, st) => s + st.weight, 0)

      const extraVanCapacity = routeWeightLimit !== null
        ? Math.min(EXTRA_VAN_CAPACITY, routeWeightLimit)
        : EXTRA_VAN_CAPACITY

      // Plan → assign → OSRM → working-day check → replan. If a truck's total day
      // (drive + 15min/drop + 45min break ≥ 4h30 driving) exceeds 9h, prohibit its
      // double-run; if even a single run overflows, add a bonus extra van. Repeat
      // until every vehicle fits within the working day or we exhaust replans.
      type Candidate = {
        assignment: TruckAssignment
        orderedStops: Stop[]
        routeDetails: RouteResult | null
        startMin: number
        schedule: Schedule | null
      }

      const noDoubleRunTruckIds = new Set<string>()
      let bonusVans = 0
      let candidates: Candidate[] = []
      let attempts = 0
      const MAX_ATTEMPTS = 10
      const MAX_BONUS_VANS = 15
      let lastAssignErr: string | null = null

      while (attempts < MAX_ATTEMPTS) {
        attempts++
        const plannedSlotsThisPass = planSlots(trucksWithLimit, totalWeight, {
          extraVanCapacity,
          noDoubleRunTruckIds,
          bonusVans,
        })

        let slotsThisPass: TruckSlot[]
        try {
          slotsThisPass = await resolveExtraVans(plannedSlotsThisPass, depotKey, extraVanCapacity)
        } catch (err) {
          errors.push(`Failed to provision Extra Vans for ${depotKey ?? 'unassigned'}: ${err instanceof Error ? err.message : String(err)}`)
          break
        }

        let assignments: TruckAssignment[]
        try {
          assignments = assignToTrucks(stops, slotsThisPass, minTruckLoadPct)
        } catch (err) {
          // Infeasible packing — add another van's worth of capacity and retry.
          lastAssignErr = err instanceof Error ? err.message : String(err)
          if (bonusVans >= MAX_BONUS_VANS) {
            errors.push(`Could not produce feasible routes for ${depotKey ?? 'unassigned'} even after ${bonusVans} bonus Extra Vans: ${lastAssignErr}`)
            candidates = []
            break
          }
          bonusVans++
          continue
        }

        for (const s of slotsThisPass) {
          if (s.isExtraVan && !extraVansCreated.includes(s.truckName)) extraVansCreated.push(s.truckName)
        }

        candidates = []
        // Runs in order so a truck's Run 2 starts when its Run 1 gets back —
        // otherwise Run 2's ETAs (and its AM/PM windows) would be fiction.
        const truckFreeAt = new Map<string, number>()
        const byRun = [...assignments].sort((a, b) => a.runNumber - b.runNumber)
        for (const assignment of byRun) {
          const startMin = truckFreeAt.get(assignment.truckId) ?? dayStartMin
          let orderedStops = await osrmTripOptimize(depotLocation, assignment.stops, optimizeStopOrder)
          if (hasTimeConstraints(orderedStops)) {
            const points = [depotLocation, ...orderedStops]
            const matrix = (await osrmDurationMatrix(points)) ?? estimateDurationMatrix(points)
            orderedStops = sequenceForTimeWindows(orderedStops, matrix, startMin)
          }
          let routeDetails: RouteResult | null = null
          if (orderedStops.length > 0) {
            routeDetails = await getRouteDetails(depotLocation, depotLocation, orderedStops)
          }
          const schedule = routeDetails
            ? computeStopSchedule(orderedStops, routeDetails.legs.map((l) => l.duration), startMin)
            : null
          truckFreeAt.set(
            assignment.truckId,
            schedule ? schedule.endMin : startMin + computeRunTime(0, orderedStops.length).totalMin
          )
          candidates.push({ assignment, orderedStops, routeDetails, startMin, schedule })
        }

        // Working-day check. The total time a driver is out (drive + drops + break)
        // for all runs on the same vehicle must fit maxWorkingDayMin (the rule-driven
        // cap or the 9h default). If a truck with a Run 2 overflows, prohibit its
        // double-run and replan. If anything overflows on its own (single run or an
        // extra van), the depot doesn't have enough capacity — add a bonus extra van
        // and replan.
        const byTruck = new Map<string, Candidate[]>()
        for (const c of candidates) {
          if (c.assignment.isExtraVan) continue
          const arr = byTruck.get(c.assignment.truckId) ?? []
          arr.push(c)
          byTruck.set(c.assignment.truckId, arr)
        }

        const runTime = (c: Candidate) =>
          computeRunTime(c.routeDetails?.totalDuration ?? 0, c.orderedStops.length, c.schedule?.waitMin ?? 0).totalMin

        const newlyProhibited: string[] = []
        let overflowSingleRun = false

        for (const [truckId, runs] of byTruck) {
          const dayTotal = runs.reduce((s, c) => s + runTime(c), 0)
          if (dayTotal <= maxWorkingDayMin) continue
          if (runs.length > 1 && !noDoubleRunTruckIds.has(truckId)) {
            newlyProhibited.push(truckId)
          } else {
            overflowSingleRun = true
          }
        }

        // Extra Vans aren't grouped above; check each individually.
        for (const c of candidates) {
          if (!c.assignment.isExtraVan) continue
          if (runTime(c) > maxWorkingDayMin) overflowSingleRun = true
        }

        if (newlyProhibited.length === 0 && !overflowSingleRun) break
        newlyProhibited.forEach((id) => noDoubleRunTruckIds.add(id))
        if (overflowSingleRun && bonusVans < MAX_BONUS_VANS) bonusVans++
      }

      if (candidates.length === 0) continue
      if (attempts === MAX_ATTEMPTS) {
        errors.push(
          `${depotKey ?? 'unassigned'}: hit max replan attempts (${MAX_ATTEMPTS}). Some vehicles may still exceed the ${maxWorkingDayMin}-minute working-day limit.`
        )
      }

      // Phase 3: persist routes + stops.
      for (const { assignment, orderedStops, routeDetails, startMin, schedule } of candidates) {
        const dayLabel = day.charAt(0).toUpperCase() + day.slice(1)
        const runSuffix = assignment.isExtraVan
          ? ''
          : assignment.runNumber > 1
            ? ` (Run ${assignment.runNumber})`
            : ''
        const routeName = `${assignment.truckName}${runSuffix} - ${dayLabel} ${date}`

        // totalDuration is now the full working-day total (drive + drops + break);
        // drivingDuration stores the OSRM driving-only portion for the breakdown UI.
        const drivingMin = routeDetails?.totalDuration ?? null
        const workingDayMin = drivingMin !== null
          ? computeRunTime(drivingMin, orderedStops.length, schedule?.waitMin ?? 0).totalMin
          : null

        // Surface any delivery windows we still couldn't hit (too many AM drops
        // for one vehicle, a far-flung "before 9" etc.) so the dispatcher can
        // move stops by hand rather than discover it from the customer.
        schedule?.stops.forEach((t, idx) => {
          if (t.lateMin <= 0) return
          const stop = orderedStops[idx]
          errors.push(
            `${routeName}: ${stop.customer} (${stop.postcode}) ETA ${formatClock(t.serviceStartMin)} misses its window ` +
            `(due by ${formatClock(stop.windowEnd!)}, ${Math.round(t.lateMin)} min late).`
          )
        })

        const route = await prisma.route.create({
          data: {
            name: routeName,
            date: new Date(date + 'T08:00:00.000Z'),
            truckId: assignment.truckId,
            status: 'planned',
            totalWeight: assignment.totalWeight,
            totalDistance: routeDetails?.totalDistance ?? null,
            totalDuration: workingDayMin,
            drivingDuration: drivingMin,
            startTime: startMin,
            depot: depotKey ?? null,
          },
        })

        await prisma.$transaction(async (tx) => {
          for (let idx = 0; idx < orderedStops.length; idx++) {
            const stop = orderedStops[idx]
            const leg = routeDetails?.legs[idx]
            const timing = schedule?.stops[idx]
            await tx.routeStop.create({
              data: {
                routeId: route.id,
                orderId: stop.id,
                truckId: assignment.truckId,
                sequence: idx + 1,
                duration: leg?.duration ?? null,
                distance: leg?.distance ?? null,
                // ETAs are stored as wall-clock-in-UTC, same convention as Route.date.
                eta: timing ? new Date(dayMidnightMs + Math.round(timing.serviceStartMin) * 60_000) : null,
                notes: timing && timing.lateMin > 0
                  ? `Misses window: ETA ${formatClock(timing.serviceStartMin)}, due by ${formatClock(stop.windowEnd!)}`
                  : null,
              },
            })
          }
          await tx.order.updateMany({
            where: { id: { in: orderedStops.map((s) => s.id) } },
            data: { status: 'scheduled' },
          })
        })

        createdRoutes.push({
          routeId: route.id,
          routeName,
          stops: orderedStops.length,
          isExtraVan: assignment.isExtraVan,
          runNumber: assignment.runNumber,
        })
      }
    }

    if (createdRoutes.length === 0 && errors.length > 0) {
      return Response.json({ error: errors.join(' ') }, { status: 400 })
    }

    return Response.json({
      routes: createdRoutes,
      total: createdRoutes.length,
      ordersRouted: orders.length,
      routeWeightLimitApplied: routeWeightLimit,
      extraVansUsed: extraVansCreated.length,
      doubleRuns: createdRoutes.filter((r) => !r.isExtraVan && r.runNumber > 1).length,
      palletNetworkFlagged,
      warnings: errors.length > 0 ? errors : undefined,
    })
  } catch (err) {
    console.error('Route generation error:', err)
    return Response.json(
      { error: String(err instanceof Error ? err.message : err) },
      { status: 500 }
    )
  }
}

