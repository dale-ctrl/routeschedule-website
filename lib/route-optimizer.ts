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
  preferredTruckType?: string | null
}

export interface TruckSlot {
  truckId: string
  truckName: string
  capacity: number
  type?: string | null
  runNumber: number
  isExtraVan: boolean
}

export interface TruckAssignment {
  truckId: string
  truckName: string
  capacity: number
  runNumber: number
  isExtraVan: boolean
  stops: Stop[]
  totalWeight: number
}

export const EXTRA_VAN_CAPACITY = 1500
export const MAX_RUNS_PER_TRUCK = 2
const EXTRA_VAN_PLACEHOLDER_PREFIX = '__extra_van_'

export function isExtraVanPlaceholder(truckId: string): boolean {
  return truckId.startsWith(EXTRA_VAN_PLACEHOLDER_PREFIX)
}

/**
 * Build the list of truck "slots" (a slot = one route = one run of one truck).
 * Adds double-runs to larger trucks first when weight exceeds single-run capacity,
 * then falls back to placeholder Extra Van slots (1.5t each) for any remaining deficit.
 * Placeholder IDs are resolved to real Truck records by the caller.
 */
export function planSlots(
  trucks: { id: string; name: string; capacity: number; type?: string | null }[],
  totalWeight: number,
  opts: {
    extraVanCapacity?: number
    maxRunsPerTruck?: number
    noDoubleRunTruckIds?: Set<string>
    bonusVans?: number
  } = {}
): TruckSlot[] {
  const extraVanCapacity = opts.extraVanCapacity ?? EXTRA_VAN_CAPACITY
  const maxRunsPerTruck = opts.maxRunsPerTruck ?? MAX_RUNS_PER_TRUCK
  const noDoubleRun = opts.noDoubleRunTruckIds ?? new Set<string>()
  const bonusVans = Math.max(0, opts.bonusVans ?? 0)

  const sorted = [...trucks]
    .filter((t) => t.capacity > 0)
    .sort((a, b) => b.capacity - a.capacity)

  const slots: TruckSlot[] = []
  let cap = 0

  for (const t of sorted) {
    slots.push({
      truckId: t.id,
      truckName: t.name,
      capacity: t.capacity,
      type: t.type ?? null,
      runNumber: 1,
      isExtraVan: false,
    })
    cap += t.capacity
  }

  for (let run = 2; run <= maxRunsPerTruck && cap < totalWeight; run++) {
    for (const t of sorted) {
      if (cap >= totalWeight) break
      if (noDoubleRun.has(t.id)) continue
      slots.push({
        truckId: t.id,
        truckName: t.name,
        capacity: t.capacity,
        type: t.type ?? null,
        runNumber: run,
        isExtraVan: false,
      })
      cap += t.capacity
    }
  }

  let vanIdx = 1
  const targetCap = totalWeight + bonusVans * extraVanCapacity
  while (cap < targetCap) {
    slots.push({
      truckId: `${EXTRA_VAN_PLACEHOLDER_PREFIX}${vanIdx}__`,
      truckName: `Extra Van ${vanIdx}`,
      capacity: extraVanCapacity,
      type: 'Extra Van',
      runNumber: 1,
      isExtraVan: true,
    })
    cap += extraVanCapacity
    vanIdx++
  }

  return slots
}

