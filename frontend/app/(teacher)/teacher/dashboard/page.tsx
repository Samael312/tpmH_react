'use client'

import { useState, useMemo } from 'react'
import { useTeacherClasses, useWallet, type TeacherClass } from '@/hooks/useTeacherData'
import ClassCard from '@/components/classes/ClassCard'
import StatCard from '@/components/ui/StatCard'
import Card from '@/components/ui/Card'
import ChipiWidget from '@/components/chipi/ChipiWidget'
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, X } from 'lucide-react'

const DAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

// Estos deben reflejar exactamente los estados usados en el backend (class_.py / classes.py)
const UPCOMING_STATUSES = ['pending', 'pending_trial', 'pending_payment', 'confirmed']
const HISTORY_STATUSES = ['completed', 'cancelled', 'no_show', 'finalized']

function toUtcDateStr(date: Date) {
  return date.toISOString().split('T')[0]
}

function getWeekDates() {
  const today = new Date()
  const monday = new Date(today)
  monday.setUTCDate(today.getUTCDate() - today.getUTCDay() + 1)
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday)
    d.setUTCDate(monday.getUTCDate() + i)
    return d
  })
}

// ─── Icono con fondo de color propio — refuerza el contraste entre KPIs ──────
function KpiIcon({
  children,
  bg,
  text,
}: {
  children: React.ReactNode
  bg: string
  text: string
}) {
  return (
    <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${bg} ${text}`}>
      {children}
    </div>
  )
}

// ─── Calendario para elegir cualquier fecha (pasada o futura) ────────────────
function DatePickerCalendar({
  value,
  onSelect,
  onClose,
}: {
  value: string
  onSelect: (d: string) => void
  onClose: () => void
}) {
  const initial = value ? new Date(value + 'T00:00:00Z') : new Date()
  const [year, setYear] = useState(initial.getUTCFullYear())
  const [month, setMonth] = useState(initial.getUTCMonth())

  const firstDay = new Date(Date.UTC(year, month, 1)).getUTCDay()
  const offset = (firstDay + 6) % 7
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const cells = Array.from({ length: offset + daysInMonth }, (_, i) => (i < offset ? null : i - offset + 1))

  const todayStr = toUtcDateStr(new Date())

  const select = (day: number) => {
    const d = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    onSelect(d)
    onClose()
  }

  return (
    <div className="absolute right-0 top-full z-50 mt-2 w-72 max-w-[calc(100vw-2rem)] bg-white rounded-2xl shadow-2xl shadow-slate-300/50 border border-slate-100 p-4 animate-in fade-in zoom-in-95 duration-150">
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={() => { if (month === 0) { setMonth(11); setYear(y => y - 1) } else setMonth(m => m - 1) }}
          className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors"
        >
          <ChevronLeft className="w-4 h-4 text-slate-600" />
        </button>
        <span className="text-sm font-black text-slate-800">{MONTHS[month]} {year}</span>
        <button
          onClick={() => { if (month === 11) { setMonth(0); setYear(y => y + 1) } else setMonth(m => m + 1) }}
          className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors"
        >
          <ChevronRight className="w-4 h-4 text-slate-600" />
        </button>
      </div>
      <div className="grid grid-cols-7 mb-1">
        {['L','M','X','J','V','S','D'].map(d => (
          <div key={d} className="text-center text-[10px] font-black text-slate-400 uppercase tracking-widest py-1">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, i) => {
          if (!day) return <div key={i} />
          const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          const isSelected = dateStr === value
          const isToday = dateStr === todayStr
          return (
            <button
              key={i}
              onClick={() => select(day)}
              className={`
                w-full aspect-square rounded-lg text-xs font-bold transition-all duration-150
                ${isSelected
                  ? 'bg-gradient-to-br from-pink-500 to-rose-400 text-white shadow-md'
                  : isToday
                    ? 'bg-pink-50 text-pink-600 border border-pink-200'
                    : 'text-slate-700 hover:bg-pink-50 hover:text-pink-600'}
              `}
            >
              {day}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default function TeacherDashboard() {
  const weekDates = getWeekDates()
  const todayStr = toUtcDateStr(new Date())

  const [selectedDate, setSelectedDate] = useState<string | null>(todayStr)
  const [showCalendar, setShowCalendar] = useState(false)
  const [tab, setTab] = useState<'upcoming' | 'history'>('upcoming')

  // Traemos TODAS las clases una sola vez (incluye historial) y filtramos en cliente,
  // así los contadores de stats, "hoy" y el historial usan siempre la misma fuente de verdad.
  const { classes, loading, refetch } = useTeacherClasses({ includeHistory: true })
  const { wallet } = useWallet()

  const safeClasses: TeacherClass[] = Array.isArray(classes) ? classes : []
  const now = new Date()

  const upcomingAll = useMemo(() => {
    return safeClasses
      .filter(c => UPCOMING_STATUSES.includes(c.status) && new Date(c.end_time_utc) >= now)
      .sort((a, b) => new Date(a.start_time_utc).getTime() - new Date(b.start_time_utc).getTime())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeClasses])

  const historyList = useMemo(() => {
    return safeClasses
      .filter(c => HISTORY_STATUSES.includes(c.status))
      .sort((a, b) => new Date(b.start_time_utc).getTime() - new Date(a.start_time_utc).getTime())
  }, [safeClasses])

  const todayUpcoming = useMemo(
    () => upcomingAll.filter(c => c.start_time_utc.slice(0, 10) === todayStr),
    [upcomingAll, todayStr]
  )

  const completadas = useMemo(
    () => safeClasses.filter(c => c.status === 'completed').length,
    [safeClasses]
  )

  const selectedDateClasses = useMemo(() => {
    if (!selectedDate) return upcomingAll
    return upcomingAll.filter(c => c.start_time_utc.slice(0, 10) === selectedDate)
  }, [upcomingAll, selectedDate])

  const availableBalance = wallet?.available_balance || 0
  const totalEarned = wallet?.total_earned || 0

  const selectedDateLabel = selectedDate
    ? new Date(selectedDate + 'T00:00:00Z').toLocaleDateString('es', {
        weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
      })
    : null

  return (
    <>
    <div className="space-y-8 animate-fade-up bg-white min-h-screen p-6 rounded-3xl">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-display text-4xl font-bold text-slate-800 mb-2 tracking-tight">
            Mis Clases
          </h1>
          <p className="text-sm text-slate-500 font-medium">
            Gestiona tu agenda y el estado de cada sesión
          </p>
        </div>
      </div>

      {/* Stats — cada KPI tiene su propio color de icono para diferenciarse a simple vista */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 animate-fade-up animate-fade-up-delay-1">
        <StatCard
          label="Próximas"
          value={upcomingAll.length}
          icon={
            <KpiIcon bg="bg-pink-100" text="text-pink-600">
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd"/>
              </svg>
            </KpiIcon>
          }
        />
        <StatCard
          label="Hoy"
          value={todayUpcoming.length}
          changeType={todayUpcoming.length > 0 ? 'up' : 'neutral'}
          icon={
            <KpiIcon bg="bg-purple-100" text="text-purple-600">
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd"/>
              </svg>
            </KpiIcon>
          }
        />
        <StatCard
          label="Completadas"
          value={completadas}
          changeType="up"
          icon={
            <KpiIcon bg="bg-emerald-100" text="text-emerald-600">
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/>
              </svg>
            </KpiIcon>
          }
        />
        <StatCard
          label="Balance"
          value={`$${Number(availableBalance).toFixed(2)}`}
          changeType="up"
          icon={
            <KpiIcon bg="bg-sky-100" text="text-sky-600">
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                <path d="M8.433 7.418c.155-.103.346-.196.567-.267v1.698a2.305 2.305 0 01-.567-.267C8.07 8.34 8 8.114 8 8c0-.114.07-.34.433-.582zM11 12.849v-1.698c.22.071.412.164.567.267.364.243.433.468.433.582 0 .114-.07.34-.433.582a2.305 2.305 0 01-.567.267z"/>
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-13a1 1 0 10-2 0v.092a4.535 4.535 0 00-1.676.662C6.602 6.234 6 7.009 6 8c0 .99.602 1.765 1.324 2.246.48.32 1.054.545 1.676.662v1.941c-.391-.127-.68-.317-.843-.504a1 1 0 10-1.51 1.31c.562.649 1.413 1.076 2.353 1.253V15a1 1 0 102 0v-.092a4.535 4.535 0 001.676-.662C13.398 13.766 14 12.991 14 12c0-.99-.602-1.765-1.324-2.246A4.535 4.535 0 0011 9.092V7.151c.391.127.68.317.843.504a1 1 0 101.511-1.31c-.563-.649-1.413-1.076-2.354-1.253V5z" clipRule="evenodd"/>
              </svg>
            </KpiIcon>
          }
        />
        <StatCard
          label="Total ganado"
          value={`$${Number(totalEarned).toFixed(2)}`}
          icon={
            <KpiIcon bg="bg-amber-100" text="text-amber-600">
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                <path fillRule="evenodd" d="M3 3a1 1 0 000 2v8a2 2 0 002 2h2.586l-1.293 1.293a1 1 0 101.414 1.414L10 15.414l2.293 2.293a1 1 0 001.414-1.414L12.414 15H15a2 2 0 002-2V5a1 1 0 100-2H3zm11 4a1 1 0 10-2 0v4a1 1 0 102 0V7zm-3 1a1 1 0 10-2 0v3a1 1 0 102 0V8zM8 9a1 1 0 00-2 0v2a1 1 0 102 0V9z" clipRule="evenodd"/>
              </svg>
            </KpiIcon>
          }
        />
      </div>

      {/* Selector de semana + calendario global */}
      <div className="animate-fade-up animate-fade-up-delay-2 bg-slate-50/50 p-4 rounded-2xl border border-pink-50 relative z-20">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-pink-400 uppercase tracking-widest font-bold">
            Semana actual
          </p>
          <div className="relative">
            <button
              onClick={() => setShowCalendar(p => !p)}
              className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-pink-600
                         bg-white border border-slate-200 hover:border-pink-300 px-3 py-1.5 rounded-xl
                         transition-colors"
            >
              <CalendarIcon className="w-3.5 h-3.5" />
              Elegir fecha
            </button>
            {showCalendar && (
              <DatePickerCalendar
                value={selectedDate ?? todayStr}
                onSelect={(d) => { setSelectedDate(d); setTab('upcoming') }}
                onClose={() => setShowCalendar(false)}
              />
            )}
          </div>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-2 custom-scrollbar">
          {weekDates.map((date) => {
            const dateStr = toUtcDateStr(date)
            const isToday = dateStr === todayStr
            const isSelected = dateStr === selectedDate
            const dayIdx = (date.getUTCDay() + 6) % 7 // Domingo=0 -> índice 6

            return (
              <button
                key={dateStr}
                onClick={() => { setSelectedDate(dateStr); setTab('upcoming') }}
                className={`
                  flex-shrink-0 flex flex-col items-center px-4 py-3
                  rounded-2xl text-xs transition-all duration-300 shadow-sm
                  ${isSelected
                    ? 'bg-gradient-to-br from-pink-500 to-rose-400 text-white shadow-pink-200 shadow-md scale-105 transform'
                    : isToday
                      ? 'bg-pink-50 text-pink-600 border border-pink-200 hover:bg-pink-100'
                      : 'bg-white text-slate-500 hover:text-pink-500 hover:bg-pink-50/50 border border-slate-100'
                  }
                `}
              >
                <span className="font-medium">{DAYS[dayIdx]}</span>
                <span className={`
                  text-lg font-bold mt-1
                  ${isSelected ? 'text-white' : 'text-slate-700'}
                  ${isToday && !isSelected ? 'text-pink-600' : ''}
                `}>
                  {date.getUTCDate()}
                </span>
              </button>
            )
          })}
        </div>

        {selectedDate && (
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <span className="text-xs font-bold text-slate-500 bg-white px-3 py-1.5 rounded-full border border-slate-100 capitalize">
              Mostrando: {selectedDateLabel}
            </span>
            <button
              onClick={() => setSelectedDate(null)}
              className="flex items-center gap-1 text-xs font-bold text-pink-500 hover:text-pink-600 transition-colors"
            >
              <X className="w-3.5 h-3.5" /> Ver todas las próximas
            </button>
          </div>
        )}
      </div>

      {/* Tabs y lista */}
      <div className="animate-fade-up animate-fade-up-delay-3">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div className="flex gap-1 bg-slate-100/80 border border-slate-200/60 rounded-xl p-1.5 shadow-inner">
            {[
              { key: 'upcoming', label: 'Próximas' },
              { key: 'history', label: 'Historial' },
            ].map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key as any)}
                className={`
                  px-5 py-2 rounded-lg text-sm font-semibold transition-all duration-300
                  ${tab === t.key
                    ? 'bg-white text-pink-600 shadow-sm border border-slate-100'
                    : 'text-slate-500 hover:text-pink-500 hover:bg-white/50'
                  }
                `}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'upcoming' ? (
            <p className="text-sm font-medium text-slate-500 bg-slate-50 px-3 py-1.5 rounded-full border border-slate-100">
              {selectedDate
                ? `${selectedDateClasses.length} clase${selectedDateClasses.length !== 1 ? 's' : ''}`
                : `${upcomingAll.length} próximas en total`}
            </p>
          ) : (
            <p className="text-sm font-medium text-slate-500 bg-slate-50 px-3 py-1.5 rounded-full border border-slate-100">
              {historyList.length} en el historial
            </p>
          )}
        </div>

        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="bg-slate-50 border border-pink-50 rounded-2xl h-28 animate-pulse shadow-sm" />
            ))}
          </div>
        ) : tab === 'upcoming' ? (
          selectedDateClasses.length === 0 ? (
            <Card className="py-20 text-center bg-slate-50/50 border-dashed border-2 border-slate-200 rounded-3xl shadow-none">
              <div className="text-5xl mb-4 drop-shadow-sm">🌸</div>
              <p className="text-slate-500 font-medium text-lg">
                {selectedDate
                  ? '¡Día libre! No tienes clases programadas ese día.'
                  : '¡Sin clases próximas por ahora!'}
              </p>
            </Card>
          ) : (
            <div className="space-y-4">
              {selectedDateClasses.map(c => (
                <ClassCard key={c.id} class_={c} role="teacher" onUpdate={refetch} />
              ))}
            </div>
          )
        ) : (
          historyList.length === 0 ? (
            <Card className="py-20 text-center bg-slate-50/50 border-dashed border-2 border-slate-200 rounded-3xl shadow-none">
              <div className="text-5xl mb-4 drop-shadow-sm">📋</div>
              <p className="text-slate-500 font-medium text-lg">
                Aún no hay historial de clases.
              </p>
            </Card>
          ) : (
            <div className="space-y-4">
              {historyList.map(c => (
                <ClassCard key={c.id} class_={c} role="teacher" onUpdate={refetch} />
              ))}
            </div>
          )
        )}
      </div>
    </div>
    <ChipiWidget screenName="teacher_home" />
    </>
  )
}