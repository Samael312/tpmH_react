import { useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'
import { fetchAllPages } from "@/lib/pagination";
import { useLoadMoreList } from "@/hooks/useLoadMoreList";
import { useVisiblePolling } from "@/lib/polling";
import type { BusinessRules } from './useBusinessRules'

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

export interface PendingPayment {
  payment_id: number
  payment_type: string
  installment_index: number | null
  student_name: string
  student_username: string | null
  amount: number
  payment_method?: string | null
  payment_method_label?: string | null
  refund_payment_info?: {
    bank_name?: string | null
    bank_account?: string | null
    account_holder?: string | null
    mobile_payment?: string | null
    paypal_or_zelle?: string | null
    other_notes?: string | null
  } | null
  transaction_reference: string | null
  submitted_at: string
  class_start_utc?: string | null
  payment_expires_at?: string | null
  package_name?: string | null
  installment_total?: number | null
  // true si es un pago de las propias clases de un teacher_admin (lo resuelve el superadmin)
  is_own_payment?: boolean
  // El backend puede devolver null si el profesor fue eliminado; se deja
  // opcional para que el renderizado condicional (`{p.teacher_name && ...}`)
  // siga siendo seguro en ese caso.
  teacher_name?: string | null
}

export interface Teacher {
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
  video_pending_url?: string | null
  video_pending_rejection_reason?: string | null
  total_classes: number
  total_students: number
  created_at: string
  rejection_reason?: string | null
  appeal_exhausted?: boolean
}

export interface Student {
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

export interface WithdrawalRecord {
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

export interface PaymentHistoryItem extends PendingPayment {
  status: 'approved' | 'rejected'
  validated_at: string | null
  rejection_reason?: string | null
}

// Fase 14, E6: los listados del admin que crecen sin límite se paginan en el servidor con «Cargar más»; filtros y
// contadores vienen del backend. Antes descargaban todas las páginas (fetchAllPages) para filtrar en el navegador.

/** Historial de pagos resueltos. `enabled`: solo se pide al abrir la pestaña. */
export function usePaymentsHistory(enabled = true) {
  const list = useLoadMoreList<PaymentHistoryItem>(["admin", "payments", "history"], '/payments/history', { enabled })
  return {
    history: list.rows,
    total: list.total,
    loading: list.loading,
    isFetching: list.isFetching,
    isError: list.isError,
    refetch: list.refetch,
    hasMore: list.hasMore,
    loadMore: list.loadMore,
    loadingMore: list.loadingMore,
  }
}

type UsersPage = { total: number; active_count?: number | null; users: Student[] }

/** `/admin/users` responde `{ total, active_count, users }` y pagina con `skip`. */
function useAdminUsers(key: string, params: Record<string, string | undefined>) {
  const list = useLoadMoreList<Student, UsersPage>(["admin", "students", key, params], '/admin/users', {
    params,
    rows: (b) => b.users,
    totalOf: (b) => b.total,
    offsetParam: 'skip',
  })
  return {
    students: list.rows,
    total: list.total,
    activeCount: list.firstBody?.active_count ?? null,
    loading: list.loading,
    isFetching: list.isFetching,
    isError: list.isError,
    refetch: list.refetch,
    hasMore: list.hasMore,
    loadMore: list.loadMore,
    loadingMore: list.loadingMore,
  }
}

export function useStudents(search?: string) {
  return useAdminUsers("list", { role: 'student', is_banned: 'false', search: search || undefined })
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
      return (await fetchAllPages<WithdrawalRecord>('/payments/admin/withdrawals/pending')).rows
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

export interface ManualGrantRequestRecord {
  id: number
  teacher_id: number
  student_id: number
  enrollment_id: number
  package_id: number | null
  reason: string
  status: 'pending' | 'approved' | 'rejected'
  rejection_reason: string | null
  created_at: string
  resolved_at: string | null
  teacher_name: string | null
  student_name: string | null
  package_name: string | null
}

/** Solicitudes de paquete gratis de los profesores (Fase 20). Por defecto solo las pendientes. */
export function useManualGrantRequests(status: string = 'pending') {
  const query = useQuery({
    queryKey: ["admin", "manual-grants", status],
    queryFn: async () => {
      return (await fetchAllPages<ManualGrantRequestRecord>(`/payments/manual-grant-requests?status=${status}`)).rows
    },
  })

  return {
    requests: query.data ?? [],
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

/** Directorio de profesores paginado; `hasVideo` filtra en el servidor. */
export function useTeachers(statusFilter?: string, { hasVideo }: { hasVideo?: boolean } = {}) {
  const params = { status_filter: statusFilter, has_video: hasVideo ? 'true' : undefined }
  const list = useLoadMoreList<Teacher>(["admin", "teachers", "list", params], '/admin/teachers', { params })
  return {
    teachers: list.rows,
    total: list.total,
    loading: list.loading,
    isFetching: list.isFetching,
    isError: list.isError,
    refetch: list.refetch,
    hasMore: list.hasMore,
    loadMore: list.loadMore,
    loadingMore: list.loadingMore,
  }
}

/** TODOS los profesores de un estado, para selectores (p. ej. profesor destacado). Son pocos: sí se pide todo. */
export function useAllTeachers(statusFilter?: string) {
  const query = useQuery({
    queryKey: ["admin", "teachers", "all", statusFilter ?? null],
    queryFn: async () => {
      return (await fetchAllPages<Teacher>('/admin/teachers', { params: { status_filter: statusFilter } })).rows
    },
  })
  return { teachers: query.data ?? [], loading: query.isLoading }
}

// ─── Notificaciones del panel de staff ───────────────────────────────────────
export interface AdminNotification {
  id: number
  type: string
  title: string
  message: string | null
  related_teacher_id: number | null
  related_support_ticket_id: number | null
  is_read: boolean
  created_at: string
}

export function useUnreadNotificationCount(enabled: boolean = true) {
  const [count, setCount] = useState(0)

  const fetchCount = useCallback(() => {
    if (!enabled) return Promise.resolve()
    return api.get('/admin/notifications/unread-count')
      .then(res => setCount(res.data.unread_count))
      .catch(() => {})
  }, [enabled])

  // Cada 60 s solo con la pestaña visible, y al volver a ella (antes cada 30 s aunque estuviera oculta).
  useVisiblePolling(fetchCount, 60000, enabled)

  // Si el hook está deshabilitado, no mostramos un conteo obtenido
  // previamente en vez de resetear el estado dentro del efecto.
  return { count: enabled ? count : 0, refetch: fetchCount }
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
  kind?: string
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
  category: 'bug' | 'error' | 'question' | 'other' | 'class_correction'
  subject: string
  message: string
  screen_context: string | null
  // Solo class_correction (NEG-02)
  class_id?: number | null
  requested_status?: 'completed' | 'cancelled' | null
  decision?: 'approved' | 'rejected' | null
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
  const params = { status_filter: statusFilter || undefined, category_filter: categoryFilter || undefined }
  const list = useLoadMoreList<SupportTicketWithUser>(['admin', 'support-tickets', params], '/admin/support-tickets', { params })
  return {
    tickets: list.rows,
    total: list.total,
    loading: list.loading,
    isFetching: list.isFetching,
    isError: list.isError,
    refetch: list.refetch,
    hasMore: list.hasMore,
    loadMore: list.loadMore,
    loadingMore: list.loadingMore,
  }
}

// ─── Estudiantes baneados ─────────────────────────────────────────────────────
export function useBannedStudents() {
  return useAdminUsers("banned", { role: 'student', is_banned: 'true' })
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
  total_completed_classes: number
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
// Referencia estable: un `?? []` nuevo en cada render hacía que `useEffect([users])` de /admin/users se realimentara
// (setRows → render → users distinto → effect...) en bucle mientras cargaba o si la petición fallaba (F12).
const NO_USERS: AdminUserRaw[] = []

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
    users: query.data?.users ?? NO_USERS,
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
  show_teacher_whatsapp: boolean
  chat_enabled: boolean
  chat_retention_days: number
  chat_reactivation_hours: number
  featured_teacher: {
    username: string
    name: string
    title: string | null
    bio: string | null
    avatar: string | null
    subjects: string[] | null
  } | null
  featured_teacher_username?: string
  landing_content: import("./useLandingData").LandingContent
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
      return res.data as BusinessRules
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