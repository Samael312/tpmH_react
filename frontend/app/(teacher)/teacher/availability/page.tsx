'use client'

import { useState } from 'react'
import { useWeeklyAvailability, useTeacherProfile } from '@/hooks/useTeacherData'
import { Card, Button, Badge, StatCard } from '@/components/ui' // Importación limpia desde el index
import api from '@/lib/api'

const DAYS = [
  { value: 0, label: 'Lunes' },
  { value: 1, label: 'Martes' },
  { value: 2, label: 'Miércoles' },
  { value: 3, label: 'Jueves' },
  { value: 4, label: 'Viernes' },
  { value: 5, label: 'Sábado' },
  { value: 6, label: 'Domingo' },
]

interface SlotDraft {
  day_of_week: number
  start_time_local: string
  end_time_local: string
  is_available: boolean
}

export default function AvailabilityPage() {
  const { slots, loading, refetch } = useWeeklyAvailability()
  const { profile } = useTeacherProfile()
  const [saving, setSaving] = useState(false)

  const [drafts, setDrafts] = useState<SlotDraft[]>([])
  const [newSlot, setNewSlot] = useState<SlotDraft>({
    day_of_week: 0,
    start_time_local: '09:00',
    end_time_local: '17:00',
    is_available: true,
  })

  const addDraft = () => {
    if (newSlot.start_time_local >= newSlot.end_time_local) {
      alert('La hora de fin debe ser posterior a la hora de inicio')
      return
    }
    setDrafts(prev => [...prev, { ...newSlot }])
  }

  const removeDraft = (idx: number) => {
    setDrafts(prev => prev.filter((_, i) => i !== idx))
  }

  const saveAvailability = async () => {
    if (!profile?.timezone) {
      alert('Configura tu zona horaria en tu perfil primero')
      return
    }
    if (drafts.length === 0) {
      alert('Añade al menos un bloque de disponibilidad')
      return
    }
    setSaving(true)
    try {
      await api.post('/availability/me/weekly', {
        timezone: profile.timezone,
        slots: drafts,
      })
      setDrafts([])
      refetch()
    } catch (e: any) {
      alert(e.response?.data?.detail || 'Error guardando disponibilidad')
    } finally {
      setSaving(false)
    }
  }

  const dayName = (n: number) => DAYS.find(d => d.value === n)?.label || n

  return (
    <div className="space-y-8 animate-fade-up max-w-5xl mx-auto pb-12">
      
      {/* Resumen Superior */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2">
          <h1 className="font-display text-4xl font-black text-slate-800 mb-2 tracking-tight">
            Gestión de Horarios
          </h1>
          <p className="text-slate-500 font-medium">
            Define los bloques de tiempo en los que tus alumnos pueden agendar clases.
          </p>
        </div>
        <StatCard 
          label="Bloques Activos" 
          value={slots.length} 
          icon={<ClockIcon />} 
        />
      </div>

      {profile?.timezone && (
        <Badge variant="pink" className="py-2 px-4 shadow-sm">
          <span className="flex h-2 w-2 rounded-full bg-pink-500 animate-pulse mr-2" />
          Zona horaria: {profile.timezone}
        </Badge>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-1 gap-8">
        {/* Listado de Disponibilidad */}
        <section className="space-y-4">
          <div className="flex items-center justify-between ml-2">
            <h2 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em]">
              Agenda Semanal
            </h2>
          </div>
          
          {loading ? (
            <div className="grid gap-3">
              {[1, 2].map(i => <div key={i} className="h-20 bg-white rounded-[2rem] animate-pulse border border-slate-100" />)}
            </div>
          ) : slots.length === 0 ? (
            <Card className="py-16 text-center border-2 border-dashed border-slate-200 shadow-none">
              <p className="text-slate-400 font-bold uppercase text-xs tracking-widest">No hay horarios configurados</p>
            </Card>
          ) : (
            <div className="grid gap-3">
              {DAYS.map(day => {
                const daySlots = slots.filter(s => s.day_of_week === day.value)
                if (daySlots.length === 0) return null
                return (
                  <Card key={day.value} className="p-5 flex flex-col md:flex-row md:items-center gap-4 hover:border-pink-200" hover>
                    <div className="w-32">
                      <Badge variant="neutral" className="w-full justify-center py-1.5">{day.label}</Badge>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {daySlots.map(slot => (
                        <Badge 
                          key={slot.id} 
                          variant={slot.is_available ? "success" : "neutral"}
                        >
                          {slot.start_time_utc} – {slot.end_time_utc} UTC
                        </Badge>
                      ))}
                    </div>
                  </Card>
                )
              })}
            </div>
          )}
        </section>

        {/* Creador de Disponibilidad */}
        <section className="space-y-4">
          <h2 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em] ml-2">
            Actualizar Calendario
          </h2>
          <Card className="p-8 space-y-8">
            <div className="bg-rose-50/30 p-5 rounded-2xl border border-rose-100 flex gap-4 items-start">
              <span className="text-xl">✨</span>
              <p className="text-sm text-rose-700 font-semibold leading-relaxed">
                Al guardar, se sobrescribirá toda tu agenda previa. Asegúrate de incluir todos los bloques que deseas mantener activos.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase ml-1">Día de la Semana</label>
                <select
                  value={newSlot.day_of_week}
                  onChange={e => setNewSlot({ ...newSlot, day_of_week: parseInt(e.target.value) })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:border-pink-400 focus:ring-4 focus:ring-pink-50 transition-all appearance-none"
                >
                  {DAYS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase ml-1">Desde (Local)</label>
                <input
                  type="time"
                  value={newSlot.start_time_local}
                  onChange={e => setNewSlot({ ...newSlot, start_time_local: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:border-pink-400 transition-all"
                />
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase ml-1">Hasta (Local)</label>
                <input
                  type="time"
                  value={newSlot.end_time_local}
                  onChange={e => setNewSlot({ ...newSlot, end_time_local: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:border-pink-400 transition-all"
                />
              </div>

              <Button variant="secondary" onClick={addDraft} className="w-full h-[52px] !rounded-2xl">
                Añadir Bloque
              </Button>
            </div>

            {/* Listado de Borradores */}
            {drafts.length > 0 && (
              <div className="pt-6 border-t border-slate-50 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {drafts.map((draft, idx) => (
                    <div key={idx} className="flex items-center justify-between bg-slate-50 p-4 rounded-2xl border border-slate-100 animate-fade-in">
                      <div>
                        <Badge variant="pink" className="mb-1">{dayName(draft.day_of_week)}</Badge>
                        <div className="text-sm font-black text-slate-700">
                          {draft.start_time_local} – {draft.end_time_local}
                        </div>
                      </div>
                      <button 
                        onClick={() => removeDraft(idx)}
                        className="p-2 hover:bg-rose-100 text-rose-400 hover:text-rose-600 rounded-full transition-colors"
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  ))}
                </div>

                <Button 
                  variant="primary" 
                  size="lg" 
                  loading={saving} 
                  onClick={saveAvailability}
                  className="w-full !rounded-[1.5rem]"
                >
                  Confirmar y Guardar Nueva Agenda
                </Button>
              </div>
            )}
          </Card>
        </section>
      </div>
    </div>
  )
}

// Iconos Rápidos
const ClockIcon = () => (
  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
)

const TrashIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
  </svg>
)