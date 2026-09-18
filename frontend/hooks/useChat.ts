"use client";

import { useCallback, useEffect } from "react";
import { QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";
import { useAuthStore } from "@/store/authStore";
import { useChatStore, onChatMessage, ChatMessage as StoreChatMessage } from "@/store/chatStore";
import { decodeToken } from "@/lib/auth";

export interface ChatConversation {
  id: number;
  conversation_type: "direct" | "group";
  title: string;
  subtitle: string | null;
  avatar: string | null;
  other_username: string | null;
  cohort_id: number | null;
  last_message_preview: string | null;
  last_message_at: string | null;
  unread_count: number;
}

// Re-exportado desde el store para que los componentes de chat (
// ChatThreadView, etc.) no tengan que importar de dos lugares distintos.
// Incluye `status` ("sending" | "sent" | "delivered" | "failed") para los
// checkmarks — ver store/chatStore.ts.
export type ChatMessage = StoreChatMessage;

const CONVERSATIONS_KEY = ["chat", "conversations"] as const;
const UNREAD_KEY = ["chat", "unread-count"] as const;

// Marca un hilo como leído: primero quita la notificación en el cache
// local (instantáneo, como en Preply), luego confirma con el servidor y
// revalida. Se usa al ENTRAR a un hilo y cuando llega un mensaje mientras
// el usuario lo está mirando.
export async function markConversationRead(queryClient: QueryClient, conversationId: number) {
  const list = queryClient.getQueryData<ChatConversation[]>(CONVERSATIONS_KEY);
  const prevUnread = list?.find((c) => c.id === conversationId)?.unread_count ?? 0;
  if (prevUnread > 0) {
    queryClient.setQueryData<ChatConversation[]>(CONVERSATIONS_KEY, (old) =>
      old?.map((c) => (c.id === conversationId ? { ...c, unread_count: 0 } : c))
    );
    queryClient.setQueryData<number>(UNREAD_KEY, (n) => Math.max(0, (n ?? 0) - prevUnread));
  }
  try {
    await api.post(`/chat/conversations/${conversationId}/read`);
  } catch {
    // no crítico — se corrige en el próximo evento/poll
  }
  queryClient.invalidateQueries({ queryKey: CONVERSATIONS_KEY });
  queryClient.invalidateQueries({ queryKey: UNREAD_KEY });
}

// ─── Lista de conversaciones ──────────────────────────────────────────────
export function useChatConversations(enabled: boolean = true) {
  const query = useQuery({
    queryKey: [...CONVERSATIONS_KEY],
    queryFn: async () => {
      const res = await api.get("/chat/conversations");
      return res.data as ChatConversation[];
    },
    enabled,
    // El WS global (ver store/chatStore.ts + useChatSocketBootstrap acá
    // abajo) invalida este query apenas llega un mensaje nuevo o se marca
    // como leído — este polling queda como red de contención por si se
    // perdió algún evento (reconexión, pestaña que estuvo dormida, etc.),
    // ya no es la única vía de actualización.
    refetchInterval: () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return false;
      return 30000;
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

// ─── Badge de no leídos (para el NavBar / widget cerrado) ────────────────
//
// Antes: useState + setInterval propio, totalmente desacoplado de React
// Query — por eso ChatThreadView::markRead() nunca lo actualizaba al
// entrar a un chat (invalidaba ["chat","conversations"] pero este hook no
// escuchaba esa key). Ahora es un query más: se invalida desde markRead()
// Y desde el WS global (mensaje nuevo / entregado) — ver
// useChatSocketBootstrap.
export function useUnreadChatCount(enabled: boolean = true) {
  const query = useQuery({
    queryKey: [...UNREAD_KEY],
    queryFn: async () => {
      const res = await api.get("/chat/conversations/unread-count");
      return res.data.unread_count as number;
    },
    enabled,
    refetchInterval: () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return false;
      return 45000; // red de contención — ver comentario arriba
    },
  });

  return { count: enabled ? (query.data ?? 0) : 0, refetch: query.refetch };
}

// ─── Abrir/crear conversación directa o grupal ───────────────────────────
export async function openDirectConversation(username: string): Promise<ChatConversation> {
  const res = await api.get(`/chat/conversations/direct/${username}`);
  return res.data;
}

export async function openGroupConversation(cohortId: number): Promise<ChatConversation> {
  const res = await api.get(`/chat/conversations/group/${cohortId}`);
  return res.data;
}

// ─── Bootstrap de la conexión WS global ──────────────────────────────────
//
// Se llama UNA vez desde los layouts de student/teacher (junto a
// <ChatWidget/> y <NavBar/>) — abre (y mantiene) la conexión de
// store/chatStore.ts sin importar en qué pantalla del dashboard estés, y
// puentea sus eventos hacia React Query para que la lista de
// conversaciones y el badge de no leídos se actualicen en el momento.
export function useChatSocketBootstrap(enabled: boolean) {
  const token = useAuthStore((s) => s.token);
  const userId = useAuthStore((s) => (s.token ? Number(decodeToken(s.token)?.sub) : undefined));
  const queryClient = useQueryClient();
  const connect = useChatStore((s) => s.connect);
  const disconnect = useChatStore((s) => s.disconnect);

  useEffect(() => {
    if (!enabled || !token || !userId) {
      disconnect();
      return;
    }
    connect(token, userId);
    return () => disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, token, userId]);

  // Puente store → React Query, en dos capas:
  //  1) Al llegar un mensaje se actualiza YA el cache local (preview, hora,
  //     orden, contador de no leídos, badge, pulso del widget) — sin
  //     esperar ningún refetch.
  //  2) Además se revalida contra el servidor (debounced) para corregir
  //     cualquier desvío.
  useEffect(() => {
    if (!enabled) return;

    const offMessage = onChatMessage((m, isMine) => {
      // "Mirando" = ese hilo está abierto y la pestaña visible → se lee en
      // el acto. Cualquier otro caso queda como nuevo hasta que el usuario
      // entre a ese chat.
      const { activeConversationId } = useChatStore.getState();
      const viewing = !isMine && activeConversationId === m.conversation_id && document.visibilityState === "visible";
      const unread = !isMine && !viewing;

      const cached = queryClient.getQueryData<ChatConversation[]>(CONVERSATIONS_KEY);
      const known = !!cached?.some((c) => c.id === m.conversation_id);
      queryClient.setQueryData<ChatConversation[]>(CONVERSATIONS_KEY, (old) => {
        const current = old?.find((c) => c.id === m.conversation_id);
        if (!old || !current) return old;
        const updated: ChatConversation = {
          ...current,
          last_message_preview: m.content.slice(0, 140),
          last_message_at: m.created_at,
          unread_count: unread ? current.unread_count + 1 : current.unread_count,
        };
        return [updated, ...old.filter((c) => c.id !== m.conversation_id)];
      });
      // Conversación que todavía no estaba en la lista (la abrió la otra
      // persona): no hay nada que parchear, se trae completa.
      if (!known) queryClient.invalidateQueries({ queryKey: CONVERSATIONS_KEY });

      if (unread) {
        queryClient.setQueryData<number>(UNREAD_KEY, (n) => (n ?? 0) + 1);
        useChatStore.setState((s) => ({ pulseKey: s.pulseKey + 1 }));
      } else if (viewing) {
        void markConversationRead(queryClient, m.conversation_id);
      }
    });

    let timer: ReturnType<typeof setTimeout> | null = null;
    const offVersion = useChatStore.subscribe((state, prev) => {
      if (state.eventVersion === prev.eventVersion) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: CONVERSATIONS_KEY });
        queryClient.invalidateQueries({ queryKey: UNREAD_KEY });
      }, 1000);
    });

    return () => {
      offMessage();
      offVersion();
      if (timer) clearTimeout(timer);
    };
  }, [enabled, queryClient]);
}

