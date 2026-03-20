import { prisma } from '@/lib/prisma'
import { assignToTrucks, optimizeStopOrder } from '@/lib/route-optimizer'
import { getRouteDetails, osrmTripOptimize } from '@/lib/routing'
import { parseRule, getRouteWeightLimit, getMinTruckLoadPct } from '@/lib/rules-engine'

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

    // Fetch all pending geocoded orders
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

    // Fetch trucks
    const trucks = await prisma.truck.findMany({
      where: {
        active: true,
        ...(truckIds && truckIds.length > 0 ? { id: { in: truckIds } } : {}),
      },
    })

    if (trucks.length === 0) {
      return Response.json({ error: 'No active trucks available.' }, { status: 400 })
    }

    // Evaluate rules once across all orders
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

    // Determine depot groups to process.
    // If a specific depot was requested, just one group.
    // Otherwise split orders by their depot field so Andover orders never go to Plymouth trucks.
    const depotKeys: (string | null)[] = depot
      ? [depot]
      : [...new Set(orders.map((o) => o.depot ?? null))]

    const createdRoutes: { routeId: string; routeName: string; stops: number }[] = []
    const errors: string[] = []

    for (const depotKey of depotKeys) {
      // Orders for this depot group
      const depotOrders = depot ? orders : orders.filter((o) => (o.depot ?? null) === depotKey)

      // Trucks for this depot group
      const depotTrucks = (truckIds && truckIds.length > 0)
        ? trucks
        : trucks.filter((t) => (t.depot ?? null) === depotKey)

      if (depotTrucks.length === 0) {
        errors.push(`No active trucks assigned to ${depotKey ?? 'unassigned'} depot — ${depotOrders.length} order(s) skipped.`)
        continue
      }

      // Look up depot coordinates
      let depotLocation = { lat: 51.5, lng: -1.8 }
      if (depotKey) {
        const depotRecord = await prisma.depot.findUnique({ where: { name: depotKey } })
        if (depotRecord?.lat && depotRecord?.lng) {
          depotLocation = { lat: depotRecord.lat, lng: depotRecord.lng }
        }
      }

      const trucksWithLimit = depotTrucks.map((t) => ({
        ...t,
        capacity: routeWeightLimit !== null ? Math.min(t.capacity, routeWeightLimit) : t.capacity,
      }))

      const stops = depotOrders.map((o) => ({
        id: o.id, lat: o.lat!, lng: o.lng!, weight: o.weight,
        customer: o.customer, postcode: o.postcode, address: o.address,
        deliveryTime: o.deliveryTime, priority: o.priority,
        preferredTruckType: o.preferredTruckType ?? null,
      }))

      const assignments = assignToTrucks(stops, trucksWithLimit, minTruckLoadPct)

      for (const assignment of assignments) {
        const truck = depotTrucks.find((t) => t.id === assignment.truckId)!
        const orderedStops = await osrmTripOptimize(depotLocation, assignment.stops, optimizeStopOrder)

        let routeDetails = null
        if (orderedStops.length > 0) {
          const origin = depotLocation
          const destination = orderedStops[orderedStops.length - 1]
          const waypoints = orderedStops.slice(0, -1)
          routeDetails = await getRouteDetails(origin, destination, waypoints)
        }

        const routeName = `${truck.name} - ${day.charAt(0).toUpperCase() + day.slice(1)} ${date}`

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

        createdRoutes.push({ routeId: route.id, routeName, stops: orderedStops.length })
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
