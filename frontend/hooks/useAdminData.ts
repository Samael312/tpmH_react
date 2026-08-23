import { useState, useEffect, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'

interface PlatformStats {
  total_users: number
  total_students: number
  total_teachers: number
  total_teachers_pending: number
  total_teachers_approved: number
  total_classes: number
  classes_this_month: number
  classes_completed: number
  classes_cancelled: number
  total_revenue: number
  total_paid_to_teachers: number
  total_platform_earnings: number
  pending_withdrawals: number
  new_users_this_week: number
  new_classes_this_week: number
}

interface PendingPayment {
  payment_id: number
  class_id: number
  student_name: string
  student_username: string
  amount: number
  payment_method: string
  transaction_id: string
  receipt_url: string
  class_start_utc: string
  submitted_at: string
}

interface Teacher {
  id: number
  username: string
  name: string
  surname: string
  phone_number?: string
  nationality?: string | null
  profile_photo_url?: string | null
  email: string
  status: string
  commission_rate: number
  balance: number
  has_pending_appeal: boolean
  video_url: string | null
  total_classes: number
  total_students: number
  created_at: string
}

interface Student {
  id: number
  username: string
  name: string
  surname: string
  phone_number?: string
  nationality?: string | null
  email: string
  role: string
  is_active: boolean
  is_verified: boolean
  is_banned?: boolean
  ban_reason?: string | null
  banned_at?: string | null
  created_at: string
}

interface PaymentRecord {
  id: number
  class_id: number | null
  student_id: number
  teacher_id: number
  amount_total: number
  amount_teacher: number
  amount_platform: number
  payment_method: string
  receipt_url: string | null
  transaction_id: string | null
  status: string
  created_at: string
  validated_at: string | null
  
}

interface WithdrawalRecord {
  id: number
  teacher_id: number
  teacher_username: string
  teacher_name: string
  amount: number
  destination_method: string | null
  destination_details: string | null
  status: string
  created_at: string
}

interface PaymentHistoryItem extends PendingPayment {
  status: 'approved' | 'rejected'
  validated_at: string | null
  rejection_reason?: string | null
}

export function usePaymentsHistory() {
  const [history, setHistory] = useState<PaymentHistoryItem[]>([])
  const [loading, setLoading] = useState(true)

  const fetch = useCallback(async () => {
    try {
      setLoading(true)
      const res = await api.get('/payments/history')
      setHistory(res.data)
    } catch { } finally { setLoading(false) }
  }, [])

  useEffect(() => { fetch() }, [fetch])
  return { history, loading, refetch: fetch }
}

export function useStudents(search?: string) {
  const [students, setStudents] = useState<Student[]>([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)

  const fetch = useCallback(async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams({ role: 'student', is_banned: 'false' })
      if (search) params.append('search', search)
      const res = await api.get(`/admin/users?${params}`)
      setStudents(res.data)
      setTotal(res.data.length)
    } catch { }
    finally { setLoading(false) }
  }, [search])

  useEffect(() => { fetch() }, [fetch])
  return { students, loading, total, refetch: fetch }
}



export function useWithdrawals() {
  const [withdrawals, setWithdrawals] = useState<WithdrawalRecord[]>([])
  const [loading, setLoading] = useState(true)

  const fetch = useCallback(async () => {
    try {
      setLoading(true)
      const res = await api.get('/payments/admin/withdrawals/pending')  // ← ver nota abajo
      setWithdrawals(res.data)
    } catch { } finally { setLoading(false) }
  }, [])

  useEffect(() => { fetch() }, [fetch])
  return { withdrawals, loading, refetch: fetch }
}

export function useAdminStats() {
  const query = useQuery({
    queryKey: ["admin", "stats"],
    queryFn: async () => {
      const res = await api.get('/admin/stats')
      return res.data as PlatformStats
    },
  })

  return {
    stats: query.data ?? null,
    loading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    refetch: query.refetch,
  }
}

export function usePendingPayments() {
  const query = useQuery({
    queryKey: ["admin", "payments", "pending"],
    queryFn: async () => {
      const res = await api.get('/payments/pending-review')
      return res.data as PendingPayment[]
    },
  })

  return {
    payments: query.data ?? [],
    loading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    refetch: query.refetch,
  }
}

