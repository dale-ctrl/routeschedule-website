'use client'

import { useEffect, useState } from 'react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { statusBadge } from '@/components/ui/Badge'
import { formatWeight, formatDuration } from '@/lib/utils'
import { ChevronLeft, ChevronRight, MapPin, Truck } from 'lucide-react'
import Link from 'next/link'
import { format, startOfWeek, addDays, addWeeks, subWeeks } from 'date-fns'

interface Route {
  id: string
  name: string
  date: string
  status: string
  totalWeight: number
  totalDuration: number | null
  truck: { name: string; capacity: number }
  stops: { id: string }[]
}

const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export default function SchedulePage() {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }))
  const [routes, setRoutes] = useState<Route[]>([])
  const [loading, setLoading] = useState(true)
  const [ordersByDay, setOrdersByDay] = useState<Record<string, number>>({})

  const weekDays = DAYS_OF_WEEK.map((_, i) => addDays(weekStart, i))

  useEffect(() => {
    setLoading(true)
    Promise.all([
      fetch('/api/routes').then((r) => r.json()),
      fetch('/api/orders?limit=1000').then((r) => r.json()),
    ]).then(([routesData, ordersData]) => {
      setRoutes(routesData)
      // Count pending orders by day
      const byDay: Record<string, number> = {}
      for (const order of ordersData.orders) {
        if (order.scheduledDay && order.status === 'pending') {
          byDay[order.scheduledDay] = (byDay[order.scheduledDay] ?? 0) + 1
        }
      }
      setOrdersByDay(byDay)
    }).finally(() => setLoading(false))
  }, [])

  const getRoutesForDay = (date: Date) => {
    const dateStr = format(date, 'yyyy-MM-dd')
    return routes.filter((r) => r.date.startsWith(dateStr))
  }

  const getDayPendingOrders = (dayName: string) => {
    return ordersByDay[dayName.toLowerCase()] ?? 0
  }

  return (
    <div className="flex flex-col min-h-full">
      <PageHeader
        title="Schedule"
        subtitle={`Week of ${format(weekStart, 'd MMMM yyyy')}`}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => setWeekStart(subWeeks(weekStart, 1))}>
              <ChevronLeft size={14} />
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}>
              Today
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setWeekStart(addWeeks(weekStart, 1))}>
              <ChevronRight size={14} />
            </Button>
          </div>
        }
      />

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-gray-400">Loading schedule...</div>
      ) : (
        <div className="flex-1 overflow-auto p-6">
          <div className="grid grid-cols-6 gap-4 min-h-[500px]">
            {DAYS_OF_WEEK.map((dayName, i) => {
              const date = weekDays[i]
              const dayRoutes = getRoutesForDay(date)
              const pendingCount = getDayPendingOrders(dayName)
              const isToday = format(date, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd')

              return (
                <div key={dayName} className={`flex flex-col rounded-xl border overflow-hidden ${isToday ? 'border-sky-400' : 'border-gray-200'} bg-white`}>
                  {/* Day header */}
                  <div className={`px-3 py-3 border-b ${isToday ? 'bg-sky-600 text-white border-sky-500' : 'bg-gray-50 border-gray-100 text-gray-700'}`}>
                    <div className="font-semibold text-sm">{dayName}</div>
                    <div className={`text-xs mt-0.5 ${isToday ? 'text-sky-100' : 'text-gray-400'}`}>{format(date, 'd MMM')}</div>
                  </div>

                  {/* Pending orders indicator */}
                  {pendingCount > 0 && (
                    <div className="px-3 py-1.5 bg-yellow-50 border-b border-yellow-100">
                      <span className="text-xs text-yellow-700">{pendingCount} pending order{pendingCount !== 1 ? 's' : ''}</span>
                    </div>
                  )}

                  {/* Routes */}
                  <div className="flex-1 p-2 space-y-2 overflow-y-auto">
                    {dayRoutes.length === 0 && (
                      <div className="text-xs text-gray-300 text-center py-4">No routes</div>
                    )}
                    {dayRoutes.map((route) => (
                      <Link
                        key={route.id}
                        href={`/routes/${route.id}`}
                        className="block bg-gray-50 hover:bg-sky-50 border border-gray-200 hover:border-sky-200 rounded-lg p-2.5 transition-colors"
                      >
                        <div className="flex items-center gap-1 mb-1">
                          <Truck size={11} className="text-sky-500 shrink-0" />
                          <span className="text-xs font-medium text-gray-800 truncate">{route.truck.name}</span>
                        </div>
                        <div className="flex items-center gap-1 text-xs text-gray-500">
                          <MapPin size={10} /> {route.stops.length} stops
                        </div>
                        <div className="mt-1">
                          {statusBadge(route.status)}
                        </div>
                        <div className="text-xs text-gray-400 mt-1">
                          {formatWeight(route.totalWeight)}
                          {route.totalDuration ? ` · ${formatDuration(route.totalDuration)}` : ''}
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
