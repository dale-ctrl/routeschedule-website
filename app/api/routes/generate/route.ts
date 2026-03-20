import { prisma } from '@/lib/prisma'
import { assignToTrucks, optimizeStopOrder } from '@/lib/route-optimizer'
import { getRouteDetails } from '@/lib/routing'
import { parseRule, getRouteWeightLimit } from '@/lib/rules-engine'

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
      if (!o.scheduledDay) {
        // Include orders with no day assigned if the option is checked
        return includeUnassigned === true
      }
      return o.scheduledDay.split(',').map((d) => d.trim()).includes(day)
    })

    // Look up depot coordinates
    let depotLocation = { lat: 51.5, lng: -1.8 } // fallback
    if (depot) {
      const depotRecord = await prisma.depot.findUnique({ where: { name: depot } })
      if (depotRecord?.lat && depotRecord?.lng) {
        depotLocation = { lat: depotRecord.lat, lng: depotRecord.lng }
      }
    }

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

    // Get trucks — filter by depot if one is selected, otherwise only use trucks with no depot assigned
    const trucks = await prisma.truck.findMany({
      where: {
        active: true,
        ...(truckIds && truckIds.length > 0
          ? { id: { in: truckIds } }
          : depot
          ? { depot }
          : {}),
      },
    })

    if (trucks.length === 0) {
      return Response.json(
        { error: depot ? `No active trucks assigned to the ${depot} depot.` : 'No active trucks available.' },
        { status: 400 }
      )
    }

    // Evaluate route-level weight limit rules
    const allRules = await prisma.rule.findMany({ where: { active: true } })
    const parsedRules = allRules.map(parseRule)
    const ordersForRules = orders.map((o) => ({
      id: o.id,
      postcode: o.postcode,
      area: o.area,
      weight: o.weight,
      customer: o.customer,
      notes: o.notes,
      reference: o.reference,
      deliveryTime: o.deliveryTime,
      scheduledDay: o.scheduledDay,
      priority: o.priority,
    }))
    const routeWeightLimit = getRouteWeightLimit(parsedRules, ordersForRules)

    const trucksWithLimit = trucks.map((t) => ({
      ...t,
      capacity: routeWeightLimit !== null ? Math.min(t.capacity, routeWeightLimit) : t.capacity,
    }))

    const stops = orders.map((o) => ({
      id: o.id,
      lat: o.lat!,
      lng: o.lng!,
      weight: o.weight,
      customer: o.customer,
      postcode: o.postcode,
      address: o.address,
      deliveryTime: o.deliveryTime,
      priority: o.priority,
    }))

    const assignments = assignToTrucks(stops, trucksWithLimit)
    const createdRoutes = []

    for (const assignment of assignments) {
      const truck = trucks.find((t) => t.id === assignment.truckId)!
      const orderedStops = optimizeStopOrder(assignment.stops, depotLocation)

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
          depot: depot ?? null,
        },
      })

      // Use callback-form transaction (compatible with SQLite adapter)
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

    return Response.json({
      routes: createdRoutes,
      total: createdRoutes.length,
      ordersRouted: orders.length,
      routeWeightLimitApplied: routeWeightLimit,
    })
  } catch (err) {
    console.error('Route generation error:', err)
    return Response.json(
      { error: String(err instanceof Error ? err.message : err) },
      { status: 500 }
    )
  }
}
