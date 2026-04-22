import { prisma } from '@/lib/prisma'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')
  const date = searchParams.get('date')
  const depot = searchParams.get('depot')

  const where = {
    ...(status ? { status } : {}),
    ...(depot ? { depot } : {}),
    ...(date
      ? {
          date: {
            gte: new Date(date + 'T00:00:00.000Z'),
            lt: new Date(date + 'T23:59:59.999Z'),
          },
        }
      : {}),
  }

  const routes = await prisma.route.findMany({
    where,
    orderBy: { date: 'desc' },
    include: {
      truck: { select: { id: true, name: true, registration: true, capacity: true } },
      stops: {
        orderBy: { sequence: 'asc' },
        include: {
          order: {
            select: {
              id: true,
              customer: true,
              postcode: true,
              address: true,
              weight: true,
              lat: true,
              lng: true,
              deliveryTime: true,
            },
          },
        },
      },
    },
  })

  return Response.json(routes)
}

export async function POST(request: Request) {
  const body = await request.json()
  const route = await prisma.route.create({
    data: {
      name: body.name,
      date: new Date(body.date),
      truckId: body.truckId,
      status: body.status ?? 'planned',
      totalWeight: body.totalWeight ?? 0,
      notes: body.notes,
      depot: body.depot ?? null,
    },
  })
  return Response.json(route, { status: 201 })
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url)
  const idsParam = searchParams.get('ids')
  const all = searchParams.get('all') === 'true'
  const date = searchParams.get('date')
  const depot = searchParams.get('depot')
  const status = searchParams.get('status')

  let where: Record<string, unknown>
  if (idsParam) {
    const ids = idsParam.split(',').filter(Boolean)
    if (ids.length === 0) return Response.json({ error: 'No IDs provided' }, { status: 400 })
    where = { id: { in: ids } }
  } else if (all || date || depot || status) {
    where = {
      ...(status ? { status } : {}),
      ...(depot ? { depot } : {}),
      ...(date
        ? {
            date: {
              gte: new Date(date + 'T00:00:00.000Z'),
              lt: new Date(date + 'T23:59:59.999Z'),
            },
          }
        : {}),
    }
  } else {
    return Response.json(
      { error: 'Specify either ids, a filter (status/date/depot), or all=true' },
      { status: 400 }
    )
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const targets = await tx.route.findMany({ where, select: { id: true } })
      const routeIds = targets.map((t) => t.id)
      if (routeIds.length === 0) return { deleted: 0, ordersReset: 0 }

      // Collect orders currently attached to these routes so we can release them back
      // to pending — otherwise they stay stuck as 'scheduled' and the generator won't
      // pick them up on the next run.
      const stops = await tx.routeStop.findMany({
        where: { routeId: { in: routeIds } },
        select: { orderId: true },
      })
      const orderIds = [...new Set(stops.map((s) => s.orderId))]

      const deleted = await tx.route.deleteMany({ where: { id: { in: routeIds } } })

      let ordersReset = 0
      if (orderIds.length > 0) {
        const r = await tx.order.updateMany({
          where: { id: { in: orderIds }, status: 'scheduled' },
          data: { status: 'pending' },
        })
        ordersReset = r.count
      }

      return { deleted: deleted.count, ordersReset }
    })

    return Response.json(result)
  } catch (err) {
    console.error('[Routes DELETE] failed:', err)
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
