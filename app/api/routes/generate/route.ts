import { prisma } from '@/lib/prisma'
import {
  assignToTrucks,
  optimizeStopOrder,
  planSlots,
  computeRunTime,
  EXTRA_VAN_CAPACITY,
  MAX_WORKING_DAY_MIN,
  MAX_DEPOT_DISTANCE_KM,
  type TruckSlot,
  type TruckAssignment,
  type Stop,
} from '@/lib/route-optimizer'
import { getRouteDetails, osrmTripOptimize, type RouteResult } from '@/lib/routing'
import { parseRule, getRouteWeightLimit, getMinTruckLoadPct } from '@/lib/rules-engine'
import { haversineDistance } from '@/lib/utils'

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

    const allPending = await prisma.order.findMany({
      where: { status: 'pending', lat: { not: null }, lng: { not: null } },
    })

    const orders = allPending.filter((o) => {
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

    const trucks = await prisma.truck.findMany({
      where: {
        active: true,
        ...(truckIds && truckIds.length > 0 ? { id: { in: truckIds } } : {}),
        // Exclude Extra Vans (provisioned on demand) and Pallet Network trucks
        // (used only for flagged out-of-area stops, handled separately below).
        type: { notIn: ['Extra Van', 'Pallet Network'] },
      },
    })

    if (trucks.length === 0) {
      return Response.json({ error: 'No active trucks available.' }, { status: 400 })
    }

    // Optional: the first active Pallet Network truck becomes the home for any
    // stops the pallet-network filter pulls out of regular routing. Each flagged
    // stop gets its own single-stop route on this truck so dispatchers can hand
    // them off to the pallet network partner individually.
    const palletNetworkTrucks = await prisma.truck.findMany({
      where: { active: true, type: 'Pallet Network' },
      orderBy: { createdAt: 'asc' },
    })
    const palletNetworkTruck = palletNetworkTrucks[0] ?? null

    const allRules = await prisma.rule.findMany({ where: { active: true } })
    const parsedRules = allRules.map(parseRule)
    const ordersForRules = orders.map((o) => ({
      id: o.id, postcode: o.postcode, area: o.area, weight: o.weight,
      customer: o.customer, notes: o.notes, reference: o.reference,
      deliveryTime: o.deliveryTime, scheduledDay: o.scheduledDay,
      priority: o.priority, depot: o.depot,
    }))
    const routeWeightLimit = getRouteWeightLimit(parsedRules, ordersForRules)
    const minTruckLoadPct = getMinTruckLoadPct(parsedRules, ordersForRules)

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
      let depotHasRealCoords = false
      if (depotKey) {
        const depotRecord = await prisma.depot.findUnique({ where: { name: depotKey } })
        if (depotRecord?.lat && depotRecord?.lng) {
          depotLocation = { lat: depotRecord.lat, lng: depotRecord.lng }
          depotHasRealCoords = true
        }
      }

      const trucksWithLimit = depotTrucks.map((t) => ({
        id: t.id,
        name: t.name,
        capacity: routeWeightLimit !== null ? Math.min(t.capacity, routeWeightLimit) : t.capacity,
        type: t.type ?? null,
      }))

      // Pallet-network pre-filter. A stop whose straight-line distance to its
      // assigned depot exceeds MAX_DEPOT_DISTANCE_KM is too far for an efficient
      // van/truck run regardless of whether it technically fits a working day —
      // beyond this range a dedicated van wastes most of the day on driving and
      // the work belongs on a pallet network. The depot override at import time
      // already moved each order to its nearest sensible depot, so this check
      // against the assigned depot is equivalent to "no depot is close enough."
      // Only fires when the depot has real coordinates; otherwise the UK-centre
      // fallback would mis-flag stops at random.
      const palletNetworkIds: string[] = []
      const inAreaOrders = depotOrders.filter((o) => {
        if (!depotHasRealCoords) return true
        if (o.lat == null || o.lng == null) return true
        const km = haversineDistance(depotLocation.lat, depotLocation.lng, o.lat, o.lng)
        if (km > MAX_DEPOT_DISTANCE_KM) {
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
          // No Pallet Network truck configured — just flag the orders so they
          // aren't routed. Dispatcher can create a "Pallet Network" truck and
          // re-generate to have them picked up automatically.
          await prisma.order.updateMany({
            where: { id: { in: palletNetworkIds } },
            data: { status: 'pallet_network' },
          })
          errors.push(
            `${depotKey ?? 'unassigned'}: ${palletNetworkIds.length} order(s) flagged as pallet network — more than ${MAX_DEPOT_DISTANCE_KM}km straight-line from depot. Add a truck with type "Pallet Network" to route these automatically.`
          )
        }
      }

      if (inAreaOrders.length === 0) continue

      const stops = inAreaOrders.map((o) => ({
        id: o.id, lat: o.lat!, lng: o.lng!, weight: o.weight,
        customer: o.customer, postcode: o.postcode, address: o.address,
        deliveryTime: o.deliveryTime, priority: o.priority,
        preferredTruckType: o.preferredTruckType ?? null,
      }))

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
        for (const assignment of assignments) {
          const orderedStops = await osrmTripOptimize(depotLocation, assignment.stops, optimizeStopOrder)
          let routeDetails: RouteResult | null = null
          if (orderedStops.length > 0) {
            routeDetails = await getRouteDetails(depotLocation, depotLocation, orderedStops)
          }
          candidates.push({ assignment, orderedStops, routeDetails })
        }

        // Working-day check. The total time a driver is out (drive + drops + break)
        // for all runs on the same vehicle must fit MAX_WORKING_DAY_MIN. If a truck
        // with a Run 2 overflows, prohibit its double-run and replan. If anything
        // overflows on its own (single run or an extra van), the depot doesn't have
        // enough capacity — add a bonus extra van and replan.
        const byTruck = new Map<string, Candidate[]>()
        for (const c of candidates) {
          if (c.assignment.isExtraVan) continue
          const arr = byTruck.get(c.assignment.truckId) ?? []
          arr.push(c)
          byTruck.set(c.assignment.truckId, arr)
        }

        const runTime = (c: Candidate) =>
          computeRunTime(c.routeDetails?.totalDuration ?? 0, c.orderedStops.length).totalMin

        const newlyProhibited: string[] = []
        let overflowSingleRun = false

        for (const [truckId, runs] of byTruck) {
          const dayTotal = runs.reduce((s, c) => s + runTime(c), 0)
          if (dayTotal <= MAX_WORKING_DAY_MIN) continue
          if (runs.length > 1 && !noDoubleRunTruckIds.has(truckId)) {
            newlyProhibited.push(truckId)
          } else {
            overflowSingleRun = true
          }
        }

        // Extra Vans aren't grouped above; check each individually.
        for (const c of candidates) {
          if (!c.assignment.isExtraVan) continue
          if (runTime(c) > MAX_WORKING_DAY_MIN) overflowSingleRun = true
        }

        if (newlyProhibited.length === 0 && !overflowSingleRun) break
        newlyProhibited.forEach((id) => noDoubleRunTruckIds.add(id))
        if (overflowSingleRun && bonusVans < MAX_BONUS_VANS) bonusVans++
      }

      if (candidates.length === 0) continue
      if (attempts === MAX_ATTEMPTS) {
        errors.push(
          `${depotKey ?? 'unassigned'}: hit max replan attempts (${MAX_ATTEMPTS}). Some vehicles may still exceed the ${MAX_WORKING_DAY_MIN}-minute working-day limit.`
        )
      }

      // Phase 3: persist routes + stops.
      for (const { assignment, orderedStops, routeDetails } of candidates) {
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
          ? computeRunTime(drivingMin, orderedStops.length).totalMin
          : null

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
            depot: depotKey ?? null,
          },
        })

        await prisma.$transaction(async (tx) => {
          for (let idx = 0; idx < orderedStops.length; idx++) {
            const stop = orderedStops[idx]
            const leg = routeDetails?.legs[idx]
            await tx.routeStop.create({
              data: {
                routeId: route.id,
                orderId: stop.id,
                truckId: assignment.truckId,
                sequence: idx + 1,
                duration: leg?.duration ?? null,
                distance: leg?.distance ?? null,
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

