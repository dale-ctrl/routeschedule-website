import { prisma } from '@/lib/prisma'
import { applyRules, parseRule } from '@/lib/rules-engine'
import { geocodePostcodesBulk } from '@/lib/routing'

export async function POST(request: Request) {
  const body = await request.json()
  const { rows } = body as {
    rows: {
      customer: string
      postcode: string
      weight: string | number
      reference?: string
      address?: string
      notes?: string
      area?: string
      deliveryTime?: string
    }[]
  }

  if (!rows || rows.length === 0) {
    return Response.json({ error: 'No rows provided' }, { status: 400 })
  }

  // Load active rules
  const dbRules = await prisma.rule.findMany({ where: { active: true } })
  const rules = dbRules.map(parseRule)

  const batchId = `import-${Date.now()}`

  // Prepare orders
  const ordersInput = rows.map((r) => ({
    id: '',
    reference: r.reference ?? null,
    customer: r.customer ?? 'Unknown',
    postcode: (r.postcode ?? '').toUpperCase().trim(),
    address: r.address ?? null,
    weight: parseFloat(String(r.weight ?? '0')) || 0,
    notes: r.notes ?? null,
    area: r.area ?? null,
    lat: null as number | null,
    lng: null as number | null,
    status: 'pending',
    scheduledDay: null as string | null,
    deliveryTime: r.deliveryTime ?? null,
    priority: 0,
    importBatch: batchId,
  }))

  // Apply rules - merge rules output back onto original input
  const rulesResult = applyRules(ordersInput as never, rules)
  const withRules = ordersInput.map((orig, i) => ({
    ...orig,
    scheduledDay: rulesResult[i].scheduledDay,
    priority: rulesResult[i].priority,
    deliveryTime: rulesResult[i].deliveryTime ?? orig.deliveryTime,
    area: rulesResult[i].area ?? orig.area,
  }))

  // Bulk geocode all postcodes in one API call (postcodes.io, free, up to 100 per request)
  const uniquePostcodes = [...new Set(withRules.map((o) => o.postcode))]
  const geocodedMap = await geocodePostcodesBulk(uniquePostcodes)

  // Create orders in DB
  const created = await prisma.$transaction(
    withRules.map((o) => {
      const geo = geocodedMap.get(o.postcode)
      return prisma.order.create({
        data: {
          reference: o.reference,
          customer: o.customer,
          postcode: o.postcode,
          address: o.address,
          weight: o.weight,
          notes: o.notes,
          area: o.area,
          lat: geo?.lat ?? null,
          lng: geo?.lng ?? null,
          status: 'pending',
          scheduledDay: o.scheduledDay === 'blocked' ? null : o.scheduledDay,
          deliveryTime: o.deliveryTime,
          priority: o.priority,
          importBatch: batchId,
        },
      })
    })
  )

  return Response.json({
    imported: created.length,
    batchId,
    geocoded: geocodedMap.size,
  })
}
