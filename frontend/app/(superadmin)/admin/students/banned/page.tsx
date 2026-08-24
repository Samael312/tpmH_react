'use client'

import { useState } from 'react'
import { useBannedStudents } from '@/hooks/useAdminData'
import { Card } from '@/components/ui'
import api from '@/lib/api'
import ChipiWidget from '@/components/chipi/ChipiWidget'
import Link from 'next/link'
import { ArrowLeft, ShieldAlert, RotateCcw, Loader2, Calendar, AlertTriangle, RefreshCw } from 'lucide-react'
import { getFlagForNationality } from '@/lib/nationalities'
import Skeleton from '@/components/ui/Skeleton'
import RefreshButton from '@/components/ui/RefreshButton'
import DesktopOnly from '@/components/ui/DesktopOnly'
import { usePageTopBar } from '@/lib/mobileTopBar'

export default function BannedStudentsPage() {
  const { students, loading, isFetching, isError, refetch } = useBannedStudents()
  const [revertingId, setRevertingId] = useState<number | null>(null)

  usePageTopBar({
    title: 'Estudiantes Baneados',
    onRefresh: refetch,
    isFetching,
  })

  const revert = async (id: number) => {
    if (!confirm('¿Reactivar a este estudiante? Podrá volver a iniciar sesión y agendar clases.')) return
    setRevertingId(id)
    try {
      await api.post(`/admin/students/${id}/unban`)
      refetch()
    } catch (e: any) {
      alert(e.response?.data?.detail || 'Error revirtiendo el baneo')
    } finally {
      setRevertingId(null)
    }
  }

  return (
    <>
      <div className="min-h-screen bg-slate-50/50 p-4 md:p-8 space-y-6 animate-fade-up">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link
              href="/admin/students"
              className="w-10 h-10 rounded-2xl bg-white border border-slate-200/80 flex items-center justify-center shadow-sm hover:bg-slate-50 transition-all"
            >
              <ArrowLeft className="w-5 h-5 text-slate-600" />
            </Link>
            <div>
              <h1 className="font-display text-3xl font-extrabold text-slate-900 tracking-tight">
                Estudiantes Baneados
              </h1>
              <p className="text-slate-500 text-xs font-semibold mt-0.5">
                {students.length} estudiante{students.length !== 1 ? 's' : ''} expulsado{students.length !== 1 ? 's' : ''} de la plataforma
              </p>
            </div>
          </div>
          <DesktopOnly>
            <RefreshButton onRefresh={refetch} isFetching={isFetching} />
          </DesktopOnly>
        </div>

        {isError && (
          <div className="bg-rose-50 border border-rose-100 text-rose-600 rounded-2xl px-4 py-3.5 flex items-center gap-3 flex-wrap">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span className="text-xs font-bold flex-1">No se pudo cargar la lista de estudiantes baneados.</span>
            <button
              onClick={() => refetch()}
              className="flex items-center gap-1.5 text-xs font-bold text-rose-700 bg-rose-100 hover:bg-rose-200 px-3 py-1.5 rounded-lg transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Reintentar
            </button>
          </div>
        )}

        <Card className="overflow-hidden border-slate-200/80 shadow-sm rounded-3xl bg-white">
          {loading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full rounded-2xl" />
              ))}
            </div>
          ) : students.length === 0 ? (
            <div className="py-20 text-center px-4">
              <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400 mx-auto mb-3">
                <ShieldAlert className="w-6 h-6" />
              </div>
              <p className="text-slate-700 font-extrabold text-base">No hay estudiantes baneados</p>
              <p className="text-slate-400 text-xs font-medium mt-1">Los estudiantes expulsados aparecerán aquí.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {students.map((student: any) => (
                <div key={student.id} className="grid grid-cols-1 md:grid-cols-[2.5fr_2.5fr_1.5fr] gap-4 px-6 md:px-8 py-5 items-center hover:bg-rose-50/30 transition-colors">
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="w-11 h-11 rounded-2xl bg-rose-50 border border-rose-200 flex items-center justify-center flex-shrink-0">
                      <span className="text-rose-500 text-xs font-black uppercase">
                        {student.name?.[0] || 'U'}{student.surname?.[0] || ''}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-slate-800 text-sm font-extrabold truncate">
                        {student.name} {student.surname}
                      </p>
                      <p className="text-slate-400 text-[11px] font-semibold truncate">@{student.username} · {student.email}</p>
                      {student.nationality && (
                        <span className="text-[10px] text-slate-400 font-bold">
                          {getFlagForNationality(student.nationality)} {student.nationality}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="min-w-0 space-y-1">
                    {student.ban_reason && (
                      <div className="flex items-start gap-1.5 text-xs">
                        <AlertTriangle className="w-3.5 h-3.5 text-rose-400 flex-shrink-0 mt-0.5" />
                        <span className="text-slate-600 font-medium">{student.ban_reason}</span>
                      </div>
                    )}
                    {student.banned_at && (
                      <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-bold">
                        <Calendar className="w-3 h-3" />
                        Baneado el {new Date(student.banned_at).toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' })}
                      </div>
                    )}
                  </div>

                  <div className="flex justify-end">
                    <button
                      onClick={() => revert(student.id)}
                      disabled={revertingId === student.id}
                      className="flex items-center gap-1.5 px-4 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-bold rounded-xl border border-emerald-200 transition-all active:scale-95 disabled:opacity-50"
                    >
                      {revertingId === student.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                      Revertir
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
      <ChipiWidget screenName="admin_students_banned" />
    </>
  )
}