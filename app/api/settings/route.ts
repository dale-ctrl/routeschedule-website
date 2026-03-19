import { prisma } from '@/lib/prisma'

export async function GET() {
  const settings = await prisma.setting.findMany()
  const map = Object.fromEntries(settings.map((s) => [s.key, s.value]))
  return Response.json(map)
}

export async function POST(request: Request) {
  const body = await request.json() as Record<string, string>
  const upserts = Object.entries(body).map(([key, value]) =>
    prisma.setting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    })
  )
  await prisma.$transaction(upserts)
  return Response.json({ saved: Object.keys(body).length })
}
