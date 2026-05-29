import { prisma } from '@/lib/prisma'
import { applyRules, parseRule } from '@/lib/rules-engine'
import { geocodePostcodesBulk } from '@/lib/routing'
import {
  pickNearestDepot,
  DEPOT_OVERRIDE_THRESHOLD_KM,
  type DepotLocation,
} from '@/lib/route-optimizer'
import { haversineDistance } from '@/lib/utils'

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

    // Helper: parse a delivery date out of BKG_START / similar columns. Handles:
    //   "19/05/2026"   (UK DD/MM/YYYY — what BKG outputs)
    //   "19-05-2026"
    //   "2026-05-19"   (ISO)
    //   "19/05/2026 9:30 AM" (date with trailing time)
    // Returns null when no date can be parsed (e.g. plain "AM" / "PM").
    const parseDeliveryDate = (v: unknown): Date | null => {
      const s = String(v ?? '').trim()
      if (!s) return null
      // Try DD/MM/YYYY or DD-MM-YYYY (UK convention — what BKG_START contains).
      const uk = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/)
      if (uk) {
        const day = parseInt(uk[1], 10)
        const month = parseInt(uk[2], 10)
        const year = parseInt(uk[3], 10)
        if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
          const d = new Date(Date.UTC(year, month - 1, day))
          if (!isNaN(d.getTime())) return d
        }
      }
      // Try ISO YYYY-MM-DD.
      const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
      if (iso) {
        const d = new Date(`${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}T00:00:00.000Z`)
        if (!isNaN(d.getTime())) return d
      }
      return null
    }

    const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const
    const weekdayOf = (d: Date): string => WEEKDAYS[d.getUTCDay()]

    // Map BKG system column names to our internal fields
    const ordersInput = rows.map((r) => {
      const bkgStart = get(r, 'bkg_start', 'delivery date', 'date', 'despatch date', 'dispatch date')
      const deliveryDate = parseDeliveryDate(bkgStart)
      // BKG_START is primarily a date column but can also carry a time stamp
      // ("19/05/2026 9:30 AM"). Probe it for AM/PM AND fall back to dedicated
      // time columns if BKG_START is date-only.
      const timeSource = get(r, 'bkg_start', 'delivery time', 'deliverytime', 'time', 'am/pm', 'window', 'slot')
      return {
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
        // Derive scheduledDay (weekday) from the parsed delivery date so existing
        // weekday-based rules and the schedule view keep working. Rules below can
        // still override it.
        scheduledDay: deliveryDate ? weekdayOf(deliveryDate) : null as string | null,
        deliveryDate,
        deliveryTime: parseDeliveryTime(timeSource),
        priority: 0,
        importBatch: batchId,
        depot: str(get(r, 'despatch office', 'bkg_despatch', 'depot', 'despatch', 'dispatch office', 'dispatch')),
        preferredTruckType: null as string | null,
      }
    }).filter((r) => r.customer || r.postcode)

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

    // Active depots with coordinates — needed for the geographic override that
    // redirects orders to their nearest depot when the Despatch Office column
    // points somewhere geographically wrong (the Stokenham issue).
    const allDepots = await prisma.depot.findMany({ where: { active: true } })
    const depotLocs: DepotLocation[] = allDepots
      .filter((d): d is typeof d & { lat: number; lng: number } => d.lat !== null && d.lng !== null)
      .map((d) => ({ name: d.name, lat: d.lat, lng: d.lng }))

    // Build a case-insensitive lookup so a despatch-office value like "plymouth"
    // still matches a depot named "Plymouth".
    const depotByLowerName = new Map<string, DepotLocation>(
      depotLocs.map((d) => [d.name.toLowerCase(), d])
    )

    // Decide the final depot for an order given its geocode and the Despatch
    // Office column value. Returns the resolved depot name plus an optional
    // human-readable note describing any override (rendered into the order's
    // notes field so dispatchers can see and review).
    const resolveDepot = (
      declared: string | null,
      geo: { lat: number; lng: number } | undefined
    ): { depot: string | null; note: string | null } => {
      if (!geo || depotLocs.length === 0) {
        return { depot: declared, note: null }
      }
      const nearest = pickNearestDepot(geo.lat, geo.lng, depotLocs)
      if (!nearest) return { depot: declared, note: null }

      const declaredLoc = declared ? depotByLowerName.get(declared.toLowerCase()) : undefined

      if (declaredLoc) {
        if (declaredLoc.name === nearest.depot.name) {
          return { depot: declaredLoc.name, note: null }
        }
        const declaredKm = haversineDistance(geo.lat, geo.lng, declaredLoc.lat, declaredLoc.lng)
        if (declaredKm - nearest.km > DEPOT_OVERRIDE_THRESHOLD_KM) {
          return {
            depot: nearest.depot.name,
            note: `[Depot redirected: ${declaredLoc.name} → ${nearest.depot.name} (closer by ${Math.round(declaredKm - nearest.km)} km)]`,
          }
        }
        return { depot: declaredLoc.name, note: null }
      }

      // Despatch office is missing or doesn't match any of our depots — adopt nearest.
      if (declared) {
        return {
          depot: nearest.depot.name,
          note: `[Depot set: unknown despatch office "${declared}" → nearest depot ${nearest.depot.name}]`,
        }
      }
      return {
        depot: nearest.depot.name,
        note: `[Depot inferred from postcode: ${nearest.depot.name}]`,
      }
    }

    // Create orders one by one inside a transaction (compatible with SQLite adapter)
    const created = await prisma.$transaction(async (tx) => {
      const results = []
      for (const o of withRules) {
        const geo = geocodedMap.get(o.postcode)
        const { depot: finalDepot, note: overrideNote } = resolveDepot(o.depot, geo)
        const combinedNotes = overrideNote
          ? (o.notes ? `${o.notes} ${overrideNote}` : overrideNote)
          : o.notes

        const order = await tx.order.create({
          data: {
            reference: o.reference,
            customer: o.customer,
            postcode: o.postcode,
            address: o.address,
            weight: o.weight,
            notes: combinedNotes,
            area: o.area,
            lat: geo?.lat ?? null,
            lng: geo?.lng ?? null,
            status: 'pending',
            scheduledDay: o.scheduledDay === 'blocked' ? null : o.scheduledDay,
            deliveryDate: o.deliveryDate,
            deliveryTime: o.deliveryTime,
            priority: o.priority,
            importBatch: batchId,
            depot: finalDepot,
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
