export interface GeoResult {
  postcode: string
  lat: number
  lng: number
  formatted: string
}

/** Geocode a single UK postcode using postcodes.io, with terminated postcode fallback */
export async function geocodePostcode(postcode: string): Promise<GeoResult | null> {
  const cleaned = postcode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
  try {
    const res = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(cleaned)}`)
    if (res.ok) {
      const data = await res.json()
      if (data.status === 200 && data.result) {
        return {
          postcode,
          lat: data.result.latitude,
          lng: data.result.longitude,
          formatted: data.result.postcode,
        }
      }
    }
    // Fallback: terminated postcodes (retired but still have valid coordinates)
    const terminated = await fetch(`https://api.postcodes.io/terminated_postcodes/${encodeURIComponent(cleaned)}`)
    if (terminated.ok) {
      const data = await terminated.json()
      if (data.status === 200 && data.result) {
        return {
          postcode,
          lat: data.result.latitude,
          lng: data.result.longitude,
          formatted: postcode.toUpperCase(),
        }
      }
    }
    return null
  } catch (err) {
    console.error('Geocode error for', postcode, err)
    return null
  }
}

/** Normalise a UK postcode to "OUTWARD INWARD" format (e.g. "TR12SE" → "TR1 2SE") */
function normalizePostcode(postcode: string): string {
  const clean = postcode.replace(/[^A-Z0-9]/gi, '').toUpperCase()
  if (clean.length < 5) return clean.toUpperCase()
  const inward = clean.slice(-3)
  const outward = clean.slice(0, -3)
  return `${outward} ${inward}`
}

/** Bulk geocode up to 100 UK postcodes in one request using postcodes.io,
 *  with automatic fallback to individual lookups for any that the bulk call misses. */
export async function geocodePostcodesBulk(
  postcodes: string[]
): Promise<Map<string, { lat: number; lng: number }>> {
  const result = new Map<string, { lat: number; lng: number }>()
  if (postcodes.length === 0) return result

  // Normalise all postcodes before sending
  const normalised = postcodes.map(normalizePostcode)

  // Store a mapping from normalised → original so we can key results both ways
  const normToOrig = new Map<string, string>()
  postcodes.forEach((pc, i) => normToOrig.set(normalised[i], pc))

  const store = (query: string, lat: number, lng: number) => {
    const norm = normalizePostcode(query)
    result.set(norm, { lat, lng })
    result.set(norm.replace(/\s+/g, ''), { lat, lng })
    const orig = normToOrig.get(norm)
    if (orig) result.set(orig, { lat, lng })
  }

  // Bulk lookup in chunks of 100
  const chunks: string[][] = []
  for (let i = 0; i < normalised.length; i += 100) {
    chunks.push(normalised.slice(i, i + 100))
  }

  const missed: string[] = []

  for (const chunk of chunks) {
    try {
      const res = await fetch('https://api.postcodes.io/postcodes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postcodes: chunk }),
      })
      if (!res.ok) {
        missed.push(...chunk)
        continue
      }
      const data = await res.json()
      for (const item of data.result ?? []) {
        if (item.result) {
          store(item.query, item.result.latitude, item.result.longitude)
        } else {
          // Bulk returned null for this one — try individually
          missed.push(item.query as string)
        }
      }
    } catch (err) {
      console.error('Bulk geocode error:', err)
      missed.push(...chunk)
    }
  }

  // Individual fallback for any postcodes the bulk call missed
  for (const pc of missed) {
    try {
      const res = await fetch(
        `https://api.postcodes.io/postcodes/${encodeURIComponent(pc)}`
      )
      if (res.ok) {
        const data = await res.json()
        if (data.status === 200 && data.result) {
          store(pc, data.result.latitude, data.result.longitude)
          continue
        }
      }

      // Last resort: check terminated postcodes (postcodes retired since 1990s
      // that are no longer active but still have valid coordinates)
      const terminated = await fetch(
        `https://api.postcodes.io/terminated_postcodes/${encodeURIComponent(pc)}`
      )
      if (terminated.ok) {
        const data = await terminated.json()
        if (data.status === 200 && data.result) {
          store(pc, data.result.latitude, data.result.longitude)
        }
      }
    } catch {
      // silently skip genuinely invalid postcodes
    }
  }

  return result
}

export interface RouteResult {
  totalDuration: number // minutes
  totalDistance: number // km
  legs: {
    duration: number
    distance: number
    startAddress: string
    endAddress: string
  }[]
}

/**
 * Get route details using OSRM (Open Source Routing Machine) — free, no key required.
 * Uses the public OSRM demo server backed by OpenStreetMap data.
 * Note: OSRM uses lng,lat coordinate order (opposite of Google Maps).
 */
export async function getRouteDetails(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  waypoints: { lat: number; lng: number }[]
): Promise<RouteResult | null> {
  const allPoints = [origin, ...waypoints, destination]
  // OSRM requires lng,lat order
  const coords = allPoints.map((p) => `${p.lng},${p.lat}`).join(';')

  try {
    const res = await fetch(
      `https://router.project-osrm.org/route/v1/driving/${coords}?steps=false&overview=false`
    )
    if (!res.ok) return null
    const data = await res.json()
    if (data.code !== 'Ok' || !data.routes?.[0]) return null

    const route = data.routes[0]
    const legs = (route.legs as { distance: number; duration: number }[]).map((leg) => ({
      duration: Math.round(leg.duration / 60), // seconds → minutes
      distance: Math.round(leg.distance / 100) / 10, // metres → km (1 dp)
      startAddress: '',
      endAddress: '',
    }))

    return {
      totalDuration: Math.round(route.duration / 60),
      totalDistance: Math.round(route.distance / 100) / 10,
      legs,
    }
  } catch (err) {
    console.error('OSRM routing error:', err)
    return null
  }
}
