'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
import { useTeacherClasses, useWallet, useTeacherProfile, type TeacherClass } from '@/hooks/useTeacherData'
import ClassCard from '@/components/classes/ClassCard'
import { RescheduleModal } from '@/components/classes/RescheduleModal'
import StatCard from '@/components/ui/StatCard'
import Card from '@/components/ui/Card'
import Skeleton from '@/components/ui/Skeleton'
import RefreshButton from '@/components/ui/RefreshButton'
import DesktopOnly from '@/components/ui/DesktopOnly'
import { usePageTopBar } from '@/lib/mobileTopBar'
import ChipiWidget from '@/components/chipi/ChipiWidget'
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  X,
  AlertTriangle,
  MessageSquare,
  Upload,
  Loader2,
  Check,
  RefreshCw,
  Users,
} from 'lucide-react'
import api from '@/lib/api'

const DAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

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

function StudentFilterDropdown({
  options,
  value,
  onChange,
}: {
  options: { name: string; avatar?: string | null }[]
  value: string
  onChange: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const selected = value !== 'all' ? options.find(o => o.name === value) : null

  return (
    <div ref={ref} className="relative w-full sm:w-72">
      <button
        onClick={() => setOpen(p => !p)}
        className={`w-full flex items-center gap-2.5 bg-white border-2 rounded-2xl px-4 py-3 text-left shadow-sm transition-all duration-200 ${
          open
            ? 'border-pink-400 ring-4 ring-pink-50'
            : 'border-slate-100 hover:border-pink-200'
        }`}
      >
        {selected ? (
          selected.avatar ? (
            <img src={selected.avatar} alt={selected.name} className="w-7 h-7 rounded-full object-cover flex-shrink-0 shadow-sm" />
          ) : (
            <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 bg-gradient-to-br from-pink-500 to-rose-400 text-white text-[11px] font-black shadow-sm">
              {selected.name[0]?.toUpperCase()}
            </div>
          )
        ) : (
          <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 bg-pink-50 text-pink-400">
            <Users className="w-3.5 h-3.5" />
          </div>
        )}
        <span className={`flex-1 text-sm font-bold truncate ${selected ? 'text-slate-800' : 'text-slate-400'}`}>
          {selected ? selected.name : 'Todos los estudiantes'}
        </span>
        <ChevronDown className={`w-4 h-4 flex-shrink-0 transition-transform duration-200 ${open ? 'rotate-180 text-pink-500' : 'text-slate-400'}`} />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-2 bg-white rounded-2xl shadow-2xl shadow-slate-300/50 border border-slate-100 p-2 max-h-72 overflow-y-auto custom-scrollbar animate-in fade-in zoom-in-95 duration-150">
          <button
            onClick={() => { onChange('all'); setOpen(false) }}
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-bold transition-colors duration-150 ${
              value === 'all'
                ? 'bg-gradient-to-br from-pink-500 to-rose-400 text-white shadow-md'
                : 'text-slate-600 hover:bg-pink-50 hover:text-pink-600'
            }`}
          >
            <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${value === 'all' ? 'bg-white/20' : 'bg-slate-100'}`}>
              <Users className={`w-3.5 h-3.5 ${value === 'all' ? 'text-white' : 'text-slate-400'}`} />
            </div>
            Todos los estudiantes
          </button>

          {options.length > 0 && <div className="h-px bg-slate-100 my-1.5 mx-1" />}

          {options.map(o => {
            const isSelected = value === o.name
            return (
              <button
                key={o.name}
                onClick={() => { onChange(o.name); setOpen(false) }}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-bold transition-colors duration-150 ${
                  isSelected
                    ? 'bg-gradient-to-br from-pink-500 to-rose-400 text-white shadow-md'
                    : 'text-slate-600 hover:bg-pink-50 hover:text-pink-600'
                }`}
              >
                {o.avatar ? (
                  <img src={o.avatar} alt={o.name} className="w-6 h-6 rounded-full object-cover flex-shrink-0" />
                ) : (
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-black ${
                    isSelected ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'
                  }`}>
                    {o.name[0]?.toUpperCase()}
                  </div>
                )}
                <span className="truncate">{o.name}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function RejectionFeedbackBanner({ profile, onRefetch }: { profile: any; onRefetch: () => void }) {
  const [dismissing, setDismissing] = useState(false)
  const [showAppealForm, setShowAppealForm] = useState(false)
  const [appealMessage, setAppealMessage] = useState('')
  const [submittingAppeal, setSubmittingAppeal] = useState(false)
  const [appealSent, setAppealSent] = useState(false)
  const [appealError, setAppealError] = useState('')

  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')

  if (profile?.status !== 'rejected') return null

  const dismiss = async () => {
    setDismissing(true)
    try {
      await api.patch('/teachers/me/feedback-seen')
      onRefetch()
    } catch { } finally { setDismissing(false) }
  }

  const submitAppeal = async () => {
    if (!appealMessage.trim()) return
    setSubmittingAppeal(true)
    setAppealError('')
    try {
      await api.post('/teachers/me/appeal', { message: appealMessage.trim() })
      setAppealSent(true)
      setAppealMessage('')
      onRefetch()
    } catch (e: any) {
      setAppealError(e.response?.data?.detail || 'Error enviando la apelación')
    } finally {
      setSubmittingAppeal(false)
    }
  }

  const handleVideoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setUploadError('')
    try {
      const form = new FormData()
      form.append('file', file)
      await api.post('/teachers/me/video', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      onRefetch()
    } catch (e: any) {
      setUploadError(e.response?.data?.detail || 'Error subiendo el video')
    } finally {
      setUploading(false)
    }
  }

  const canAppeal = !profile.appeal_exhausted && (profile.appeal_count ?? 0) < 2

  return (
    <div className="bg-rose-50 border border-rose-100 rounded-[2rem] shadow-md p-6 sm:p-8 relative overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-5">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 bg-rose-100 rounded-xl flex items-center justify-center flex-shrink-0">
          <AlertTriangle className="w-5 h-5 text-rose-500" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-black uppercase tracking-widest text-rose-500 mb-1">Perfil rechazado</p>
          <h2 className="text-lg font-black text-rose-800">Tu perfil no fue aprobado</h2>
          {profile.rejection_reason && (
            <p className="text-rose-700 text-sm mt-1.5 bg-white/60 rounded-xl px-3 py-2 border border-rose-100">
              {profile.rejection_reason}
            </p>
          )}
        </div>
        {!profile.rejection_feedback_seen && (
          <button
            onClick={dismiss}
            disabled={dismissing}
            className="text-rose-400 hover:text-rose-600 transition-colors flex-shrink-0"
            title="Marcar como visto"
          >
            {dismissing ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
          </button>
        )}
      </div>

      {profile.appeal_exhausted ? (
        <div className="bg-white/70 rounded-2xl p-4 border border-rose-100 space-y-3">
          <p className="text-xs font-bold text-rose-700">
            Ya usaste tus 2 apelaciones. Sube un nuevo video de presentación para reiniciar la revisión de tu perfil.
          </p>
          {uploadError && (
            <div className="bg-rose-100 text-rose-700 text-xs font-bold px-3 py-2 rounded-xl">{uploadError}</div>
          )}
          <label className="inline-flex items-center gap-2 px-4 py-2.5 bg-rose-500 hover:bg-rose-600 text-white text-xs font-bold rounded-xl cursor-pointer transition-colors">
            {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            Subir nuevo video
            <input type="file" accept="video/mp4,video/quicktime" className="hidden" onChange={handleVideoUpload} disabled={uploading} />
          </label>
        </div>
      ) : appealSent ? (
        <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4 flex items-center gap-2">
          <Check className="w-4 h-4 text-emerald-600 flex-shrink-0" />
          <p className="text-xs font-bold text-emerald-700">Tu apelación fue enviada. El equipo la revisará en breve.</p>
        </div>
      ) : canAppeal ? (
        !showAppealForm ? (
          <button
            onClick={() => setShowAppealForm(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border-2 border-rose-200 text-rose-600 text-xs font-bold rounded-xl hover:bg-rose-100 transition-colors"
          >
            <MessageSquare className="w-3.5 h-3.5" /> Apelar esta decisión ({(profile.appeal_count ?? 0)}/2 usadas)
          </button>
        ) : (
          <div className="bg-white/70 rounded-2xl p-4 border border-rose-100 space-y-3">
            <textarea
              value={appealMessage}
              onChange={e => setAppealMessage(e.target.value)}
              rows={3}
              placeholder="Explica por qué consideras que la decisión debería revisarse..."
              className="w-full bg-white border-2 border-rose-100 rounded-xl text-sm font-medium text-slate-800 placeholder:text-slate-400 px-4 py-3 focus:outline-none focus:border-rose-400 transition-all resize-none"
            />
            {appealError && <p className="text-xs font-bold text-rose-600">{appealError}</p>}
            <div className="flex gap-2">
              <button
                onClick={() => setShowAppealForm(false)}
                disabled={submittingAppeal}
                className="px-4 py-2 text-xs font-bold text-slate-500 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={submitAppeal}
                disabled={submittingAppeal || !appealMessage.trim()}
                className="flex items-center gap-1.5 px-4 py-2 bg-rose-500 hover:bg-rose-600 text-white text-xs font-bold rounded-xl transition-colors disabled:opacity-50"
              >
                {submittingAppeal ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MessageSquare className="w-3.5 h-3.5" />}
                Enviar apelación
              </button>
            </div>
          </div>
        )
      ) : null}
    </div>
  )
}

export default function TeacherDashboard() {
  const weekDates = getWeekDates()
  const todayStr = toUtcDateStr(new Date())

  const [selectedDate, setSelectedDate] = useState<string | null>(todayStr)
  const [showCalendar, setShowCalendar] = useState(false)
  const [tab, setTab] = useState<'upcoming' | 'history'>('upcoming')
  const [rescheduleTarget, setRescheduleTarget] = useState<TeacherClass | null>(null)
  const [studentFilter, setStudentFilter] = useState<string>('all')

  const { classes, loading, isFetching, isError, refetch } = useTeacherClasses({ includeHistory: true })
  const { wallet, isFetching: walletFetching, refetch: refetchWallet } = useWallet()
  const { profile, refetch: refetchProfile } = useTeacherProfile()

  const isPageFetching = isFetching || walletFetching

  const handleRefresh = () => {
    refetch()
    refetchWallet()
    refetchProfile()
  }

  usePageTopBar({
    title: 'Mis Clases',
    onRefresh: handleRefresh,
    isFetching: isPageFetching,
  })

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

  // Estudiantes únicos (nombre y avatar) para el selector de filtrado
  const studentOptions = useMemo(() => {
    const map = new Map<string, { name: string; avatar?: string | null }>()
    safeClasses.forEach(c => {
      const name = c.student_name?.trim()
      if (name && !map.has(name)) {
        map.set(name, { name, avatar: c.student_avatar })
      }
    })
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, 'es'))
  }, [safeClasses])

  const filterByStudent = useMemo(() => {
    return (list: TeacherClass[]) =>
      studentFilter === 'all' ? list : list.filter(c => c.student_name === studentFilter)
  }, [studentFilter])

  const todayUpcoming = useMemo(
    () => upcomingAll.filter(c => c.start_time_utc.slice(0, 10) === todayStr),
    [upcomingAll, todayStr]
  )

  const completadas = useMemo(
    () => safeClasses.filter(c => c.status === 'completed').length,
    [safeClasses]
  )

  const selectedDateClasses = useMemo(() => {
    const base = !selectedDate
      ? upcomingAll
      : upcomingAll.filter(c => c.start_time_utc.slice(0, 10) === selectedDate)
    return filterByStudent(base)
  }, [upcomingAll, selectedDate, filterByStudent])

  const historyListFiltered = useMemo(
    () => filterByStudent(historyList),
    [historyList, filterByStudent]
  )

  const availableBalance = wallet?.available_balance || 0
  const totalEarned = wallet?.total_earned || 0

  const selectedDateLabel = selectedDate
    ? new Date(selectedDate + 'T00:00:00Z').toLocaleDateString('es', {
        weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
      })
    : null

  if (isError && !loading) {
    return (
      <>
        <div className="bg-white min-h-screen p-6 md:p-8 rounded-3xl flex flex-col items-center justify-center text-center gap-4 py-24">
          <div className="w-14 h-14 bg-rose-100 rounded-full flex items-center justify-center">
            <AlertTriangle className="w-7 h-7 text-rose-500" />
          </div>
          <div>
            <p className="text-lg font-black text-slate-800">No se pudieron cargar tus clases</p>
            <p className="text-sm text-slate-500 mt-1">Revisa tu conexión e inténtalo de nuevo.</p>
          </div>
          <button
            onClick={handleRefresh}
            className="flex items-center gap-2 px-5 py-2.5 bg-pink-500 hover:bg-pink-600 text-white text-sm font-bold rounded-xl shadow-sm transition-colors"
          >
            <RefreshCw className="w-4 h-4" /> Reintentar
          </button>
        </div>
        <ChipiWidget screenName="teacher_home" />
      </>
    )
  }

  return (
    <>
      <div className="space-y-8 animate-fade-up bg-white min-h-screen p-6 rounded-3xl">
        {profile?.status === 'rejected' && (
          <RejectionFeedbackBanner profile={profile} onRefetch={refetchProfile} />
        )}

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl md:text-4xl font-bold text-slate-800 mb-2 tracking-tight">
              Mis Clases
            </h1>
            <p className="text-sm text-slate-500 font-medium">
              Gestiona tu agenda y el estado de cada sesión
            </p>
          </div>
          <DesktopOnly>
            <RefreshButton onRefresh={handleRefresh} isFetching={isPageFetching} />
          </DesktopOnly>
        </div>

        {/* Stats */}
        {loading ? (
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-[104px] w-full rounded-3xl" />
            ))}
          </div>
        ) : (
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
        )}

        {/* Selector de semana + calendario global */}
        <div className="animate-fade-up animate-fade-up-delay-2 bg-slate-50/50 p-4 rounded-2xl border border-pink-50 relative z-20">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-pink-400 uppercase tracking-widest font-bold">
              Semana actual
            </p>
            <div className="relative">
              <button
                onClick={() => setShowCalendar(p => !p)}
                className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-pink-600 bg-white border border-slate-200 hover:border-pink-300 px-3 py-1.5 rounded-xl transition-colors"
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
              const dayIdx = (date.getUTCDay() + 6) % 7

              return (
                <button
                  key={dateStr}
                  onClick={() => { setSelectedDate(dateStr); setTab('upcoming') }}
                  className={`flex-shrink-0 flex flex-col items-center px-4 py-3 rounded-2xl text-xs transition-all duration-300 shadow-sm ${
                    isSelected
                      ? 'bg-gradient-to-br from-pink-500 to-rose-400 text-white shadow-pink-200 shadow-md scale-105 transform'
                      : isToday
                        ? 'bg-pink-50 text-pink-600 border border-pink-200 hover:bg-pink-100'
                        : 'bg-white text-slate-500 hover:text-pink-500 hover:bg-pink-50/50 border border-slate-100'
                  }`}
                >
                  <span className="font-medium">{DAYS[dayIdx]}</span>
                  <span className={`text-lg font-bold mt-1 ${isSelected ? 'text-white' : 'text-slate-700'} ${isToday && !isSelected ? 'text-pink-600' : ''}`}>
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
          <div className="flex flex-col xl:flex-row xl:items-center justify-between mb-6 gap-4">
            
            {/* Contenedor Izquierdo: Pestañas + Selector de Estudiantes agrupados */}
            <div className="flex flex-wrap items-center gap-3 w-full xl:w-auto">
              
              <div className="flex gap-1 bg-slate-100/80 border border-slate-200/60 rounded-xl p-1.5 shadow-inner">
                {[
                  { key: 'upcoming', label: 'Próximas' },
                  { key: 'history', label: 'Historial' },
                ].map(t => (
                  <button
                    key={t.key}
                    onClick={() => setTab(t.key as any)}
                    className={`px-5 py-2 rounded-lg text-sm font-semibold transition-all duration-300 ${
                      tab === t.key
                        ? 'bg-white text-pink-600 shadow-sm border border-slate-100'
                        : 'text-slate-500 hover:text-pink-500 hover:bg-white/50'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {/* Selector de filtrado por estudiante: Esqueleto de carga o Selector real */}
              {loading ? (
                <Skeleton className="h-[52px] w-full sm:w-72 rounded-2xl" />
              ) : studentOptions.length > 0 ? (
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <StudentFilterDropdown
                    options={studentOptions}
                    value={studentFilter}
                    onChange={setStudentFilter}
                  />
                  {studentFilter !== 'all' && (
                    <button
                      onClick={() => setStudentFilter('all')}
                      className="flex items-center gap-1 text-xs font-bold text-pink-500 hover:text-pink-600 bg-pink-50 hover:bg-pink-100 px-3 py-2 rounded-xl transition-colors flex-shrink-0"
                    >
                      <X className="w-3.5 h-3.5" /> Quitar filtro
                    </button>
                  )}
                </div>
              ) : null}
            </div>

            {/* Contenedor Derecho: Contador de estado (con esqueleto) */}
            {loading ? (
              <Skeleton className="h-8 w-36 rounded-full" />
            ) : tab === 'upcoming' ? (
              <p className="text-sm font-medium text-slate-500 bg-slate-50 px-3 py-1.5 rounded-full border border-slate-100">
                {selectedDate
                  ? `${selectedDateClasses.length} clase${selectedDateClasses.length !== 1 ? 's' : ''}`
                  : `${upcomingAll.length} próximas en total`}
              </p>
            ) : (
              <p className="text-sm font-medium text-slate-500 bg-slate-50 px-3 py-1.5 rounded-full border border-slate-100">
                {historyListFiltered.length} en el historial
              </p>
            )}
          </div>

          {loading ? (
            <div className="space-y-4">
              {[1, 2, 3].map(i => (
                <Skeleton key={i} className="h-28 w-full rounded-2xl" />
              ))}
            </div>
          ) : tab === 'upcoming' ? (
            selectedDateClasses.length === 0 ? (
              <Card className="py-20 text-center bg-slate-50/50 border-dashed border-2 border-slate-200 rounded-3xl shadow-none">
                <div className="text-5xl mb-4 drop-shadow-sm">🌸</div>
                <p className="text-slate-500 font-medium text-lg">
                  {studentFilter !== 'all'
                    ? 'No hay clases próximas con este estudiante.'
                    : selectedDate
                      ? '¡Día libre! No tienes clases programadas ese día.'
                      : '¡Sin clases próximas por ahora!'}
                </p>
              </Card>
            ) : (
              <div className="space-y-4">
                {selectedDateClasses.map(c => (
                  <ClassCard
                    key={c.id}
                    class_={c}
                    role="teacher"
                    onUpdate={refetch}
                    onReschedule={() => setRescheduleTarget(c)}
                  />
                ))}
              </div>
            )
          ) : (
            historyListFiltered.length === 0 ? (
              <Card className="py-20 text-center bg-slate-50/50 border-dashed border-2 border-slate-200 rounded-3xl shadow-none">
                <div className="text-5xl mb-4 drop-shadow-sm">📋</div>
                <p className="text-slate-500 font-medium text-lg">
                  {studentFilter !== 'all'
                    ? 'No hay clases en el historial con este estudiante.'
                    : 'Aún no hay historial de clases.'}
                </p>
              </Card>
            ) : (
              <div className="space-y-4">
                {historyListFiltered.map(c => (
                  <ClassCard
                    key={c.id}
                    class_={c}
                    role="teacher"
                    onUpdate={refetch}
                    onReschedule={() => setRescheduleTarget(c)}
                  />
                ))}
              </div>
            )
          )}
        </div>
      </div>
      {rescheduleTarget && profile?.user_username && (
        <RescheduleModal
          classItem={{
            id: rescheduleTarget.id,
            subject: rescheduleTarget.subject,
            start_time_utc: rescheduleTarget.start_time_utc,
            duration_minutes: rescheduleTarget.duration_minutes,
            counterpart_name: rescheduleTarget.student_name,
            isGroup: rescheduleTarget.class_type === "group",
            classType: rescheduleTarget.class_type,
          }}
          teacherUsername={profile.user_username}
          endpoint={`/classes/teacher/${rescheduleTarget.id}/reschedule`}
          onClose={() => setRescheduleTarget(null)}
          onSaved={refetch}
        />
      )}
      <ChipiWidget screenName="teacher_home" />
    </>
  )
}