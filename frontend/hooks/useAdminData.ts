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
  const query = useQuery({
    queryKey: ["admin", "payments", "history"],
    queryFn: async () => {
      const res = await api.get('/payments/history')
      return res.data as PaymentHistoryItem[]
    },
  })

  return {
    history: query.data ?? [],
    loading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    refetch: query.refetch,
  }
}

export function useStudents(search?: string) {
  const query = useQuery({
    queryKey: ["admin", "students", search ?? ""],
    queryFn: async () => {
      const params = new URLSearchParams({ role: 'student', is_banned: 'false' })
      if (search) params.append('search', search)
      const res = await api.get(`/admin/users?${params}`)
      return res.data as Student[]
    },
  })

  return {
    students: query.data ?? [],
    total: query.data?.length ?? 0,
    loading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    refetch: query.refetch,
  }
}

export function useStudentDetail(studentId: number, enabled: boolean) {
  const query = useQuery({
    queryKey: ["admin", "students", studentId, "detail"],
    queryFn: async () => {
      const res = await api.get<StudentDetail>(`/admin/students/${studentId}/detail`)
      return res.data
    },
    enabled,
  })

  return {
    detail: query.data ?? null,
    loading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  }
}

export function useWithdrawals() {
  const query = useQuery({
    queryKey: ["admin", "withdrawals", "pending"],
    queryFn: async () => {
      const res = await api.get('/payments/admin/withdrawals/pending')
      return res.data as WithdrawalRecord[]
    },
  })

  return {
    withdrawals: query.data ?? [],
    loading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    refetch: query.refetch,
  }
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
  const query = useQuery({
    queryKey: ["admin", "teachers", statusFilter ?? null],
    queryFn: async () => {
      const params = statusFilter ? `?status_filter=${statusFilter}` : ''
      const res = await api.get(`/admin/teachers${params}`)
      return res.data as Teacher[]
    },
  })

  return {
    teachers: query.data ?? [],
    loading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    refetch: query.refetch,
  }
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

// ─── Apelaciones de un profesor específico (modal de detalle) ────────────────
export function useTeacherAppeals(teacherId: number | undefined) {
  const query = useQuery({
    queryKey: ["admin", "teachers", teacherId, "appeals"],
    queryFn: async () => {
      const res = await api.get(`/admin/teachers/${teacherId}/appeals`)
      return res.data as TeacherAppeal[]
    },
    enabled: teacherId !== undefined,
  })

  return {
    appeals: query.data ?? [],
    loading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  }
}

// ─── Tickets de soporte (bugs / errores / dudas de student o teacher) ────────
export interface SupportTicketWithUser {
  id: number
  category: 'bug' | 'error' | 'question' | 'other'
  subject: string
  message: string
  screen_context: string | null
  status: 'pending' | 'answered'
  admin_response: string | null
  created_at: string
  resolved_at: string | null
  user_notified_seen: boolean
  user_id: number
  user_name: string
  user_surname: string
  user_username: string
  user_email: string
  user_role: string
}

export function useSupportTickets(statusFilter?: string, categoryFilter?: string) {
  const query = useQuery({
    queryKey: ['admin', 'support-tickets', statusFilter, categoryFilter],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (statusFilter) params.set('status_filter', statusFilter)
      if (categoryFilter) params.set('category_filter', categoryFilter)
      const qs = params.toString()
      const res = await api.get(`/admin/support-tickets${qs ? `?${qs}` : ''}`)
      return res.data as SupportTicketWithUser[]
    },
  })

  return {
    tickets: query.data ?? [],
    loading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    refetch: query.refetch,
  }
}

// ─── Estudiantes baneados ─────────────────────────────────────────────────────
export function useBannedStudents() {
  const query = useQuery({
    queryKey: ["admin", "students", "banned"],
    queryFn: async () => {
      const res = await api.get('/admin/users?role=student&is_banned=true&limit=200')
      return res.data as Student[]
    },
  })

  return {
    students: query.data ?? [],
    loading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    refetch: query.refetch,
  }
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

// BUG-10 fix: paginación real en vez de pedir un límite fijo de una sola
// vez y descartar el total. El backend ahora devuelve {total, users}.
export function useAdminUsersList(page: number = 1, pageSize: number = 50) {
  const skip = (page - 1) * pageSize
  const query = useQuery({
    queryKey: ["admin", "users", page, pageSize],
    queryFn: async () => {
      const res = await api.get(`/admin/users?limit=${pageSize}&skip=${skip}`)
      const data = res.data
      // Compat: si en algún punto el backend volviera a responder una
      // lista plana, no se rompe (aunque 'total' quedaría indefinido).
      if (Array.isArray(data)) {
        return { total: data.length, users: data as AdminUserRaw[] }
      }
      return { total: data.total as number, users: data.users as AdminUserRaw[] }
    },
  })

  return {
    users: query.data?.users ?? [],
    total: query.data?.total ?? 0,
    page,
    pageSize,
    totalPages: query.data ? Math.max(1, Math.ceil(query.data.total / pageSize)) : 1,
    loading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    refetch: query.refetch,
  }
}

// ─── Configuración de pagos (edición, panel admin) ────────────────────────
export interface AdminPaymentConfig {
  paypal_enabled: boolean
  binance_enabled: boolean
  bank_transfer_enabled: boolean
  mobile_payment_enabled: boolean
  paypal_email: string | null
  binance_address: string | null
  binance_network: string | null
  bank_transfer_details: string | null
  mobile_payment_details: string | null
  whatsapp_number: string | null
  default_commission_rate: number
}

export function useAdminPaymentConfig() {
  const query = useQuery({
    queryKey: ["admin", "settings", "payment-config"],
    queryFn: async () => {
      const res = await api.get('/payments/config')
      return res.data as AdminPaymentConfig
    },
  })

  return {
    paymentConfig: query.data ?? null,
    loading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    refetch: query.refetch,
  }
}

// ─── Configuración de plataforma (edición, panel admin) ───────────────────
export interface AdminPlatformConfig {
  platform_name: string
  platform_tagline: string | null
  is_single_tenant: boolean
  featured_teacher: any
  featured_teacher_username?: string
}

export function useAdminPlatformConfig() {
  const query = useQuery({
    queryKey: ["admin", "settings", "platform-config"],
    queryFn: async () => {
      const res = await api.get('/admin/platform-config')
      return {
        ...res.data,
        featured_teacher_username: res.data.featured_teacher?.username || '',
      } as AdminPlatformConfig
    },
  })

  return {
    platformConfig: query.data ?? null,
    loading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    refetch: query.refetch,
  }
}

// ─── Reglas de negocio (edición, panel admin) ─────────────────────────────
export function useAdminBusinessRules() {
  const query = useQuery({
    queryKey: ["admin", "settings", "business-rules"],
    queryFn: async () => {
      const res = await api.get('/system-catalogs/business-rules')
      return res.data
    },
  })

  return {
    businessRules: query.data ?? null,
    loading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    refetch: query.refetch,
  }
}