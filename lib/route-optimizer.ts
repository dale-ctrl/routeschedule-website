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

/**
 * K-means++ geographic clustering.
 * Groups stops into k clusters that minimise total intra-cluster distance,
 * so stops in the same area end up on the same truck.
 */
function geographicCluster(stops: Stop[], k: number): Stop[][] {
  if (k <= 1) return [stops]
  if (stops.length <= k) return stops.map((s) => [s])

  // K-means++ init: spread initial centres far apart to avoid poor local optima
  const centers: { lat: number; lng: number }[] = []

  // First centre: stop closest to the overall centroid
  const centLat = stops.reduce((s, st) => s + st.lat, 0) / stops.length
  const centLng = stops.reduce((s, st) => s + st.lng, 0) / stops.length
  let minD = Infinity
  let first = stops[0]
  for (const stop of stops) {
    const d = haversineDistance(stop.lat, stop.lng, centLat, centLng)
    if (d < minD) { minD = d; first = stop }
  }
  centers.push({ lat: first.lat, lng: first.lng })

  // Subsequent centres: pick stop with maximum min-distance to existing centres
  while (centers.length < k) {
    let maxMinDist = -1
    let best = stops[0]
    for (const stop of stops) {
      const d = Math.min(...centers.map((c) => haversineDistance(stop.lat, stop.lng, c.lat, c.lng)))
      if (d > maxMinDist) { maxMinDist = d; best = stop }
    }
    centers.push({ lat: best.lat, lng: best.lng })
  }

  // K-means iterations (converges in < 30 for typical delivery data)
  let assignments = new Array<number>(stops.length).fill(0)
  for (let iter = 0; iter < 30; iter++) {
    const next = stops.map((stop) => {
      let nearest = 0
      let nearestDist = Infinity
      centers.forEach((c, i) => {
        const d = haversineDistance(stop.lat, stop.lng, c.lat, c.lng)
        if (d < nearestDist) { nearestDist = d; nearest = i }
      })
      return nearest
    })

    const converged = next.every((a, i) => a === assignments[i])
    assignments = next
    if (converged) break

    // Update centres to cluster centroids
    for (let i = 0; i < k; i++) {
      const cs = stops.filter((_, idx) => assignments[idx] === i)
      if (cs.length > 0) {
        centers[i] = {
          lat: cs.reduce((s, st) => s + st.lat, 0) / cs.length,
          lng: cs.reduce((s, st) => s + st.lng, 0) / cs.length,
        }
      }
    }
  }

  return Array.from({ length: k }, (_, i) => stops.filter((_, idx) => assignments[idx] === i))
}

/**
 * Assign stops to trucks using geographic clustering to keep nearby deliveries together.
 *
 * Algorithm:
 *  1. K-means cluster stops into k geographic groups (k = number of trucks)
 *  2. Assign heaviest cluster → highest-capacity truck
 *  3. Rebalance any over-capacity truck by moving stops that are closest to
 *     a neighbouring cluster into that cluster
 */
export function assignToTrucks(
  stops: Stop[],
  trucks: { id: string; name: string; capacity: number }[]
): TruckAssignment[] {
  const activeTrucks = trucks.filter((t) => t.capacity > 0)
  if (activeTrucks.length === 0 || stops.length === 0) return []

  const k = activeTrucks.length
  const clusters = geographicCluster(stops, k)

  // Match heaviest cluster to highest-capacity truck
  const trucksSorted = [...activeTrucks].sort((a, b) => b.capacity - a.capacity)
  const clustersSorted = [...clusters].sort(
    (a, b) => b.reduce((s, st) => s + st.weight, 0) - a.reduce((s, st) => s + st.weight, 0)
  )

  const assignments: TruckAssignment[] = activeTrucks.map((t) => ({
    truckId: t.id,
    truckName: t.name,
    capacity: t.capacity,
    stops: [],
    totalWeight: 0,
  }))

  clustersSorted.forEach((cluster, i) => {
    if (i >= trucksSorted.length) return
    const a = assignments.find((x) => x.truckId === trucksSorted[i].id)!
    a.stops = [...cluster]
    a.totalWeight = cluster.reduce((s, st) => s + st.weight, 0)
  })

  // Rebalance: move stops from over-capacity trucks to the nearest under-capacity truck
  let changed = true
  let iters = 0
  while (changed && iters < 200) {
    changed = false
    iters++

    for (const over of assignments) {
      if (over.totalWeight <= over.capacity) continue

      const under = assignments.filter((a) => a.truckId !== over.truckId)
      if (under.length === 0) continue

      // Find the stop in the overloaded truck that is geographically closest to
      // another truck's cluster and will fit within that truck's remaining capacity
      let bestStop: Stop | null = null
      let bestTarget: TruckAssignment | null = null
      let bestDist = Infinity

      for (const stop of over.stops) {
        for (const target of under) {
          if (target.totalWeight + stop.weight > target.capacity) continue
          const tLat = target.stops.length > 0
            ? target.stops.reduce((s, st) => s + st.lat, 0) / target.stops.length
            : stop.lat
          const tLng = target.stops.length > 0
            ? target.stops.reduce((s, st) => s + st.lng, 0) / target.stops.length
            : stop.lng
          const dist = haversineDistance(stop.lat, stop.lng, tLat, tLng)
          if (dist < bestDist) { bestDist = dist; bestStop = stop; bestTarget = target }
        }
      }

      if (bestStop && bestTarget) {
        over.stops = over.stops.filter((s) => s.id !== bestStop!.id)
        over.totalWeight -= bestStop.weight
        bestTarget.stops.push(bestStop)
        bestTarget.totalWeight += bestStop.weight
        changed = true
        break // restart after each move
      } else {
        // No capacity-respecting move available — move the lightest stop to the least-loaded truck
        const lightest = over.stops.reduce((a, b) => a.weight <= b.weight ? a : b)
        const leastLoaded = under.reduce((a, b) => a.totalWeight <= b.totalWeight ? a : b)
        over.stops = over.stops.filter((s) => s.id !== lightest.id)
        over.totalWeight -= lightest.weight
        leastLoaded.stops.push(lightest)
        leastLoaded.totalWeight += lightest.weight
        changed = true
        break
      }
    }
  }

  return assignments.filter((a) => a.stops.length > 0)
}

/** Nearest-neighbor TSP: order stops to minimise total driving distance */
export function optimizeStopOrder(
  stops: Stop[],
  depot = { lat: 51.5, lng: -1.8 }
): Stop[] {
  if (stops.length <= 1) return stops

  const unvisited = [...stops]
  const route: Stop[] = []
  let current = depot

  while (unvisited.length > 0) {
    let nearestIdx = 0
    let minDist = haversineDistance(current.lat, current.lng, unvisited[0].lat, unvisited[0].lng)

    for (let i = 1; i < unvisited.length; i++) {
      const dist = haversineDistance(current.lat, current.lng, unvisited[i].lat, unvisited[i].lng)
      if (dist < minDist) { minDist = dist; nearestIdx = i }
    }

    route.push(unvisited[nearestIdx])
    current = unvisited[nearestIdx]
    unvisited.splice(nearestIdx, 1)
  }

  return route
}
