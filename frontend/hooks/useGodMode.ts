import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";
import { GodModeAction } from "@/lib/godModeActions";

export interface GodModeAuditLogEntry {
  id: number;
  actor_user_id: number;
  actor_name: string | null;
  actor_role: string;
  action: string;
  entity_type: string;
  entity_id: number;
  reason: string;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  created_at: string;
}

interface AuditLogFilters {
  entity_type?: string;
  action?: string;
  skip?: number;
  limit?: number;
}

// ─── Historial de auditoría ────────────────────────────────────────────────
export function useGodModeAuditLog(filters: AuditLogFilters = {}) {
  const query = useQuery({
    queryKey: ["god-mode", "audit-log", filters],
    queryFn: async () => {
      const res = await api.get("/god-mode/audit-log", { params: filters });
      return res.data as { items: GodModeAuditLogEntry[]; total: number; page: number; page_size: number };
    },
  });

  return {
    items: query.data?.items ?? [],
    total: query.data?.total ?? 0,
    loading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    refetch: query.refetch,
  };
}

// ─── Historial de una entidad puntual (ej. desde la ficha de un enrollment) ──
export function useGodModeEntityHistory(entityType: string, entityId: number | undefined) {
  const query = useQuery({
    queryKey: ["god-mode", "audit-log", entityType, entityId],
    queryFn: async () => {
      const res = await api.get(`/god-mode/audit-log/${entityType}/${entityId}`);
      return res.data as GodModeAuditLogEntry[];
    },
    enabled: !!entityId,
  });

  return {
    history: query.data ?? [],
    loading: query.isLoading,
    refetch: query.refetch,
  };
}

// ─── Lookup: selectores en cascada (profesor → alumno → enrollment/clase) ──
// Reemplazan los inputs de ID escritos a mano en el panel de Modo Dios.

export interface GodModeLookupTeacher {
  id: number;
  username: string;
  name: string;
  subjects: string[];
}

export interface GodModeLookupStudent {
  id: number;
  name: string;
  username: string;
}

export interface GodModeLookupEnrollment {
  id: number;
  package_name: string;
  subject: string | null;
  teacher_id: number;
  classes_used: number;
  classes_total: number | null;
  status: string;
  is_group: boolean;
  is_unlimited: boolean;
  unlocked_credits: number;
  prepaid_unlimited_credits: number;
}

export interface GodModeLookupClass {
  id: number;
  enrollment_id: number | null;
  subject: string | null;
  start_time_utc: string;
  duration: number;
  status: string;
  class_type: string;
}

export function useGodModeTeachers() {
  const query = useQuery({
    queryKey: ["god-mode", "lookup", "teachers"],
    queryFn: async () => {
      const res = await api.get("/god-mode/lookup/teachers");
      return res.data as GodModeLookupTeacher[];
    },
  });
  return { teachers: query.data ?? [], loading: query.isLoading };
}

export function useGodModeTeacherStudents(teacherId: number | undefined) {
  const query = useQuery({
    queryKey: ["god-mode", "lookup", "teacher-students", teacherId],
    queryFn: async () => {
      const res = await api.get(`/god-mode/lookup/teachers/${teacherId}/students`);
      return res.data as GodModeLookupStudent[];
    },
    enabled: !!teacherId,
  });
  return { students: query.data ?? [], loading: query.isLoading };
}

export function useGodModeStudentEnrollments(studentId: number | undefined, teacherId: number | undefined) {
  const query = useQuery({
    queryKey: ["god-mode", "lookup", "student-enrollments", studentId, teacherId],
    queryFn: async () => {
      const res = await api.get(`/god-mode/lookup/students/${studentId}/enrollments`, {
        params: teacherId ? { teacher_id: teacherId } : undefined,
      });
      return res.data as GodModeLookupEnrollment[];
    },
    enabled: !!studentId,
  });
  return { enrollments: query.data ?? [], loading: query.isLoading };
}

