import { haversineDistance } from './utils'

export interface Stop {
  id: string
  lat: number
  lng: number
  weight: number
  customer: string
  postcode: string
  address?: string | null
  deliveryTime?: string | null
  priority: number
}

export interface TruckAssignment {
  truckId: string
  truckName: string
  capacity: number
  stops: Stop[]
  totalWeight: number
}

/** Bin-pack orders into trucks by weight capacity */
export function assignToTrucks(
  stops: Stop[],
  trucks: { id: string; name: string; capacity: number }[]
): TruckAssignment[] {
  const activeTrucks = trucks.filter((t) => t.capacity > 0)
  if (activeTrucks.length === 0) return []

  const assignments: TruckAssignment[] = activeTrucks.map((t) => ({
    truckId: t.id,
    truckName: t.name,
    capacity: t.capacity,
    stops: [],
    totalWeight: 0,
  }))

  // Sort by priority desc, then weight desc for better packing
  const sorted = [...stops].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority
    return b.weight - a.weight
  })

  for (const stop of sorted) {
    // Find first truck that has capacity
    const truck = assignments.find(
      (t) => t.totalWeight + stop.weight <= t.capacity
    )
    if (truck) {
      truck.stops.push(stop)
      truck.totalWeight += stop.weight
    } else {
      // Overflow: add to least-loaded truck
      const least = assignments.reduce((a, b) =>
        a.totalWeight <= b.totalWeight ? a : b
      )
      least.stops.push(stop)
      least.totalWeight += stop.weight
    }
  }

  return assignments.filter((a) => a.stops.length > 0)
}

/** Nearest-neighbor TSP from a depot point */
export function optimizeStopOrder(
  stops: Stop[],
  depot = { lat: 51.5, lng: -1.8 } // Default: Swindon area (configurable)
): Stop[] {
  if (stops.length <= 1) return stops

  const unvisited = [...stops]
  const route: Stop[] = []
  let current = depot

  while (unvisited.length > 0) {
    let nearestIdx = 0
    let minDist = haversineDistance(
      current.lat,
      current.lng,
      unvisited[0].lat,
      unvisited[0].lng
    )

    for (let i = 1; i < unvisited.length; i++) {
      const dist = haversineDistance(
        current.lat,
        current.lng,
        unvisited[i].lat,
        unvisited[i].lng
      )
      if (dist < minDist) {
        minDist = dist
        nearestIdx = i
      }
    }

    route.push(unvisited[nearestIdx])
    current = unvisited[nearestIdx]
    unvisited.splice(nearestIdx, 1)
  }

  return route
}
