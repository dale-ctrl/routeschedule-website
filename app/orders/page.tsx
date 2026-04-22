'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input, Select } from '@/components/ui/Input'
import { statusBadge } from '@/components/ui/Badge'
import { formatWeight } from '@/lib/utils'
import { Upload, Plus, Trash2, Search, RefreshCw, Pencil, RotateCcw } from 'lucide-react'
import Papa from 'papaparse'
import * as XLSX from 'xlsx'

interface Order {
  id: string
  reference: string | null
  customer: string
  postcode: string
  address: string | null
  weight: number
  notes: string | null
  area: string | null
  status: string
  scheduledDay: string | null
  deliveryTime: string | null
  lat: number | null
  lng: number | null
  priority: number
  depot: string | null
  createdAt: string
}

interface Depot {
  id: string
  name: string
}

const DAYS = [
  { value: '', label: 'Any day' },
  { value: 'monday', label: 'Monday' },
  { value: 'tuesday', label: 'Tuesday' },
  { value: 'wednesday', label: 'Wednesday' },
  { value: 'thursday', label: 'Thursday' },
  { value: 'friday', label: 'Friday' },
  { value: 'saturday', label: 'Saturday' },
]

const STATUSES = [
  { value: '', label: 'All statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'cancelled', label: 'Cancelled' },
]

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [dayFilter, setDayFilter] = useState('')
  const [depotFilter, setDepotFilter] = useState('')
  const [depots, setDepots] = useState<Depot[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [importModal, setImportModal] = useState(false)
  const [editOrder, setEditOrder] = useState<Order | null>(null)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<string | null>(null)
  const [geocoding, setGeocoding] = useState(false)
  const [resetting, setResetting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const LIMIT = 50

  useEffect(() => {
    fetch('/api/depots').then((r) => r.json()).then(setDepots).catch(() => {})
  }, [])

  const fetchOrders = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams({
      page: String(page),
      limit: String(LIMIT),
      ...(search ? { search } : {}),
      ...(statusFilter ? { status: statusFilter } : {}),
      ...(dayFilter ? { day: dayFilter } : {}),
      ...(depotFilter ? { depot: depotFilter } : {}),
    })
    fetch(`/api/orders?${params}`)
      .then((r) => r.json())
      .then((d) => { setOrders(d.orders); setTotal(d.total) })
      .finally(() => setLoading(false))
  }, [page, search, statusFilter, dayFilter, depotFilter])

  useEffect(() => { fetchOrders() }, [fetchOrders])

  const handleFileImport = async (file: File) => {
    setImporting(true)
    setImportResult(null)
    try {
      let rows: Record<string, string>[] = []

      if (file.name.endsWith('.csv')) {
        const text = await file.text()
        const result = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true })
        rows = result.data
      } else {
        const buf = await file.arrayBuffer()
        const wb = XLSX.read(buf)
        const ws = wb.Sheets[wb.SheetNames[0]]
        rows = XLSX.utils.sheet_to_json<Record<string, string>>(ws)
      }

      const res = await fetch('/api/orders/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows }),
      })
      const data = await res.json()
      if (!res.ok) {
        setImportResult(`Import failed: ${data.error ?? 'Unknown server error'}`)
        return
      }
      setImportResult(`Imported ${data.imported} orders. Geocoded: ${data.geocoded}`)
      fetchOrders()
    } catch (err) {
      setImportResult('Import failed: ' + String(err))
    } finally {
      setImporting(false)
    }
  }

  const handleDelete = async (ids: string[]) => {
    if (!confirm(`Delete ${ids.length} order(s)?`)) return
    const res = await fetch(`/api/orders?ids=${ids.join(',')}`, { method: 'DELETE' })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      alert(`Delete failed: ${data.error ?? 'Unknown error'}`)
      return
    }
    setSelected(new Set())
    fetchOrders()
  }

  const handleDeleteAllFiltered = async () => {
    const filterDesc = [
      statusFilter && `status=${statusFilter}`,
      dayFilter && `day=${dayFilter}`,
      depotFilter && `depot=${depotFilter}`,
      search && `search="${search}"`,
    ].filter(Boolean).join(', ')
    const scope = filterDesc ? `all ${total} matching (${filterDesc})` : `ALL ${total} orders`
    if (!confirm(`Delete ${scope}? This will also remove their route stops and empty routes. This cannot be undone.`)) return

    const params = new URLSearchParams()
    if (statusFilter) params.set('status', statusFilter)
    if (dayFilter) params.set('day', dayFilter)
    if (depotFilter) params.set('depot', depotFilter)
    if (search) params.set('search', search)
    if (!statusFilter && !dayFilter && !depotFilter && !search) params.set('all', 'true')

    const res = await fetch(`/api/orders?${params}`, { method: 'DELETE' })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      alert(`Delete failed: ${data.error ?? 'Unknown error'}`)
      return
    }
    setSelected(new Set())
    fetchOrders()
  }

  const handleResetToPending = async () => {
    const ids = selected.size > 0 ? [...selected] : null
    const msg = ids ? `Reset ${ids.length} selected order(s) to pending?` : 'Reset ALL scheduled orders back to pending?'
    if (!confirm(msg)) return
    setResetting(true)
    await fetch('/api/orders', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ids ? { ids, status: 'pending' } : { status: 'pending' }),
    })
    setSelected(new Set())
    fetchOrders()
    setResetting(false)
  }

  const handleGeocode = async () => {
    setGeocoding(true)
    await fetch('/api/geocode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
    fetchOrders()
    setGeocoding(false)
  }

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    if (selected.size === orders.length) setSelected(new Set())
    else setSelected(new Set(orders.map((o) => o.id)))
  }

  const totalPages = Math.ceil(total / LIMIT)

  return (
    <div className="flex flex-col min-h-full">
      <PageHeader
        title="Orders"
        subtitle={`${total.toLocaleString()} total orders`}
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={handleGeocode} loading={geocoding}>
              <RefreshCw size={14} /> Geocode
            </Button>
            <Button variant="secondary" size="sm" onClick={handleResetToPending} loading={resetting}>
              <RotateCcw size={14} /> {selected.size > 0 ? `Reset to Pending (${selected.size})` : 'Reset All to Pending'}
            </Button>
            {selected.size > 0 && (
              <Button variant="danger" size="sm" onClick={() => handleDelete([...selected])}>
                <Trash2 size={14} /> Delete ({selected.size})
              </Button>
            )}
            {total > 0 && (
              <Button variant="danger" size="sm" onClick={handleDeleteAllFiltered}>
                <Trash2 size={14} /> Delete All{statusFilter || dayFilter || depotFilter || search ? ' Filtered' : ''} ({total})
              </Button>
            )}
            <Button size="sm" onClick={() => setImportModal(true)}>
              <Upload size={14} /> Import CSV / Excel
            </Button>
          </>
        }
      />

      {/* Filters */}
      <div className="flex items-center gap-3 px-6 py-3 bg-white border-b border-gray-200">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
            placeholder="Search customer, postcode, ref..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
          />
        </div>
        <select
          className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none"
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }}
        >
          {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <select
          className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none"
          value={dayFilter}
          onChange={(e) => { setDayFilter(e.target.value); setPage(1) }}
        >
          {DAYS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
        </select>
        {depots.length > 0 && (
          <select
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none"
            value={depotFilter}
            onChange={(e) => { setDepotFilter(e.target.value); setPage(1) }}
          >
            <option value="">All depots</option>
            {depots.map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
          </select>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="data-table">
          <thead className="sticky top-0 z-10">
            <tr>
              <th className="w-10">
                <input type="checkbox" checked={selected.size === orders.length && orders.length > 0} onChange={toggleAll} />
              </th>
              <th>Customer</th>
              <th>Reference</th>
              <th>Postcode</th>
              <th>Area</th>
              <th>Weight</th>
              <th>Day</th>
              <th>Status</th>
              <th>Geocoded</th>
              <th className="w-10"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={10} className="text-center py-8 text-gray-400">Loading...</td></tr>
            )}
            {!loading && orders.length === 0 && (
              <tr>
                <td colSpan={10} className="text-center py-12 text-gray-400">
                  No orders found. Click <strong>Import CSV / Excel</strong> to get started.
                </td>
              </tr>
            )}
            {orders.map((order) => (
              <tr key={order.id}>
                <td>
                  <input type="checkbox" checked={selected.has(order.id)} onChange={() => toggleSelect(order.id)} />
                </td>
                <td className="font-medium text-gray-900">{order.customer}</td>
                <td className="text-gray-500">{order.reference ?? '—'}</td>
                <td className="font-mono text-sm">{order.postcode}</td>
                <td className="text-gray-500">{order.area ?? '—'}</td>
                <td>{formatWeight(order.weight)}</td>
                <td className="capitalize text-gray-600">{order.scheduledDay ?? '—'}</td>
                <td>{statusBadge(order.status)}</td>
                <td>
                  <span className={`text-xs ${order.lat ? 'text-green-600' : 'text-gray-400'}`}>
                    {order.lat ? '✓' : '✗'}
                  </span>
                </td>
                <td>
                  <button onClick={() => setEditOrder(order)} className="text-gray-400 hover:text-sky-600 transition-colors">
                    <Pencil size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-6 py-3 bg-white border-t border-gray-200">
          <span className="text-sm text-gray-500">Page {page} of {totalPages} · {total.toLocaleString()} rows</span>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
            <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</Button>
          </div>
        </div>
      )}

      {/* Import Modal */}
      <Modal open={importModal} onClose={() => { setImportModal(false); setImportResult(null) }} title="Import Orders" size="lg">
        <div className="space-y-4">
          <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-600">
            <p className="font-medium text-gray-800 mb-2">Accepted file formats: CSV or Excel (.xlsx)</p>
            <p>Your file should have columns like:</p>
            <code className="block mt-2 bg-white p-2 rounded border text-xs">
              Customer, Postcode, Weight (kg), Reference, Address, Notes, Area, Delivery Time
            </code>
            <p className="mt-2 text-xs text-gray-500">Column names are flexible — the system will recognise common variants.</p>
          </div>

          <div
            className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-sky-400 transition-colors"
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              const file = e.dataTransfer.files[0]
              if (file) handleFileImport(file)
            }}
          >
            <Upload size={24} className="mx-auto text-gray-400 mb-2" />
            <p className="text-sm text-gray-600">Drop your file here or <span className="text-sky-600 underline">click to browse</span></p>
            <p className="text-xs text-gray-400 mt-1">CSV or Excel files only</p>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileImport(f) }}
          />

          {importing && <div className="text-sm text-sky-600 text-center">Importing and geocoding... this may take a moment.</div>}
          {importResult && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-700">
              {importResult}
            </div>
          )}

          <div className="bg-blue-50 rounded-lg p-3">
            <p className="text-xs text-blue-700 font-medium">About rules &amp; geocoding</p>
            <p className="text-xs text-blue-600 mt-1">
              Active rules are applied automatically during import to assign orders to days.
              Postcodes are geocoded using Google Maps (requires API key in Settings).
            </p>
          </div>
        </div>
      </Modal>

      {/* Edit Order Modal */}
      {editOrder && (
        <EditOrderModal
          order={editOrder}
          depots={depots}
          onClose={() => setEditOrder(null)}
          onSaved={() => { setEditOrder(null); fetchOrders() }}
        />
      )}
    </div>
  )
}

