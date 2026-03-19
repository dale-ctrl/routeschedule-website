import { prisma } from '@/lib/prisma'
import { assignToTrucks, optimizeStopOrder } from '@/lib/route-optimizer'
import { getRouteDetails } from '@/lib/routing'
import { parseRule, getRouteWeightLimit } from '@/lib/rules-engine'

export async function POST(request: Request) {
  const body = await request.json()
  const { day, date, truckIds } = body as {
    day: string
    date: string
    truckIds?: string[]
  }

  if (!day || !date) {
    return Response.json({ error: 'day and date are required' }, { status: 400 })
  }

  // Fetch all pending geocoded orders and filter by day.
  // scheduledDay may be a single day ("tuesday") or comma-separated ("tuesday,friday")
  // so we include any order whose allowed days include the requested day.
  const allPending = await prisma.order.findMany({
    where: { status: 'pending', lat: { not: null }, lng: { not: null } },
  })

  const orders = allPending.filter((o) => {
    if (!o.scheduledDay) return false
    return o.scheduledDay.split(',').map((d) => d.trim()).includes(day)
  })

  if (orders.length === 0) {
    return Response.json({ error: 'No geocoded pending orders for this day' }, { status: 400 })
  }

  // Get trucks
  const trucks = await prisma.truck.findMany({
    where: {
      active: true,
      ...(truckIds && truckIds.length > 0 ? { id: { in: truckIds } } : {}),
    },
  })

  if (trucks.length === 0) {
    return Response.json({ error: 'No active trucks available' }, { status: 400 })
  }

  // Evaluate route-level weight limit rules against this batch of orders
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

  // Apply route weight limit: cap each truck's effective capacity
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
    const orderedStops = optimizeStopOrder(assignment.stops)

    const centLat = orderedStops.reduce((s, st) => s + st.lat, 0) / orderedStops.length
    const centLng = orderedStops.reduce((s, st) => s + st.lng, 0) / orderedStops.length

    let routeDetails = null
    if (orderedStops.length > 0) {
      const origin = { lat: centLat, lng: centLng }
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
      },
    })

    const stopCreates = orderedStops.map((stop, idx) => {
      const leg = routeDetails?.legs[idx]
      return prisma.routeStop.create({
        data: {
          routeId: route.id,
          orderId: stop.id,
          truckId: assignment.truckId,
          sequence: idx + 1,
          duration: leg?.duration ?? null,
          distance: leg?.distance ?? null,
        },
      })
    })

    await prisma.$transaction(stopCreates)

    await prisma.order.updateMany({
      where: { id: { in: orderedStops.map((s) => s.id) } },
      data: { status: 'scheduled' },
    })

    createdRoutes.push({ routeId: route.id, routeName, stops: orderedStops.length })
  }

  return Response.json({
    routes: createdRoutes,
    total: createdRoutes.length,
    routeWeightLimitApplied: routeWeightLimit,
  })
}
