'use client'

import { useEffect, useState } from 'react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Save, MapPin, CheckCircle } from 'lucide-react'

interface Settings {
  DEPOT_LAT?: string
  DEPOT_LNG?: string
  DEPOT_ADDRESS?: string
  DEFAULT_TRUCK_CAPACITY?: string
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then(setSettings)
      .finally(() => setLoading(false))
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
    </div>
  )
}
