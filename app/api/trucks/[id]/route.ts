import { prisma } from '@/lib/prisma'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const truck = await prisma.truck.findUnique({
    where: { id },
    include: { routes: { take: 10, orderBy: { createdAt: 'desc' } } },
  })
  if (!truck) return Response.json({ error: 'Not found' }, { status: 404 })
  return Response.json(truck)
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()
  const truck = await prisma.truck.update({
    where: { id },
    data: {
      name: body.name,
      registration: body.registration,
      capacity: parseFloat(body.capacity) || 7500,
      type: body.type,
      active: body.active,
      notes: body.notes,
    },
  })
  return Response.json(truck)
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await prisma.truck.update({ where: { id }, data: { active: false } })
  return Response.json({ deactivated: true })
}
