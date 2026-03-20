'use client'

import { useEffect, useState, useCallback } from 'react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input, Select } from '@/components/ui/Input'
import { statusBadge } from '@/components/ui/Badge'
import { formatWeight, formatDuration, formatDistance } from '@/lib/utils'
import { Plus, Trash2, Eye, Zap } from 'lucide-react'
import Link from 'next/link'
import { format } from 'date-fns'

interface Route {
  id: string
  name: string
  date: string
  status: string
  totalWeight: number
  totalDistance: number | null
  totalDuration: number | null
  truck: { id: string; name: string; registration: string | null; capacity: number }
  stops: { id: string; sequence: number; order: { customer: string; postcode: string } }[]
}

interface Truck {
  id: string
  name: string
  capacity: number
}

const DAYS = [
  { value: 'monday', label: 'Monday' },
  { value: 'tuesday', label: 'Tuesday' },
  { value: 'wednesday', label: 'Wednesday' },
  { value: 'thursday', label: 'Thursday' },
  { value: 'friday', label: 'Friday' },
  { value: 'saturday', label: 'Saturday' },
]

export default function RoutesPage() {
  const [routes, setRoutes] = useState<Route[]>([])
  const [trucks, setTrucks] = useState<Truck[]>([])
  const [loading, setLoading] = useState(true)
  const [generateModal, setGenerateModal] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [generateResult, setGenerateResult] = useState<string | null>(null)
  const [genForm, setGenForm] = useState({ day: 'monday', date: format(new Date(), 'yyyy-MM-dd'), includeUnassigned: false })
  const [preview, setPreview] = useState<{ dayCount: number; unassignedCount: number } | null>(null)

  const fetchRoutes = useCallback(() => {
    setLoading(true)
    fetch('/api/routes').then((r) => r.json()).then(setRoutes).finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    fetchRoutes()
    fetch('/api/trucks').then((r) => r.json()).then(setTrucks)
  }, [fetchRoutes])

  const fetchPreview = useCallback((day: string) => {
    setPreview(null)
    fetch(`/api/routes/preview?day=${day}`)
      .then((r) => r.json())
      .then(setPreview)
      .catch(() => {})
  }, [])

  const handleGenerate = async () => {
    setGenerating(true)
    setGenerateResult(null)
    try {
      const res = await fetch('/api/routes/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ day: genForm.day, date: genForm.date, includeUnassigned: genForm.includeUnassigned }),
      })
      const data = await res.json()
      if (res.ok) {
        setGenerateResult(`Generated ${data.total} route(s) with ${data.ordersRouted} orders.`)
        fetchRoutes()
        setPreview(null)
      } else {
        setGenerateResult('Error: ' + (data.error ?? 'Unknown error'))
      }
    } catch {
      setGenerateResult('Network error')
    } finally {
      setGenerating(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this route?')) return
    await fetch(`/api/routes/${id}`, { method: 'DELETE' })
    fetchRoutes()
  }

  return (
    <div className="flex flex-col min-h-full">
      <PageHeader
        title="Routes"
        subtitle={`${routes.length} route(s)`}
        actions={
          <Button size="sm" onClick={() => { setGenerateModal(true); fetchPreview(genForm.day) }}>
            <Zap size={14} /> Generate Routes
          </Button>
        }
      />

      <div className="flex-1 overflow-auto">
        <table className="data-table">
          <thead className="sticky top-0 z-10">
            <tr>
              <th>Route Name</th>
              <th>Date</th>
              <th>Truck</th>
              <th>Stops</th>
              <th>Total Weight</th>
              <th>Distance</th>
              <th>Duration</th>
              <th>Status</th>
              <th className="w-20">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={9} className="text-center py-8 text-gray-400">Loading...</td></tr>}
            {!loading && routes.length === 0 && (
              <tr>
                <td colSpan={9} className="text-center py-12 text-gray-400">
                  No routes yet. Click <strong>Generate Routes</strong> to create routes from your pending orders.
                </td>
              </tr>
            )}
            {routes.map((route) => (
              <tr key={route.id}>
                <td className="font-medium text-gray-900">{route.name}</td>
                <td className="text-gray-600">{format(new Date(route.date), 'dd MMM yyyy')}</td>
                <td>
                  <div className="text-sm text-gray-900">{route.truck.name}</div>
                  {route.truck.registration && <div className="text-xs text-gray-400">{route.truck.registration}</div>}
                </td>
                <td>{route.stops.length}</td>
                <td>
                  <span className={route.totalWeight > route.truck.capacity ? 'text-red-600 font-medium' : ''}>
                    {formatWeight(route.totalWeight)}
                  </span>
                  <span className="text-xs text-gray-400"> / {formatWeight(route.truck.capacity)}</span>
                </td>
                <td>{route.totalDistance ? formatDistance(route.totalDistance) : '—'}</td>
                <td>{route.totalDuration ? formatDuration(route.totalDuration) : '—'}</td>
                <td>{statusBadge(route.status)}</td>
                <td>
                  <div className="flex items-center gap-1">
                    <Link href={`/routes/${route.id}`} className="p-1.5 text-gray-400 hover:text-sky-600 transition-colors rounded">
                      <Eye size={14} />
                    </Link>
                    <button onClick={() => handleDelete(route.id)} className="p-1.5 text-gray-400 hover:text-red-600 transition-colors rounded">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Generate Routes Modal */}
      <Modal open={generateModal} onClose={() => { setGenerateModal(false); setGenerateResult(null); setPreview(null) }} title="Generate Routes" size="md">
        <div className="space-y-4">
          <Select
            label="Day"
            value={genForm.day}
            onChange={(e) => {
              setGenForm({ ...genForm, day: e.target.value })
              fetchPreview(e.target.value)
            }}
            options={DAYS}
          />
          <Input
            label="Route Date"
            type="date"
            value={genForm.date}
            onChange={(e) => setGenForm({ ...genForm, date: e.target.value })}
          />

          {/* Preview counts */}
          {preview && (
            <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-gray-600">Orders assigned to {genForm.day}:</span>
                <span className={`font-semibold ${preview.dayCount > 0 ? 'text-green-600' : 'text-gray-400'}`}>{preview.dayCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Orders with no day assigned:</span>
                <span className={`font-semibold ${preview.unassignedCount > 0 ? 'text-orange-500' : 'text-gray-400'}`}>{preview.unassignedCount}</span>
              </div>
              <div className="flex justify-between border-t border-gray-200 pt-1 mt-1">
                <span className="text-gray-700 font-medium">Will be routed:</span>
                <span className="font-bold text-gray-900">
                  {genForm.includeUnassigned ? preview.dayCount + preview.unassignedCount : preview.dayCount}
                </span>
              </div>
            </div>
          )}

          {/* Include unassigned toggle */}
          <label className="flex items-start gap-3 cursor-pointer bg-orange-50 rounded-lg p-3">
            <input
              type="checkbox"
              checked={genForm.includeUnassigned}
              onChange={(e) => setGenForm({ ...genForm, includeUnassigned: e.target.checked })}
              className="mt-0.5 w-4 h-4 text-orange-500 rounded"
            />
            <div>
              <p className="text-sm font-medium text-gray-800">Include unassigned orders</p>
              <p className="text-xs text-gray-500 mt-0.5">Route orders that haven&apos;t been assigned a day by rules. Useful if most orders have no day set.</p>
            </div>
          </label>

          {generating && <div className="text-sm text-sky-600 text-center">Generating routes... this may take a moment.</div>}
          {generateResult && (
            <div className={`rounded-lg p-3 text-sm ${generateResult.startsWith('Error') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
              {generateResult}
            </div>
          )}
          <div className="flex gap-2">
            <Button onClick={handleGenerate} loading={generating}>Generate Routes</Button>
            <Button variant="secondary" onClick={() => { setGenerateModal(false); setPreview(null) }}>Cancel</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
