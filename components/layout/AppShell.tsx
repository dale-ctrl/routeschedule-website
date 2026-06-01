'use client'

import { usePathname } from 'next/navigation'
import { Sidebar } from './Sidebar'
import { ToastProvider } from '@/components/ui/Toast'

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <ToastProvider>
      {pathname === '/login' ? (
        <div className="h-full">{children}</div>
      ) : (
        <div className="h-full flex overflow-hidden">
          <Sidebar />
          <main className="flex-1 flex flex-col overflow-auto bg-[#f0f2f5]">
            {children}
          </main>
        </div>
      )}
    </ToastProvider>
  )
}
