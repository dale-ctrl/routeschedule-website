import { prisma } from '@/lib/prisma'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')
  const day = searchParams.get('day')
  const depot = searchParams.get('depot')
  const page = parseInt(searchParams.get('page') ?? '1')
  const limit = parseInt(searchParams.get('limit') ?? '50')
  const search = searchParams.get('search') ?? ''

  console.log('[Orders GET] depot param:', JSON.stringify(depot), '| status:', status, '| search:', search)

  const where = {
    ...(status ? { status } : {}),
    ...(day ? { scheduledDay: day } : {}),
    ...(depot ? { depot } : {}),
    ...(search
      ? {
          OR: [
            { customer: { contains: search } },
            { postcode: { contains: search } },
            { reference: { contains: search } },
            { area: { contains: search } },
          ],
        }
      : {}),
  }

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.order.count({ where }),
  ])

  console.log('[Orders GET] returning', orders.length, 'of', total, 'orders')
  return Response.json({ orders, total, page, limit })
}

export async function POST(request: Request) {
  const body = await request.json()
  const order = await prisma.order.create({ data: body })
  return Response.json(order, { status: 201 })
}

export async function PATCH(request: Request) {
  const body = await request.json()
  const { ids, status } = body as { ids?: string[]; status: string }
  if (ids && ids.length > 0) {
    const { count } = await prisma.order.updateMany({ where: { id: { in: ids } }, data: { status } })
    return Response.json({ updated: count })
  }
  // No ids = reset all scheduled orders to pending
  const { count } = await prisma.order.updateMany({ where: { status: 'scheduled' }, data: { status: 'pending' } })
  return Response.json({ updated: count })
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url)
  const idsParam = searchParams.get('ids')
  const all = searchParams.get('all') === 'true'
  const status = searchParams.get('status')
  const day = searchParams.get('day')
  const depot = searchParams.get('depot')
  const search = searchParams.get('search') ?? ''

  let where: Record<string, unknown>
  if (idsParam) {
    const ids = idsParam.split(',').filter(Boolean)
    if (ids.length === 0) return Response.json({ error: 'No IDs provided' }, { status: 400 })
    where = { id: { in: ids } }
  } else if (all || status || day || depot || search) {
    where = {
      ...(status ? { status } : {}),
      ...(day ? { scheduledDay: day } : {}),
      ...(depot ? { depot } : {}),
      ...(search
        ? {
            OR: [
              { customer: { contains: search } },
              { postcode: { contains: search } },
              { reference: { contains: search } },
              { area: { contains: search } },
            ],
          }
        : {}),
    }
  } else {
    return Response.json(
      { error: 'Specify either ids, a filter (status/day/depot/search), or all=true' },
      { status: 400 }
    )
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // RouteStop.orderId has no ON DELETE CASCADE, so remove dependent stops first.
      const targets = await tx.order.findMany({ where, select: { id: true } })
      const targetIds = targets.map((t) => t.id)
      if (targetIds.length === 0) return { deleted: 0, routeStopsDeleted: 0 }

      const stops = await tx.routeStop.deleteMany({ where: { orderId: { in: targetIds } } })
      const orders = await tx.order.deleteMany({ where: { id: { in: targetIds } } })

      // Clean up now-empty routes so the UI doesn't carry stale shells.
      await tx.route.deleteMany({
        where: { stops: { none: {} } },
      })

      return { deleted: orders.count, routeStopsDeleted: stops.count }
    })

    return Response.json(result)
  } catch (err) {
    console.error('[Orders DELETE] failed:', err)
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
