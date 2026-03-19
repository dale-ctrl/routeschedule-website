import { prisma } from '@/lib/prisma'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const order = await prisma.order.findUnique({
    where: { id },
    include: { routeStops: { include: { route: true } } },
  })
  if (!order) return Response.json({ error: 'Not found' }, { status: 404 })
  return Response.json(order)
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()
  const order = await prisma.order.update({ where: { id }, data: body })
  return Response.json(order)
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await prisma.order.delete({ where: { id } })
  return Response.json({ deleted: true })
}
