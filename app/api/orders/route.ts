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
  const ids = searchParams.get('ids')?.split(',') ?? []
  if (ids.length === 0) return Response.json({ error: 'No IDs provided' }, { status: 400 })
  await prisma.order.deleteMany({ where: { id: { in: ids } } })
  return Response.json({ deleted: ids.length })
}
