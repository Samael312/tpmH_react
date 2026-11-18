import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";
import { useLoadMoreList } from "@/hooks/useLoadMoreList";

/** Aviso dirigido al profesor (p. ej. clases que pasaron solas a «No asistió»). */
export interface TeacherNotification {
  id: number;
  type: string;
  title: string;
  message: string | null;
  is_read: boolean;
  created_at: string;
}

const KEY = ["teacher", "notifications"] as const;

/**
 * Número de avisos sin leer para el badge del menú. Sin sondeo periódico: los avisos nacen de un job que corre
 * pocas veces al día, así que basta con consultarlo al cargar y al volver a la pestaña (no despierta la BD en vano).
 */
export function useTeacherUnreadNotificationCount(enabled: boolean = true) {
  const query = useQuery({
    queryKey: [...KEY, "unread-count"],
    queryFn: async () => (await api.get("/teachers/me/notifications/unread-count")).data.unread_count as number,
    enabled,
    staleTime: 60_000,
  });
  return { count: enabled ? query.data ?? 0 : 0, refetch: query.refetch };
}

export function useTeacherNotifications() {
  const qc = useQueryClient();
  const list = useLoadMoreList<TeacherNotification>([...KEY, "list"], "/teachers/me/notifications");

  const invalidate = () => qc.invalidateQueries({ queryKey: KEY });
  const markRead = useMutation({
    mutationFn: async (id: number) => api.patch(`/teachers/me/notifications/${id}/read`),
    onSuccess: invalidate,
  });
  const markAllRead = useMutation({
    mutationFn: async () => api.post("/teachers/me/notifications/mark-all-read"),
    onSuccess: invalidate,
  });

  return { ...list, notifications: list.rows, markRead: markRead.mutate, markAllRead: markAllRead.mutate, marking: markRead.isPending || markAllRead.isPending };
}
