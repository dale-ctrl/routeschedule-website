'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Package,
  Route,
  CalendarDays,
  Map,
  Zap,
  Truck,
  Settings,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/utils'

const NAV = [
  { label: 'Dashboard', href: '/', icon: LayoutDashboard },
  { label: 'Orders', href: '/orders', icon: Package },
  { label: 'Routes', href: '/routes', icon: Route },
  { label: 'Map View', href: '/map', icon: Map },
  { label: 'Schedule', href: '/schedule', icon: CalendarDays },
  { label: 'Rules Engine', href: '/rules', icon: Zap },
  { label: 'Trucks', href: '/trucks', icon: Truck },
  { label: 'Settings', href: '/settings', icon: Settings },
]

export function Sidebar() {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)

  return (
    <aside
      className={cn(
        'flex flex-col h-full bg-[#1a2234] text-white transition-all duration-200 shrink-0',
        collapsed ? 'w-16' : 'w-56'
      )}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-5 border-b border-white/10">
        <div className="w-8 h-8 bg-sky-500 rounded-lg flex items-center justify-center shrink-0">
          <Route size={16} className="text-white" />
        </div>
        {!collapsed && (
          <span className="font-semibold text-sm leading-tight">
            Route<br />
            <span className="text-sky-400">Schedule</span>
          </span>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 py-3 overflow-y-auto">
        {NAV.map(({ label, href, icon: Icon }) => {
          const active = pathname === href || (href !== '/' && pathname.startsWith(href))
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-3 px-4 py-2.5 mx-2 my-0.5 rounded-lg text-sm transition-colors',
                active
                  ? 'bg-sky-600/30 text-sky-300 font-medium'
                  : 'text-gray-400 hover:bg-white/5 hover:text-white'
              )}
              title={collapsed ? label : undefined}
            >
              <Icon size={18} className="shrink-0" />
              {!collapsed && <span>{label}</span>}
            </Link>
          )
        })}
      </nav>

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center justify-center py-3 border-t border-white/10 text-gray-500 hover:text-white transition-colors"
      >
        {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
      </button>
    </aside>
  )
}
