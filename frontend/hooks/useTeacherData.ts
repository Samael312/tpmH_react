import api from '@/lib/api'
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"

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
export function useTeacherPendingPayments(enabled: boolean = true) {
  const query = useQuery({
    queryKey: ["teacher", "payments", "pending"],
    queryFn: async () => {
      const res = await api.get('/payments/pending-review')
      return res.data as any[]
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
  const query = useQuery({
    queryKey: ["teacher", "payments", "history"],
    queryFn: async () => {
      const res = await api.get('/payments/history')
      return res.data as any[]
    },
    enabled,
  })

  return {
    history: query.data ?? [],
    loading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    refetch: query.refetch,
  }
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
  const query = useQuery({
    queryKey: ["teacher", "wallet", "withdrawals"],
    queryFn: async () => {
      const res = await api.get('/payments/my-withdrawals')
      return res.data as WithdrawalHistoryItem[]
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

export function useMyIncome() {
  const query = useQuery({
    queryKey: ["teacher", "wallet", "income"],
    queryFn: async () => {
      const res = await api.get('/payments/my-income')
      return res.data as IncomeHistoryItem[]
    },
  })

  return {
    income: query.data ?? [],
    loading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    refetch: query.refetch,
  }
}

// ─── Estudiantes del profesor (detalle completo) ─────────────────────────────
export function useTeacherStudentsFull() {
  const query = useQuery({
    queryKey: ["teacher", "students"],
    queryFn: async () => {
      const res = await api.get('/teachers/me/students-full')
      return res.data as TeacherStudentFull[]
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
}

export function useCurrentUser() {
  const query = useQuery({
    queryKey: ["user", "me"],
    queryFn: async () => {
      const res = await api.get('/users/me')
      return res.data as CurrentUser
    },
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
      const res = await api.get('/teachers/me/students')
      return res.data as TeacherStudentBasic[]
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
  duration_minutes: number
  is_active: boolean
  allow_installments?: boolean
  installment_count?: number | null
  is_group?: boolean
  min_students?: number | null
  max_students?: number | null
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
      const res = await api.get('/packages/teacher/enrollments')
      return res.data as TeacherEnrollmentCompliance[]
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
      const res = await api.get('/cohorts/teacher')
      return res.data as TeacherCohortItem[]
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