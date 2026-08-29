'use client'

import { useState } from 'react'
import { Bug, AlertTriangle, HelpCircle, MoreHorizontal, X, Send, CheckCircle2, Clock } from 'lucide-react'
import { useSupportTickets, SupportTicketWithUser } from '@/hooks/useAdminData'
import api from '@/lib/api'
import ChipiWidget from '@/components/chipi/ChipiWidget'
import Skeleton from '@/components/ui/Skeleton'
import RefreshButton from '@/components/ui/RefreshButton'
import DesktopOnly from '@/components/ui/DesktopOnly'
import { usePageTopBar } from '@/lib/mobileTopBar'

const CATEGORY_CONFIG: Record<string, { label: string; icon: React.ReactNode }> = {
  bug: { label: 'Bug', icon: <Bug className="w-3.5 h-3.5" /> },
  error: { label: 'Error', icon: <AlertTriangle className="w-3.5 h-3.5" /> },
  question: { label: 'Duda', icon: <HelpCircle className="w-3.5 h-3.5" /> },
  other: { label: 'Otro', icon: <MoreHorizontal className="w-3.5 h-3.5" /> },
}

const STATUS_TABS = [
  { key: undefined, label: 'Todos' },
  { key: 'pending', label: 'Pendientes' },
  { key: 'answered', label: 'Respondidos' },
]

const ROLE_LABEL: Record<string, string> = {
  student: 'Estudiante',
  teacher: 'Profesor',
}