export function useGodModePairClasses(teacherId: number | undefined, studentId: number | undefined) {
  const query = useQuery({
    queryKey: ["god-mode", "lookup", "pair-classes", teacherId, studentId],
    queryFn: async () => {
      const res = await api.get(`/god-mode/lookup/teachers/${teacherId}/students/${studentId}/classes`);
      return res.data as GodModeLookupClass[];
    },
    enabled: !!teacherId && !!studentId,
  });
  return { classes: query.data ?? [], loading: query.isLoading };
}

export interface GodModeLookupPackage {
  id: number;
  name: string;
  subject: string;
  classes_count: number | null;
  price: number;
  is_unlimited: boolean;
}

export function useGodModeTeacherPackages(teacherId: number | undefined) {
  const query = useQuery({
    queryKey: ["god-mode", "lookup", "teacher-packages", teacherId],
    queryFn: async () => {
      const res = await api.get(`/god-mode/lookup/teachers/${teacherId}/packages`);
      return res.data as GodModeLookupPackage[];
    },
    enabled: !!teacherId,
  });
  return { packages: query.data ?? [], loading: query.isLoading };
}

export interface GodModeLookupCohort {
  id: number;
  package_name: string;
  subject: string | null;
  status: string;
  current_students: number;
  max_students: number;
  start_date: string | null;
}

export function useGodModeTeacherCohorts(teacherId: number | undefined) {
  const query = useQuery({
    queryKey: ["god-mode", "lookup", "teacher-cohorts", teacherId],
    queryFn: async () => {
      const res = await api.get(`/god-mode/lookup/teachers/${teacherId}/cohorts`);
      return res.data as GodModeLookupCohort[];
    },
    enabled: !!teacherId,
  });
  return { cohorts: query.data ?? [], loading: query.isLoading };
}

export interface GodModeLookupPayment {
  id: number;
  amount_total: number;
  amount_teacher: number;
  status: string;
  payment_method: string;
  payment_type: string | null;
  is_manual_grant: boolean;
  created_at: string;
}

export function useGodModePairPayments(teacherId: number | undefined, studentId: number | undefined) {
  const query = useQuery({
    queryKey: ["god-mode", "lookup", "pair-payments", teacherId, studentId],
    queryFn: async () => {
      const res = await api.get(`/god-mode/lookup/teachers/${teacherId}/students/${studentId}/payments`);
      return res.data as GodModeLookupPayment[];
    },
    enabled: !!teacherId && !!studentId,
  });
  return { payments: query.data ?? [], loading: query.isLoading };
}

export interface GodModeClassDurations {
  allowed_class_durations: number[];
  trial_duration_minutes: number;
}

export function useGodModeClassDurations() {
  const query = useQuery({
    queryKey: ["god-mode", "lookup", "class-durations"],
    queryFn: async () => {
      const res = await api.get("/god-mode/lookup/class-durations");
      return res.data as GodModeClassDurations;
    },
  });
  return { durations: query.data ?? { allowed_class_durations: [], trial_duration_minutes: 25 }, loading: query.isLoading };
}

// ─── Ejecutar una acción del Modo Dios ─────────────────────────────────────
// Un único mutator genérico: la URL/método/body vienen del registro de
// acciones (lib/godModeActions.ts), no de 13 funciones distintas.
interface RunGodModeActionPayload {
  action: GodModeAction;
  pathValues: Record<string, string>;
  body: Record<string, unknown>;
}

export function useRunGodModeAction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ action, pathValues, body }: RunGodModeActionPayload) => {
      const url = action.buildUrl(pathValues);
      if (action.method === "delete") {
        // El endpoint de hard-delete recibe 'reason' como query param, no body
        const res = await api.delete(url, { params: { reason: body.reason } });
        return res.data;
      }
      const res = await api[action.method](url, body);
      return res.data;
    },
    onSuccess: () => {
      // Invalida TODO lo que empieza con "god-mode": el historial de
      // auditoría, pero también los lookups en cascada (créditos de un
      // enrollment, clases de un par profesor-alumno, etc). Sin esto,
      // después de ajustar créditos o crear una clase, los selectores
      // seguían mostrando los datos viejos hasta refrescar la página.
      queryClient.invalidateQueries({ queryKey: ["god-mode"] });
    },
  });
}
