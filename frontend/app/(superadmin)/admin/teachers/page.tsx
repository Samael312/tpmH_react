'use client'

import { useState } from 'react'
import { useTeachers, TeacherAppeal } from '@/hooks/useAdminData'
import { Card, Badge, Button } from '@/components/ui'
import api from '@/lib/api'
import ChipiWidget from '@/components/chipi/ChipiWidget'
import { getFlagForNationality } from '@/lib/nationalities'
import { X, Video as VideoIcon, MessageSquare, Check, AlertTriangle, Loader2 } from 'lucide-react'

const STATUS_TABS = [
  { key: undefined,   label: 'Todos' },
  { key: 'pending',   label: 'Pendientes' },
  { key: 'approved',  label: 'Aprobados' },
  { key: 'rejected',  label: 'Rechazados' },
  { key: 'suspended', label: 'Suspendidos' },
]

const statusBadge: Record<string, 'warning' | 'success' | 'danger' | 'neutral' | 'pink'> = {
  pending:   'warning',
  approved:  'success',
  rejected:  'danger',
  suspended: 'neutral',
}

const statusLabel: Record<string, string> = {
  pending:   'Pendiente',
  approved:  'Aprobado',
  rejected:  'Rechazado',
  suspended: 'Suspendido',
}


function TeacherDetailModal({
  teacher,
  onClose,
  onActioned,
}: {
  teacher: any
  onClose: () => void
  onActioned: () => void
}) {
  const [appeals, setAppeals] = useState<TeacherAppeal[]>([])
  const [loadingAppeals, setLoadingAppeals] = useState(true)
  const [actioning, setActioning] = useState(false)
  const [resolvingAppealId, setResolvingAppealId] = useState<number | null>(null)
  const [adminResponse, setAdminResponse] = useState('')

  const loadAppeals = async () => {
    setLoadingAppeals(true)
    try {
      const res = await api.get(`/admin/teachers/${teacher.id}/appeals`)
      setAppeals(res.data)
    } catch { } finally { setLoadingAppeals(false) }
  }

  useState(() => { loadAppeals() })

  const updateStatus = async (newStatus: string) => {
    setActioning(true)
    try {
      let body: any = { status: newStatus }
      if (newStatus === 'rejected') {
        const reason = prompt('Motivo del rechazo:')
        if (!reason) { setActioning(false); return }
        body.reason = reason
      }
      await api.patch(`/admin/teachers/${teacher.id}/status`, body)
      onActioned()
      onClose()
    } catch (e: any) {
      alert(e.response?.data?.detail || 'Error')
    } finally {
      setActioning(false)
    }
  }

  const resolveAppeal = async (appealId: number, action: 'approve' | 'reject') => {
    setResolvingAppealId(appealId)
    try {
      await api.patch(`/admin/appeals/${appealId}/resolve`, {
        action,
        admin_response: adminResponse.trim() || undefined,
      })
      setAdminResponse('')
      await loadAppeals()
      onActioned()
    } catch (e: any) {
      alert(e.response?.data?.detail || 'Error resolviendo la apelación')
    } finally {
      setResolvingAppealId(null)
    }
  }

  const pendingAppeal = appeals.find(a => a.status === 'pending')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-2xl bg-white rounded-[2rem] shadow-2xl p-6 sm:p-8 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-pink-100 to-rose-50 border border-pink-200 flex items-center justify-center overflow-hidden flex-shrink-0">
              {teacher.profile_photo_url ? (
                <img src={teacher.profile_photo_url} alt={teacher.name} className="w-full h-full object-cover" />
              ) : (
                <span className="text-pink-600 font-black">{teacher.name[0]}{teacher.surname[0]}</span>
              )}
            </div>
            <div>
              <h2 className="text-lg font-black text-slate-800">{teacher.name} {teacher.surname}</h2>
              <p className="text-xs text-slate-400">@{teacher.username} · {teacher.email}</p>
            </div>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center">
            <X className="w-4 h-4 text-slate-500" />
          </button>
        </div>

        {/* Video de presentación */}
        <div className="mb-6">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
            <VideoIcon className="w-3.5 h-3.5" /> Video de presentación
          </p>
          {teacher.video_url ? (
            <div className="rounded-2xl overflow-hidden bg-slate-900 aspect-video max-w-md">
              <video src={teacher.video_url} controls className="w-full h-full object-contain" />
            </div>
          ) : (
            <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
              <p className="text-xs font-bold text-amber-700">
                Aún no ha subido su video — no se puede aprobar hasta que lo suba.
              </p>
            </div>
          )}
        </div>

        {/* Motivo de rechazo actual */}
        {teacher.status === 'rejected' && teacher.rejection_reason && (
          <div className="mb-6 bg-rose-50 border border-rose-100 rounded-xl px-4 py-3">
            <p className="text-[10px] font-black text-rose-500 uppercase tracking-widest mb-1">Motivo del rechazo</p>
            <p className="text-sm text-rose-700 font-medium">{teacher.rejection_reason}</p>
            {teacher.appeal_exhausted && (
              <p className="text-[11px] text-rose-500 font-bold mt-2">
                Apelaciones agotadas (2/2) — el profesor debe subir un nuevo video para reiniciar la revisión.
              </p>
            )}
          </div>
        )}

        {/* Historial de apelaciones */}
        <div className="mb-6">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
            <MessageSquare className="w-3.5 h-3.5" /> Apelaciones ({appeals.length}/2)
          </p>
          {loadingAppeals ? (
            <div className="h-16 bg-slate-50 rounded-xl animate-pulse" />
          ) : appeals.length === 0 ? (
            <p className="text-xs text-slate-400 font-bold">Sin apelaciones presentadas</p>
          ) : (
            <div className="space-y-3">
              {appeals.map(a => (
                <div key={a.id} className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-slate-200 text-slate-600">
                      Apelación {a.appeal_number}/2
                    </span>
                    <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${
                      a.status === 'pending' ? 'bg-amber-100 text-amber-700'
                        : a.status === 'approved' ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-rose-100 text-rose-700'
                    }`}>
                      {a.status === 'pending' ? 'Pendiente' : a.status === 'approved' ? 'Aprobada' : 'Rechazada'}
                    </span>
                  </div>
                  <p className="text-sm text-slate-700 mb-2">{a.message}</p>
                  {a.admin_response && (
                    <p className="text-xs text-slate-500 italic border-t border-slate-200 pt-2 mt-2">
                      Respuesta del equipo: {a.admin_response}
                    </p>
                  )}

                  {a.status === 'pending' && (
                    <div className="mt-3 pt-3 border-t border-slate-200 space-y-2">
                      <input
                        value={adminResponse}
                        onChange={e => setAdminResponse(e.target.value)}
                        placeholder="Respuesta opcional para el profesor..."
                        className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs font-medium focus:outline-none focus:border-pink-400"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => resolveAppeal(a.id, 'approve')}
                          disabled={resolvingAppealId === a.id}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold rounded-lg disabled:opacity-50"
                        >
                          {resolvingAppealId === a.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                          Aprobar apelación
                        </button>
                        <button
                          onClick={() => resolveAppeal(a.id, 'reject')}
                          disabled={resolvingAppealId === a.id}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 text-xs font-bold rounded-lg disabled:opacity-50"
                        >
                          <X className="w-3.5 h-3.5" /> Rechazar apelación
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Acciones de estado del perfil */}
        {!pendingAppeal && (
          <div className="flex gap-2 pt-4 border-t border-slate-100">
            {teacher.status === 'pending' && (
              <>
                <Button variant="primary" loading={actioning} onClick={() => updateStatus('approved')} className="flex-1 justify-center">
                  Aprobar
                </Button>
                <Button variant="danger" loading={actioning} onClick={() => updateStatus('rejected')} className="flex-1 justify-center">
                  Rechazar
                </Button>
              </>
            )}
            {teacher.status === 'approved' && (
              <Button variant="danger" loading={actioning} onClick={() => updateStatus('suspended')} className="flex-1 justify-center">
                Suspender
              </Button>
            )}
            {(teacher.status === 'rejected' || teacher.status === 'suspended') && (
              <Button variant="secondary" loading={actioning} onClick={() => updateStatus('approved')} className="flex-1 justify-center">
                Reactivar
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default function TeachersPage() {
  const [activeTab, setActiveTab] = useState<string | undefined>(undefined)
  const [actioning, setActioning] = useState<number | null>(null)
  const [commissionEdit, setCommissionEdit] = useState<number | null>(null)
  const [commissionValue, setCommissionValue] = useState('')
  const [detailTarget, setDetailTarget] = useState<any | null>(null)
  const {teachers, loading, refetch } = useTeachers(activeTab)

  const updateStatus = async (teacherId: number, newStatus: string) => {
    setActioning(teacherId)
    try {
      let body: any = { status: newStatus }
      if (newStatus === 'rejected') {
        const reason = prompt('Motivo del rechazo:')
        if (!reason) { setActioning(null); return }
        body.reason = reason
      }
      await api.patch(`/admin/teachers/${teacherId}/status`, body)
      refetch()
    } catch (e: any) {
      alert(e.response?.data?.detail || 'Error')
    } finally {
      setActioning(null)
    }
  }

  const updateCommission = async (teacherId: number) => {
    const rate = parseFloat(commissionValue)
    if (isNaN(rate) || rate < 0 || rate > 1) {
      alert('Introduce un valor entre 0 y 1 (ej: 0.15 = 15%)')
      return
    }
    try {
      await api.patch(`/admin/teachers/${teacherId}/commission`, {
        commission_rate: rate
      })
      setCommissionEdit(null)
      refetch()
    } catch (e: any) {
      alert(e.response?.data?.detail || 'Error')
    }
  }

  return (
    <>
      <div className="space-y-8 animate-fade-up bg-white min-h-screen p-6 md:p-8 rounded-[2.5rem] shadow-sm border border-slate-100">

        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="font-display text-4xl font-bold text-slate-800 mb-2 tracking-tight">
              Directorio de Profesores
            </h1>
            <p className="text-sm text-slate-500 font-medium">
              Gestiona accesos, estados y tasas de comisión de tus tutores
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 bg-slate-50 border border-slate-100 rounded-2xl p-1.5 w-max shadow-inner overflow-x-auto custom-scrollbar max-w-full">
          {STATUS_TABS.map(tab => (
            <button
              key={tab.label}
              onClick={() => setActiveTab(tab.key)}
              className={`
                px-5 py-2 rounded-xl text-sm font-bold transition-all duration-300 whitespace-nowrap
                ${activeTab === tab.key
                  ? 'bg-white text-pink-600 shadow-sm border border-pink-100'
                  : 'text-slate-400 hover:text-pink-500 hover:bg-white/50'
                }
              `}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Lista */}
        <div className="pt-2">
          {loading ? (
            <div className="space-y-4">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="bg-slate-50 border border-slate-100 rounded-3xl h-24 animate-pulse" />
              ))}
            </div>
          ) : teachers.length === 0 ? (
            <Card className="p-16 text-center bg-slate-50/50 border-2 border-dashed border-slate-200 rounded-3xl shadow-none">
              <div className="text-5xl mb-4 drop-shadow-sm opacity-60">👩🏻‍🏫</div>
              <p className="text-slate-500 font-bold text-lg">
                No hay profesores en esta categoría
              </p>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {teachers.map((teacher) => (
                              <Card
                  key={teacher.id}
                  hover
                  className="p-6 border-slate-100 shadow-sm rounded-3xl group cursor-pointer"
                >
                  <div
                    className="flex flex-col md:flex-row md:items-center gap-6"
                    onClick={() => setDetailTarget(teacher)}
                  >

                    {/* Avatar & Basic Info */}
                    <div className="flex items-center gap-4 flex-1 min-w-0">
                      <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-pink-100 to-rose-50 border border-pink-200 flex items-center justify-center flex-shrink-0 shadow-inner group-hover:scale-105 transition-transform overflow-hidden">
                        {teacher.profile_photo_url ? (
                          <img src={teacher.profile_photo_url} alt={teacher.name} className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-pink-600 font-black text-xl">
                            {teacher.name[0]}{teacher.surname[0]}
                          </span>
                        )}
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-3 mb-1 flex-wrap">
                          <span className="text-slate-800 font-bold text-lg truncate">
                            {teacher.name} {teacher.surname}
                          </span>
                          {teacher.nationality && (
                            <span className="text-xs font-bold text-slate-400 flex items-center gap-1">
                              {getFlagForNationality(teacher.nationality)} {teacher.nationality}
                            </span>
                          )}
                          <Badge variant={statusBadge[teacher.status] || 'neutral'} className="shadow-sm">
                            {statusLabel[teacher.status] || teacher.status}
                          </Badge>
                          {teacher.status === 'rejected' && teacher.has_pending_appeal && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-700 animate-pulse">
                              Apelación pendiente
                            </span>
                          )}
                        </div>
                        <div className="text-sm font-medium text-slate-400 truncate">
                          @{teacher.username} • {teacher.email}
                          {teacher.phone_number && <span> • {teacher.phone_number}</span>}
                        </div>
                      </div>
                    </div>

                    {/* Stats & Commission */}
                    <div onClick={e => e.stopPropagation()} className="flex flex-wrap items-center gap-x-8 gap-y-3 bg-slate-50 px-6 py-3 rounded-2xl border border-slate-100">
                      <div className="flex flex-col">
                        <span className="text-[10px] uppercase font-black text-slate-400 tracking-widest">Actividad</span>
                        <span className="text-sm font-bold text-slate-700">
                          {teacher.total_classes} clases • {teacher.total_students} est.
                        </span>
                      </div>
                      
                      <div className="flex flex-col">
                        <span className="text-[10px] uppercase font-black text-slate-400 tracking-widest">Balance</span>
                        <span className="text-sm font-black text-emerald-500">
                          ${teacher.balance.toFixed(2)}
                        </span>
                      </div>

                      <div className="flex flex-col items-start min-w-[120px]">
                        <span className="text-[10px] uppercase font-black text-slate-400 tracking-widest mb-1">Comisión</span>
                        {commissionEdit === teacher.id ? (
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              max="1"
                              value={commissionValue}
                              onChange={e => setCommissionValue(e.target.value)}
                              className="w-16 bg-white border border-pink-300 rounded-lg px-2 py-1 text-sm font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-pink-100"
                              placeholder="0.15"
                              autoFocus
                            />
                            <button onClick={() => updateCommission(teacher.id)} className="p-1.5 bg-emerald-100 text-emerald-600 rounded-lg hover:bg-emerald-200 transition-colors">
                              ✓
                            </button>
                            <button onClick={() => setCommissionEdit(null)} className="p-1.5 bg-rose-100 text-rose-600 rounded-lg hover:bg-rose-200 transition-colors">
                              ✕
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => {
                              setCommissionEdit(teacher.id)
                              setCommissionValue(teacher.commission_rate.toString())
                            }}
                            className="text-sm font-bold text-pink-500 hover:text-pink-600 bg-white px-3 py-1 rounded-lg border border-pink-100 hover:border-pink-300 transition-all shadow-sm flex items-center gap-1.5"
                          >
                            {(teacher.commission_rate * 100).toFixed(0)}%
                            <span className="text-[10px]">✏️</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Acciones */}
                              
                    <div onClick={e => e.stopPropagation()} className="flex gap-2 flex-wrap md:flex-col md:w-32 justify-center shrink-0">
                      {teacher.status === 'pending' && (
                        <>
                          <Button
                            size="sm"
                            variant="primary"
                            loading={actioning === teacher.id}
                            onClick={() => updateStatus(teacher.id, 'approved')}
                            className="w-full justify-center !py-2 shadow-md shadow-pink-200"
                          >
                            Aprobar
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            loading={actioning === teacher.id}
                            onClick={() => updateStatus(teacher.id, 'rejected')}
                            className="w-full justify-center !py-2"
                          >
                            Rechazar
                          </Button>
                        </>
                      )}
                      {teacher.status === 'approved' && (
                        <Button
                          size="sm"
                          variant="danger"
                          loading={actioning === teacher.id}
                          onClick={() => updateStatus(teacher.id, 'suspended')}
                          className="w-full justify-center !py-2"
                        >
                          Suspender
                        </Button>
                      )}
                      {(teacher.status === 'rejected' || teacher.status === 'suspended') && (
                        <Button
                          size="sm"
                          variant="secondary"
                          loading={actioning === teacher.id}
                          onClick={() => updateStatus(teacher.id, 'approved')}
                          className="w-full justify-center !py-2"
                        >
                          Reactivar
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>

      {detailTarget && (
        <TeacherDetailModal
          teacher={detailTarget}
          onClose={() => setDetailTarget(null)}
          onActioned={refetch}
        />
      )}

      {/* Widget fuera del contenedor en su ubicación corregida */}
      <ChipiWidget screenName="admin_teachers" />
    </>
  )
}