import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";

export type BookingStage =
  | "loading"
  | "needs_trial"
  | "trial_in_progress"
  | "needs_package"
  | "package_pending_payment"
  | "needs_payment"
  | "needs_renewal"
  | "renew_required"
  | "renewal_pending"
  | "ready";

export interface RejectedPaymentInfo {
  payment_id: number;
  amount: number;
  payment_type: string | null;
  rejection_reason: string | null;
  rejected_at: string | null;
}
  
export interface StudentClass {
  id: number;
  class_type: "trial" | "regular" | "group";
  enrollment_id: number | null;
  subject: string | null;
  start_time_utc: string;
  end_time_utc: string;
  duration_minutes: number;
  status: string;
  meet_link: string | null;
  teacher_avatar?: string | null;
  teacher_name: string;
  teacher_username: string;
  teacher_nationality: string | null;
  package_name: string | null;
  class_count: string | null;
  teacher_phone?: string | null;
  cohort_id?: number | null;
  participant_count?: number | null;
  participant_names?: string[] | null;
}

export interface AvailableSlot {
  start_time_utc: string;
  end_time_utc: string;
  duration_minutes: number;
  is_preferred: boolean;
  is_available: boolean;
  is_past?: boolean;
  // Margen de preparación (min) reservado después de end_time_utc, y hasta
  // cuándo queda ocupada la agenda del profesor incluyéndolo. Informativo
  // — lo que se reserva/guarda siempre es start/end_time_utc (sin margen).
  buffer_minutes?: number;
  block_end_time_utc?: string;
}

export interface StudentEnrollment {
  id: number;
  package_id: number;
  package: {
    id: number;
    name: string;
    subject: string;
    description: string | null;
    description_type?: "text" | "list" | string | null;
    description_items?: string[] | null;
    color?: string | null;
    icon?: string | null;
    classes_count: number | null;
    installment_count?: number;
    price: number;
    duration_minutes: number;
    is_active: boolean;
    created_at: string;
    is_group?: boolean;
    min_students?: number | null;
    max_students?: number | null;
  };
  classes_used: number;
  unlocked_credits?: number;
  classes_total: number | null;
  prepaid_unlimited_credits?: number;
  available_credits?: number;
  status: string;
  installments_paid?: number;
  paid_via_installments?: boolean;
  total_installments?: number;
  pending_payment_notified?: boolean;
  renewal_requested?: boolean;
  requested_package_id?: number | null;
  payment_status?: string;
  teacher_name: string | null;
  teacher_username: string | null;
  teacher_avatar: string | null;
  created_at?: string;
  updated_at?: string;
  cohort_id?: number | null;
  cohort_status?: "filling" | "confirmed" | "in_progress" | "completed" | "cancelled" | null;
  cohort_start_date?: string | null;
  cohort_current_students?: number | null;
  cohort_max_students?: number | null;
  credit_balance_usd?: number | null;
}

export interface StudentMaterial {
  link_id: number;
  material_id: number;
  title: string;
  category: string;
  level: string;
  content: string;
  tags: { words?: string[] } | null;
  progress: string;
}

export interface StudentHomework {
  id: number;
  homework_id: number;
  student_id: number;
  status: string; // "pending" | "submitted" | "graded"
  submission: string | null;
  submitted_at: string | null;
  score: number | null;
  feedback: string | null;
  graded_at: string | null;
  assigned_at: string;
  homework: {
    id: number;
    teacher_id: number;
    title: string;
    description: string;
    due_date_utc: string;
    is_active: boolean;
    created_at: string;
  };
}

export interface TeacherResolution {
  loading: boolean;
  isSingleTenant: boolean;
  teacherUsername: string | null;
  hasChosenTeacher: boolean;
}

export interface TeacherPublicProfile {
  username: string;
  name: string;
  surname?: string | null;
  bio: string | null;
  title: string | null;
  video_url?: string | null;
  theme_color?: string | null;
  photo_url: string | null;
  languages: string[];
  subjects: string[];
  skills: string[];
  certificates: { title: string; year: string }[];
  social_links: Record<string, string>;
  average_rating: number;
  total_reviews: number;
}

export interface Review {
  id: number;
  student_name: string;
  rating: number;
  comment: string;
  created_at: string;
}

export function useStudentClasses(includeHistory = false) {
  const query = useQuery({
    queryKey: ["student", "classes", includeHistory],
    queryFn: async () => {
      const res = await api.get(`/classes/my-classes?include_history=${includeHistory}`);
      const rawData = res.data;
      return (Array.isArray(rawData) ? rawData : (rawData?.classes || rawData?.data || [])) as StudentClass[];
    },
  });

  return {
    classes: query.data ?? [],
    loading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    refetch: query.refetch,
  };
}

export interface MyTeacherInfo {
  teacher_username: string;
  name: string | null;
  surname: string | null;
  title: string | null;
  profile_photo_url: string | null;
  theme_color: string | null;
  stage: BookingStage;
  active_enrollment: {
    id: number;
    package_name: string | null;
    classes_used: number;
    classes_total: number | null;
    status: string;
  } | null;
}

