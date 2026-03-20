'use client'

import { useEffect, useState } from 'react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Save, MapPin, CheckCircle, Plus, Pencil, Trash2 } from 'lucide-react'

interface Settings {
  DEPOT_LAT?: string
  DEPOT_LNG?: string
  DEPOT_ADDRESS?: string
  DEFAULT_TRUCK_CAPACITY?: string
}

interface Depot {
  id: string
  name: string
  address: string | null
  lat: number | null
  lng: number | null
  active: boolean
}

type DepotForm = { name: string; address: string; lat: string; lng: string; active: boolean }

const EMPTY_DEPOT_FORM: DepotForm = { name: '', address: '', lat: '', lng: '', active: true }

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const [depots, setDepots] = useState<Depot[]>([])
  const [depotModal, setDepotModal] = useState(false)
  const [editingDepot, setEditingDepot] = useState<Depot | null>(null)
  const [depotForm, setDepotForm] = useState<DepotForm>(EMPTY_DEPOT_FORM)
  const [depotSaving, setDepotSaving] = useState(false)

  const fetchDepots = () => {
    fetch('/api/depots').then((r) => r.json()).then(setDepots).catch(() => {})
  }

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then(setSettings)
      .finally(() => setLoading(false))
    fetchDepots()
  }, [])

  const handleSave = async () => {
    setSaving(true)
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    })
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  const openAddDepot = () => {
    setEditingDepot(null)
    setDepotForm(EMPTY_DEPOT_FORM)
    setDepotModal(true)
  }

  const openEditDepot = (depot: Depot) => {
    setEditingDepot(depot)
    setDepotForm({
      name: depot.name,
      address: depot.address ?? '',
      lat: depot.lat !== null ? String(depot.lat) : '',
      lng: depot.lng !== null ? String(depot.lng) : '',
      active: depot.active,
    })
    setDepotModal(true)
  }

  const handleDepotSave = async () => {
    setDepotSaving(true)
    const payload = {
      name: depotForm.name,
      address: depotForm.address || null,
      lat: depotForm.lat || null,
      lng: depotForm.lng || null,
      active: depotForm.active,
    }
    if (editingDepot) {
      await fetch(`/api/depots/${editingDepot.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    } else {
      await fetch('/api/depots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    }
    setDepotSaving(false)
    setDepotModal(false)
    fetchDepots()
  }

  const handleDepotDelete = async (id: string, name: string) => {
    if (!confirm(`Delete depot "${name}"?`)) return
    await fetch(`/api/depots/${id}`, { method: 'DELETE' })
    fetchDepots()
  }

  return (
    <div className="flex flex-col min-h-full">
      <PageHeader
        title="Settings"
        subtitle="Configure system defaults"
        actions={
          <Button onClick={handleSave} loading={saving} size="sm">
            <Save size={14} /> {saved ? 'Saved!' : 'Save Settings'}
          </Button>
        }
      />

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-gray-400">Loading settings...</div>
      ) : (
        <div className="flex-1 p-6 space-y-6 max-w-2xl">
          {/* Free mapping stack info */}
          <section className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center gap-2 mb-4">
              <CheckCircle size={18} className="text-green-500" />
              <h2 className="font-semibold text-gray-900">Mapping &amp; Geocoding</h2>
            </div>
            <div className="space-y-2">
              <div className="bg-green-50 rounded-lg p-4 space-y-2">
                <p className="text-sm font-medium text-green-800">No API keys required — everything is free</p>
                <ul className="text-xs text-green-700 space-y-1">
                  <li><strong>Geocoding</strong> — postcodes.io (free UK postcode database, no key, bulk lookups)</li>
                  <li><strong>Routing</strong> — OSRM (Open Source Routing Machine, OpenStreetMap data, free)</li>
                  <li><strong>Maps</strong> — Leaflet + OpenStreetMap (free, used by Wikipedia &amp; GitHub)</li>
                </ul>
              </div>
            </div>
          </section>

          {/* Depot Management */}
          <section className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <MapPin size={18} className="text-sky-500" />
                <h2 className="font-semibold text-gray-900">Depot Management</h2>
              </div>
              <Button size="sm" onClick={openAddDepot}>
                <Plus size={14} /> Add Depot
              </Button>
            </div>
            {depots.length === 0 ? (
              <p className="text-sm text-gray-400">No depots configured. Add a depot to enable per-depot filtering and routing.</p>
            ) : (
              <div className="space-y-2">
                {depots.map((depot) => (
                  <div key={depot.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-100">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900">{depot.name}</span>
                        {!depot.active && <span className="text-xs text-gray-400 bg-gray-200 px-1.5 py-0.5 rounded">Inactive</span>}
                      </div>
                      {depot.address && <p className="text-xs text-gray-500 mt-0.5">{depot.address}</p>}
                      {depot.lat !== null && depot.lng !== null && (
                        <p className="text-xs text-gray-400 mt-0.5">{depot.lat.toFixed(4)}, {depot.lng.toFixed(4)}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 ml-3">
                      <button onClick={() => openEditDepot(depot)} className="p-1.5 text-gray-400 hover:text-sky-600 transition-colors rounded">
                        <Pencil size={14} />
                      </button>
                      <button onClick={() => handleDepotDelete(depot.id, depot.name)} className="p-1.5 text-gray-400 hover:text-red-600 transition-colors rounded">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Depot / Home Base */}
          <section className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center gap-2 mb-4">
              <MapPin size={18} className="text-green-500" />
              <h2 className="font-semibold text-gray-900">Depot / Home Base</h2>
            </div>
            <div className="space-y-4">
              <Input
                label="Depot Address"
                value={settings.DEPOT_ADDRESS ?? ''}
                onChange={(e) => setSettings({ ...settings, DEPOT_ADDRESS: e.target.value })}
                placeholder="e.g. West Country Group, Swindon, SN1 1AA"
              />
              <div className="grid grid-cols-2 gap-4">
                <Input
                  label="Depot Latitude"
                  type="number"
                  step="0.0001"
                  value={settings.DEPOT_LAT ?? ''}
                  onChange={(e) => setSettings({ ...settings, DEPOT_LAT: e.target.value })}
                  placeholder="e.g. 51.5601"
                />
                <Input
                  label="Depot Longitude"
                  type="number"
                  step="0.0001"
                  value={settings.DEPOT_LNG ?? ''}
                  onChange={(e) => setSettings({ ...settings, DEPOT_LNG: e.target.value })}
                  placeholder="e.g. -1.7850"
                />
              </div>
              <p className="text-xs text-gray-400">
                The depot is the starting point for route optimisation. You can find your lat/lng on Google Maps by right-clicking your depot location.
              </p>
            </div>
          </section>

          {/* Defaults */}
          <section className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center gap-2 mb-4">
              <h2 className="font-semibold text-gray-900">Fleet Defaults</h2>
            </div>
            <Input
              label="Default Truck Capacity (kg)"
              type="number"
              value={settings.DEFAULT_TRUCK_CAPACITY ?? '7500'}
              onChange={(e) => setSettings({ ...settings, DEFAULT_TRUCK_CAPACITY: e.target.value })}
            />
            <p className="text-xs text-gray-400 mt-1">
              Default payload capacity used when adding new trucks. Typical 12T DAF payload is ~7,500kg.
            </p>
          </section>

          <Button onClick={handleSave} loading={saving}>
            <Save size={14} /> {saved ? '✓ Saved!' : 'Save Settings'}
          </Button>
        </div>
      )}

      {/* Add/Edit Depot Modal */}
      <Modal
        open={depotModal}
        onClose={() => setDepotModal(false)}
        title={editingDepot ? `Edit Depot — ${editingDepot.name}` : 'Add Depot'}
        size="md"
      >
        <div className="space-y-4">
          <Input
            label="Depot Name"
            value={depotForm.name}
            onChange={(e) => setDepotForm({ ...depotForm, name: e.target.value })}
            placeholder="e.g. Swindon"
          />
          <Input
            label="Address"
            value={depotForm.address}
            onChange={(e) => setDepotForm({ ...depotForm, address: e.target.value })}
            placeholder="e.g. 1 Depot Road, Swindon, SN1 1AA"
          />
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Latitude"
              type="number"
              step="0.0001"
              value={depotForm.lat}
              onChange={(e) => setDepotForm({ ...depotForm, lat: e.target.value })}
              placeholder="e.g. 51.5601"
            />
            <Input
              label="Longitude"
              type="number"
              step="0.0001"
              value={depotForm.lng}
              onChange={(e) => setDepotForm({ ...depotForm, lng: e.target.value })}
              placeholder="e.g. -1.7850"
            />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={depotForm.active}
              onChange={(e) => setDepotForm({ ...depotForm, active: e.target.checked })}
              className="w-4 h-4 text-sky-500 rounded"
            />
            <span className="text-sm text-gray-700">Active</span>
          </label>
          <div className="flex gap-2 pt-2">
            <Button onClick={handleDepotSave} loading={depotSaving}>
              {editingDepot ? 'Save Changes' : 'Add Depot'}
            </Button>
            <Button variant="secondary" onClick={() => setDepotModal(false)}>Cancel</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
