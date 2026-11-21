import { useLoadMoreList } from "@/hooks/useLoadMoreList";
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";

export interface AdminClass {
  id: number;
  teacher_id: number;
  student_id: number | null;
  teacher_name: string | null;
  teacher_username: string | null;
  student_name: string | null;
  class_type: string;
  subject: string | null;
  start_time_utc: string;
  end_time_utc: string;
  duration_minutes: number;
  status: string;
  teacher_timezone: string | null;
  student_timezone: string | null;
  external_source: string | null;
}

export interface AdminClassFilters {
  teacherId?: number;
  studentQ?: string;
  dateFrom?: string;
  dateTo?: string;
  status?: string;
}

/** Clases de cualquier profesor/alumno (solo superadmin), paginadas en el servidor con «Cargar más». */
export function useAdminClasses(f: AdminClassFilters) {
  const params = {
    teacher_id: f.teacherId,
    student_q: f.studentQ || undefined,
    date_from: f.dateFrom || undefined,
    date_to: f.dateTo || undefined,
    status: f.status || undefined,
  };
  const list = useLoadMoreList<AdminClass, { classes: AdminClass[]; total: number }>(
    ["admin", "classes", "list", params],
    "/classes/admin/list",
    { params, rows: (b) => b.classes, totalOf: (b) => b.total },
  );
  return { classes: list.rows, ...list };
}

export interface LookupTeacher { id: number; username: string; name: string }

/** Profesores aprobados para el selector de filtros (superadmin). */
export function useLookupTeachers() {
  return useQuery({
    queryKey: ["admin", "lookup", "teachers"],
    queryFn: async () => {
      const out: LookupTeacher[] = [];
      for (let offset = 0; offset < 2000; offset += 200) {
        const { data } = await api.get<LookupTeacher[]>("/god-mode/lookup/teachers", { params: { limit: 200, offset } });
        out.push(...data);
        if (data.length < 200) break;
      }
      return out;
    },
  });
}
