import { useLoadMoreList } from "@/hooks/useLoadMoreList";

export interface AdminMaterial {
  id: number;
  teacher_id: number;
  title: string;
  description: string | null;
  category: string;
  level: string | null;
  file_url: string | null;
  file_type: string | null;
  file_size: number | null;
  created_at: string;
}

/** Materiales de cualquier profesor (solo superadmin), paginados en el servidor. */
export function useAdminMaterials(teacherId?: number, q?: string) {
  const params = { teacher_id: teacherId, q: q || undefined };
  return useLoadMoreList<AdminMaterial>(["admin", "materials", "list", params], "/materials/admin/list", { params });
}
