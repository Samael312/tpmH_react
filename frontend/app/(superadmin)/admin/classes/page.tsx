'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CalendarClock, Trash2, Search } from 'lucide-react'
import { Card, Badge, Button } from '@/components/ui'
import ConfirmModal from '@/components/ui/ConfirmModal'
import FullScreenModal from '@/components/ui/FullScreenModal'
import LoadMoreButton from '@/components/ui/LoadMoreButton'
import LoadError from '@/components/ui/LoadError'
import RefreshButton from '@/components/ui/RefreshButton'
import Skeleton from '@/components/ui/Skeleton'
import { useAdminClasses, useLookupTeachers, type AdminClass } from '@/hooks/useAdminClasses'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useToast } from '@/hooks/useToast'
import { usePageTopBar } from '@/lib/mobileTopBar'
import { getErrorMessage } from '@/lib/errorMessage'
import api from '@/lib/api'
import { zonedLocalToUtcIso } from '@/lib/tzFormat'

const STATUSES = ['pending', 'pending_trial', 'pending_payment', 'confirmed', 'completed', 'cancelled', 'no_show', 'rescheduled', 'finalized']

// Fase 22: etiquetas en español (antes se mostraba el valor interno en inglés).
const STATUS_LABELS: Record<string, string> = {
  pending: 'Pendiente',
  pending_trial: 'Prueba pendiente',
  pending_payment: 'Pago pendiente',
  confirmed: 'Confirmada',
  completed: 'Completada',
  cancelled: 'Cancelada',
  no_show: 'No asistió',
  rescheduled: 'Reagendada',
  finalized: 'Finalizada sin marcar',
  expired: 'Vencida',
}
const statusLabel = (s: string) => STATUS_LABELS[s] ?? s

// Solo las clases abiertas y futuras se reagendan o cancelan desde aquí; el servidor lo valida igual.
const OPEN_STATUSES = ['pending', 'pending_trial', 'pending_payment', 'confirmed']

