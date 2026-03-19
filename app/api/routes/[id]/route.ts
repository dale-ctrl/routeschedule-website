import { prisma } from '@/lib/prisma'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const route = await prisma.route.findUnique({
    where: { id },
    include: {
      truck: true,
      stops: {
        orderBy: { sequence: 'asc' },
        include: {
          order: true,
        },
      },
    },
  })
  if (!route) return Response.json({ error: 'Not found' }, { status: 404 })
  return Response.json(route)
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()
  const route = await prisma.route.update({
    where: { id },
    data: {
      name: body.name,
      status: body.status,
      notes: body.notes,
      totalWeight: body.totalWeight,
      totalDistance: body.totalDistance,
      totalDuration: body.totalDuration,
    },
  })
  return Response.json(route)
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await prisma.route.delete({ where: { id } })
  return Response.json({ deleted: true })
}
