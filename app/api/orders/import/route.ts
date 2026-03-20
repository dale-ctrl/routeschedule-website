import { prisma } from '@/lib/prisma'
import { applyRules, parseRule } from '@/lib/rules-engine'
import { geocodePostcodesBulk } from '@/lib/routing'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { rows } = body as { rows: Record<string, string>[] }

    if (!rows || rows.length === 0) {
      return Response.json({ error: 'No rows provided' }, { status: 400 })
    }

    // Log raw column names so they appear in the terminal for debugging
    console.log('[Import] Raw columns:', Object.keys(rows[0]))

    // Strip parenthetical report suffixes and normalise whitespace/case
    // e.g. "Despatch Office (MAX)" → "despatch office"
    const stripCol = (s: string) =>
      s.replace(/\s*\([^)]+\)\s*$/, '').trim().replace(/\s+/g, ' ').toLowerCase()
        // Also strip leading BOM character that some CSV exports include
        .replace(/^\ufeff/, '')

    const get = (row: Record<string, string>, ...keys: string[]) => {
      for (const k of keys) {
        const found = Object.keys(row).find((c) => stripCol(c) === k)
        if (found !== undefined) return row[found] ?? ''
      }
      return ''
    }

    // Log what the depot column resolves to on the first row
    if (rows.length > 0) {
      const depotVal = get(rows[0], 'despatch office', 'bkg_despatch', 'depot', 'despatch', 'dispatch office', 'dispatch')
      console.log('[Import] First row depot resolved to:', JSON.stringify(depotVal))
      console.log('[Import] Stripped column names:', Object.keys(rows[0]).map(stripCol))
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

    // Map BKG system column names to our internal fields
    const ordersInput = rows.map((r) => ({
      id: '',
      reference: str(get(r, 'bgk_user_char1', 'bkg_user_char1', 'reference', 'ref', 'order ref', 'order number', 'job number', 'po')),
      customer: str(get(r, 'bkg_description', 'customer', 'company', 'name', 'customer name')) ?? 'Unknown',
      postcode: get(r, 'bgk_user_char3', 'bkg_user_char3', 'postcode', 'post code', 'zip', 'postal code').toUpperCase().trim(),
      address: str(get(r, 'bgk_user_notes1', 'bkg_user_notes1', 'address', 'delivery address', 'addr')),
      weight: parseFloat(get(r, 'order weight', 'weight', 'weight (kg)', 'weight(kg)', 'kg', 'weight kg') || '0') || 0,
      notes: str(get(r, 'notes', 'note', 'comments', 'comment')),
      area: str(get(r, 'area', 'region', 'zone', 'area location')),
      lat: null as number | null,
      lng: null as number | null,
      status: 'pending',
      scheduledDay: null as string | null,
      deliveryTime: parseDeliveryTime(get(r, 'bkg_start', 'delivery time', 'deliverytime', 'time', 'am/pm', 'window', 'slot')),
      priority: 0,
      importBatch: batchId,
      depot: str(get(r, 'despatch office', 'bkg_despatch', 'depot', 'despatch', 'dispatch office', 'dispatch')),
      preferredTruckType: null as string | null,
    })).filter((r) => r.customer || r.postcode)

    // Apply rules
    const rulesResult = applyRules(ordersInput as never, rules)
    const withRules = ordersInput.map((orig, i) => ({
      ...orig,
      scheduledDay: rulesResult[i].scheduledDay,
      priority: rulesResult[i].priority,
      deliveryTime: rulesResult[i].deliveryTime ?? orig.deliveryTime,
      area: rulesResult[i].area ?? orig.area,
      preferredTruckType: rulesResult[i].preferredTruckType ?? null,
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
            depot: o.depot,
            preferredTruckType: o.preferredTruckType,
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