// Referencia ESTABLE para "sin mensajes todavía" — si acá devolviéramos un
// `[]` literal en el selector de abajo, useSyncExternalStore (por debajo de
// zustand) recibiría un array nuevo en cada render y nunca vería el
// snapshot como estable, disparando "The result of getSnapshot should be
// cached to avoid an infinite loop" y, en cascada, "Maximum update depth
// exceeded" en quien consuma este hook (ver ChatThreadView).
const EMPTY_MESSAGES: StoreChatMessage[] = [];

// ─── Hilo de una conversación: cache local + tiempo real por WS global ───
export function useChatThread(conversationId: number | null) {
  const queryClient = useQueryClient();
  const messages = useChatStore((s) => (conversationId ? s.messagesByConversation[conversationId] ?? EMPTY_MESSAGES : EMPTY_MESSAGES));
  const connected = useChatStore((s) => s.connected);
  const storeSendError = useChatStore((s) => (conversationId ? s.errorByConversation[conversationId] ?? null : null));
  // `fetching`/`historyLoaded` viven en el store (no como useState acá)
  // para no tener que llamar setState de forma sincrónica dentro del
  // efecto de abajo — ver store/chatStore.ts::ensureHistory.
  const fetching = useChatStore((s) => (conversationId ? !!s.fetchingByConversation[conversationId] : false));
  const historyLoaded = useChatStore((s) => (conversationId ? !!s.historyLoadedByConversation[conversationId] : false));
  const ensureHistory = useChatStore((s) => s.ensureHistory);
  const sendToStore = useChatStore((s) => s.sendMessage);

  // Skeleton solo en la primerísima carga de este hilo (todavía sin nada
  // cacheado); en reaperturas dentro de la misma sesión, el historial ya
  // cacheado se muestra al instante y el delta se trae en silencio.
  const loading = fetching && !historyLoaded;

  useEffect(() => {
    if (!conversationId) return;
    ensureHistory(conversationId);
  }, [conversationId, ensureHistory]);

  const refetch = useCallback(() => {
    if (!conversationId) return Promise.resolve();
    return ensureHistory(conversationId);
  }, [conversationId, ensureHistory]);

  const send = useCallback((content: string) => {
    if (!conversationId || !content.trim()) return;
    sendToStore(conversationId, content);
  }, [conversationId, sendToStore]);

  const retry = useChatStore((s) => s.retryMessage);
  const retryMessage = useCallback((clientId: string) => {
    if (conversationId) retry(conversationId, clientId);
  }, [conversationId, retry]);

  const markRead = useCallback(async () => {
    if (!conversationId) return;
    await markConversationRead(queryClient, conversationId);
  }, [conversationId, queryClient]);

  return { messages, loading, isFetching: fetching, connected, sendError: storeSendError, send, retryMessage, markRead, refetch };
}
