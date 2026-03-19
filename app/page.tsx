'use client'

import { useEffect, useState } from 'react'
import { PageHeader } from '@/components/ui/PageHeader'
import { formatWeight, statusColor } from '@/lib/utils'
import { Package, Route, Truck, Zap, TrendingUp, Clock } from 'lucide-react'
import Link from 'next/link'

interface DashboardData {
  stats: {
    totalOrders: number
    pendingOrders: number
    scheduledOrders: number
    totalRoutes: number
    activeTrucks: number
    totalRules: number
  }
  recentRoutes: {
    id: string
    name: string
    status: string
    totalWeight: number
    truck: { name: string }
    stops: { order: { customer: string; postcode: string } }[]
  }[]
  weightByDay: { scheduledDay: string | null; _sum: { weight: number | null }; _count: number }[]
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/dashboard')
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-gray-500">Loading dashboard...</div>
      </div>
    )
  }

  const stats = data?.stats

  return (
    <div className="flex flex-col min-h-full">
      <PageHeader title="Dashboard" subtitle="Overview of your route scheduling operations" />
      <div className="flex-1 p-6 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
          <StatCard icon={<Package className="text-blue-500" size={20} />} label="Total Orders" value={stats?.totalOrders ?? 0} bg="bg-blue-50" />
          <StatCard icon={<Clock className="text-yellow-500" size={20} />} label="Pending" value={stats?.pendingOrders ?? 0} bg="bg-yellow-50" />
          <StatCard icon={<TrendingUp className="text-green-500" size={20} />} label="Scheduled" value={stats?.scheduledOrders ?? 0} bg="bg-green-50" />
          <StatCard icon={<Route className="text-purple-500" size={20} />} label="Routes" value={stats?.totalRoutes ?? 0} bg="bg-purple-50" />
          <StatCard icon={<Truck className="text-sky-500" size={20} />} label="Active Trucks" value={stats?.activeTrucks ?? 0} bg="bg-sky-50" />
          <StatCard icon={<Zap className="text-orange-500" size={20} />} label="Active Rules" value={stats?.totalRules ?? 0} bg="bg-orange-50" />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {/* Recent Routes */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">Recent Routes</h2>
              <Link href="/routes" className="text-xs text-sky-600 hover:underline">View all</Link>
            </div>
            <div className="divide-y divide-gray-50">
              {(!data?.recentRoutes || data.recentRoutes.length === 0) && (
                <div className="px-5 py-8 text-center text-gray-400 text-sm">
                  No routes yet.{' '}
                  <Link href="/orders" className="text-sky-600 hover:underline">Import orders</Link> to get started.
                </div>
              )}
              {data?.recentRoutes.map((route) => (
                <Link key={route.id} href={`/routes/${route.id}`} className="flex items-center justify-between px-5 py-3 hover:bg-gray-50 transition-colors">
                  <div>
                    <div className="text-sm font-medium text-gray-900">{route.name}</div>
                    <div className="text-xs text-gray-500">{route.truck.name} · {route.stops.length} stops</div>
                  </div>
                  <div className="text-right">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusColor(route.status)}`}>
                      {route.status}
                    </span>
                    <div className="text-xs text-gray-400 mt-1">{formatWeight(route.totalWeight)}</div>
                  </div>
                </Link>
              ))}
            </div>
          </div>

          {/* Weight by day */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">Orders by Day</h2>
            </div>
            <div className="p-5 space-y-3">
              {(!data?.weightByDay || data.weightByDay.length === 0) && (
                <div className="text-center text-gray-400 text-sm py-4">No scheduled orders yet.</div>
              )}
              {data?.weightByDay
                .filter((d) => d.scheduledDay)
                .sort((a, b) => {
                  const order = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
                  return order.indexOf(a.scheduledDay!) - order.indexOf(b.scheduledDay!)
                })
                .map((d) => (
                  <div key={d.scheduledDay} className="flex items-center gap-3">
                    <div className="w-24 text-sm text-gray-600 capitalize">{d.scheduledDay}</div>
                    <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
                      <div className="bg-sky-500 h-full rounded-full" style={{ width: `${Math.min(100, ((d._sum.weight ?? 0) / 7500) * 100)}%` }} />
                    </div>
                    <div className="text-xs text-gray-500 w-24 text-right">
                      {d._count} · {formatWeight(d._sum.weight ?? 0)}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>

        {/* Quick actions */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="font-semibold text-gray-900 mb-4">Quick Actions</h2>
          <div className="flex flex-wrap gap-3">
            <Link href="/orders" className="flex items-center gap-2 px-4 py-2.5 bg-sky-600 text-white rounded-lg text-sm font-medium hover:bg-sky-700 transition-colors">
              <Package size={16} /> Import Orders
            </Link>
            <Link href="/routes" className="flex items-center gap-2 px-4 py-2.5 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 transition-colors">
              <Route size={16} /> Generate Routes
            </Link>
            <Link href="/rules" className="flex items-center gap-2 px-4 py-2.5 bg-orange-500 text-white rounded-lg text-sm font-medium hover:bg-orange-600 transition-colors">
              <Zap size={16} /> Manage Rules
            </Link>
            <Link href="/trucks" className="flex items-center gap-2 px-4 py-2.5 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700 transition-colors">
              <Truck size={16} /> Manage Trucks
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

function StatCard({ icon, label, value, bg }: { icon: React.ReactNode; label: string; value: number; bg: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className={`w-9 h-9 rounded-lg ${bg} flex items-center justify-center mb-3`}>{icon}</div>
      <div className="text-2xl font-bold text-gray-900">{value.toLocaleString()}</div>
      <div className="text-xs text-gray-500 mt-0.5">{label}</div>
    </div>
  )
}
