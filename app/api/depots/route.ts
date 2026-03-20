import { prisma } from '@/lib/prisma'

export async function GET() {
  const depots = await prisma.depot.findMany({ orderBy: { name: 'asc' } })
  return Response.json(depots)
}

export async function POST(request: Request) {
  const body = await request.json()
  const depot = await prisma.depot.create({
    data: {
      name: body.name,
      address: body.address ?? null,
      lat: body.lat ? Number(body.lat) : null,
      lng: body.lng ? Number(body.lng) : null,
      active: body.active ?? true,
    },
  })
  return Response.json(depot, { status: 201 })
}
