'use client'

import { useState } from 'react'
import { useTeachers } from '@/hooks/useAdminData'
import { Card, Badge, Button } from '@/components/ui'
import api from '@/lib/api'

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

export default function TeachersPage() {
  const [activeTab, setActiveTab] = useState<string | undefined>(undefined)
  const [actioning, setActioning] = useState<number | null>(null)
  const [commissionEdit, setCommissionEdit] = useState<number | null>(null)
  const [commissionValue, setCommissionValue] = useState('')
  const { teachers, loading, refetch } = useTeachers(activeTab)

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
              <Card key={teacher.id} hover className="p-6 border-slate-100 shadow-sm rounded-3xl group">
                <div className="flex flex-col md:flex-row md:items-center gap-6">

                  {/* Avatar & Basic Info */}
                  <div className="flex items-center gap-4 flex-1 min-w-0">
                    <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-pink-100 to-rose-50 border border-pink-200 flex items-center justify-center flex-shrink-0 shadow-inner group-hover:scale-105 transition-transform">
                      <span className="text-pink-600 font-black text-xl">
                        {teacher.name[0]}{teacher.surname[0]}
                      </span>
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-3 mb-1">
                        <span className="text-slate-800 font-bold text-lg truncate">
                          {teacher.name} {teacher.surname}
                        </span>
                        <Badge variant={statusBadge[teacher.status] || 'neutral'} className="shadow-sm">
                          {statusLabel[teacher.status] || teacher.status}
                        </Badge>
                      </div>
                      <div className="text-sm font-medium text-slate-400 truncate">
                        @{teacher.username} • {teacher.email}
                      </div>
                    </div>
                  </div>

                  {/* Stats & Commission */}
                  <div className="flex flex-wrap items-center gap-x-8 gap-y-3 bg-slate-50 px-6 py-3 rounded-2xl border border-slate-100">
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
                  <div className="flex gap-2 flex-wrap md:flex-col md:w-32 justify-center shrink-0">
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
  )
}