export function useMyTeachers() {
  const query = useQuery({
    queryKey: ["student", "my-teachers"],
    queryFn: async () => {
      const [cfgRes, teachersRes] = await Promise.all([
        api.get("/admin/platform-config"),
        api.get("/users/me/teachers"),
      ]);
      return {
        isSingleTenant: !!cfgRes.data?.is_single_tenant,
        teachers: (Array.isArray(teachersRes.data) ? teachersRes.data : []) as MyTeacherInfo[],
      };
    },
  });

  const teachers = query.data?.teachers ?? [];

  return {
    loading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    isSingleTenant: query.data?.isSingleTenant ?? true,
    teachers,
    hasAnyTeacher: teachers.length > 0,
    refetch: query.refetch,
  };
}

export function useAvailableSlots(
  date: string,
  duration: number,
  teacherUsername: string | null,
  classType: "trial" | "regular" | "group" = "regular",
) {
  const query = useQuery({
    queryKey: ["student", "available-slots", teacherUsername, date, duration, classType],
    queryFn: async () => {
      const res = await api.get(
        `/availability/${teacherUsername}/slots?date=${date}&duration=${duration}&class_type=${classType}`
      );
      return res.data as AvailableSlot[];
    },
    enabled: !!date && !!teacherUsername,
  });

  return {
    slots: query.data ?? [],
    loading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    refetch: query.refetch,
  };
}

export function useEnrollments() {
  const query = useQuery({
    queryKey: ["student", "enrollments"],
    queryFn: async () => {
      const res = await api.get("/packages/my-enrollments");
      return res.data as StudentEnrollment[];
    },
  });

  return {
    enrollments: query.data ?? [],
    loading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    refetch: query.refetch,
  };
}

// ─── Estado del flujo de reserva (trial → paquete → pago → listo) ────────────
export function useBookingStage() {
  const query = useQuery({
    queryKey: ["student", "booking-status"],
    queryFn: async () => {
      const res = await api.get("/payments/booking-status");
      return {
        stage: res.data.stage as BookingStage,
        lastRejectedPayment: (res.data.last_rejected_payment ?? null) as RejectedPaymentInfo | null,
      };
    },
  });

  return {
    // Preserva el fallback original: si falla, se asume "ready" en vez de
    // bloquear la pantalla indefinidamente.
    stage: query.isError ? ("ready" as BookingStage) : (query.data?.stage ?? "loading"),
    lastRejectedPayment: query.isError ? null : (query.data?.lastRejectedPayment ?? null),
    isFetching: query.isFetching,
    isError: query.isError,
    refetch: query.refetch,
  };
}

// ─── Estado del flujo de reserva, con soporte multi-profesor ─────────────────
export interface BookingStatusInfo {
  stage: BookingStage;
  enrollmentId: number | null;
  lastRejectedPayment: RejectedPaymentInfo | null;
}

export function useBookingStatusFor(teacherUsername: string | null, isSingleTenant: boolean, ready: boolean = true) {
  // `ready` debe ser false mientras useMyTeachers() aún no resuelve. Su
  // `isSingleTenant` cae en un fallback optimista (`true`) antes de tener
  // datos reales; sin esta guarda, este hook se habilitaba de inmediato con
  // ese fallback y disparaba una primera petición con teacherUsername=null,
  // para luego volver a dispararse (con la queryKey ya cambiada) en cuanto
  // useMyTeachers() resolvía y seteaba el teacherUsername real — es decir,
  // dos cargas casi seguidas de /payments/booking-status.
  const enabled = ready && (isSingleTenant || !!teacherUsername);

  const query = useQuery({
    queryKey: ["student", "booking-status", teacherUsername ?? "single-tenant"],
    queryFn: async () => {
      const params = teacherUsername ? `?teacher_username=${teacherUsername}` : "";
      const res = await api.get(`/payments/booking-status${params}`);
      return {
        stage: res.data.stage as BookingStage,
        enrollmentId: res.data.enrollment_id ?? null,
        lastRejectedPayment: (res.data.last_rejected_payment ?? null) as RejectedPaymentInfo | null,
      } as BookingStatusInfo;
    },
    enabled,
  });

  return {
    // Preserva el fallback original: si falla, se asume "ready" en vez de
    // bloquear la pantalla indefinidamente. Si aún no hay condiciones para
    // consultar (falta elegir profesor), se muestra "loading".
    stage: !enabled ? ("loading" as BookingStage) : query.isError ? ("ready" as BookingStage) : (query.data?.stage ?? "loading"),
    enrollmentId: query.data?.enrollmentId ?? null,
    lastRejectedPayment: query.isError ? null : (query.data?.lastRejectedPayment ?? null),
    isFetching: query.isFetching,
    isError: query.isError,
    refetch: query.refetch,
  };
}