function ResolveModal({
  ticket,
  onClose,
  onResolved,
}: {
  ticket: SupportTicketWithUser
  onClose: () => void
  onResolved: () => void
}) {
  const [response, setResponse] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    if (!response.trim()) return
    setSending(true)
    setError('')
    try {
      await api.patch(`/admin/support-tickets/${ticket.id}/resolve`, { admin_response: response.trim() })
      onResolved()
      onClose()
    } catch (e: any) {
      setError(e.response?.data?.detail || 'Error respondiendo el ticket')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-xl bg-white rounded-[2rem] shadow-2xl p-6 sm:p-8 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between mb-5">
          <div>
            <h2 className="text-lg font-black text-slate-800">{ticket.subject}</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {ROLE_LABEL[ticket.user_role] || ticket.user_role} · {ticket.user_name} {ticket.user_surname} · @{ticket.user_username} · {ticket.user_email}
            </p>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center flex-shrink-0">
            <X className="w-4 h-4 text-slate-500" />
          </button>
        </div>

        <div className="bg-slate-50 rounded-2xl p-4 mb-5">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Mensaje del usuario</p>
          <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{ticket.message}</p>
        </div>

        {ticket.status === 'answered' ? (
          <div className="bg-emerald-50 rounded-2xl p-4">
            <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest mb-2">Ya respondido</p>
            <p className="text-sm text-emerald-800 leading-relaxed whitespace-pre-wrap">{ticket.admin_response}</p>
          </div>
        ) : (
          <>
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">
              Tu respuesta
            </label>
            <textarea
              value={response}
              onChange={(e) => setResponse(e.target.value)}
              rows={5}
              maxLength={2000}
              placeholder="Escribe una respuesta personalizada..."
              className="w-full bg-slate-50 border-2 border-transparent rounded-xl text-sm font-medium
                         text-slate-800 placeholder:text-slate-400 px-4 py-3.5 focus:outline-none
                         focus:bg-white focus:border-pink-500 focus:ring-4 focus:ring-pink-50
                         transition-all duration-300 resize-none"
            />

            {error && (
              <div className="mt-3 bg-rose-50 border border-rose-100 text-rose-600 px-4 py-3 rounded-xl text-xs font-bold">
                {error}
              </div>
            )}

            <button
              onClick={submit}
              disabled={!response.trim() || sending}
              className="w-full mt-4 py-3.5 text-sm font-bold text-white rounded-xl
                         bg-gradient-to-r from-pink-500 to-rose-400 hover:from-pink-600 hover:to-rose-500
                         shadow-lg shadow-pink-200 hover:shadow-pink-300 active:scale-[0.98]
                         transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed
                         flex items-center justify-center gap-2"
            >
              {sending ? (
                <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  Enviar respuesta
                </>
              )}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

export default function AdminSupportPage() {
  const [statusFilter, setStatusFilter] = useState<string | undefined>('pending')
  const [categoryFilter, setCategoryFilter] = useState<string | undefined>(undefined)
  const { tickets, loading, isFetching, refetch } = useSupportTickets(statusFilter, categoryFilter)
  const [selected, setSelected] = useState<SupportTicketWithUser | null>(null)

  usePageTopBar({ title: 'Soporte', onRefresh: refetch, isFetching })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-slate-800 tracking-tight">Soporte</h1>
          <p className="text-slate-500 mt-1">Bugs, errores y dudas reportadas por estudiantes y profesores</p>
        </div>
        <DesktopOnly>
          <RefreshButton onRefresh={refetch} isFetching={isFetching} />
        </DesktopOnly>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 bg-white border border-slate-100 rounded-2xl p-1 shadow-sm w-fit">
          {STATUS_TABS.map((t) => (
            <button
              key={t.label}
              onClick={() => setStatusFilter(t.key)}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all duration-200 ${
                statusFilter === t.key ? 'bg-gradient-to-r from-pink-500 to-rose-400 text-white shadow-md' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <select
          value={categoryFilter ?? ''}
          onChange={(e) => setCategoryFilter(e.target.value || undefined)}
          className="bg-white border border-slate-100 rounded-2xl px-4 py-2.5 text-xs font-bold text-slate-600 shadow-sm focus:outline-none"
        >
          <option value="">Todas las categorías</option>
          <option value="bug">Bug</option>
          <option value="error">Error</option>
          <option value="question">Duda</option>
          <option value="other">Otro</option>
        </select>
      </div>

      <div className="space-y-3">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)
        ) : tickets.length === 0 ? (
          <div className="bg-white rounded-[2rem] border border-slate-100 shadow-sm py-16 text-center">
            <p className="text-slate-400 font-bold">No hay tickets en esta vista</p>
          </div>
        ) : (
          tickets.map((t) => {
            const cfg = CATEGORY_CONFIG[t.category] ?? CATEGORY_CONFIG.other
            const isAnswered = t.status === 'answered'
            return (
              <button
                key={t.id}
                onClick={() => setSelected(t)}
                className="w-full text-left bg-white rounded-2xl border border-slate-100 shadow-sm hover:shadow-md
                           transition-all duration-200 p-5 flex items-center gap-4"
              >
                <div className="w-10 h-10 bg-slate-50 rounded-xl flex items-center justify-center flex-shrink-0 text-slate-400">
                  {cfg.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span
                      className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full flex items-center gap-1 ${
                        isAnswered ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                      }`}
                    >
                      {isAnswered ? <CheckCircle2 className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                      {isAnswered ? 'Respondido' : 'Pendiente'}
                    </span>
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                      {ROLE_LABEL[t.user_role] || t.user_role}
                    </span>
                    <span className="text-[10px] text-slate-400 font-bold">
                      {new Date(t.created_at).toLocaleDateString('es', { day: 'numeric', month: 'short' })}
                    </span>
                  </div>
                  <p className="text-sm font-bold text-slate-800 truncate">{t.subject}</p>
                  <p className="text-xs text-slate-400 truncate mt-0.5">{t.user_name} {t.user_surname} · @{t.user_username}</p>
                </div>
              </button>
            )
          })
        )}
      </div>

      {selected && (
        <ResolveModal
          ticket={selected}
          onClose={() => setSelected(null)}
          onResolved={refetch}
        />
      )}

      <ChipiWidget screenName="admin_support" />
    </div>
  )
}
