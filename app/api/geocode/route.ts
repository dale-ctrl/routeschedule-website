import { prisma } from '@/lib/prisma'
import { geocodePostcode } from '@/lib/routing'

export async function POST(request: Request) {
  const body = await request.json()
  const { orderIds } = body as { orderIds?: string[] }

  // If no IDs provided, geocode all ungeocodded orders
  const where = orderIds && orderIds.length > 0
    ? { id: { in: orderIds } }
    : { lat: null }

  const orders = await prisma.order.findMany({ where })

  let geocoded = 0
  let failed = 0

  for (const order of orders) {
    const result = await geocodePostcode(order.postcode)
    if (result) {
      await prisma.order.update({
        where: { id: order.id },
        data: { lat: result.lat, lng: result.lng, address: result.formatted },
      })
      geocoded++
    } else {
      failed++
    }
  }

  return Response.json({ geocoded, failed, total: orders.length })
}
