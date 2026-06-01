'use client'

import * as RadixToast from '@radix-ui/react-toast'
import { createContext, useCallback, useContext, useState } from 'react'
import { CheckCircle, AlertCircle, Info, X } from 'lucide-react'

type ToastVariant = 'success' | 'error' | 'info'

interface ToastInput {
  title: string
  message?: string
  variant?: ToastVariant
  duration?: number
}

interface ToastItem {
  id: number
  title: string
  message?: string
  variant: ToastVariant
  duration: number
}

interface ToastContextValue {
  push: (input: ToastInput) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>')
  return ctx
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])

  const push = useCallback((input: ToastInput) => {
    // Math.random() instead of Date.now() so React can never collide IDs when
    // two toasts fire in the same tick.
    const id = Math.floor(Math.random() * 1e9)
    setItems((prev) => [
      ...prev,
      {
        id,
        title: input.title,
        message: input.message,
        variant: input.variant ?? 'success',
        duration: input.duration ?? 5000,
      },
    ])
  }, [])

  const remove = (id: number) => setItems((prev) => prev.filter((t) => t.id !== id))

  return (
    <ToastContext.Provider value={{ push }}>
      <RadixToast.Provider swipeDirection="right" duration={5000}>
        {children}
        {items.map((t) => (
          <RadixToast.Root
            key={t.id}
            duration={t.duration}
            onOpenChange={(open) => {
              if (!open) remove(t.id)
            }}
            className={`bg-white border rounded-xl shadow-lg p-4 ${variantBorder(t.variant)}`}
          >
            <div className="flex items-start gap-3">
              {variantIcon(t.variant)}
              <div className="flex-1 min-w-0">
                <RadixToast.Title className="font-semibold text-sm text-gray-900">
                  {t.title}
                </RadixToast.Title>
                {t.message && (
                  <RadixToast.Description className="text-sm text-gray-600 mt-0.5 break-words">
                    {t.message}
                  </RadixToast.Description>
                )}
              </div>
              <RadixToast.Close
                aria-label="Close"
                className="p-1 text-gray-300 hover:text-gray-600 transition-colors rounded"
              >
                <X size={14} />
              </RadixToast.Close>
            </div>
          </RadixToast.Root>
        ))}
        <RadixToast.Viewport className="fixed top-4 right-4 z-50 flex flex-col gap-2 w-96 max-w-[calc(100vw-2rem)] outline-none" />
      </RadixToast.Provider>
    </ToastContext.Provider>
  )
}

function variantIcon(v: ToastVariant) {
  if (v === 'success') return <CheckCircle size={18} className="text-green-500 shrink-0 mt-0.5" />
  if (v === 'error') return <AlertCircle size={18} className="text-red-500 shrink-0 mt-0.5" />
  return <Info size={18} className="text-sky-500 shrink-0 mt-0.5" />
}

function variantBorder(v: ToastVariant): string {
  if (v === 'success') return 'border-green-200'
  if (v === 'error') return 'border-red-200'
  return 'border-sky-200'
}
