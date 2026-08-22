import { useState, useEffect, useCallback } from 'react'
import api from '@/lib/api'
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"

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
  student_name?: string | null    
  student_avatar?: string | null 
  student_nationality?: string | null
  student_phone?: string | null
}

export interface TeacherProfile {
  id: number
  user_username: string
  name?: string | null
  surname?: string | null
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
  video_url?: string | null
  theme_color?: string | null
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


// ─── Estudiantes del profesor (detalle completo) ─────────────────────────────
export interface StudentEnrollmentSummary {
  id: number
  package_name: string
  subject: string | null
  classes_used: number
  classes_total: number | null
  status: string
  created_at: string
}

export interface StudentMaterialSummary {
  id: number
  material_id: number
  title: string
  category: string
  level: string | null
  progress: string
  assigned_at: string
}
export interface TeacherStudentFull {
  id: number
  user_id: number
  username: string
  name: string
  surname: string
  email: string
  phone_number: string | null
  avatar: string | null
  timezone: string | null
  nationality: string | null
  goal: string | null
  created_at: string
  enrollments: StudentEnrollmentSummary[]
  materials: StudentMaterialSummary[]
}

export interface WithdrawalHistoryItem {
  id: number
  amount: number
  status: string
  destination_details: string | null
  reference: string | null
  rejection_reason: string | null
  created_at: string
  processed_at: string | null
}

export interface IncomeHistoryItem {
  id: number
  amount_teacher: number
  payment_type: string | null
  installment_number: number | null
  status: string
  created_at: string
  validated_at: string | null
}

export function useMyWithdrawals() {
  const [withdrawals, setWithdrawals] = useState<WithdrawalHistoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const fetch = useCallback(async () => {
    try {
      setLoading(true)
      const res = await api.get('/payments/my-withdrawals')
      setWithdrawals(res.data)
    } catch { } finally { setLoading(false) }
  }, [])
  useEffect(() => { fetch() }, [fetch])
  return { withdrawals, loading, refetch: fetch }
}

export function useMyIncome() {
  const [income, setIncome] = useState<IncomeHistoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const fetch = useCallback(async () => {
    try {
      setLoading(true)
      const res = await api.get('/payments/my-income')
      setIncome(res.data)
    } catch { } finally { setLoading(false) }
  }, [])
  useEffect(() => { fetch() }, [fetch])
  return { income, loading, refetch: fetch }
}

export function useTeacherStudentsFull() {
  const [students, setStudents] = useState<TeacherStudentFull[]>([])
  const [loading, setLoading] = useState(true)

  const fetch = useCallback(async () => {
    try {
      setLoading(true)
      const res = await api.get('/teachers/me/students-full')
      setStudents(res.data)
    } catch { }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetch() }, [fetch])
  return { students, loading, refetch: fetch }
}

// ─── Clases del profesor ─────────────────────────────────────────────────────
interface TeacherClassesFilters {
  date?: string
  status?: string
  includeHistory?: boolean
}

interface TeacherClassesResponse {
  classes: TeacherClass[]
  total: number
  upcoming: number
  completed: number
}

export function useTeacherClasses(filters?: TeacherClassesFilters) {
  const query = useQuery({
    queryKey: ["teacher", "classes", filters ?? {}],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (filters?.date) params.append('date', filters.date)
      if (filters?.status) params.append('status_filter', filters.status)
      if (filters?.includeHistory) params.append('include_history', 'true')

      const res = await api.get(`/classes/teacher/classes?${params}`)
      return {
        classes: res.data.classes as TeacherClass[],
        total: res.data.total as number,
        upcoming: res.data.upcoming as number,
        completed: res.data.completed as number,
      } satisfies TeacherClassesResponse
    },
  })

  return {
    classes: query.data?.classes ?? [],
    stats: {
      total: query.data?.total ?? 0,
      upcoming: query.data?.upcoming ?? 0,
      completed: query.data?.completed ?? 0,
    },
    loading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    refetch: query.refetch,
  }
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
  const query = useQuery({
    queryKey: ["teacher", "availability", "weekly"],
    queryFn: async () => {
      const res = await api.get('/availability/me/weekly')
      return res.data as WeeklySlot[]
    },
  })

  return {
    slots: query.data ?? [],
    loading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    refetch: query.refetch,
  }
}

// ─── Wallet ──────────────────────────────────────────────────────────────────
export function useWallet() {
  const query = useQuery({
    queryKey: ["teacher", "wallet"],
    queryFn: async () => {
      const res = await api.get("/payments/my-wallet")
      return res.data as WalletData
    },
  })

  return {
    wallet: query.data ?? null,
    loading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    refetch: query.refetch,
  }
}

interface WithdrawalPayload {
  amount: number
  destination_method: string
  destination_details: string
}

export function useRequestWithdrawal() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: WithdrawalPayload) =>
      api.post("/payments/request-withdrawal", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teacher", "wallet"] })
    },
  })
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