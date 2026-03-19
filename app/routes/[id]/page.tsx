'use client'

import { useEffect, useState, use } from 'react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { statusBadge } from '@/components/ui/Badge'
import { formatWeight, formatDuration, formatDistance } from '@/lib/utils'
import { ArrowLeft, MapPin, Clock, Weight, Truck as TruckIcon } from 'lucide-react'
import Link from 'next/link'
import { format } from 'date-fns'

interface Stop {
  id: string
  sequence: number
  duration: number | null
  distance: number | null
  order: {
    id: string
    customer: string
    postcode: string
    address: string | null
    weight: number
    deliveryTime: string | null
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
  const [route, setRoute] = useState<RouteDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

  useEffect(() => {
    fetch(`/api/routes/${id}`)
      .then((r) => r.json())
      .then(setRoute)
      .finally(() => setLoading(false))
  }, [id])

  if (loading) return <div className="flex-1 flex items-center justify-center text-gray-400">Loading route...</div>
  if (!route) return <div className="flex-1 flex items-center justify-center text-gray-400">Route not found.</div>

  const geocodedStops = route.stops.filter((s) => s.order.lat && s.order.lng)
  const mapsUrl = geocodedStops.length > 0
    ? `https://www.google.com/maps/dir/${geocodedStops.map((s) => `${s.order.lat},${s.order.lng}`).join('/')}`
    : null

  return (
    <div className="flex flex-col min-h-full">
      <PageHeader
        title={route.name}
        subtitle={format(new Date(route.date), 'EEEE, d MMMM yyyy')}
        actions={
          <>
            {mapsUrl && (
              <a href={mapsUrl} target="_blank" rel="noopener noreferrer">
                <Button variant="secondary" size="sm">Open in Google Maps</Button>
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
          <SummaryCard icon={<Clock size={18} className="text-orange-500" />} label="Duration" value={route.totalDuration ? formatDuration(route.totalDuration) : '—'} sub={statusBadge(route.status) as unknown as string} />
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
                    <th>Time</th>
                    <th>Drive</th>
                  </tr>
                </thead>
                <tbody>
                  {route.stops.map((stop) => (
                    <tr key={stop.id}>
                      <td className="text-gray-400 font-mono text-xs">{stop.sequence}</td>
                      <td>
                        <div className="font-medium text-gray-900 text-sm">{stop.order.customer}</div>
                        {stop.order.notes && <div className="text-xs text-gray-400">{stop.order.notes}</div>}
                      </td>
                      <td className="font-mono text-sm">{stop.order.postcode}</td>
                      <td className="text-sm">{formatWeight(stop.order.weight)}</td>
                      <td className="text-xs text-gray-500 capitalize">{stop.order.deliveryTime ?? '—'}</td>
                      <td className="text-xs text-gray-500">{stop.duration ? formatDuration(stop.duration) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Map embed */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">Route Map</h2>
            </div>
            {apiKey && apiKey !== 'YOUR_GOOGLE_MAPS_API_KEY_HERE' && geocodedStops.length > 0 ? (
              <RouteMapEmbed stops={geocodedStops} apiKey={apiKey} />
            ) : (
              <div className="flex flex-col items-center justify-center h-64 text-gray-400 text-sm gap-2">
                <MapPin size={32} className="text-gray-300" />
                {!apiKey || apiKey === 'YOUR_GOOGLE_MAPS_API_KEY_HERE'
                  ? 'Add your Google Maps API key in Settings to see the map.'
                  : geocodedStops.length === 0
                  ? 'No geocoded stops. Run Geocode from the Orders page.'
                  : ''}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
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

function RouteMapEmbed({ stops, apiKey }: { stops: Stop[]; apiKey: string }) {
  const coords = stops.map((s) => `${s.order.lat},${s.order.lng}`).join('|')
  // Use Google Maps Embed API with waypoints
  const origin = `${stops[0].order.lat},${stops[0].order.lng}`
  const dest = `${stops[stops.length - 1].order.lat},${stops[stops.length - 1].order.lng}`
  const waypoints = stops.slice(1, -1).map((s) => `${s.order.lat},${s.order.lng}`).join('|')

  const src = `https://www.google.com/maps/embed/v1/directions?key=${apiKey}&origin=${origin}&destination=${dest}${waypoints ? `&waypoints=${waypoints}` : ''}&mode=driving`

  return (
    <iframe
      src={src}
      className="w-full h-80"
      allowFullScreen
      referrerPolicy="no-referrer-when-downgrade"
      title="Route Map"
    />
  )
}
