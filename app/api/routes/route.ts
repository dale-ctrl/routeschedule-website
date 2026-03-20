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
