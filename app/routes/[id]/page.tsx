'use client'

import { useEffect, useState, use } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { statusBadge } from '@/components/ui/Badge'
import { formatWeight, formatDuration, formatDistance } from '@/lib/utils'
import {
  SERVICE_TIME_PER_DROP_MIN,
  BREAK_MIN,
  BREAK_AFTER_DRIVE_MIN,
} from '@/lib/route-optimizer'
import { InstructionChips } from '@/components/ui/InstructionChips'
import { windowLabel, formatClock } from '@/lib/special-instructions'
import { ArrowLeft, MapPin, Clock, Weight, Truck as TruckIcon, X, AlertTriangle } from 'lucide-react'
import Link from 'next/link'
import { format } from 'date-fns'

// Leaflet must be client-side only (uses window)
const RouteMap = dynamic(
  () => import('@/components/ui/RouteMap').then((m) => m.RouteMap),
  { ssr: false, loading: () => <div className="h-80 flex items-center justify-center text-gray-400 text-sm">Loading map...</div> }
)

interface Stop {
  id: string
  sequence: number
  duration: number | null
  distance: number | null
  eta: string | null
  notes: string | null
  order: {
    id: string
    customer: string
    postcode: string
    address: string | null
    weight: number
    deliveryTime: string | null
    specialInstructions: string | null
    windowStart: number | null
    windowEnd: number | null
    instructionFlags: string | null
    notes: string | null
    lat: number | null
    lng: number | null
  }
}

interface RouteDetail {
  id: string
  name: string
  date: string
  status: string
  totalWeight: number
  totalDistance: number | null
  totalDuration: number | null
  drivingDuration: number | null
  startTime: number | null
  notes: string | null
  truck: {
    id: string
    name: string
    registration: string | null
    capacity: number
    type: string
  }
  stops: Stop[]
}

