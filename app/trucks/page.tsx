'use client'

import { useEffect, useState, useCallback } from 'react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input, Select, TextArea } from '@/components/ui/Input'
import { formatWeight } from '@/lib/utils'
import { Plus, Pencil, Truck, Power } from 'lucide-react'

interface TruckRecord {
  id: string
  name: string
  registration: string | null
  capacity: number
  type: string
  active: boolean
  depot: string | null
  notes: string | null
  createdAt: string
}

interface Depot {
  id: string
  name: string
}

const emptyTruck = {
  name: '',
  registration: '',
  capacity: '7500',
  type: '12T DAF',
  active: true,
  depot: '',
  notes: '',
}

const TRUCK_TYPES = [
  { value: '12T DAF', label: '12T DAF' },
  { value: '7.5T DAF', label: '7.5T DAF' },
  { value: '3.5T Transit', label: '3.5T Transit' },
  { value: 'Artic', label: 'Articulated' },
  { value: 'Custom', label: 'Custom' },
]

export default function TrucksPage() {
  const [trucks, setTrucks] = useState<TruckRecord[]>([])
  const [depots, setDepots] = useState<Depot[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [editingTruck, setEditingTruck] = useState<typeof emptyTruck | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const fetchTrucks = useCallback(() => {
    setLoading(true)
    fetch('/api/trucks').then((r) => r.json()).then(setTrucks).finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    fetchTrucks()
    fetch('/api/depots').then((r) => r.json()).then(setDepots).catch(() => {})
  }, [fetchTrucks])

  const openNew = () => {
    setEditingTruck({ ...emptyTruck })
    setEditingId(null)
    setModal(true)
  }

  const openEdit = (truck: TruckRecord) => {
    setEditingTruck({
      name: truck.name,
      registration: truck.registration ?? '',
      capacity: String(truck.capacity),
      type: truck.type,
      active: truck.active,
      depot: truck.depot ?? '',
      notes: truck.notes ?? '',
    })
    setEditingId(truck.id)
    setModal(true)
  }

  const handleSave = async () => {
    if (!editingTruck) return
    setSaving(true)
    const url = editingId ? `/api/trucks/${editingId}` : '/api/trucks'
    const method = editingId ? 'PUT' : 'POST'
    await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editingTruck),
    })
    setSaving(false)
    setModal(false)
    fetchTrucks()
  }

  const handleToggleActive = async (truck: TruckRecord) => {
    await fetch(`/api/trucks/${truck.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...truck, active: !truck.active }),
    })
    fetchTrucks()
  }

  return (
    <div className="flex flex-col min-h-full">
      <PageHeader
        title="Fleet"
        subtitle={`${trucks.filter((t) => t.active).length} active truck(s)`}
        actions={
          <Button size="sm" onClick={openNew}>
            <Plus size={14} /> Add Truck
          </Button>
        }
      />

      <div className="flex-1 p-6">
        {loading ? (
          <div className="text-center text-gray-400 py-12">Loading fleet...</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {trucks.length === 0 && (
              <div className="col-span-3 bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
                No trucks added yet. Click <strong>Add Truck</strong> to set up your fleet.
              </div>
            )}
            {trucks.map((truck) => (
              <div key={truck.id} className={`bg-white rounded-xl border border-gray-200 p-5 ${!truck.active ? 'opacity-60' : ''}`}>
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${truck.active ? 'bg-sky-100' : 'bg-gray-100'}`}>
                      <Truck size={20} className={truck.active ? 'text-sky-600' : 'text-gray-400'} />
                    </div>
                    <div>
                      <div className="font-semibold text-gray-900">{truck.name}</div>
                      {truck.registration && <div className="text-xs text-gray-400 font-mono">{truck.registration}</div>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => openEdit(truck)} className="p-1.5 text-gray-400 hover:text-sky-600 rounded transition-colors">
                      <Pencil size={15} />
                    </button>
                    <button onClick={() => handleToggleActive(truck)} className={`p-1.5 rounded transition-colors ${truck.active ? 'text-green-500 hover:text-red-500' : 'text-gray-400 hover:text-green-500'}`} title={truck.active ? 'Deactivate' : 'Activate'}>
                      <Power size={15} />
                    </button>
                  </div>
                </div>

                {truck.depot && (
                  <div className="mb-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-sky-100 text-sky-700">
                      {truck.depot}
                    </span>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <div className="text-xs text-gray-400">Type</div>
                    <div className="font-medium text-gray-700">{truck.type}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-400">Payload Capacity</div>
                    <div className="font-medium text-gray-700">{formatWeight(truck.capacity)}</div>
                  </div>
                </div>

                {/* Capacity bar */}
                <div className="mt-3">
                  <div className="flex justify-between text-xs text-gray-400 mb-1">
                    <span>Capacity</span>
                    <span>{formatWeight(truck.capacity)}</span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-sky-500 rounded-full" style={{ width: `${Math.min(100, (truck.capacity / 12000) * 100)}%` }} />
                  </div>
                </div>

                {truck.notes && <p className="mt-3 text-xs text-gray-400">{truck.notes}</p>}

                <div className="mt-3">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${truck.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {truck.active ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title={editingId ? 'Edit Truck' : 'Add Truck'}>
        {editingTruck && (
          <div className="space-y-4">
            <Input label="Truck Name" value={editingTruck.name} onChange={(e) => setEditingTruck({ ...editingTruck, name: e.target.value })} placeholder="e.g. DAF 1 - Plymouth" />
            <Input label="Registration" value={editingTruck.registration} onChange={(e) => setEditingTruck({ ...editingTruck, registration: e.target.value })} placeholder="e.g. AB12 CDE" />
            <Select label="Truck Type" value={editingTruck.type} onChange={(e) => setEditingTruck({ ...editingTruck, type: e.target.value })} options={TRUCK_TYPES} />
            <Input label="Payload Capacity (kg)" type="number" value={editingTruck.capacity} onChange={(e) => setEditingTruck({ ...editingTruck, capacity: e.target.value })} />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Depot</label>
              <select
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                value={editingTruck.depot}
                onChange={(e) => setEditingTruck({ ...editingTruck, depot: e.target.value })}
              >
                <option value="">No depot assigned</option>
                {depots.map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
              </select>
            </div>
            <TextArea label="Notes (optional)" value={editingTruck.notes} onChange={(e) => setEditingTruck({ ...editingTruck, notes: e.target.value })} placeholder="Any notes about this truck..." />
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={editingTruck.active} onChange={(e) => setEditingTruck({ ...editingTruck, active: e.target.checked })} className="w-4 h-4 text-sky-600 rounded" />
              <span className="text-sm font-medium text-gray-700">Active (included in route generation)</span>
            </label>
            <div className="flex gap-2 pt-2 border-t border-gray-100">
              <Button onClick={handleSave} loading={saving}>{editingId ? 'Save Changes' : 'Add Truck'}</Button>
              <Button variant="secondary" onClick={() => setModal(false)}>Cancel</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
