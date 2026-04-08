import React from 'react'
import type { Toast as ToastType } from '@shared/types'
import { Zap, CheckCircle, XCircle } from 'lucide-react'

interface ToastProps {
  toast: ToastType | null
}

export function Toast({ toast }: ToastProps): React.ReactElement | null {
  if (!toast) return null

  const baseClasses =
    'fixed bottom-8 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-5'
  const variantClasses = {
    success: 'bg-emerald-600 border-emerald-400/50',
    error: 'bg-rose-600 border-rose-400/50',
    info: 'bg-indigo-600 border-indigo-400/50'
  }
  const iconMap = {
    success: CheckCircle,
    error: XCircle,
    info: Zap
  }
  const Icon = iconMap[toast.type]

  return (
    <div className={baseClasses}>
      <div
        className={`${variantClasses[toast.type]} text-white px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-3 border`}
      >
        <Icon size={18} className="text-amber-400 animate-pulse" />
        <span className="font-bold tracking-tight text-sm">{toast.message}</span>
      </div>
    </div>
  )
}