export default function RouteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [route, setRoute] = useState<RouteDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [removing, setRemoving] = useState<string | null>(null)

  const refetchRoute = () => {
    fetch(`/api/routes/${id}`).then((r) => r.json()).then(setRoute)
  }

  useEffect(() => {
    fetch(`/api/routes/${id}`)
      .then((r) => r.json())
      .then(setRoute)
      .finally(() => setLoading(false))
  }, [id])

  const handleRemoveStop = async (stopId: string, customer: string) => {
    if (!confirm(`Remove ${customer} from this route? The order will go back to pending so you can re-route it.`)) return
    setRemoving(stopId)
    try {
      const res = await fetch(`/api/routes/${id}/stops/${stopId}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(`Remove failed: ${data.error ?? 'Unknown error'}`)
        return
      }
      if (data.routeDeleted) {
        router.push('/routes')
        return
      }
      refetchRoute()
    } finally {
      setRemoving(null)
    }
  }

  if (loading) return <div className="flex-1 flex items-center justify-center text-gray-400">Loading route...</div>
  if (!route) return <div className="flex-1 flex items-center justify-center text-gray-400">Route not found.</div>

  const geocodedStops = route.stops
    .filter((s) => s.order.lat && s.order.lng)
    .map((s) => ({
      lat: s.order.lat!,
      lng: s.order.lng!,
      sequence: s.sequence,
      customer: s.order.customer,
      postcode: s.order.postcode,
    }))

  // Build an OSM-based directions URL as fallback link
  const osmUrl = geocodedStops.length > 0
    ? `https://www.openstreetmap.org/directions?engine=osrm_car&route=${geocodedStops.map((s) => `${s.lat},${s.lng}`).join(';')}`
    : null

  return (
    <div className="flex flex-col min-h-full">
      <PageHeader
        title={route.name}
        subtitle={format(new Date(route.date), 'EEEE, d MMMM yyyy')}
        actions={
          <>
            {osmUrl && (
              <a href={osmUrl} target="_blank" rel="noopener noreferrer">
                <Button variant="secondary" size="sm">Open in Maps</Button>
              </a>
            )}
            <Link href="/routes">
              <Button variant="secondary" size="sm"><ArrowLeft size={14} /> Back</Button>
            </Link>
          </>
        }
      />

      <div className="flex-1 p-6 space-y-6">
        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <SummaryCard icon={<TruckIcon size={18} className="text-sky-500" />} label="Truck" value={route.truck.name} sub={route.truck.registration ?? route.truck.type} />
          <SummaryCard icon={<Weight size={18} className="text-purple-500" />} label="Total Weight" value={formatWeight(route.totalWeight)} sub={`Capacity: ${formatWeight(route.truck.capacity)}`} />
          <SummaryCard icon={<MapPin size={18} className="text-green-500" />} label="Distance" value={route.totalDistance ? formatDistance(route.totalDistance) : '—'} sub={`${route.stops.length} stops`} />
          <SummaryCard
            icon={<Clock size={18} className="text-orange-500" />}
            label="Working day"
            value={route.totalDuration ? formatDuration(route.totalDuration) : '—'}
            sub={renderTimeBreakdown(route.drivingDuration, route.stops.length, route.totalDuration, route.startTime) ?? (statusBadge(route.status) as unknown as string)}
          />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {/* Stops list */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">Delivery Stops ({route.stops.length})</h2>
            </div>
            <div className="overflow-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-10">#</th>
                    <th>Customer</th>
                    <th>Postcode</th>
                    <th>Weight</th>
                    <th>Window</th>
                    <th>ETA</th>
                    <th>Drive</th>
                    <th className="w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {route.stops.map((stop) => (
                    <tr key={stop.id}>
                      <td className="text-gray-400 font-mono text-xs">{stop.sequence}</td>
                      <td>
                        <div className="font-medium text-gray-900 text-sm">{stop.order.customer}</div>
                        {stop.order.specialInstructions && (
                          <div className="text-xs text-gray-600 mt-0.5">{stop.order.specialInstructions}</div>
                        )}
                        <InstructionChips order={{ instructionFlags: stop.order.instructionFlags }} className="mt-1" />
                        {stop.order.notes && <div className="text-xs text-gray-400">{stop.order.notes}</div>}
                      </td>
                      <td className="font-mono text-sm">{stop.order.postcode}</td>
                      <td className="text-sm">{formatWeight(stop.order.weight)}</td>
                      <td className="text-xs text-gray-500 whitespace-nowrap">{windowLabel(stop.order) ?? '—'}</td>
                      <td className="text-xs whitespace-nowrap">
                        {stop.eta ? (
                          <span
                            className={stop.notes ? 'text-red-600 font-medium inline-flex items-center gap-1' : 'text-gray-700'}
                            title={stop.notes ?? undefined}
                          >
                            {stop.notes && <AlertTriangle size={12} />}
                            {formatUtcClock(stop.eta)}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="text-xs text-gray-500">{stop.duration ? formatDuration(stop.duration) : '—'}</td>
                      <td>
                        <button
                          onClick={() => handleRemoveStop(stop.id, stop.order.customer)}
                          disabled={removing === stop.id}
                          title="Remove from this route (order goes back to pending)"
                          className="p-1 text-gray-300 hover:text-red-600 disabled:opacity-30 transition-colors rounded"
                        >
                          <X size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Map */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">Route Map</h2>
            </div>
            {geocodedStops.length > 0 ? (
              <RouteMap stops={geocodedStops} />
            ) : (
              <div className="flex flex-col items-center justify-center h-80 text-gray-400 text-sm gap-2">
                <MapPin size={32} className="text-gray-300" />
                No geocoded stops — run Geocode from the Orders page.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Renders the driving / drops / break breakdown that adds up to the working-day total.
 * Returns null when we don't have driving time (older routes) so the caller can fall back.
 */
function renderTimeBreakdown(
  drivingMin: number | null,
  stopCount: number,
  totalMin: number | null,
  startMin: number | null
): string | null {
  if (drivingMin === null || drivingMin === undefined) return null
  const service = stopCount * SERVICE_TIME_PER_DROP_MIN
  const brk = drivingMin >= BREAK_AFTER_DRIVE_MIN ? BREAK_MIN : 0
  // Whatever's left of the working day is time parked waiting for delivery windows to open.
  const wait = totalMin != null ? Math.max(0, totalMin - drivingMin - service - brk) : 0
  const parts = [
    `Drive ${formatDuration(drivingMin)}`,
    `${stopCount} drops ${formatDuration(service)}`,
  ]
  if (brk > 0) parts.push(`Break ${formatDuration(brk)}`)
  if (wait > 0) parts.push(`Waiting ${formatDuration(wait)}`)
  if (startMin != null) parts.push(`Departs ${formatClock(startMin)}`)
  return parts.join(' · ')
}

/** ETAs are stored as wall-clock-in-UTC (same convention as Route.date), so read them back in UTC. */
function formatUtcClock(iso: string): string {
  const d = new Date(iso)
  return formatClock(d.getUTCHours() * 60 + d.getUTCMinutes())
}

function SummaryCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string | React.ReactNode; sub: string | React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-center gap-2 mb-2 text-gray-500">
        {icon}
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-xl font-bold text-gray-900">{value}</div>
      <div className="text-xs text-gray-400 mt-1">{sub}</div>
    </div>
  )
}
