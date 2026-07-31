'use client'

import { useState } from 'react'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import api from '@/lib/api'
import type { TeacherClass } from '@/hooks/useTeacherData'
import { Video } from 'lucide-react'

const STATUS_CONFIG: Record<string, {
  badge: 'warning' | 'info' | 'success' | 'danger' | 'neutral' | 'gold' | 'pink'
  label: string
  border: string
}> = {
  pending:         { badge: 'warning', label: 'Pendiente pago',   border: 'border-l-amber-400' },
  pending_trial:   { badge: 'warning', label: 'Prueba pendiente', border: 'border-l-purple-400' },
  pending_payment: { badge: 'info',    label: 'En revisión',      border: 'border-l-blue-400' },
  confirmed:       { badge: 'success', label: 'Confirmada',       border: 'border-l-emerald-400' },
  completed:       { badge: 'neutral', label: 'Completada',       border: 'border-l-slate-300' },
  cancelled:       { badge: 'danger',  label: 'Cancelada',        border: 'border-l-red-400' },
  no_show:         { badge: 'danger',  label: 'No asistió',       border: 'border-l-red-600' },
  finalized:       { badge: 'neutral', label: 'Finalizada',       border: 'border-l-slate-300' },
}

const NEXT_STATUSES: Record<string, string[]> = {
  pending:         ['cancelled'],
  pending_trial:   ['cancelled'],
  pending_payment: ['cancelled'],
  confirmed:       ['completed', 'no_show', 'cancelled'],
  completed:       ['no_show'],
  cancelled:       ['no_show', 'completed'],
  no_show:         ['completed', 'cancelled'],
  finalized:       ['completed', 'no_show', 'cancelled'],
}

interface ClassCardProps {
  class_: TeacherClass
  onUpdate: () => void
}

