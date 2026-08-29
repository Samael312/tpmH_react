import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";

export type SupportCategory = "bug" | "error" | "question" | "other";
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
      const res = await api.get("/support/tickets/me");
      return res.data as SupportTicket[];
    },
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

  const fetch = useCallback(async () => {
    try {
      const res = await api.get("/support/tickets/me/unread-count");
      setCount(res.data.unread_count);
    } catch {}
  }, []);

  useEffect(() => {
    if (!enabled) return;
    fetch();
    const interval = setInterval(fetch, 30000); // refresco cada 30s
    return () => clearInterval(interval);
  }, [enabled, fetch]);

  // Si el hook está deshabilitado (ej. rol sin acceso a soporte), no mostramos
  // un conteo obtenido previamente en vez de resetear el estado dentro del efecto.
  return { count: enabled ? count : 0, refetch: fetch };
}

// ─── Helper para invalidar caché tras crear/ver un ticket ────────────────────
export function useSupportQueryInvalidation() {
  const queryClient = useQueryClient();
  return useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["support", "my-tickets"] });
  }, [queryClient]);
}
