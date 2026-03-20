import { prisma } from '@/lib/prisma'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const day = searchParams.get('day') ?? ''

  const allPending = await prisma.order.findMany({
    where: { status: 'pending', lat: { not: null }, lng: { not: null } },
    select: { id: true, scheduledDay: true },
  })

  let dayCount = 0
  let unassignedCount = 0

  for (const o of allPending) {
    if (!o.scheduledDay) {
      unassignedCount++
    } else if (o.scheduledDay.split(',').map((d) => d.trim()).includes(day)) {
      dayCount++
    }
  }

  return Response.json({ dayCount, unassignedCount, total: dayCount + unassignedCount })
}