function EditOrderModal({ order, depots, onClose, onSaved }: { order: Order; depots: Depot[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ ...order, weight: String(order.weight), priority: String(order.priority ?? 0) })
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    await fetch(`/api/orders/${order.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, weight: parseFloat(form.weight) || 0, priority: parseInt(form.priority) || 0 }),
    })
    setSaving(false)
    onSaved()
  }

  return (
    <Modal open onClose={onClose} title={`Edit Order — ${order.customer}`}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Input label="Customer" value={form.customer} onChange={(e) => setForm({ ...form, customer: e.target.value })} />
          <Input label="Reference" value={form.reference ?? ''} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
          <Input label="Postcode" value={form.postcode} onChange={(e) => setForm({ ...form, postcode: e.target.value.toUpperCase() })} />
          <Input label="Weight (kg)" type="number" value={form.weight} onChange={(e) => setForm({ ...form, weight: e.target.value })} />
          <Input label="Area" value={form.area ?? ''} onChange={(e) => setForm({ ...form, area: e.target.value })} />
          <Select
            label="Scheduled Day"
            value={form.scheduledDay ?? ''}
            onChange={(e) => setForm({ ...form, scheduledDay: e.target.value || null })}
            options={DAYS}
          />
          <Select
            label="Status"
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value })}
            options={STATUSES.slice(1).map((s) => ({ value: s.value, label: s.label }))}
          />
          <Select
            label="Delivery Time"
            value={form.deliveryTime ?? ''}
            onChange={(e) => setForm({ ...form, deliveryTime: e.target.value || null })}
            options={[
              { value: '', label: 'Any time' },
              { value: 'am', label: 'AM' },
              { value: 'pm', label: 'PM' },
            ]}
          />
        </div>
        <Input label="Notes" value={form.notes ?? ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        {depots.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Depot</label>
            <select
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
              value={form.depot ?? ''}
              onChange={(e) => setForm({ ...form, depot: e.target.value || null })}
            >
              <option value="">No depot</option>
              {depots.map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
            </select>
          </div>
        )}
        <div className="flex gap-2 pt-2">
          <Button onClick={handleSave} loading={saving}>Save Changes</Button>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </Modal>
  )
}
