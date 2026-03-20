import { prisma } from '@/lib/prisma'

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()
  const depot = await prisma.depot.update({
    where: { id },
    data: {
      name: body.name,
      address: body.address ?? null,
      lat: body.lat ? Number(body.lat) : null,
      lng: body.lng ? Number(body.lng) : null,
      active: body.active ?? true,
    },
  })
  return Response.json(depot)
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await prisma.depot.delete({ where: { id } })
  return Response.json({ deleted: true })
}
