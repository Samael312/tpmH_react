"use client";

// hooks/useChatAdmin.ts
//
// N5: panel de auditoría de chats para superadmin/teacher_admin — ver
// backend/app/api/v1/endpoints/chat.py (sección "N5: Auditoría"). Listar
// conversaciones es solo metadata (no requiere motivo); ver los mensajes
// de una conversación puntual SÍ exige `reason` y queda registrado en
// GodModeAuditLog (entity_type="chat_conversation") — reutilizable desde
// components/god-mode/GodModeAuditLogViewer.tsx y
// hooks/useGodMode.ts::useGodModeEntityHistory sin cambios ahí.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";
import { ChatMessage } from "@/store/chatStore";

export interface ChatConversationAdmin {
  id: number;
  conversation_type: "direct" | "group";
  title: string;
  subtitle: string | null;
  teacher_username: string | null;
  teacher_name: string | null;
  student_username: string | null;
  student_name: string | null;
  cohort_id: number | null;
  last_message_preview: string | null;
  last_message_at: string | null;
  message_count: number;
}

export function useChatAdminConversations(filters: { teacher_username?: string; student_username?: string }) {
  const query = useQuery({
    queryKey: ["chat", "admin", "conversations", filters],
    queryFn: async () => {
      const res = await api.get("/chat/admin/conversations", { params: filters });
      return res.data as ChatConversationAdmin[];
    },
  });

  return {
    conversations: query.data ?? [],
    loading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    refetch: query.refetch,
  };
}

// Los mensajes de una conversación auditada NO se guardan en
// store/chatStore.ts (ese cache es para el chat normal, en primera
// persona) — viven en su propio query de React Query, atado al `reason`
// con el que se pidieron, para que cambiar de motivo dispare un fetch
// (y un registro de auditoría) nuevo en vez de servir una respuesta
// vieja cacheada bajo otro motivo.
export function useChatAdminMessages(conversationId: number | null, reason: string | null) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["chat", "admin", "messages", conversationId, reason],
    queryFn: async () => {
      const res = await api.get(`/chat/admin/conversations/${conversationId}/messages`, {
        params: { reason },
      });
      return res.data as ChatMessage[];
    },
    enabled: !!conversationId && !!reason,
    // Cada refetch vuelve a pegarle al endpoint (y por lo tanto vuelve a
    // auditarse) — no tiene sentido cachear "ver mensajes ajenos" por
    // mucho tiempo.
    staleTime: 0,
  });

  return {
    messages: query.data ?? [],
    loading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    refetch: query.refetch,
    // Al pedir el mismo hilo con un motivo nuevo, invalidamos cualquier
    // query anterior de este conversationId (con otros motivos) para no
    // dejar cache viejo dando vueltas sin uso.
    invalidateOthers: () => queryClient.invalidateQueries({
      queryKey: ["chat", "admin", "messages", conversationId],
      exact: false,
    }),
  };
}