export function useTeachers(statusFilter?: string) {
  const [teachers, setTeachers] = useState<Teacher[]>([])
  const [loading, setLoading] = useState(true)

  const fetch = useCallback(async () => {
    try {
      setLoading(true)
      const params = statusFilter ? `?status_filter=${statusFilter}` : ''
      const res = await api.get(`/admin/teachers${params}`)
      setTeachers(res.data)
    } catch { } finally {
      setLoading(false)
    }
  }, [statusFilter])

  useEffect(() => { fetch() }, [fetch])
  return { teachers, loading, refetch: fetch }
}

// ─── Notificaciones del panel de staff ───────────────────────────────────────
export interface AdminNotification {
  id: number
  type: string
  title: string
  message: string | null
  related_teacher_id: number | null
  is_read: boolean
  created_at: string
}

export function useUnreadNotificationCount(enabled: boolean = true) {
  const [count, setCount] = useState(0)

  const fetch = useCallback(async () => {
    if (!enabled) return
    try {
      const res = await api.get('/admin/notifications/unread-count')
      setCount(res.data.unread_count)
    } catch { }
  }, [enabled])

  useEffect(() => {
    if (!enabled) {
      setCount(0)
      return
    }
    fetch()
    const interval = setInterval(fetch, 30000) // refresco cada 30s
    return () => clearInterval(interval)
  }, [enabled, fetch])

  return { count, refetch: fetch }
}

export function useNotifications(unreadOnly = false) {
  const query = useQuery({
    queryKey: ["admin", "notifications", unreadOnly],
    queryFn: async () => {
      const res = await api.get(`/admin/notifications?unread_only=${unreadOnly}`)
      return res.data as AdminNotification[]
    },
  })

  return {
    notifications: query.data ?? [],
    loading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    refetch: query.refetch,
  }
}

// ─── Apelaciones de profesores ────────────────────────────────────────────────
export interface TeacherAppeal {
  id: number
  teacher_id: number
  appeal_number: number
  message: string
  status: string
  admin_response: string | null
  created_at: string
  resolved_at: string | null
  teacher_username: string
  teacher_name: string
  teacher_surname: string
  teacher_status: string
}

export function useAppeals(statusFilter?: string) {
  const [appeals, setAppeals] = useState<TeacherAppeal[]>([])
  const [loading, setLoading] = useState(true)

  const fetch = useCallback(async () => {
    try {
      setLoading(true)
      const params = statusFilter ? `?status_filter=${statusFilter}` : ''
      const res = await api.get(`/admin/appeals${params}`)
      setAppeals(res.data)
    } catch { } finally { setLoading(false) }
  }, [statusFilter])

  useEffect(() => { fetch() }, [fetch])
  return { appeals, loading, refetch: fetch }
}

// ─── Estudiantes baneados ─────────────────────────────────────────────────────
export function useBannedStudents() {
  const [students, setStudents] = useState<Student[]>([])
  const [loading, setLoading] = useState(true)

  const fetch = useCallback(async () => {
    try {
      setLoading(true)
      const res = await api.get('/admin/users?role=student&is_banned=true&limit=200')
      setStudents(res.data)
    } catch { } finally { setLoading(false) }
  }, [])

  useEffect(() => { fetch() }, [fetch])
  return { students, loading, refetch: fetch }
}

// ─── Detalle de un estudiante (bajo demanda, para el desplegable) ────────────
export interface StudentDetailEnrollment {
  id: number
  package_name: string
  subject: string | null
  teacher_name: string | null
  classes_used: number
  classes_total: number | null
  status: string
  created_at: string
}

export interface StudentDetailMaterial {
  id: number
  title: string
  category: string
  progress: string
  assigned_at: string
}

export interface StudentDetail {
  created_at: string
  goal: string | null
  timezone: string | null
  enrollments: StudentDetailEnrollment[]
  materials: StudentDetailMaterial[]
}

export function fetchStudentDetail(userId: number) {
  return api.get<StudentDetail>(`/admin/students/${userId}/detail`)
}

// ─── Lista completa de usuarios (edición masiva) ─────────────────────────────
export interface AdminUserRaw {
  id: number
  username: string
  name: string
  surname: string
  email: string
  role: string
  is_active: boolean
  phone_number: string | null
  nationality: string | null
  classes_used?: number
  classes_total?: number
}

export function useAdminUsersList() {
  const query = useQuery({
    queryKey: ["admin", "users"],
    queryFn: async () => {
      const res = await api.get('/admin/users?limit=200')
      return (res.data.users ?? res.data) as AdminUserRaw[]
    },
  })

  return {
    users: query.data ?? [],
    loading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    refetch: query.refetch,
  }
}