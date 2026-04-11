import { useState, useEffect, useCallback } from 'react'
import api from '@/lib/api'

export interface TeacherClass {
  id: number
  enrollment_id: number | null
  teacher_id: number
  student_id: number
  class_type: 'trial' | 'regular'
  subject: string | null
  start_time_utc: string
  end_time_utc: string
  duration_minutes: number
  status: string
  meet_link: string | null
  notes: string | null
  teacher_timezone: string | null
  student_timezone: string | null
  created_at: string
}

export interface TeacherProfile {
  id: number
  user_username: string
  bio: string | null
  title: string | null
  timezone: string | null
  languages: string[]
  subjects: string[]
  skills: string[]
  certificates: any[]
  gallery: string[]
  social_links: Record<string, string>
  status: string
  commission_rate: number
  balance: number
}

export interface WeeklySlot {
  id: number
  teacher_id: number
  day_of_week: number
  start_time_utc: string
  end_time_utc: string
  is_available: boolean
}

export interface WalletData {
  available_balance: number
  total_earned: number
  total_withdrawn: number
}

export interface CalendarStatus {
  connected: boolean
  is_active: boolean
  calendar_id: string | null
}

// ─── Clases del profesor ─────────────────────────────────────────────────────
export function useTeacherClasses(filters?: {
  date?: string
  status?: string
  includeHistory?: boolean
}) {
  const [classes, setClasses] = useState<TeacherClass[]>([])
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({ total: 0, upcoming: 0, completed: 0 })

  const fetch = useCallback(async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      if (filters?.date) params.append('date', filters.date)
      if (filters?.status) params.append('status_filter', filters.status)
      if (filters?.includeHistory) params.append('include_history', 'true')

      const res = await api.get(`/classes/teacher/classes?${params}`)
      setClasses(res.data.classes)
      setStats({
        total: res.data.total,
        upcoming: res.data.upcoming,
        completed: res.data.completed,
      })
    } catch { }
    finally { setLoading(false) }
  }, [filters?.date, filters?.status, filters?.includeHistory])

  useEffect(() => { fetch() }, [fetch])
  return { classes, loading, stats, refetch: fetch }
}

// ─── Perfil del profesor ─────────────────────────────────────────────────────
export function useTeacherProfile() {
  const [profile, setProfile] = useState<TeacherProfile | null>(null)
  const [loading, setLoading] = useState(true)

  const fetch = useCallback(async () => {
    try {
      setLoading(true)
      const res = await api.get('/teachers/me/profile')
      setProfile(res.data)
    } catch { }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetch() }, [fetch])
  return { profile, loading, refetch: fetch }
}

// ─── Disponibilidad semanal ──────────────────────────────────────────────────
export function useWeeklyAvailability() {
  const [slots, setSlots] = useState<WeeklySlot[]>([])
  const [loading, setLoading] = useState(true)

  const fetch = useCallback(async () => {
    try {
      setLoading(true)
      const res = await api.get('/availability/me/weekly')
      setSlots(res.data)
    } catch { }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetch() }, [fetch])
  return { slots, loading, refetch: fetch }
}

// ─── Wallet ──────────────────────────────────────────────────────────────────
export function useWallet() {
  const [wallet, setWallet] = useState<WalletData | null>(null)
  const [loading, setLoading] = useState(true)

  const fetch = useCallback(async () => {
    try {
      setLoading(true)
      const res = await api.get('/payments/my-wallet')
      setWallet(res.data)
    } catch { }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetch() }, [fetch])
  return { wallet, loading, refetch: fetch }
}

// ─── Google Calendar status ──────────────────────────────────────────────────
export function useCalendarStatus() {
  const [status, setStatus] = useState<CalendarStatus | null>(null)
  const [loading, setLoading] = useState(true)

  const fetch = useCallback(async () => {
    try {
      setLoading(true)
      const res = await api.get('/calendar/status')
      setStatus(res.data)
    } catch { }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetch() }, [fetch])
  return { status, loading, refetch: fetch }
}