function fmt(utcIso: string, tz: string) {
  return new Date(utcIso).toLocaleString('es', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' })
}

// Hora que se muestra: la del profesor (la misma zona en que el admin elige la nueva hora).
function teacherTz(c: AdminClass) {
  return c.teacher_timezone || 'UTC'
}

export default function AdminClassesPage() {
  const toast = useToast()
  const qc = useQueryClient()
  const [teacherId, setTeacherId] = useState<number | undefined>()
  const [studentText, setStudentText] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [status, setStatus] = useState('')
  const studentQ = useDebouncedValue(studentText, 400)

  const { data: teachers = [] } = useLookupTeachers()
  const list = useAdminClasses({ teacherId, studentQ, dateFrom, dateTo, status })
  usePageTopBar({ title: 'Clases', onRefresh: list.refetch, isFetching: list.isFetching })

  const [resTarget, setResTarget] = useState<AdminClass | null>(null)
  const [newLocal, setNewLocal] = useState('')
  const [delTarget, setDelTarget] = useState<AdminClass | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = () => qc.invalidateQueries({ queryKey: ['admin', 'classes'] })
  const editable = (c: AdminClass) =>
    c.class_type !== 'external' && OPEN_STATUSES.includes(c.status) && new Date(c.start_time_utc).getTime() > Date.now()
  const blockedReason = (c: AdminClass) => {
    if (c.class_type === 'external') return 'Clase externa (Calendar): se gestiona desde el calendario del profesor.'
    if (editable(c)) return null
    if (OPEN_STATUSES.includes(c.status)) return 'La clase ya pasó: no se puede reagendar ni cancelar. Corrige su estado desde el profesor o con una corrección.'
    return `La clase está «${statusLabel(c.status)}»: no se puede reagendar ni cancelar desde aquí.`
  }

  const doReschedule = async () => {
    if (!resTarget) return
    const startUtc = zonedLocalToUtcIso(newLocal, teacherTz(resTarget))
    if (!startUtc) { toast.warning('Elige una fecha y hora válidas'); return }
    const endUtc = new Date(new Date(startUtc).getTime() + resTarget.duration_minutes * 60000).toISOString()
    setBusy(true)
    try {
      await api.patch(`/classes/admin/${resTarget.id}/reschedule`, { start_time_utc: startUtc, end_time_utc: endUtc })
      toast.success('Clase reagendada')
      setResTarget(null)
      refresh()
    } catch (e) {
      toast.error(getErrorMessage(e, 'No se pudo reagendar la clase'))
    } finally {
      setBusy(false)
    }
  }

  const doDelete = async () => {
    if (!delTarget) return
    setBusy(true)
    try {
      await api.delete(`/classes/admin/${delTarget.id}`)
      toast.success('Clase cancelada y crédito reembolsado')
      setDelTarget(null)
      refresh()
    } catch (e) {
      toast.error(getErrorMessage(e, 'No se pudo cancelar la clase'))
    } finally {
      setBusy(false)
    }
  }

  const input = 'w-full px-3 py-2 text-sm rounded-xl border border-slate-200 bg-white focus:outline-none focus:border-pink-300'

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-slate-800">Clases</h1>
          <p className="text-sm text-slate-500">Busca cualquier clase para reagendarla o cancelarla.</p>
        </div>
        <RefreshButton onRefresh={list.refetch} isFetching={list.isFetching} />
      </div>

      <Card className="p-4 grid grid-cols-1 md:grid-cols-5 gap-3">
        <select className={input} value={teacherId ?? ''} onChange={e => setTeacherId(e.target.value ? Number(e.target.value) : undefined)} aria-label="Profesor">
          <option value="">Todos los profesores</option>
          {teachers.map(t => <option key={t.id} value={t.id}>{t.name} (@{t.username})</option>)}
        </select>
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input className={`${input} pl-9`} placeholder="Alumno (nombre o usuario)" value={studentText} onChange={e => setStudentText(e.target.value)} />
        </div>
        <input type="date" className={input} value={dateFrom} onChange={e => setDateFrom(e.target.value)} aria-label="Desde (UTC)" title="Desde (día UTC)" />
        <input type="date" className={input} value={dateTo} onChange={e => setDateTo(e.target.value)} aria-label="Hasta (UTC)" title="Hasta (día UTC)" />
        <select className={input} value={status} onChange={e => setStatus(e.target.value)} aria-label="Estado">
          <option value="">Todos los estados</option>
          {STATUSES.map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}
        </select>
      </Card>

      {list.isError ? (
        <LoadError what="las clases" onRetry={list.refetch} retrying={list.isFetching} />
      ) : list.loading ? (
        <Skeleton className="h-40 w-full" />
      ) : list.classes.length === 0 ? (
        <Card className="p-8 text-center text-sm text-slate-400">No hay clases con esos filtros.</Card>
      ) : (
        <Card className="overflow-hidden">
          <p className="px-4 py-2 text-xs font-bold text-slate-400">{list.total} clases · horas en la zona del profesor</p>
          <div className="divide-y divide-slate-100">
            {list.classes.map(c => (
              <div key={c.id} className="p-4 flex flex-col md:flex-row md:items-center gap-3 justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-800">
                    {fmt(c.start_time_utc, teacherTz(c))} <span className="text-slate-400 font-medium">({teacherTz(c)}) · {c.duration_minutes} min</span>
                  </p>
                  <p className="text-xs text-slate-500 truncate">
                    Profesor: {c.teacher_name || c.teacher_username || c.teacher_id} · Alumno: {c.student_name || '—'} · {c.subject || 'Sin materia'} · #{c.id}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={c.status === 'cancelled' ? 'danger' : c.status === 'confirmed' ? 'success' : 'neutral'}>{statusLabel(c.status)}</Badge>
                  {c.class_type === 'external' && <Badge variant="info">externa</Badge>}
                  <Button size="sm" variant="secondary" disabled={!editable(c)}
                    onClick={() => { setResTarget(c); setNewLocal('') }}>
                    <CalendarClock className="w-4 h-4 mr-1 inline" />Reagendar
                  </Button>
                  <Button size="sm" variant="danger" disabled={!editable(c)} onClick={() => setDelTarget(c)}>
                    <Trash2 className="w-4 h-4 mr-1 inline" />Cancelar clase
                  </Button>
                </div>
                {blockedReason(c) && (
                  <p className="text-xs font-bold text-red-600 md:basis-full" role="note">{blockedReason(c)}</p>
                )}
              </div>
            ))}
          </div>
          <LoadMoreButton hasMore={list.hasMore} loading={list.loadingMore} onClick={list.loadMore} />
        </Card>
      )}

      <FullScreenModal
        open={!!resTarget}
        onClose={() => !busy && setResTarget(null)}
        title="Reagendar clase"
        footer={
          <div className="flex gap-3">
            <button onClick={() => setResTarget(null)} disabled={busy} className="flex-1 py-3 text-sm font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl disabled:opacity-50">Volver</button>
            <Button variant="primary" loading={busy} onClick={doReschedule} className="flex-1 justify-center">Confirmar reagendado</Button>
          </div>
        }
      >
        {resTarget && (
          <div className="space-y-3 text-sm text-slate-600">
            <p>Actual: <b>{fmt(resTarget.start_time_utc, teacherTz(resTarget))}</b> ({teacherTz(resTarget)})</p>
            <label className="block text-xs font-bold text-slate-500">
              Nueva fecha y hora (zona del profesor: {teacherTz(resTarget)})
              <input type="datetime-local" className={`${input} mt-1`} value={newLocal} onChange={e => setNewLocal(e.target.value)} />
            </label>
            <p className="text-xs text-slate-400">Se envía en UTC. Se avisa por correo a profesor y alumno; el servidor valida conflictos de horario.</p>
          </div>
        )}
      </FullScreenModal>

      <ConfirmModal
        open={!!delTarget}
        title="Cancelar clase"
        description={delTarget ? `¿Cancelar la clase #${delTarget.id} del ${fmt(delTarget.start_time_utc, teacherTz(delTarget))}? Se reembolsa el crédito y se avisa a profesor y alumno.` : ''}
        confirmLabel="Sí, cancelar la clase"
        cancelLabel="Volver"
        variant="danger"
        loading={busy}
        onClose={() => !busy && setDelTarget(null)}
        onConfirm={doDelete}
      />
    </div>
  )
}
