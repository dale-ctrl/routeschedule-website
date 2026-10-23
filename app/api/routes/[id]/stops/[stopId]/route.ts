import { prisma } from '@/lib/prisma'
import { getRouteDetails } from '@/lib/routing'
import { computeRunTime, computeStopSchedule, DEFAULT_DAY_START_MIN } from '@/lib/route-optimizer'
import { effectiveWindow, clockToMinutes, formatClock } from '@/lib/special-instructions'

/**
 * Remove one stop from a route. The order goes back to 'pending' (so it can
 * be re-routed or assigned elsewhere), remaining stops are resequenced 1..N,
 * route totals are recomputed (weight directly; distance/duration via a fresh
 * OSRM call), and the route is deleted entirely if it has no stops left.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; stopId: string }> }
) {
  const { id: routeId, stopId } = await params

  try {
    const stop = await prisma.routeStop.findUnique({
      where: { id: stopId },
      include: { order: true },
    })
    if (!stop || stop.routeId !== routeId) {
      return Response.json({ error: 'Stop not found on this route' }, { status: 404 })
    }

    const route = await prisma.route.findUnique({ where: { id: routeId } })
    if (!route) return Response.json({ error: 'Route not found' }, { status: 404 })

    // Remove the stop and release the order back to pending in one transaction
    // so we never end up with an orphaned order stuck on a deleted route.
    await prisma.$transaction(async (tx) => {
      await tx.routeStop.delete({ where: { id: stopId } })
      await tx.order.update({
        where: { id: stop.orderId },
        data: { status: 'pending' },
      })
    })

    // Pull the surviving stops in their current sequence order
    const remaining = await prisma.routeStop.findMany({
      where: { routeId },
      orderBy: { sequence: 'asc' },
      include: { order: true },
    })

    // No stops left → drop the whole route. Saves dispatchers having to clean
    // up empty shells in the Routes list after every edit.
    if (remaining.length === 0) {
      await prisma.route.delete({ where: { id: routeId } })
      return Response.json({ removed: true, routeDeleted: true })
    }

    // Resequence 1..N so the stop numbers stay tidy after deletion.
    await prisma.$transaction(
      remaining.map((s, i) =>
        prisma.routeStop.update({ where: { id: s.id }, data: { sequence: i + 1 } })
      )
    )

    // Recompute the route's headline numbers. Weight is just summing; for
    // drive time and distance we need a fresh OSRM call against the depot.
    const totalWeight = remaining.reduce((acc, s) => acc + s.order.weight, 0)

    let depotLocation: { lat: number; lng: number } | null = null
    if (route.depot) {
      const depotRecord = await prisma.depot.findUnique({ where: { name: route.depot } })
      if (depotRecord?.lat && depotRecord?.lng) {
        depotLocation = { lat: depotRecord.lat, lng: depotRecord.lng }
      }
    }

    const geocodedStops = remaining.filter(
      (s) => s.order.lat !== null && s.order.lng !== null
    )

    let drivingMin: number | null = null
    let totalDistance: number | null = null
    let workingDayMin: number | null = null
    const legUpdates: {
      id: string
      duration: number | null
      distance: number | null
      eta: Date | null
      notes: string | null
    }[] = []

    if (depotLocation && geocodedStops.length > 0) {
      const waypoints = geocodedStops.map((s) => ({ lat: s.order.lat!, lng: s.order.lng! }))
      const details = await getRouteDetails(depotLocation, depotLocation, waypoints)
      if (details) {
        drivingMin = details.totalDuration
        totalDistance = details.totalDistance

        // Recompute ETAs from the run's original departure time — removing a
        // stop can pull later drops earlier (and fix or reveal window misses).
        let startMin = route.startTime
        if (startMin == null) {
          const setting = await prisma.setting.findUnique({ where: { key: 'ROUTE_START_TIME' } })
          startMin = clockToMinutes(setting?.value) ?? DEFAULT_DAY_START_MIN
        }
        const scheduleStops = geocodedStops.map((s) => {
          const w = effectiveWindow(s.order)
          return {
            id: s.id, lat: s.order.lat!, lng: s.order.lng!, weight: s.order.weight,
            customer: s.order.customer, postcode: s.order.postcode, priority: s.order.priority,
            windowStart: w.start, windowEnd: w.end,
          }
        })
        const schedule = computeStopSchedule(scheduleStops, details.legs.map((l) => l.duration), startMin)
        const midnightMs = new Date(route.date.toISOString().slice(0, 10) + 'T00:00:00.000Z').getTime()

        workingDayMin = computeRunTime(drivingMin, remaining.length, schedule.waitMin).totalMin
        geocodedStops.forEach((s, i) => {
          const leg = details.legs[i]
          const timing = schedule.stops[i]
          const windowEnd = scheduleStops[i].windowEnd
          legUpdates.push({
            id: s.id,
            duration: leg.duration,
            distance: leg.distance,
            eta: new Date(midnightMs + Math.round(timing.serviceStartMin) * 60_000),
            notes: timing.lateMin > 0 && windowEnd != null
              ? `Misses window: ETA ${formatClock(timing.serviceStartMin)}, due by ${formatClock(windowEnd)}`
              : null,
          })
        })
      }
    }

    await prisma.$transaction([
      prisma.route.update({
        where: { id: routeId },
        data: {
          totalWeight,
          totalDistance,
          totalDuration: workingDayMin,
          drivingDuration: drivingMin,
        },
      }),
      ...legUpdates.map((u) =>
        prisma.routeStop.update({
          where: { id: u.id },
          data: { duration: u.duration, distance: u.distance, eta: u.eta, notes: u.notes },
        })
      ),
    ])

    return Response.json({ removed: true, routeDeleted: false, remainingStops: remaining.length })
  } catch (err) {
    console.error('[Route stop DELETE] failed:', err)
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
