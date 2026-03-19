import { Client, TravelMode, UnitSystem } from '@googlemaps/google-maps-services-js'

const client = new Client({})
const API_KEY = process.env.GOOGLE_MAPS_API_KEY ?? ''

export interface GeoResult {
  postcode: string
  lat: number
  lng: number
  formatted: string
}

/** Geocode a UK postcode */
export async function geocodePostcode(postcode: string): Promise<GeoResult | null> {
  if (!API_KEY || API_KEY === 'YOUR_GOOGLE_MAPS_API_KEY_HERE') return null

  try {
    const res = await client.geocode({
      params: {
        address: postcode + ', UK',
        key: API_KEY,
        region: 'gb',
      },
    })

    const result = res.data.results[0]
    if (!result) return null

    return {
      postcode,
      lat: result.geometry.location.lat,
      lng: result.geometry.location.lng,
      formatted: result.formatted_address,
    }
  } catch (err) {
    console.error('Geocode error for', postcode, err)
    return null
  }
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

/** Get route details for an ordered list of waypoints */
export async function getRouteDetails(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  waypoints: { lat: number; lng: number }[]
): Promise<RouteResult | null> {
  if (!API_KEY || API_KEY === 'YOUR_GOOGLE_MAPS_API_KEY_HERE') return null

  try {
    // Google Maps Directions API supports max 25 waypoints
    const waypointChunks: { lat: number; lng: number }[][] = []
    for (let i = 0; i < waypoints.length; i += 23) {
      waypointChunks.push(waypoints.slice(i, i + 23))
    }

    const chunk = waypointChunks[0] ?? []
    const res = await client.directions({
      params: {
        origin: `${origin.lat},${origin.lng}`,
        destination: `${destination.lat},${destination.lng}`,
        waypoints: chunk.map((w) => `${w.lat},${w.lng}`),
        optimize: false, // We already optimized order
        mode: TravelMode.driving,
        key: API_KEY,
        region: 'gb',
        units: UnitSystem.metric,
      },
    })

    const route = res.data.routes[0]
    if (!route) return null

    const legs = route.legs.map((leg) => ({
      duration: Math.round((leg.duration?.value ?? 0) / 60),
      distance: Math.round((leg.distance?.value ?? 0) / 100) / 10,
      startAddress: leg.start_address,
      endAddress: leg.end_address,
    }))

    return {
      totalDuration: legs.reduce((sum, l) => sum + l.duration, 0),
      totalDistance: legs.reduce((sum, l) => sum + l.distance, 0),
      legs,
    }
  } catch (err) {
    console.error('Directions API error:', err)
    return null
  }
}
