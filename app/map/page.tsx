'use client'

import { useEffect, useState, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { PageHeader } from '@/components/ui/PageHeader'
import { formatWeight, formatDuration, formatDistance } from '@/lib/utils'
import { MapPin } from 'lucide-react'
import { format } from 'date-fns'
import type { MapRoute } from '@/components/ui/RouteMapMulti'

const RouteMapMulti = dynamic(
  () => import('@/components/ui/RouteMapMulti').then((m) => m.RouteMapMulti),
  { ssr: false, loading: () => <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">Loading map...</div> }
)

const ROUTE_COLORS = [
  '#0ea5e9', // sky
  '#ef4444', // red
  '#22c55e', // green
  '#f97316', // orange
  '#a855f7', // purple
  '#ec4899', // pink
  '#14b8a6', // teal
  '#f59e0b', // amber
  '#6366f1', // indigo
  '#84cc16', // lime
]

interface RouteData {
  id: string
  name: string
  status: string
  totalWeight: number
  totalDistance: number | null
  totalDuration: number | null
  truck: { name: string; registration: string | null }
  stops: {
    id: string
    sequence: number
    order: {
      customer: string
      postcode: string
      weight: number
      lat: number | null
      lng: number | null
    }
  }[]
}

export default function MapPage() {
  const [dates, setDates] = useState<string[]>([])
  const [selectedDate, setSelectedDate] = useState<string>('')
  const [routes, setRoutes] = useState<RouteData[]>([])
  const [loading, setLoading] = useState(false)

  // Load available dates on mount
  useEffect(() => {
    fetch('/api/routes/dates')
      .then((r) => r.json())
      .then((d: string[]) => {
        setDates(d)
        if (d.length > 0) setSelectedDate(d[0])
      })
  }, [])

  const fetchRoutes = useCallback((date: string) => {
    if (!date) return
    setLoading(true)
    fetch(`/api/routes?date=${date}`)
      .then((r) => r.json())
      .then(setRoutes)
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (selectedDate) fetchRoutes(selectedDate)
  }, [selectedDate, fetchRoutes])

  // Build MapRoute objects with assigned colours
  const mapRoutes: MapRoute[] = routes.map((r, i) => ({
    id: r.id,
    name: r.truck.name,
    color: ROUTE_COLORS[i % ROUTE_COLORS.length],
    stops: r.stops
      .filter((s) => s.order.lat && s.order.lng)
      .map((s) => ({
        sequence: s.sequence,
        lat: s.order.lat!,
        lng: s.order.lng!,
        customer: s.order.customer,
        postcode: s.order.postcode,
        weight: s.order.weight,
      })),
  }))

  const totalStops = routes.reduce((s, r) => s + r.stops.length, 0)
  const totalWeight = routes.reduce((s, r) => s + r.totalWeight, 0)

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Map View"
        subtitle="All routes for a day on one map"
        actions={
          <div className="flex items-center gap-3">
            <select
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg bg-white text-gray-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              {dates.length === 0 && <option value="">No routes yet</option>}
              {dates.map((d) => (
                <option key={d} value={d}>
                  {format(new Date(d + 'T12:00:00'), 'EEEE d MMMM yyyy')}
                </option>
              ))}
            </select>
          </div>
        }
      />

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-gray-400">Loading routes...</div>
      ) : routes.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-gray-400 gap-2">
          <MapPin size={40} className="text-gray-300" />
          <p>No routes found for this date.</p>
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden">
          {/* Map — takes most of the space */}
          <div className="flex-1 relative">
            <RouteMapMulti routes={mapRoutes} />
          </div>

          {/* Right panel — legend + route summaries */}
          <div className="w-72 shrink-0 border-l border-gray-200 bg-white flex flex-col overflow-hidden">
            {/* Summary bar */}
            <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
              <p className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-1">Day Summary</p>
              <div className="grid grid-cols-2 gap-2 text-center">
                <div>
                  <p className="text-lg font-bold text-gray-900">{routes.length}</p>
                  <p className="text-xs text-gray-400">Trucks</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-gray-900">{totalStops}</p>
                  <p className="text-xs text-gray-400">Stops</p>
                </div>
              </div>
              <div className="mt-2 text-center">
                <p className="text-sm font-semibold text-gray-700">{formatWeight(totalWeight)} total</p>
              </div>
            </div>

            {/* Route list */}
            <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
              {routes.map((route, i) => {
                const color = ROUTE_COLORS[i % ROUTE_COLORS.length]
                return (
                  <div key={route.id} className="p-4">
                    {/* Truck header */}
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-3 h-3 rounded-full shrink-0" style={{ background: color }} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-900 truncate">{route.truck.name}</p>
                        {route.truck.registration && (
                          <p className="text-xs text-gray-400">{route.truck.registration}</p>
                        )}
                      </div>
                    </div>

                    {/* Stats row */}
                    <div className="grid grid-cols-3 gap-1 text-center mb-3">
                      <div className="bg-gray-50 rounded p-1.5">
                        <p className="text-xs font-bold text-gray-800">{route.stops.length}</p>
                        <p className="text-xs text-gray-400">stops</p>
                      </div>
                      <div className="bg-gray-50 rounded p-1.5">
                        <p className="text-xs font-bold text-gray-800">{formatWeight(route.totalWeight)}</p>
                        <p className="text-xs text-gray-400">weight</p>
                      </div>
                      <div className="bg-gray-50 rounded p-1.5">
                        <p className="text-xs font-bold text-gray-800">
                          {route.totalDuration ? formatDuration(route.totalDuration) : '—'}
                        </p>
                        <p className="text-xs text-gray-400">drive</p>
                      </div>
                    </div>

                    {/* Stop list */}
                    <div className="space-y-1">
                      {route.stops.map((stop) => (
                        <div key={stop.id} className="flex items-center gap-2 text-xs">
                          <div
                            className="w-5 h-5 rounded-full shrink-0 flex items-center justify-center text-white font-bold"
                            style={{ background: color, fontSize: '10px' }}
                          >
                            {stop.sequence}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="truncate text-gray-800">{stop.order.customer}</p>
                            <p className="text-gray-400">{stop.order.postcode}</p>
                          </div>
                        </div>
                      ))}
                    </div>

                    {route.totalDistance && (
                      <p className="text-xs text-gray-400 mt-2 text-right">
                        {formatDistance(route.totalDistance)} total
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
