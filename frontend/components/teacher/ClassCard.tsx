'use client'

import { useState } from 'react'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import api from '@/lib/api'
import type { TeacherClass } from '@/hooks/useTeacherData'

const STATUS_CONFIG: Record<string, {
  badge: 'warning' | 'info' | 'success' | 'danger' | 'neutral' | 'gold'
  label: string
  border: string
}> = {
  pending:         { badge: 'warning', label: 'Pendiente pago',    border: 'border-l-amber-500/50' },
  pending_payment: { badge: 'info',    label: 'En revisión',       border: 'border-l-blue-500/50' },
  confirmed:       { badge: 'success', label: 'Confirmada',        border: 'border-l-emerald-500/50' },
  completed:       { badge: 'neutral', label: 'Completada',        border: 'border-l-zinc-600' },
  cancelled:       { badge: 'danger',  label: 'Cancelada',         border: 'border-l-red-500/50' },
  no_show:         { badge: 'danger',  label: 'No asistió',        border: 'border-l-red-800/50' },
}

const NEXT_STATUSES: Record<string, string[]> = {
  pending:         ['cancelled'],
  pending_payment: ['cancelled'],
  confirmed:       ['completed', 'no_show', 'cancelled'],
  completed:       [],
  cancelled:       [],
  no_show:         [],
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
    border: 'border-l-zinc-700',
  }

  const startDate = new Date(class_.start_time_utc)
  const endDate = new Date(class_.end_time_utc)

  const formatTime = (date: Date) =>
    date.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })

  const formatDate = (date: Date) =>
    date.toLocaleDateString('es', {
      weekday: 'short', day: 'numeric', month: 'short'
    })

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
  const isPast = startDate < new Date()

  return (
    <div className={`
      bg-[#111111] border border-[#1f1f1f] border-l-2
      ${config.border} rounded-xl p-4
      hover:border-[#2a2a2a] transition-colors
    `}>
      <div className="flex items-start gap-4">

        {/* Fecha/hora */}
        <div className="flex-shrink-0 text-center min-w-[60px]">
          <p className="text-2xl font-bold text-zinc-200 font-display
                        leading-none">
            {startDate.getUTCDate()}
          </p>
          <p className="text-[10px] text-zinc-600 uppercase tracking-wide mt-0.5">
            {startDate.toLocaleString('es', { month: 'short', timeZone: 'UTC' })}
          </p>
          <p className="text-xs text-zinc-500 mt-1 font-mono">
            {formatTime(startDate)}
          </p>
          <p className="text-[10px] text-zinc-700 font-mono">
            → {formatTime(endDate)}
          </p>
          <p className="text-[10px] text-zinc-700 mt-0.5">UTC</p>
        </div>

        {/* Separador */}
        <div className="w-px bg-[#1f1f1f] self-stretch flex-shrink-0"/>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <Badge variant={config.badge}>{config.label}</Badge>
            {class_.class_type === 'trial' && (
              <Badge variant="gold">Prueba</Badge>
            )}
            {class_.subject && (
              <span className="text-xs text-zinc-600">
                {class_.subject}
              </span>
            )}
            <span className="text-xs text-zinc-700 ml-auto">
              {class_.duration_minutes} min
            </span>
          </div>

          {/* Meet link — solo si confirmed */}
          {class_.meet_link && class_.status === 'confirmed' && (
            <a 
              href={class_.meet_link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs
                         text-emerald-400 hover:text-emerald-300
                         bg-emerald-500/10 px-2.5 py-1 rounded-lg
                         border border-emerald-500/20 mb-2
                         transition-colors"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3">
                <path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM14.553 7.106A1 1 0 0014 8v4a1 1 0 00.553.894l2 1A1 1 0 0018 13V7a1 1 0 00-1.447-.894l-2 1z"/>
              </svg>
              Abrir Google Meet
            </a>
          )}

          {/* Notas */}
          {class_.notes && (
            <p className="text-xs text-zinc-600 italic mb-2 truncate">
              "{class_.notes}"
            </p>
          )}

          {/* Reagendar form */}
          {showReschedule && (
            <div className="flex gap-2 mb-2 flex-wrap">
              <input
                type="date"
                value={newDate}
                onChange={e => setNewDate(e.target.value)}
                className="bg-[#0d0d0d] border border-[#2a2a2a] rounded-lg
                           px-3 py-1.5 text-xs text-zinc-300 focus:outline-none
                           focus:border-emerald-400/30"
              />
              <input
                type="time"
                value={newTime}
                onChange={e => setNewTime(e.target.value)}
                className="bg-[#0d0d0d] border border-[#2a2a2a] rounded-lg
                           px-3 py-1.5 text-xs text-zinc-300 focus:outline-none
                           focus:border-emerald-400/30"
              />
              <Button
                size="sm"
                variant="primary"
                loading={updating}
                onClick={reschedule}
              >
                Confirmar
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowReschedule(false)}
              >
                Cancelar
              </Button>
            </div>
          )}

          {/* Acciones */}
          {!showReschedule && !isPast && (
            <div className="flex gap-2 flex-wrap">
              {nextActions.includes('completed') && (
                <Button
                  size="sm"
                  variant="secondary"
                  loading={updating}
                  onClick={() => updateStatus('completed')}
                >
                  Marcar completada
                </Button>
              )}
              {nextActions.includes('no_show') && (
                <Button
                  size="sm"
                  variant="danger"
                  loading={updating}
                  onClick={() => updateStatus('no_show')}
                >
                  No asistió
                </Button>
              )}
              {!['completed', 'cancelled', 'no_show'].includes(class_.status) && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowReschedule(true)}
                >
                  Reagendar
                </Button>
              )}
              {nextActions.includes('cancelled') && (
                <Button
                  size="sm"
                  variant="danger"
                  loading={updating}
                  onClick={() => updateStatus('cancelled')}
                >
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