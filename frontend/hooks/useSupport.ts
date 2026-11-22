import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";

import { fetchAllPages } from "@/lib/pagination";
import { useVisiblePolling, visiblePoll } from "@/lib/polling";
export type SupportCategory = "bug" | "error" | "question" | "other" | "class_correction";
export type SupportTicketStatus = "pending" | "answered";

export interface SupportTicket {
  id: number;
  category: SupportCategory;
  subject: string;
  message: string;
  screen_context: string | null;
  status: SupportTicketStatus;
  admin_response: string | null;
  created_at: string;
  resolved_at: string | null;
  user_notified_seen: boolean;
}

// ─── Mis tickets (student o teacher) ─────────────────────────────────────────
export function useMySupportTickets() {
  const query = useQuery({
    queryKey: ["support", "my-tickets"],
    queryFn: async () => {
      return (await fetchAllPages<SupportTicket>("/support/tickets/me")).rows;
    },
    // M15: antes solo se refrescaba al montar/reenfocar (staleTime global de
    // 60s + refetchOnWindowFocus desactivado), así que si el staff respondía
    // mientras el estudiante/profesor ya tenía la vista abierta, no se
    // enteraba hasta recargar la página a mano. Se sondea en segundo plano
    // mientras la pestaña esté visible, igual que useUnreadSupportCount.
    refetchInterval: visiblePoll(60000), // Fase 14: antes 20 s; el badge de no leídos avisa antes
  });

  return {
    tickets: query.data ?? [],
    loading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    refetch: query.refetch,
  };
}

// ─── Crear un ticket nuevo ────────────────────────────────────────────────────
export async function createSupportTicket(data: {
  category: SupportCategory;
  subject: string;
  message: string;
  screen_context?: string;
}) {
  const res = await api.post("/support/tickets", data);
  return res.data as SupportTicket;
}

// ─── Marcar como vista la respuesta de un ticket ─────────────────────────────
export async function markSupportTicketSeen(ticketId: number) {
  const res = await api.patch(`/support/tickets/${ticketId}/seen`);
  return res.data as SupportTicket;
}

// ─── Badge de no leídos (respondidos y aún no vistos) ────────────────────────
export function useUnreadSupportCount(enabled: boolean = true) {
  const [count, setCount] = useState(0);

  const fetchUnread = useCallback(() => {
    return api.get("/support/tickets/me/unread-count")
      .then(res => setCount(res.data.unread_count))
      .catch(() => {});
  }, []);

  // Cada 60 s solo con la pestaña visible, y al volver a ella (antes cada 30 s aunque estuviera oculta).
  useVisiblePolling(fetchUnread, 60000, enabled);

  // Si el hook está deshabilitado (ej. rol sin acceso a soporte), no mostramos
  // un conteo obtenido previamente en vez de resetear el estado dentro del efecto.
  return { count: enabled ? count : 0, refetch: fetchUnread };
}

