'use client'

import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import { useEmailSettings } from '@/hooks/useEmailSettings'
import { alertMessage } from '@/lib/emailSettings'

/** Banner del panel del superadmin: hoy se omitieron o fallaron correos. Solo se consulta para el superadmin. */
export default function EmailQuotaBanner() {
  const role = useAuthStore(s => s.user?.role)
  const { settings } = useEmailSettings(role === 'superadmin')
  const message = role === 'superadmin' ? alertMessage(settings) : null
  if (!message) return null
  return (
    <div role="alert" className="bg-amber-50 border border-amber-100 text-amber-700 rounded-2xl px-4 py-3.5 flex items-center gap-3 flex-wrap">
      <AlertTriangle className="w-4 h-4 flex-shrink-0" />
      <span className="text-sm font-semibold flex-1">{message}</span>
      <Link href="/admin/settings" className="text-xs font-black underline">Revisar correos</Link>
    </div>
  )
}
