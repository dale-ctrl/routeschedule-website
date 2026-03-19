'use client'

import { useEffect, useState } from 'react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Save, ExternalLink, Key, MapPin } from 'lucide-react'

interface Settings {
  GOOGLE_MAPS_API_KEY?: string
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
        subtitle="Configure API keys and system defaults"
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
          {/* Google Maps */}
          <section className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center gap-2 mb-4">
              <Key size={18} className="text-sky-500" />
              <h2 className="font-semibold text-gray-900">Google Maps API</h2>
            </div>
            <div className="space-y-4">
              <div>
                <Input
                  label="Google Maps API Key"
                  type="password"
                  value={settings.GOOGLE_MAPS_API_KEY ?? ''}
                  onChange={(e) => setSettings({ ...settings, GOOGLE_MAPS_API_KEY: e.target.value })}
                  placeholder="AIzaSy..."
                />
                <p className="text-xs text-gray-400 mt-1">
                  Required for geocoding postcodes, calculating route times, and displaying maps.
                </p>
              </div>
              <div className="bg-blue-50 rounded-lg p-3 flex items-start gap-2">
                <ExternalLink size={14} className="text-blue-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs text-blue-700 font-medium">How to get a Google Maps API key</p>
                  <ol className="text-xs text-blue-600 mt-1 space-y-0.5 list-decimal list-inside">
                    <li>Go to console.cloud.google.com</li>
                    <li>Create a project or select an existing one</li>
                    <li>Enable: Maps JavaScript API, Directions API, Geocoding API, Distance Matrix API</li>
                    <li>Go to Credentials → Create API Key</li>
                    <li>Paste it above</li>
                  </ol>
                </div>
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

          {/* Environment note */}
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
            <p className="text-xs text-yellow-700">
              <strong>Note:</strong> Settings saved here are stored in the database.
              For production, you can also set <code className="bg-yellow-100 px-1 rounded">GOOGLE_MAPS_API_KEY</code> and
              <code className="bg-yellow-100 px-1 rounded ml-1">NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code> in your <code>.env</code> file.
              Environment variables take precedence over database settings.
            </p>
          </div>

          <Button onClick={handleSave} loading={saving}>
            <Save size={14} /> {saved ? '✓ Saved!' : 'Save Settings'}
          </Button>
        </div>
      )}
    </div>
  )
}
