export interface GeoResult {
  postcode: string
  lat: number
  lng: number
  formatted: string
}

/** Geocode a single UK postcode using postcodes.io (free, no API key required) */
export async function geocodePostcode(postcode: string): Promise<GeoResult | null> {
  const cleaned = postcode.trim().toUpperCase().replace(/\s+/g, '')
  try {
    const res = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(cleaned)}`)
    if (!res.ok) return null
    const data = await res.json()
    if (data.status !== 200 || !data.result) return null
    return {
      postcode,
      lat: data.result.latitude,
      lng: data.result.longitude,
      formatted: data.result.postcode,
    }
  } catch (err) {
    console.error('Geocode error for', postcode, err)
    return null
  }
}

/** Bulk geocode up to 100 UK postcodes in one request using postcodes.io */
export async function geocodePostcodesBulk(
  postcodes: string[]
): Promise<Map<string, { lat: number; lng: number }>> {
  const result = new Map<string, { lat: number; lng: number }>()
  if (postcodes.length === 0) return result

  // postcodes.io bulk endpoint accepts max 100 per request
  const chunks: string[][] = []
  for (let i = 0; i < postcodes.length; i += 100) {
    chunks.push(postcodes.slice(i, i + 100))
  }

  for (const chunk of chunks) {
    try {
      const res = await fetch('https://api.postcodes.io/postcodes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postcodes: chunk }),
      })
      if (!res.ok) continue
      const data = await res.json()
      for (const item of data.result ?? []) {
        if (item.result) {
          result.set(item.query.replace(/\s+/g, '').toUpperCase(), {
            lat: item.result.latitude,
            lng: item.result.longitude,
          })
          // Also store with original casing/spacing
          result.set(item.query, { lat: item.result.latitude, lng: item.result.longitude })
        }
      }
    } catch (err) {
      console.error('Bulk geocode error:', err)
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
