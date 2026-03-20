import type { Metadata } from 'next'
import { Geist } from 'next/font/google'
import './globals.css'
import { AppShell } from '@/components/layout/AppShell'

const geist = Geist({ variable: '--font-geist-sans', subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Route Schedule',
  description: 'Truck route scheduling and management',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} h-full`}>
      <body className="h-full">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  )
}