export default function ClassCard({ class_, onUpdate }: ClassCardProps) {
  const [updating, setUpdating] = useState(false)
  const [showReschedule, setShowReschedule] = useState(false)
  const [newDate, setNewDate] = useState('')
  const [newTime, setNewTime] = useState('')

  const config = STATUS_CONFIG[class_.status] || {
    badge: 'neutral' as const,
    label: class_.status,
    border: 'border-l-slate-200',
  }

  const startDate = new Date(class_.start_time_utc)
  const endDate = new Date(class_.end_time_utc)

  const formatTime = (date: Date) =>
    date.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })

  const updateStatus = async (newStatus: string) => {
    setUpdating(true)
    try {
      await api.patch(`/classes/${class_.id}/status`, { status: newStatus })
      onUpdate()
    } catch (e: any) {
      alert(e.response?.data?.detail || 'Error actualizando estado')
    } finally {
      setUpdating(false)
    }
  }

  const reschedule = async () => {
    if (!newDate || !newTime) return
    setUpdating(true)
    try {
      const startUtc = new Date(`${newDate}T${newTime}:00Z`).toISOString()
      const endUtc = new Date(
        new Date(startUtc).getTime() + class_.duration_minutes * 60000
      ).toISOString()

      await api.patch(`/classes/teacher/${class_.id}/reschedule`, {
        start_time_utc: startUtc,
        end_time_utc: endUtc,
      })
      setShowReschedule(false)
      setNewDate('')
      setNewTime('')
      onUpdate()
    } catch (e: any) {
      alert(e.response?.data?.detail || 'Error reagendando')
    } finally {
      setUpdating(false)
    }
  }

  const nextActions = NEXT_STATUSES[class_.status] || []
  const isPast = endDate < new Date()

  return (
    <div
      className={`
        bg-white/85 backdrop-blur-xl border border-white border-l-4
        ${config.border} rounded-2xl p-5 shadow-md shadow-slate-100
        hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300
      `}
    >
      <div className="flex items-start gap-4">
        {/* Fecha/hora */}
        <div className="flex-shrink-0 text-center min-w-[68px] bg-pink-50/70 rounded-2xl px-2 py-2.5 border border-pink-100/60">
          <p className="text-2xl font-black text-slate-800 leading-none">
            {startDate.getUTCDate()}
          </p>
          <p className="text-[10px] text-pink-400 font-bold uppercase tracking-wide mt-1">
            {startDate.toLocaleString('es', { month: 'short', timeZone: 'UTC' })}
          </p>
          <p className="text-xs text-slate-700 mt-1.5 font-bold">
            {formatTime(startDate)}
          </p>
          <p className="text-[10px] text-slate-400 font-medium">
            → {formatTime(endDate)}
          </p>
        </div>

        {/* Separador */}
        <div className="w-px bg-slate-100 self-stretch flex-shrink-0" />

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <Badge variant={config.badge}>{config.label}</Badge>
            {class_.class_type === 'trial' && class_.status !== 'pending_trial' && (
              <Badge variant="gold">Prueba</Badge>
            )}
            {class_.subject && (
              <span className="text-xs text-slate-400 font-medium">
                {class_.subject}
              </span>
            )}
            <span className="text-xs text-slate-400 font-bold ml-auto">
              {class_.duration_minutes} min
            </span>
          </div>

          {/* Notas */}
          {class_.notes && (
            <p className="text-xs text-slate-400 italic mb-2 truncate">
              "{class_.notes}"
            </p>
          )}

          {/* Reagendar form */}
          {showReschedule && (
            <div className="flex gap-2 mb-2 flex-wrap items-center bg-slate-50 rounded-xl p-3 border border-slate-100">
              <input
                type="date"
                value={newDate}
                onChange={e => setNewDate(e.target.value)}
                className="bg-white border border-slate-200 rounded-lg
                           px-3 py-1.5 text-xs text-slate-700 focus:outline-none
                           focus:border-pink-300 focus:ring-2 focus:ring-pink-50"
              />
              <input
                type="time"
                value={newTime}
                onChange={e => setNewTime(e.target.value)}
                className="bg-white border border-slate-200 rounded-lg
                           px-3 py-1.5 text-xs text-slate-700 focus:outline-none
                           focus:border-pink-300 focus:ring-2 focus:ring-pink-50"
              />
              <Button size="sm" variant="primary" loading={updating} onClick={reschedule}>
                Confirmar
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowReschedule(false)}>
                Cancelar
              </Button>
            </div>
          )}

          {/* Acciones — clase futura */}
          {!showReschedule && !isPast && (
            <div className="flex gap-2 flex-wrap">
              {nextActions.includes('completed') && (
                <Button size="sm" variant="secondary" loading={updating} onClick={() => updateStatus('completed')}>
                  Marcar completada
                </Button>
              )}
              {nextActions.includes('no_show') && (
                <Button size="sm" variant="danger" loading={updating} onClick={() => updateStatus('no_show')}>
                  No asistió
                </Button>
              )}
              {!['completed', 'cancelled', 'no_show'].includes(class_.status) && (
                <Button size="sm" variant="ghost" onClick={() => setShowReschedule(true)}>
                  Reagendar
                </Button>
              )}
              {nextActions.includes('cancelled') && (
                <Button size="sm" variant="danger" loading={updating} onClick={() => updateStatus('cancelled')}>
                  Cancelar
                </Button>
              )}
            </div>
          )}

          {/* Acciones — clase pasada sin cerrar (corrección manual desde el historial) */}
          {!showReschedule && isPast && nextActions.length > 0 && (
            <div className="flex gap-2 flex-wrap pt-1">
              {nextActions.includes('completed') && (
                <Button size="sm" variant="secondary" loading={updating} onClick={() => updateStatus('completed')}>
                  Marcar completada
                </Button>
              )}
              {nextActions.includes('no_show') && (
                <Button size="sm" variant="danger" loading={updating} onClick={() => updateStatus('no_show')}>
                  No asistió
                </Button>
              )}
              {nextActions.includes('cancelled') && (
                <Button size="sm" variant="danger" loading={updating} onClick={() => updateStatus('cancelled')}>
                  Cancelar
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}