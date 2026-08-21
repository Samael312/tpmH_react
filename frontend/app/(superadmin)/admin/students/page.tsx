'use client'

import { useState, useEffect } from 'react'
import { useStudents, fetchStudentDetail, StudentDetail } from '@/hooks/useAdminData'
import { Card } from '@/components/ui'
import api from '@/lib/api'
import ChipiWidget from '@/components/chipi/ChipiWidget'
import { useRouter } from 'next/navigation'
import {
  Users,
  Search,
  X,
  UserCheck,
  UserX,
  Phone,
  Calendar,
  Loader2,
  Sparkles,
  SlidersHorizontal,
  ShieldAlert,
  ChevronDown,
  Package as PackageIcon,
  AtSign,
  AlertTriangle,
} from 'lucide-react'
import Link from 'next/link'
import { getFlagForNationality } from '@/lib/nationalities'

function BanStudentModal({
  student,
  onClose,
  onBanned,
}: {
  student: any
  onClose: () => void
  onBanned: () => void
}) {
  const [reason, setReason] = useState('')
  const [banning, setBanning] = useState(false)
  const [error, setError] = useState('')

  const confirmBan = async () => {
    if (!reason.trim()) {
      setError('Debes indicar el motivo de la expulsión')
      return
    }
    setBanning(true)
    setError('')
    try {
      await api.post(`/admin/students/${student.id}/ban`, { reason: reason.trim() })
      onBanned()
      onClose()
    } catch (e: any) {
      setError(e.response?.data?.detail || 'Error expulsando al estudiante')
    } finally {
      setBanning(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white rounded-[2rem] shadow-2xl p-7">
        <div className="flex flex-col items-center text-center mb-5">
          <div className="w-14 h-14 bg-rose-100 rounded-full flex items-center justify-center mb-4">
            <ShieldAlert className="w-7 h-7 text-rose-500" />
          </div>
          <h2 className="text-lg font-black text-slate-800 mb-1.5">
            ¿Expulsar a {student.name} {student.surname}?
          </h2>
          <p className="text-xs text-slate-500 leading-relaxed">
            Se cancelarán todos sus paquetes activos y clases pendientes/confirmadas.
            No podrá volver a registrarse con el mismo correo. Podrás revertir esto desde la sección de Baneados.
          </p>
        </div>

        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">
          Motivo de la expulsión
        </label>
        <textarea
          value={reason}
          onChange={e => setReason(e.target.value)}
          rows={3}
          placeholder="Describe el motivo..."
          className="w-full bg-slate-50 border-2 border-transparent rounded-xl text-sm font-medium text-slate-800 placeholder:text-slate-400 px-4 py-3 focus:outline-none focus:bg-white focus:border-rose-400 focus:ring-4 focus:ring-rose-50 transition-all resize-none mb-4"
        />

        {error && (
          <div className="mb-4 bg-rose-50 border border-rose-100 text-rose-600 px-4 py-3 rounded-xl text-xs font-bold flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" /> {error}
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={onClose}
            disabled={banning}
            className="flex-1 py-3 text-sm font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={confirmBan}
            disabled={banning}
            className="flex-1 py-3 text-sm font-bold text-white bg-rose-500 hover:bg-rose-600 rounded-xl shadow-md shadow-rose-100 active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {banning ? <Loader2 className="w-4 h-4 animate-spin" /> : <><ShieldAlert className="w-4 h-4" /> Expulsar</>}
          </button>
        </div>
      </div>
    </div>
  )
}

function StudentRow({
  student,
  onBanTarget,
}: {
  student: any
  onBanTarget: (s: any) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [detail, setDetail] = useState<StudentDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [detailError, setDetailError] = useState('')

  const toggleExpand = async () => {
    const next = !expanded
    setExpanded(next)
    if (next && !detail) {
      setLoadingDetail(true)
      setDetailError('')
      try {
        const res = await fetchStudentDetail(student.id)
        setDetail(res.data)
      } catch {
        setDetailError('No se pudo cargar el detalle')
      } finally {
        setLoadingDetail(false)
      }
    }
  }

  const isActive = student.is_active !== false

  return (
    <div className="border-b border-slate-100 last:border-0">
      <div className="grid grid-cols-1 md:grid-cols-[2.5fr_2fr_1.5fr_1.5fr] gap-4 px-6 md:px-8 py-4 items-center hover:bg-slate-50/60 transition-colors group">
        {/* Card visible: nombre + apellido, teléfono, nacionalidad, estado */}
        <div className="flex items-center gap-3.5 min-w-0">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-pink-100 to-rose-50 border border-pink-200/80 flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition-transform shadow-inner">
            <span className="text-pink-600 text-xs font-black uppercase">
              {student.name?.[0] || 'U'}
              {student.surname?.[0] || ''}
            </span>
          </div>
          <div className="min-w-0">
            <p className="text-slate-800 text-xs md:text-sm font-extrabold truncate">
              {student.name} {student.surname}
            </p>
            <p className="text-slate-400 text-[11px] font-semibold truncate">
              @{student.username}
            </p>
          </div>
        </div>

        <div className="min-w-0 space-y-1">
          {student.phone_number && (
            <span className="text-slate-500 text-[10px] font-bold flex items-center gap-1 bg-slate-100 px-2 py-0.5 rounded-md w-fit">
              <Phone className="w-2.5 h-2.5 text-slate-400" />
              {student.phone_number}
            </span>
          )}
          {student.nationality && (
            <span className="text-slate-500 text-[10px] font-bold bg-slate-100 px-2 py-0.5 rounded-md w-fit block">
              {getFlagForNationality(student.nationality)} {student.nationality}
            </span>
          )}
        </div>

        <div className="flex items-center">
          <span
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-extrabold border ${
              isActive
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : 'bg-slate-100 text-slate-500 border-slate-200'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
            {isActive ? 'Activo' : 'Inactivo'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => onBanTarget(student)}
            className="px-3.5 py-1.5 rounded-xl text-xs font-bold border border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100 transition-all active:scale-95 flex items-center gap-1.5"
          >
            <ShieldAlert className="w-3.5 h-3.5" /> Expulsar
          </button>
          <button
            onClick={toggleExpand}
            className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors flex-shrink-0"
          >
            <ChevronDown className={`w-4 h-4 text-slate-500 transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>

            {/* Desplegable: fecha de registro, info de paquetes, materiales */}
      {expanded && (
        <div className="px-6 md:px-8 pb-5 -mt-1 animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="bg-slate-50/80 rounded-2xl p-4 border border-slate-100 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="flex items-center gap-2">
                <AtSign className="w-3.5 h-3.5 text-slate-400" />
                <span className="text-slate-500 font-bold">{student.email}</span>
              </div>
              {(detail?.created_at || student.created_at) && (
                <div className="flex items-center gap-2">
                  <Calendar className="w-3.5 h-3.5 text-slate-400" />
                  <span className="text-slate-500 font-bold">
                    Registrado el {new Date(detail?.created_at ?? student.created_at).toLocaleDateString('es', {
                      day: 'numeric', month: 'long', year: 'numeric',
                    })}
                  </span>
                </div>
              )}
              {detail?.goal && (
                <div className="sm:col-span-2 text-slate-500 font-bold">
                  Objetivo: <span className="text-slate-700">{detail.goal}</span>
                </div>
              )}
            </div>

            {loadingDetail ? (
              <div className="h-16 bg-slate-100 rounded-xl animate-pulse" />
            ) : detailError ? (
              <p className="text-xs text-rose-500 font-bold">{detailError}</p>
            ) : (
              <>
                <div className="pt-2 border-t border-slate-200/60">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                    <PackageIcon className="w-3.5 h-3.5" /> Paquetes ({detail?.enrollments.length ?? 0})
                  </p>
                  {!detail?.enrollments.length ? (
                    <p className="text-xs text-slate-400 font-bold">Sin paquetes asignados</p>
                  ) : (
                    <div className="space-y-2">
                      {detail.enrollments.map(e => (
                        <div key={e.id} className="bg-white border border-slate-100 rounded-xl px-3 py-2.5 flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-slate-700 truncate">{e.package_name}</p>
                            <p className="text-[10px] text-slate-400">
                              {e.subject ?? 'Sin materia'} · con {e.teacher_name ?? 'profesor desconocido'} · {e.classes_used}/{e.classes_total ?? '∞'} clases
                            </p>
                          </div>
                          <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 flex-shrink-0">
                            {e.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="pt-2 border-t border-slate-200/60">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
                    Materiales asignados ({detail?.materials.length ?? 0})
                  </p>
                  {!detail?.materials.length ? (
                    <p className="text-xs text-slate-400 font-bold">Sin materiales asignados</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {detail.materials.map(m => (
                        <span
                          key={m.id}
                          className="inline-flex items-center gap-1.5 bg-purple-50 border border-purple-100 text-purple-700 text-[11px] font-bold px-2.5 py-1 rounded-lg"
                          title={`Progreso: ${m.progress}`}
                        >
                          {m.title}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default function StudentsPage() {
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [banTarget, setBanTarget] = useState<any | null>(null)
  const { students, loading, total, refetch } = useStudents(debouncedSearch)
  const router = useRouter()

  // Debounce del buscador (400ms)
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 400)
    return () => clearTimeout(timer)
  }, [search])


  // Métricas rápidas
  const activeCount = students.filter((s) => s.is_active !== false).length
  const inactiveCount = students.length - activeCount

  return (
    <>
      <div className="min-h-screen bg-slate-50/50 p-4 md:p-8 space-y-6 animate-fade-up">
        {/* ─── Header & Acciones Principal ─── */}
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="font-display text-3xl md:text-4xl font-extrabold text-slate-900 tracking-tight">
                Estudiantes
              </h1>
              <span className="bg-pink-100 text-pink-700 text-xs font-black px-3 py-1 rounded-full border border-pink-200">
                Gestión
              </span>
            </div>
            <p className="text-slate-500 text-xs md:text-sm font-medium mt-1 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              {total} estudiantes activos en la plataforma
            </p>
          </div>
          <Link
            href="/admin/students/banned"
            className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:border-rose-300 hover:text-rose-600 transition-all shadow-sm w-fit"
          >
            <ShieldAlert className="w-4 h-4" /> Ver estudiantes baneados
          </Link>
        </div>

        {/* ─── Tarjetas de Resumen (KPIs) ─── */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white rounded-3xl p-4 border border-slate-200/60 shadow-sm flex items-center gap-4">
            <div className="p-3 rounded-2xl bg-pink-50 text-pink-500">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
                Total Registrados
              </p>
              <p className="text-xl font-black text-slate-800">{total}</p>
            </div>
          </div>

          <div className="bg-white rounded-3xl p-4 border border-slate-200/60 shadow-sm flex items-center gap-4">
            <div className="p-3 rounded-2xl bg-emerald-50 text-emerald-500">
              <UserCheck className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
                Activos en Vista
              </p>
              <p className="text-xl font-black text-emerald-600">{activeCount}</p>
            </div>
          </div>

          <div className="bg-white rounded-3xl p-4 border border-slate-200/60 shadow-sm flex items-center gap-4">
            <div className="p-3 rounded-2xl bg-rose-50 text-rose-500">
              <UserX className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
                Inactivos en Vista
              </p>
              <p className="text-xl font-black text-rose-500">{inactiveCount}</p>
            </div>
          </div>
        </div>

        {/* ─── Buscador ─── */}
        <div className="bg-white rounded-3xl p-3 border border-slate-200/80 shadow-sm">
          <div className="relative w-full">
            <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar estudiante por nombre, apellido, email o usuario..."
              className="w-full bg-slate-50/80 border border-transparent rounded-2xl pl-11 pr-10 py-3 text-xs md:text-sm font-semibold text-slate-700 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-pink-300 focus:ring-4 focus:ring-pink-50 transition-all"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-pink-500 transition-colors p-1.5"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* ─── Tabla / Lista ─── */}
        <Card className="overflow-hidden border-slate-200/80 shadow-sm rounded-3xl bg-white">
          {/* Header de la Tabla (Desktop) */}
          <div className="hidden md:grid grid-cols-[2.5fr_2fr_1.5fr_1.5fr] gap-4 px-8 py-4 border-b border-slate-100 bg-slate-50/60">
            {['Estudiante', 'Contacto & Origen', 'Estado', 'Acciones'].map((h) => (
              <span
                key={h}
                className="text-[10px] text-slate-400 uppercase tracking-widest font-black"
              >
                {h}
              </span>
            ))}
          </div>

          {loading ? (
            <div className="divide-y divide-slate-100">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="px-8 py-5 animate-pulse flex items-center gap-4">
                  <div className="w-11 h-11 rounded-2xl bg-slate-100 flex-shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-slate-100 rounded-full w-48" />
                    <div className="h-3 bg-slate-100 rounded-full w-32" />
                  </div>
                </div>
              ))}
            </div>
          ) : students.length === 0 ? (
            <div className="py-20 text-center px-4">
              <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400 mx-auto mb-3">
                <Search className="w-6 h-6" />
              </div>
              <p className="text-slate-700 font-extrabold text-base">
                {search
                  ? 'No se encontraron estudiantes para la búsqueda'
                  : 'Aún no hay estudiantes registrados'}
              </p>
              <p className="text-slate-400 text-xs font-medium mt-1">
                {search ? 'Intenta ajustando los términos ingresados' : 'Los nuevos estudiantes aparecerán aquí.'}
              </p>
            </div>
          ) : (
            <div>
              {students.map((student) => (
                <StudentRow key={student.id} student={student} onBanTarget={setBanTarget} />
              ))}
            </div>
          )}
        </Card>
      </div>

      {banTarget && (
        <BanStudentModal
          student={banTarget}
          onClose={() => setBanTarget(null)}
          onBanned={refetch}
        />
      )}

      <ChipiWidget screenName="admin_students" />
    </>
  )
}