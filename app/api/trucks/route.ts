import { prisma } from '@/lib/prisma'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const depot = searchParams.get('depot')
  const trucks = await prisma.truck.findMany({
    where: { ...(depot ? { depot } : {}) },
    orderBy: [{ depot: 'asc' }, { name: 'asc' }],
  })
  return Response.json(trucks)
}

export async function POST(request: Request) {
  const body = await request.json()
  const truck = await prisma.truck.create({
    data: {
      name: body.name,
      registration: body.registration ?? null,
      capacity: parseFloat(body.capacity) || 7500,
      type: body.type ?? '12T DAF',
      active: body.active ?? true,
      depot: body.depot ?? null,
      notes: body.notes ?? null,
    },
  })
  return Response.json(truck, { status: 201 })
}
