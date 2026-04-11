'use client'

import { useState, useEffect } from 'react'
import { useStudents } from '@/hooks/useAdminData'
import { Card, Badge, Button } from '@/components/ui'
import api from '@/lib/api'

export default function StudentsPage() {
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [actioning, setActioning] = useState<number | null>(null)
  const { students, loading, total, refetch } = useStudents(debouncedSearch)

  // Debounce del buscador — espera 400ms antes de buscar
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 400)
    return () => clearTimeout(timer)
  }, [search])

  const toggleStatus = async (userId: number, currentStatus: boolean) => {
    setActioning(userId)
    try {
      await api.patch(`/admin/users/${userId}/status`, {
        is_active: !currentStatus,
        reason: !currentStatus ? 'Reactivado por admin' : 'Desactivado por admin'
      })
      refetch()
    } catch (e: any) {
      alert(e.response?.data?.detail || 'Error')
    } finally {
      setActioning(null)
    }
  }

  return (
    <div className="space-y-8 animate-fade-up bg-white min-h-screen p-6 md:p-8 rounded-[2.5rem] shadow-sm border border-slate-100">

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h1 className="font-display text-4xl font-bold text-slate-800 mb-2 tracking-tight">
            Estudiantes
          </h1>
          <p className="text-sm text-slate-500 font-medium flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            {total} usuarios registrados en la plataforma
          </p>
        </div>

        {/* Buscador Moderno */}
        <div className="relative w-full md:max-w-md">
          <svg
            viewBox="0 0 20 20"
            fill="currentColor"
            className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
          >
            <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd"/>
          </svg>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nombre, email o usuario..."
            className="w-full bg-slate-50 border border-slate-200 rounded-2xl pl-12 pr-10 py-3.5 text-sm font-medium text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-4 focus:ring-pink-50 focus:border-pink-300 transition-all"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-300 hover:text-pink-500 transition-colors p-1"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Tarjeta con Lista/Tabla */}
      <Card className="overflow-hidden border-slate-100 shadow-sm rounded-3xl">
        {/* Header tabla */}
        <div className="hidden md:grid grid-cols-[1fr_1fr_auto_auto] gap-4 px-8 py-4 border-b border-slate-100 bg-slate-50/50">
          {['Estudiante', 'Contacto', 'Estado', 'Acción'].map(h => (
            <span key={h} className="text-[10px] text-slate-400 uppercase tracking-widest font-black">
              {h}
            </span>
          ))}
        </div>

        {loading ? (
          <div className="divide-y divide-slate-50">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="px-8 py-5 animate-pulse flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-slate-100 flex-shrink-0" />
                <div className="flex-1">
                  <div className="h-4 bg-slate-100 rounded-full w-48 mb-2" />
                  <div className="h-3 bg-slate-50 rounded-full w-32" />
                </div>
              </div>
            ))}
          </div>
        ) : students.length === 0 ? (
          <div className="py-20 text-center">
            <div className="text-5xl mb-4 opacity-50">🔍</div>
            <p className="text-slate-500 font-bold text-lg">
              {search ? 'No se encontraron resultados para tu búsqueda' : 'Aún no hay estudiantes registrados'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-50">
            {students.map((student) => (
              <div
                key={student.id}
                className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto_auto] gap-4 px-6 md:px-8 py-5 items-center hover:bg-slate-50/50 transition-colors group"
              >
                {/* Nombre y Avatar */}
                <div className="flex items-center gap-4 min-w-0">
                  <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-pink-100 to-rose-50 border border-pink-200 flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition-transform shadow-inner">
                    <span className="text-pink-600 text-sm font-black uppercase">
                      {student.name[0]}{student.surname[0]}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-slate-800 text-sm font-bold truncate">
                      {student.name} {student.surname}
                    </p>
                    <p className="text-slate-400 text-xs font-medium truncate mt-0.5">
                      @{student.username}
                    </p>
                  </div>
                </div>

                {/* Contacto */}
                <div className="min-w-0">
                  <p className="text-slate-600 text-sm font-medium truncate">
                    {student.email}
                  </p>
                  <p className="text-slate-400 text-[11px] font-bold mt-1 uppercase tracking-wide">
                    Desde {new Date(student.created_at).toLocaleDateString('es', {
                      day: 'numeric', month: 'short', year: 'numeric'
                    })}
                  </p>
                </div>

                {/* Estado */}
                <div className="flex gap-2 items-center">
                  <Badge variant={student.is_active ? 'success' : 'neutral'} className="shadow-sm">
                    {student.is_active ? 'Activo' : 'Inactivo'}
                  </Badge>
                  {student.is_verified && (
                    <Badge variant="info" className="shadow-sm">Verificado</Badge>
                  )}
                </div>

                {/* Acción */}
                <div className="flex justify-end mt-2 md:mt-0">
                  <Button
                    size="sm"
                    variant={student.is_active ? 'danger' : 'secondary'}
                    loading={actioning === student.id}
                    onClick={() => toggleStatus(student.id, student.is_active)}
                    className="w-full md:w-auto"
                  >
                    {student.is_active ? 'Desactivar' : 'Activar'}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}