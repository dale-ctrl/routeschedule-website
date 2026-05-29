import { prisma } from '@/lib/prisma'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const day = searchParams.get('day') ?? ''
  const date = searchParams.get('date') ?? ''
  const depot = searchParams.get('depot') ?? ''

  const allPending = await prisma.order.findMany({
    where: { status: 'pending', lat: { not: null }, lng: { not: null } },
    select: { id: true, scheduledDay: true, deliveryDate: true, depot: true },
  })

  let dayCount = 0
  let unassignedCount = 0

  for (const o of allPending) {
    if (depot && o.depot !== depot) continue
    // If sales tagged a specific delivery date, it's authoritative and overrides
    // weekday matching — we only count it for the exact date being generated.
    if (o.deliveryDate) {
      if (date && o.deliveryDate.toISOString().slice(0, 10) === date) dayCount++
      continue
    }
    if (!o.scheduledDay) {
      unassignedCount++
    } else if (o.scheduledDay.split(',').map((d) => d.trim()).includes(day)) {
      dayCount++
    }
  }

  return Response.json({ dayCount, unassignedCount, total: dayCount + unassignedCount })
}
