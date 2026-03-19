import type { Metadata } from 'next'
import { Geist } from 'next/font/google'
import './globals.css'
import { Sidebar } from '@/components/layout/Sidebar'

const geist = Geist({ variable: '--font-geist-sans', subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Route Schedule',
  description: 'Truck route scheduling and management',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} h-full`}>
      <body className="h-full flex overflow-hidden">
        <Sidebar />
        <main className="flex-1 flex flex-col overflow-auto bg-[#f0f2f5]">
          {children}
        </main>
      </body>
    </html>
  )
}
