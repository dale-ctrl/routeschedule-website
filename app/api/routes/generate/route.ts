import { prisma } from '@/lib/prisma'
import {
  assignToTrucks,
  optimizeStopOrder,
  planSlots,
  EXTRA_VAN_CAPACITY,
  type TruckSlot,
  type TruckAssignment,
  type Stop,
} from '@/lib/route-optimizer'
import { getRouteDetails, osrmTripOptimize, type RouteResult } from '@/lib/routing'
import { parseRule, getRouteWeightLimit, getMinTruckLoadPct } from '@/lib/rules-engine'

/** Max on-road time per truck per day (minutes). Door-to-door: depot → stops → depot. */
const DRIVER_DAY_LIMIT_MIN = 240

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
        // Exclude Extra Van pool from the "regular fleet" — they are provisioned on demand below.
        NOT: { type: 'Extra Van' },
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

      const stops = depotOrders.map((o) => ({
        id: o.id, lat: o.lat!, lng: o.lng!, weight: o.weight,
        customer: o.customer, postcode: o.postcode, address: o.address,
        deliveryTime: o.deliveryTime, priority: o.priority,
        preferredTruckType: o.preferredTruckType ?? null,
      }))

      const totalWeight = stops.reduce((s, st) => s + st.weight, 0)

      const extraVanCapacity = routeWeightLimit !== null
        ? Math.min(EXTRA_VAN_CAPACITY, routeWeightLimit)
        : EXTRA_VAN_CAPACITY

      // Plan → assign → OSRM → 4h check → replan (prohibit double-runs on trucks that
      // exceeded the limit). Repeat until every truck fits within the driver day, or we
      // run out of double-run options. The replan uses planSlots again which will
      // automatically insert enough correctly-sized Extra Vans to absorb the overflow.
      type Candidate = {
        assignment: TruckAssignment
        orderedStops: Stop[]
        routeDetails: RouteResult | null
      }

      const noDoubleRunTruckIds = new Set<string>()
      let candidates: Candidate[] = []
      let attempts = 0
      const MAX_ATTEMPTS = 4

      while (attempts < MAX_ATTEMPTS) {
        attempts++
        const plannedSlotsThisPass = planSlots(trucksWithLimit, totalWeight, {
          extraVanCapacity,
          noDoubleRunTruckIds,
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
          errors.push(`Could not produce feasible routes for ${depotKey ?? 'unassigned'}: ${err instanceof Error ? err.message : String(err)}`)
          candidates = []
          break
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

        // Group non-extra-van runs by truck and find any truck whose door-to-door total
        // exceeds the driver-day limit. Prohibit those trucks from getting a Run 2 next pass.
        const byTruck = new Map<string, Candidate[]>()
        for (const c of candidates) {
          if (c.assignment.isExtraVan) continue
          const arr = byTruck.get(c.assignment.truckId) ?? []
          arr.push(c)
          byTruck.set(c.assignment.truckId, arr)
        }

        const newlyProhibited: string[] = []
        for (const [truckId, runs] of byTruck) {
          if (runs.length <= 1) continue
          const total = runs.reduce((s, c) => s + (c.routeDetails?.totalDuration ?? 0), 0)
          if (total > DRIVER_DAY_LIMIT_MIN && !noDoubleRunTruckIds.has(truckId)) {
            newlyProhibited.push(truckId)
          }
        }

        if (newlyProhibited.length === 0) break
        newlyProhibited.forEach((id) => noDoubleRunTruckIds.add(id))
        if (attempts === MAX_ATTEMPTS) {
          errors.push(
            `${depotKey ?? 'unassigned'}: driver-day limit (${DRIVER_DAY_LIMIT_MIN} min) could not be satisfied after ${MAX_ATTEMPTS} attempts — some trucks may still be over.`
          )
        }
      }

      if (candidates.length === 0) continue

      // Phase 3: persist routes + stops.
      for (const { assignment, orderedStops, routeDetails } of candidates) {
        const dayLabel = day.charAt(0).toUpperCase() + day.slice(1)
        const runSuffix = assignment.isExtraVan
          ? ''
          : assignment.runNumber > 1
            ? ` (Run ${assignment.runNumber})`
            : ''
        const routeName = `${assignment.truckName}${runSuffix} - ${dayLabel} ${date}`

        const route = await prisma.route.create({
          data: {
            name: routeName,
            date: new Date(date + 'T08:00:00.000Z'),
            truckId: assignment.truckId,
            status: 'planned',
            totalWeight: assignment.totalWeight,
            totalDistance: routeDetails?.totalDistance ?? null,
            totalDuration: routeDetails?.totalDuration ?? null,
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

