'use client'

import { useState, useEffect } from 'react'
import { useStudents } from '@/hooks/useAdminData'
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
} from 'lucide-react'
import { getFlagForNationality } from '@/lib/nationalities'

export default function StudentsPage() {
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [actioning, setActioning] = useState<number | null>(null)
  const { students, loading, total, refetch } = useStudents(debouncedSearch)
  const router = useRouter()

  // Debounce del buscador (400ms)
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 400)
    return () => clearTimeout(timer)
  }, [search])

  const toggleStatus = async (userId: number, currentStatus: boolean) => {
    setActioning(userId)
    try {
      await api.patch(`/admin/users/${userId}/status`, {
        is_active: !currentStatus,
        reason: !currentStatus ? 'Reactivado por admin' : 'Desactivado por admin',
      })
      refetch()
    } catch (e: any) {
      alert(e.response?.data?.detail || 'Error al cambiar estado')
    } finally {
      setActioning(null)
    }
  }

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
              {total} usuarios registrados en la plataforma
            </p>
          </div>
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
            {['Estudiante', 'Contacto & Origen', 'Estado', 'Acción'].map((h) => (
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
            <div className="divide-y divide-slate-100">
              {students.map((student) => {
                const isActive = student.is_active !== false
                const isProcessing = actioning === student.id

                return (
                  <div
                    key={student.id}
                    className="grid grid-cols-1 md:grid-cols-[2.5fr_2fr_1.5fr_1.5fr] gap-4 px-6 md:px-8 py-4 items-center hover:bg-slate-50/60 transition-colors group"
                  >
                    {/* Estudiante (Avatar + Nombre + User) */}
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

                    {/* Contacto & Origen */}
                    <div className="min-w-0 space-y-1">
                      <p className="text-slate-700 text-xs font-bold truncate">
                        {student.email}
                      </p>
                      <div className="flex items-center gap-2 flex-wrap">
                        {student.phone_number && (
                          <span className="text-slate-500 text-[10px] font-bold flex items-center gap-1 bg-slate-100 px-2 py-0.5 rounded-md">
                            <Phone className="w-2.5 h-2.5 text-slate-400" />
                            {student.phone_number}
                          </span>
                        )}
                        {student.nationality && (
                          <span className="text-slate-500 text-[10px] font-bold bg-slate-100 px-2 py-0.5 rounded-md">
                            {getFlagForNationality(student.nationality)} {student.nationality}
                          </span>
                        )}
                      </div>
                      {student.created_at && (
                        <p className="text-slate-400 text-[10px] font-bold flex items-center gap-1 uppercase tracking-wide">
                          <Calendar className="w-2.5 h-2.5" />
                          {new Date(student.created_at).toLocaleDateString('es', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </p>
                      )}
                    </div>

                    {/* Estado */}
                    <div className="flex items-center">
                      <span
                        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-extrabold border ${
                          isActive
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-slate-100 text-slate-500 border-slate-200'
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            isActive ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'
                          }`}
                        />
                        {isActive ? 'Activo' : 'Inactivo'}
                      </span>
                    </div>

                    {/* Botón de Acción */}
                    <div>
                      <button
                        onClick={() => toggleStatus(student.id, isActive)}
                        disabled={isProcessing}
                        className={`px-3.5 py-1.5 rounded-xl text-xs font-bold border transition-all active:scale-95 flex items-center gap-1.5 ${
                          isActive
                            ? 'border-slate-200 bg-white text-slate-600 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200'
                            : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                        } disabled:opacity-50`}
                      >
                        {isProcessing ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : isActive ? (
                          'Desactivar'
                        ) : (
                          'Activar'
                        )}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Card>
      </div>

      <ChipiWidget screenName="admin_students" />
    </>
  )
}