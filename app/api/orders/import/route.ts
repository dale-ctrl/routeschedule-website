import { prisma } from '@/lib/prisma'
import { applyRules, parseRule } from '@/lib/rules-engine'
import { geocodePostcodesBulk } from '@/lib/routing'

export async function POST(request: Request) {
  try {
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

    // Helper: convert empty/whitespace strings to null
    const str = (v: unknown) => {
      const s = String(v ?? '').trim()
      return s === '' ? null : s
    }

    // Helper: normalise delivery time to "am" | "pm" | null
    // Handles: "AM", "PM", "3/23/2026 7:30:00 AM", "morning", "afternoon", etc.
    const parseDeliveryTime = (v: unknown): string | null => {
      const s = String(v ?? '').toLowerCase().trim()
      if (!s) return null
      if (s.includes('pm') || s.includes('afternoon')) return 'pm'
      if (s.includes('am') || s.includes('morning')) return 'am'
      return null
    }

    // Prepare orders
    const ordersInput = rows.map((r) => ({
      id: '',
      reference: str(r.reference),
      customer: str(r.customer) ?? 'Unknown',
      postcode: (r.postcode ?? '').toString().toUpperCase().trim(),
      address: str(r.address),
      weight: parseFloat(String(r.weight ?? '0')) || 0,
      notes: str(r.notes),
      area: str(r.area),
      lat: null as number | null,
      lng: null as number | null,
      status: 'pending',
      scheduledDay: null as string | null,
      deliveryTime: parseDeliveryTime(r.deliveryTime),
      priority: 0,
      importBatch: batchId,
    }))

    // Apply rules
    const rulesResult = applyRules(ordersInput as never, rules)
    const withRules = ordersInput.map((orig, i) => ({
      ...orig,
      scheduledDay: rulesResult[i].scheduledDay,
      priority: rulesResult[i].priority,
      deliveryTime: rulesResult[i].deliveryTime ?? orig.deliveryTime,
      area: rulesResult[i].area ?? orig.area,
    }))

    // Bulk geocode all unique postcodes
    const uniquePostcodes = [...new Set(withRules.map((o) => o.postcode).filter(Boolean))]
    const geocodedMap = await geocodePostcodesBulk(uniquePostcodes)

    // Create orders one by one inside a transaction (compatible with SQLite adapter)
    const created = await prisma.$transaction(async (tx) => {
      const results = []
      for (const o of withRules) {
        const geo = geocodedMap.get(o.postcode)
        const order = await tx.order.create({
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
        results.push(order)
      }
      return results
    })

    return Response.json({
      imported: created.length,
      batchId,
      geocoded: geocodedMap.size,
    })
  } catch (err) {
    console.error('Import error:', err)
    return Response.json(
      { error: String(err instanceof Error ? err.message : err) },
      { status: 500 }
    )
  }
}