/** Seeded PRNG — deterministic restarts so regenerations are reproducible. */
function mulberry32(seed: number) {
  return function () {
    seed = (seed + 0x6d2b79f5) | 0
    let t = seed
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Within-cluster sum of squared distances — lower = tighter clusters. */
function wcss(clusters: Stop[][]): number {
  let total = 0
  for (const cluster of clusters) {
    if (cluster.length === 0) continue
    const cLat = cluster.reduce((s, st) => s + st.lat, 0) / cluster.length
    const cLng = cluster.reduce((s, st) => s + st.lng, 0) / cluster.length
    for (const stop of cluster) {
      const d = haversineDistance(stop.lat, stop.lng, cLat, cLng)
      total += d * d
    }
  }
  return total
}

function runKMeansOnce(stops: Stop[], k: number, seed: number): Stop[][] {
  const rng = mulberry32(seed * 9973 + 1)
  const centers: { lat: number; lng: number }[] = []

  if (seed === 0) {
    // Attempt 0: deterministic max-min k-means++ init (good baseline).
    const centLat = stops.reduce((s, st) => s + st.lat, 0) / stops.length
    const centLng = stops.reduce((s, st) => s + st.lng, 0) / stops.length
    let minD = Infinity
    let first = stops[0]
    for (const stop of stops) {
      const d = haversineDistance(stop.lat, stop.lng, centLat, centLng)
      if (d < minD) { minD = d; first = stop }
    }
    centers.push({ lat: first.lat, lng: first.lng })
    while (centers.length < k) {
      let maxMinDist = -1
      let best = stops[0]
      for (const stop of stops) {
        const d = Math.min(...centers.map((c) => haversineDistance(stop.lat, stop.lng, c.lat, c.lng)))
        if (d > maxMinDist) { maxMinDist = d; best = stop }
      }
      centers.push({ lat: best.lat, lng: best.lng })
    }
  } else {
    // Attempts 1..N: probabilistic k-means++ (D² weighted) to explore other partitions.
    const firstIdx = Math.floor(rng() * stops.length)
    centers.push({ lat: stops[firstIdx].lat, lng: stops[firstIdx].lng })
    while (centers.length < k) {
      const distSq = stops.map((stop) => {
        const d = Math.min(...centers.map((c) => haversineDistance(stop.lat, stop.lng, c.lat, c.lng)))
        return d * d
      })
      const total = distSq.reduce((a, b) => a + b, 0)
      if (total === 0) {
        const idx = Math.floor(rng() * stops.length)
        centers.push({ lat: stops[idx].lat, lng: stops[idx].lng })
        continue
      }
      let r = rng() * total
      let pick = stops[0]
      for (let i = 0; i < stops.length; i++) {
        r -= distSq[i]
        if (r <= 0) { pick = stops[i]; break }
      }
      centers.push({ lat: pick.lat, lng: pick.lng })
    }
  }

  let assignments = new Array<number>(stops.length).fill(0)
  for (let iter = 0; iter < 50; iter++) {
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
 * Multi-start k-means geographic clustering.
 * K-means gets stuck in local minima with elongated data (e.g. long strings of stops
 * spanning Salisbury → Surrey): a bad initialisation can produce diagonal/zigzagging
 * clusters instead of the obvious compact regional groups. We run k-means many times
 * from different seeds (first deterministic, rest D²-weighted k-means++) and keep the
 * partition with the lowest within-cluster sum of squares — i.e. the tightest one.
 */
function geographicCluster(stops: Stop[], k: number): Stop[][] {
  if (k <= 1) return [stops]
  if (stops.length <= k) return stops.map((s) => [s])

  const RESTARTS = 40
  let best = runKMeansOnce(stops, k, 0)
  let bestScore = wcss(best)
  for (let seed = 1; seed < RESTARTS; seed++) {
    const candidate = runKMeansOnce(stops, k, seed)
    const score = wcss(candidate)
    if (score < bestScore) {
      bestScore = score
      best = candidate
    }
  }
  return best
}

/**
 * Distance from a stop to the nearest actual stop in an assignment's current stops.
 * Falls back to the assignment's centroid when it has no stops yet.
 */
function distanceToAssignment(stop: Stop, a: TruckAssignment): number {
  if (a.stops.length === 0) return 0
  let min = Infinity
  for (const s of a.stops) {
    const d = haversineDistance(stop.lat, stop.lng, s.lat, s.lng)
    if (d < min) min = d
  }
  return min
}

function clusterCentroid(cluster: Stop[]): { lat: number; lng: number } {
  if (cluster.length === 0) return { lat: 0, lng: 0 }
  return {
    lat: cluster.reduce((s, st) => s + st.lat, 0) / cluster.length,
    lng: cluster.reduce((s, st) => s + st.lng, 0) / cluster.length,
  }
}

/**
 * Count how many stops in the cluster prefer the given truck type.
 * Matches case-insensitively via substring.
 */
function preferredTypeScore(cluster: Stop[], slotType: string | null | undefined): number {
  if (!slotType) return 0
  const t = slotType.toLowerCase()
  return cluster.filter((s) => s.preferredTruckType && t.includes(s.preferredTruckType.toLowerCase())).length
}

/**
 * Assign stops to truck slots. One slot = one route.
 *
 * Algorithm:
 *  1. K-means cluster stops into len(slots) geographic groups (respects geography for all stops).
 *  2. Greedy cluster→slot matching: heaviest cluster first, prefer slots whose truck type matches
 *     the cluster's majority preferredTruckType, then highest remaining capacity.
 *  3. Rebalance any over-capacity slot by moving its stop that is closest (to the nearest stop
 *     in another slot — not a far-away centroid) and still fits that slot's capacity.
 *  4. Hard constraint: if no capacity-respecting move exists, throw. Caller must provision more
 *     slots (via planSlots) rather than silently overloading.
 */
export function assignToTrucks(
  stops: Stop[],
  slots: TruckSlot[],
  minLoadPct: number | null = null
): TruckAssignment[] {
  if (slots.length === 0 || stops.length === 0) return []

  let k = slots.length
  if (minLoadPct !== null && minLoadPct > 0) {
    const totalWeight = stops.reduce((s, st) => s + st.weight, 0)
    const maxCapacity = Math.max(...slots.map((s) => s.capacity))
    const effectiveCapacity = maxCapacity * (minLoadPct / 100)
    const minSlots = Math.ceil(totalWeight / effectiveCapacity)
    k = Math.max(1, Math.min(slots.length, minSlots))
  }

  const activeSlots = slots.slice(0, k)
  const clusters = geographicCluster(stops, k)

  const assignments: TruckAssignment[] = activeSlots.map((s) => ({
    truckId: s.truckId,
    truckName: s.truckName,
    capacity: s.capacity,
    runNumber: s.runNumber,
    isExtraVan: s.isExtraVan,
    stops: [],
    totalWeight: 0,
  }))

  // Greedy cluster → slot assignment.
  // Sort clusters by weight desc so heavy clusters pick first.
  const clustersSorted = [...clusters].sort(
    (a, b) => b.reduce((s, st) => s + st.weight, 0) - a.reduce((s, st) => s + st.weight, 0)
  )

  const usedSlotIdx = new Set<number>()
  for (const cluster of clustersSorted) {
    if (cluster.length === 0) continue
    const clusterWeight = cluster.reduce((s, st) => s + st.weight, 0)
    const centroid = clusterCentroid(cluster)

    // Pick the best available slot for this cluster. Score (higher = better):
    //   + 1000 per stop whose preferredTruckType matches the slot type
    //   + 100 if cluster fits within slot capacity
    //   + (same-truck double-run bonus) 50 - distance_km_to_other_run_centroid, if the other run of
    //       the same truck has already been assigned a cluster nearby
    //   - capacity wasted (rough tie-breaker for packing)
    let bestIdx = -1
    let bestScore = -Infinity

    for (let i = 0; i < activeSlots.length; i++) {
      if (usedSlotIdx.has(i)) continue
      const slot = activeSlots[i]
      let score = 0
      score += preferredTypeScore(cluster, slot.type) * 1000
      if (clusterWeight <= slot.capacity) score += 100
      // Double-run affinity: if same truck has another run already with a cluster assigned, prefer
      // putting this cluster near it — that keeps both runs in the same area.
      for (let j = 0; j < activeSlots.length; j++) {
        if (j === i) continue
        if (!usedSlotIdx.has(j)) continue
        if (activeSlots[j].truckId !== slot.truckId) continue
        if (activeSlots[j].isExtraVan) continue
        const otherCentroid = clusterCentroid(assignments[j].stops)
        const dKm = haversineDistance(centroid.lat, centroid.lng, otherCentroid.lat, otherCentroid.lng)
        score += Math.max(0, 50 - dKm)
      }
      score -= Math.abs(slot.capacity - clusterWeight) / 1000
      if (score > bestScore) { bestScore = score; bestIdx = i }
    }

    if (bestIdx === -1) bestIdx = activeSlots.findIndex((_, i) => !usedSlotIdx.has(i))
    if (bestIdx === -1) break

    usedSlotIdx.add(bestIdx)
    assignments[bestIdx].stops = [...cluster]
    assignments[bestIdx].totalWeight = clusterWeight
  }

  // Rebalance over-capacity assignments. Hard constraint: every move must respect capacity.
  let changed = true
  let iters = 0
  while (changed && iters < 500) {
    changed = false
    iters++

    for (const over of assignments) {
      if (over.totalWeight <= over.capacity) continue
      const under = assignments.filter((a) => a !== over)
      if (under.length === 0) break

      let bestStop: Stop | null = null
      let bestTarget: TruckAssignment | null = null
      let bestDist = Infinity

      for (const stop of over.stops) {
        for (const target of under) {
          if (target.totalWeight + stop.weight > target.capacity) continue
          const dist = distanceToAssignment(stop, target)
          if (dist < bestDist) { bestDist = dist; bestStop = stop; bestTarget = target }
        }
      }

      if (bestStop && bestTarget) {
        over.stops = over.stops.filter((s) => s.id !== bestStop!.id)
        over.totalWeight -= bestStop.weight
        bestTarget.stops.push(bestStop)
        bestTarget.totalWeight += bestStop.weight
        changed = true
        break
      }

      // No capacity-respecting move exists. Caller must provision more slots.
      throw new Error(
        `Cannot fit ${over.stops.length} stops (${over.totalWeight.toFixed(0)}kg) ` +
        `into ${over.truckName} (Run ${over.runNumber}, cap ${over.capacity}kg). ` +
        `Add another truck or increase Extra Van capacity.`
      )
    }
  }

  // Geographic refinement: every stop should live in the cluster whose nearest
  // neighbour is closest. Rebalance only runs when an assignment is over-capacity,
  // so a stop can end up in a geographically suboptimal cluster whenever the
  // greedy cluster→slot pairing leaves everything under capacity but slightly
  // skewed — producing routes that cross each other on the map even though no
  // single assignment is overloaded. This pass moves each stop to the nearest
  // cluster it will fit in, iterating until stable.
  refineByProximity(assignments)

  return assignments.filter((a) => a.stops.length > 0)
}

function refineByProximity(assignments: TruckAssignment[]): void {
  let improved = true
  let iters = 0
  while (improved && iters < 100) {
    improved = false
    iters++

    // Pass 1: direct moves. For each stop, migrate to the nearest cluster that has
    // capacity headroom for it, provided the target's nearest-neighbour is closer
    // than the stop's current home's nearest-neighbour.
    for (const home of assignments) {
      if (home.stops.length <= 1) continue
      for (const stop of [...home.stops]) {
        const hereDist = nearestOtherStopDistance(stop, home)
        let bestTarget: TruckAssignment | null = null
        let bestDist = hereDist

        for (const target of assignments) {
          if (target === home) continue
          if (target.totalWeight + stop.weight > target.capacity) continue
          const d = distanceToAssignment(stop, target)
          if (d < bestDist) { bestDist = d; bestTarget = target }
        }

        if (bestTarget) {
          home.stops = home.stops.filter((s) => s.id !== stop.id)
          home.totalWeight -= stop.weight
          bestTarget.stops.push(stop)
          bestTarget.totalWeight += stop.weight
          improved = true
        }
      }
    }

    // Pass 2: swaps. Classic 2-opt: for every pair of stops in different clusters,
    // swap them if the total nearest-neighbour distance strictly decreases and both
    // capacities remain intact. This fixes geographic outliers that direct moves
    // can't reach because the target cluster is at capacity — the partner stop
    // doesn't need to individually want to move, it just needs to be a "fair trade"
    // that leaves both clusters tighter overall.
    const SWAP_IMPROVEMENT_KM = 1
    for (const a of assignments) {
      for (const b of assignments) {
        if (a === b) continue
        for (const sa of [...a.stops]) {
          if (!a.stops.some((s) => s.id === sa.id)) continue
          let bestPartner: Stop | null = null
          let bestGain = SWAP_IMPROVEMENT_KM
          const saHere = nearestOtherStopDistance(sa, a)
          const saThere = distanceToAssignment(sa, b)
          for (const sb of b.stops) {
            const sbHere = nearestOtherStopDistance(sb, b)
            const sbThere = distanceToAssignment(sb, a)
            const gain = (saHere + sbHere) - (saThere + sbThere)
            if (gain <= bestGain) continue
            const aAfter = a.totalWeight - sa.weight + sb.weight
            const bAfter = b.totalWeight - sb.weight + sa.weight
            if (aAfter > a.capacity || bAfter > b.capacity) continue
            bestGain = gain
            bestPartner = sb
          }
          if (!bestPartner) continue

          a.stops = a.stops.filter((s) => s.id !== sa.id)
          b.stops = b.stops.filter((s) => s.id !== bestPartner!.id)
          a.stops.push(bestPartner)
          b.stops.push(sa)
          a.totalWeight = a.totalWeight - sa.weight + bestPartner.weight
          b.totalWeight = b.totalWeight - bestPartner.weight + sa.weight
          improved = true
        }
      }
    }
  }
}

/** Distance from a stop to the nearest *other* stop in its own assignment. */
function nearestOtherStopDistance(stop: Stop, assignment: TruckAssignment): number {
  let min = Infinity
  for (const s of assignment.stops) {
    if (s.id === stop.id) continue
    const d = haversineDistance(stop.lat, stop.lng, s.lat, s.lng)
    if (d < min) min = d
  }
  return min === Infinity ? 0 : min
}

/**
 * Local fallback stop-order optimiser (no external calls).
 * ≤ 10 stops: brute-force all permutations — guaranteed globally optimal.
 * > 10 stops: nearest-neighbour + 2-opt — good approximation.
 */
export function optimizeStopOrder(
  stops: Stop[],
  depot = { lat: 51.5, lng: -1.8 }
): Stop[] {
  if (stops.length <= 1) return stops

  const dist = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) =>
    haversineDistance(a.lat, a.lng, b.lat, b.lng)

  const routeDist = (r: Stop[]) => {
    let d = dist(depot, r[0])
    for (let i = 0; i < r.length - 1; i++) d += dist(r[i], r[i + 1])
    return d
  }

  if (stops.length <= 10) {
    let bestRoute = stops
    let bestDist = routeDist(stops)

    const permute = (arr: Stop[], start: number) => {
      if (start === arr.length) {
        const d = routeDist(arr)
        if (d < bestDist) { bestDist = d; bestRoute = [...arr] }
        return
      }
      for (let i = start; i < arr.length; i++) {
        ;[arr[start], arr[i]] = [arr[i], arr[start]]
        permute(arr, start + 1)
        ;[arr[start], arr[i]] = [arr[i], arr[start]]
      }
    }
    permute([...stops], 0)
    return bestRoute
  }

  const unvisited = [...stops]
  const route: Stop[] = []
  let current: { lat: number; lng: number } = depot

  while (unvisited.length > 0) {
    let nearestIdx = 0
    let minDist = dist(current, unvisited[0])
    for (let i = 1; i < unvisited.length; i++) {
      const d = dist(current, unvisited[i])
      if (d < minDist) { minDist = d; nearestIdx = i }
    }
    route.push(unvisited[nearestIdx])
    current = unvisited[nearestIdx]
    unvisited.splice(nearestIdx, 1)
  }

  let best = route
  let improved = true
  while (improved) {
    improved = false
    for (let i = 0; i < best.length - 1; i++) {
      for (let j = i + 1; j < best.length; j++) {
        const candidate = [...best.slice(0, i), ...best.slice(i, j + 1).reverse(), ...best.slice(j + 1)]
        if (routeDist(candidate) < routeDist(best)) { best = candidate; improved = true }
      }
    }
  }
  return best
}
