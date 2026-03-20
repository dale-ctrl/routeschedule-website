import { prisma } from '@/lib/prisma'

/** Returns the distinct dates that have at least one route, for the date dropdown */
export async function GET() {
  const routes = await prisma.route.findMany({
    select: { date: true },
    orderBy: { date: 'desc' },
  })

  const seen = new Set<string>()
  const dates: string[] = []
  for (const r of routes) {
    const d = r.date.toISOString().slice(0, 10)
    if (!seen.has(d)) { seen.add(d); dates.push(d) }
  }

  return Response.json(dates)
}
