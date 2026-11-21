import api from '@/lib/api'
import { fetchMe } from '@/lib/me'
import { fetchAllPages } from "@/lib/pagination";
import { useLoadMoreList } from "@/hooks/useLoadMoreList";
import type { SpokenLanguage } from '@/lib/spokenLanguages'
import { useQuery, useQueryClient } from "@tanstack/react-query"

export interface TeacherClass {
  id: number
  enrollment_id: number | null
  teacher_id: number
  student_id: number
  class_type: 'trial' | 'regular' | 'group'
  cohort_id?: number | null
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
  certificates: { title: string; year: string }[]
  gallery: string[]
  social_links: Record<string, string>
  status: string
  commission_rate: number
  balance: number
  video_url?: string | null
  theme_color?: string | null
  rejection_reason?: string | null
  rejection_feedback_seen?: boolean
  appeal_count?: number
  appeal_exhausted?: boolean
}

export interface WeeklySlot {
  id: number
  teacher_id: number
  day_of_week: number         // día LOCAL del profesor (0=Lunes ... 6=Domingo), Fase 26
  start_time_local: string    // "18:00" hora local del profesor (sin UTC: se pinta tal cual)
  end_time_local: string      // "20:00"; si <= inicio cruza la medianoche local
  is_available: boolean
  timezone: string            // zona IANA con la que se interpreta (la del perfil del profesor)
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
  cohort_id?: number | null
  is_group?: boolean
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
  // Fase 8: idiomas que habla el alumno (solo los ve su profesor)
  spoken_languages?: SpokenLanguage[]
  goal: string | null
  created_at: string
  enrollments: StudentEnrollmentSummary[]
  materials: StudentMaterialSummary[]
  total_completed_classes: number
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

// ─── Materiales del profesor ─────────────────────────────────────────────────
export interface TeacherMaterial {
  id: number
  title: string
  description?: string | null
  category: string
  level: string
  file_url: string | null
  file_type: string | null
  created_at: string
  vocabulary_words: string[] | null
}

// ─── Pagos del profesor (validación) ─────────────────────────────────────────
// Ambos endpoints devuelven una forma parecida (pending-review agrega
// payment_expires_at; history agrega validated_at/status/rejection_reason),
// y la UI (teacher/payments/page.tsx) los combina en una sola lista según la
// pestaña activa, por eso se modela como un único tipo con los campos
// exclusivos de cada endpoint marcados opcionales.
export interface TeacherPaymentEntry {
  payment_id: number
  payment_type: string
  installment_index: number | null
  amount: number
  transaction_reference: string | null
  submitted_at: string
  student_name: string
  student_username: string | null
  class_start_utc?: string | null
  package_name?: string | null
  installment_total?: number | null
  // true si es un pago de las propias clases de un teacher_admin (lo resuelve el superadmin)
  is_own_payment?: boolean
  // Solo en /payments/pending-review (pagos de una sola clase con vencimiento)
  payment_expires_at?: string | null
  // Solo en /payments/history
  validated_at?: string | null
  status?: "approved" | "rejected"
  rejection_reason?: string | null
}

export function useTeacherPendingPayments(enabled: boolean = true) {
  const query = useQuery({
    queryKey: ["teacher", "payments", "pending"],
    queryFn: async () => {
      const res = await api.get('/payments/pending-review')
      return res.data as TeacherPaymentEntry[]
    },
    enabled,
  })

  return {
    payments: query.data ?? [],
    loading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    refetch: query.refetch,
  }
}

export function useTeacherPaymentsHistory(enabled: boolean = true) {
  const list = useLoadMoreList<TeacherPaymentEntry>(["teacher", "payments", "history"], '/payments/history', { enabled })
  return { history: list.rows, loading: list.loading, isFetching: list.isFetching, isError: list.isError, refetch: list.refetch, hasMore: list.hasMore, loadMore: list.loadMore, loadingMore: list.loadingMore }
}

export function useTeacherMaterials() {
  const query = useQuery({
    queryKey: ["teacher", "materials"],
    queryFn: async () => {
      const res = await api.get('/materials/my-materials')
      return res.data as TeacherMaterial[]
    },
  })

  return {
    materials: query.data ?? [],
    loading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    refetch: query.refetch,
  }
}

export function useMyWithdrawals() {
  const list = useLoadMoreList<WithdrawalHistoryItem>(["teacher", "wallet", "withdrawals"], '/payments/my-withdrawals')
  return { withdrawals: list.rows, loading: list.loading, isFetching: list.isFetching, isError: list.isError, refetch: list.refetch, hasMore: list.hasMore, loadMore: list.loadMore, loadingMore: list.loadingMore }
}

export function useMyIncome() {
  const list = useLoadMoreList<IncomeHistoryItem>(["teacher", "wallet", "income"], '/payments/my-income')
  return { income: list.rows, loading: list.loading, isFetching: list.isFetching, isError: list.isError, refetch: list.refetch, hasMore: list.hasMore, loadMore: list.loadMore, loadingMore: list.loadingMore }
}

// ─── Estudiantes del profesor (detalle completo) ─────────────────────────────
export function useTeacherStudentsFull() {
  const query = useQuery({
    queryKey: ["teacher", "students"],
    queryFn: async () => {
      return (await fetchAllPages<TeacherStudentFull>('/teachers/me/students-full')).rows
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
      // Los contadores (total, upcoming, completed) son globales: vienen en la primera página; las filas se piden
      // por páginas hasta completar el total.
      const { rows, firstBody } = await fetchAllPages<TeacherClass, TeacherClassesResponse>('/classes/teacher/classes', {
        params: {
          date: filters?.date || undefined,
          status_filter: filters?.status || undefined,
          include_history: filters?.includeHistory ? 'true' : undefined,
        },
        rows: (body) => body.classes,
      })
      return {
        classes: rows,
        total: firstBody.total as number,
        upcoming: firstBody.upcoming as number,
        completed: firstBody.completed as number,
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
  const query = useQuery({
    queryKey: ["teacher", "profile"],
    queryFn: async () => {
      const res = await api.get('/teachers/me/profile')
      return res.data as TeacherProfile
    },
  })

  return {
    profile: query.data ?? null,
    loading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    refetch: query.refetch,
  }
}

// ─── Usuario actual (datos base: username, email, teléfono, avatar, nacionalidad) ──
export interface CurrentUser {
  username: string
  email: string
  phone_number: string | null
  avatar: string | null
  nationality: string | null
  is_google_account?: boolean
}

export function useCurrentUser() {
  const qc = useQueryClient()
  const query = useQuery({
    queryKey: ["user", "me"],
    queryFn: () => fetchMe<CurrentUser>(qc),
  })

  return {
    user: query.data ?? null,
    loading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    refetch: query.refetch,
  }
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

// ─── Google Calendar status ──────────────────────────────────────────────────
export interface CalendarStatus {
  connected: boolean
  calendar_id: string | null
  last_sync_at: string | null
  sync_enabled: boolean
}

export function useCalendarStatus() {
  const query = useQuery({
    queryKey: ["teacher", "calendar", "status"],
    queryFn: async () => {
      const res = await api.get('/calendar/status')
      return res.data as CalendarStatus
    },
  })

  return {
    status: query.data ?? null,
    loading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    refetch: query.refetch,
  }
}

// ─── Tareas del profesor ──────────────────────────────────────────────────────
export interface TeacherHomeworkItem {
  id: number
  teacher_id: number
  title: string
  description: string
  due_date_utc: string
  is_active: boolean
  created_at: string
}

export function useTeacherHomework() {
  const query = useQuery({
    queryKey: ["teacher", "homework"],
    queryFn: async () => {
      const res = await api.get('/homework/my-homework')
      return res.data as TeacherHomeworkItem[]
    },
  })

  return {
    homeworks: query.data ?? [],
    loading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    refetch: query.refetch,
  }
}

export interface HomeworkSubmission {
  id: number
  homework_id: number
  student_id: number
  status: string // "pending" | "submitted" | "graded"
  submission: string | null
  submitted_at: string | null
  score: number | null
  feedback: string | null
  graded_at: string | null
  assigned_at: string
  student_name?: string
  student_username?: string
  student_avatar?: string | null
}

export function useHomeworkSubmissions(homeworkId: number | null) {
  const query = useQuery({
    queryKey: ["teacher", "homework", "submissions", homeworkId],
    queryFn: async () => {
      const res = await api.get(`/homework/${homeworkId}/submissions`)
      return res.data as HomeworkSubmission[]
    },
    enabled: homeworkId !== null,
  })

  return {
    submissions: query.data ?? [],
    loading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  }
}

// ─── Estudiantes del profesor (lista básica, reutilizable en modales) ────────
export interface TeacherStudentBasic {
  id: number
  user_id?: number
  username: string
  name: string
  surname: string
  avatar?: string | null
}

export function useTeacherStudentsBasic() {
  const query = useQuery({
    queryKey: ["teacher", "students", "basic"],
    queryFn: async () => {
      return (await fetchAllPages<TeacherStudentBasic>('/teachers/me/students')).rows
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

// ─── Paquetes del profesor ────────────────────────────────────────────────────
export interface TeacherPackage {
  id: number
  name: string
  subject: string
  description: string | null
  description_type: "paragraph" | "list"
  description_items: string[] | null
  icon: string
  color: string
  classes_count: number | null
  price: number
  price_per_class: number | null
  duration_minutes: number
  is_active: boolean
  allow_installments?: boolean
  installment_count?: number | null
  is_group?: boolean
  min_students?: number | null
  max_students?: number | null
  group_schedule_mode?: "manual" | "fixed"
  group_recurring_days_of_week?: number[] | null
  group_recurring_time_local?: string | null
}

export function useTeacherPackages() {
  const query = useQuery({
    queryKey: ["teacher", "packages"],
    queryFn: async () => {
      const res = await api.get('/packages/my-packages')
      return res.data as TeacherPackage[]
    },
  })

  return {
    packages: query.data ?? [],
    loading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    refetch: query.refetch,
  }
}

export interface TeacherEnrollmentCompliance {
  id: number
  student_id: number
  student_username: string
  student_name: string
  package_id: number
  package_name: string
  classes_used: number
  classes_total: number | null
  available_credits: number | null
  status: string
  completed_count: number
  no_show_count: number
  cancelled_late_count: number
  renewal_requested_package_name: string | null
  change_requested_package_name: string | null
  created_at: string
}

export function useTeacherEnrollments() {
  const query = useQuery({
    queryKey: ["teacher", "packages", "enrollments"],
    queryFn: async () => {
      return (await fetchAllPages<TeacherEnrollmentCompliance>('/packages/teacher/enrollments')).rows
    },
  })

  return {
    enrollments: query.data ?? [],
    loading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    refetch: query.refetch,
  }
}

// ─── Cohortes grupales del profesor ──────────────────────────────────────────
export interface TeacherCohortItem {
  id: number
  package_id: number
  package_name: string | null
  teacher_id: number
  start_date: string | null
  status: "filling" | "confirmed" | "in_progress" | "completed" | "cancelled"
  min_students: number
  max_students: number
  current_students: number
  created_at: string
  closed_at: string | null
}

export function useTeacherCohorts() {
  const query = useQuery({
    queryKey: ["teacher", "cohorts"],
    queryFn: async () => {
      return (await fetchAllPages<TeacherCohortItem>('/cohorts/teacher')).rows
    },
  })

  return {
    cohorts: query.data ?? [],
    loading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    refetch: query.refetch,
  }
}

// Integrantes de una cohorte (funciona incluso mientras está "filling",
// antes de que exista ninguna sesión agendada) — para mostrar en vivo
// quién se va uniendo al grupo a medida que se llena.
export interface CohortMember {
  enrollment_id: number
  student_id: number
  student_name: string
  student_avatar: string | null
  payment_status: string
  joined_at: string
}

export function useCohortMembers(cohortId: number | null) {
  const query = useQuery({
    queryKey: ["teacher", "cohort-members", cohortId],
    queryFn: async () => {
      const res = await api.get(`/cohorts/${cohortId}/members`)
      return res.data as CohortMember[]
    },
    enabled: cohortId !== null,
  })

  return {
    members: query.data ?? [],
    loading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    refetch: query.refetch,
  }
}

// ─── Reseñas del propio profesor (para la vista previa pública) ─────────────
export function useTeacherOwnReviews(username: string | undefined) {
  const query = useQuery({
    queryKey: ["teacher", "reviews", username],
    queryFn: async () => {
      const res = await api.get(`/reviews/${username}`)
      return Array.isArray(res.data) ? res.data : []
    },
    enabled: !!username,
  })

  return {
    reviews: query.data ?? [],
    loading: query.isLoading,
    refetch: query.refetch,
  }
}