// ─── Paquetes disponibles de un profesor (modal de cambio de paquete) ────────
export function useTeacherPackagesFor(teacherUsername: string | undefined, enabled: boolean) {
  const query = useQuery({
    queryKey: ["student", "teacher-packages", teacherUsername],
    queryFn: async () => {
      const res = await api.get(`/packages/teacher/${teacherUsername}`);
      return (res.data || []) as any[];
    },
    enabled: enabled && !!teacherUsername,
  });

  return {
    packages: query.data ?? [],
    loading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}

export interface MaterialAssignmentFull {
  id: number;
  material_id: number;
  student_id: number;
  progress: string;
  assigned_at: string;
  completed_at?: string;
  material: {
    id: number;
    title: string;
    description?: string;
    category: string;
    level?: string;
    file_url?: string;
    vocabulary_words?: string[];
  };
}

export function useStudentMaterials() {
  const query = useQuery({
    queryKey: ["student", "materials"],
    queryFn: async () => {
      const res = await api.get("/materials/student/my-materials");
      return res.data as MaterialAssignmentFull[];
    },
  });

  return {
    materials: query.data ?? [],
    loading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    refetch: query.refetch,
  };
}

export function useStudentHomework() {
  const query = useQuery({
    queryKey: ["student", "homework"],
    queryFn: async () => {
      const res = await api.get("/homework/student/my-homework");
      return res.data as StudentHomework[];
    },
  });

  return {
    homeworks: query.data ?? [],
    loading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    refetch: query.refetch,
  };
}

// ─── Preferencias horarias del estudiante ────────────────────────────────────
export interface StudentPreference {
  day_of_week: number;
  start_time_utc: string;
  end_time_utc: string;
}

// Referencia estable para el fallback: si se usara `?? []` inline, cada
// render mientras query.data es undefined crearía un array nuevo, y como
// availability/page.tsx usa `preferences` como dependencia de un useEffect,
// eso disparaba el efecto en cada render -> setState -> nuevo render ->
// nuevo [] -> loop infinito ("Maximum update depth exceeded").
const EMPTY_PREFERENCES: StudentPreference[] = [];

export function useStudentPreferences() {
  const query = useQuery({
    queryKey: ["student", "preferences"],
    queryFn: async () => {
      const res = await api.get("/users/me/preferences");
      return res.data as StudentPreference[];
    },
  });

  return {
    preferences: query.data ?? EMPTY_PREFERENCES,
    loading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    refetch: query.refetch,
  };
}

// ─── Perfil del estudiante (usuario + student-profile combinados) ───────────
export interface StudentProfileData {
  user: any;
  studentProfile: any;
}

export function useStudentProfileData() {
  const query = useQuery({
    queryKey: ["student", "profile"],
    queryFn: async () => {
      const [userRes, studentRes] = await Promise.all([
        api.get("/users/me"),
        api.get("/users/me/student-profile"),
      ]);
      return { user: userRes.data, studentProfile: studentRes.data } as StudentProfileData;
    },
  });

  return {
    data: query.data ?? null,
    loading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    refetch: query.refetch,
  };
}

export function useFeaturedTeacher() {
  const query = useQuery({
    queryKey: ["student", "featured-teacher"],
    queryFn: async () => {
      const username = process.env.NEXT_PUBLIC_FEATURED_TEACHER_USERNAME ?? "mar12";
      const [tRes, rRes] = await Promise.all([
        api.get(`/teachers/${username}`),
        api.get(`/reviews/${username}`),
      ]);
      return {
        teacher: tRes.data as TeacherPublicProfile,
        reviews: rRes.data as Review[],
      };
    },
  });

  return {
    teacher: query.data?.teacher ?? null,
    reviews: query.data?.reviews ?? [],
    loading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    refetch: query.refetch,
  };
}

export interface TeacherDirectoryItem {
  user_username: string;
  name?: string;
  surname?: string;
  bio: string | null;
  title: string | null;
  profile_photo_url: string | null;
  languages: string[];
  subjects: string[];
  skills: string[];
  average_rating?: number;
  total_reviews?: number;
  nationality?: string | null; 
}

export function useTeacherDirectory() {
  const query = useQuery({
    queryKey: ["student", "teacher-directory"],
    queryFn: async () => {
      const res = await api.get("/teachers/");
      const list: TeacherDirectoryItem[] = res.data || [];

      const withRatings = await Promise.all(
        list.map(async (t) => {
          try {
            const r = await api.get(`/reviews/${t.user_username}/summary`);
            return {
              ...t,
              average_rating: r.data.average_rating,
              total_reviews: r.data.total_reviews,
            };
          } catch {
            return t;
          }
        })
      );
      return withRatings;
    },
  });

  return {
    teachers: query.data ?? [],
    loading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    refetch: query.refetch,
  };
}

export interface PlatformConfigInfo {
  platform_name: string;
  platform_tagline: string | null;
  is_single_tenant: boolean;
  featured_teacher: {
    username: string;
    name: string;
    title: string | null;
    bio: string | null;
    avatar: string | null;
    subjects: string[];
  } | null;
}

export function usePlatformConfig() {
  const query = useQuery({
    queryKey: ["student", "platform-config"],
    queryFn: async () => {
      const res = await api.get("/admin/platform-config");
      return res.data as PlatformConfigInfo;
    },
  });

  return {
    config: query.data ?? null,
    loading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    refetch: query.refetch,
  };
}