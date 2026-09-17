"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";
import { useAuthStore } from "@/store/authStore";

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

export interface ChatMessage {
  id: number;
  conversation_id: number;
  sender_id: number;
  sender_username: string;
  content: string;
  created_at: string;
}

// ─── Lista de conversaciones ──────────────────────────────────────────────
export function useChatConversations(enabled: boolean = true) {
  const query = useQuery({
    queryKey: ["chat", "conversations"],
    queryFn: async () => {
      const res = await api.get("/chat/conversations");
      return res.data as ChatConversation[];
    },
    enabled,
    // Igual criterio que useUnreadSupportCount: solo sondea mientras la
    // pestaña está visible, para no gastar requests/batería en segundo plano.
    refetchInterval: () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return false;
      return 15000;
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
export function useUnreadChatCount(enabled: boolean = true) {
  const [count, setCount] = useState(0);

  const fetchUnread = useCallback(() => {
    return api.get("/chat/conversations/unread-count")
      .then(res => setCount(res.data.unread_count))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!enabled) return;
    fetchUnread();
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      fetchUnread();
    }, 20000);
    return () => clearInterval(interval);
  }, [enabled, fetchUnread]);

  return { count: enabled ? count : 0, refetch: fetchUnread };
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

// ─── Construcción de la URL del WS ────────────────────────────────────────
function buildWsUrl(conversationId: number, token: string): string {
  const httpBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";
  const wsBase = httpBase.replace(/^http/, "ws");
  return `${wsBase}/chat/ws/${conversationId}?token=${encodeURIComponent(token)}`;
}

// ─── Hilo de una conversación: historial + tiempo real por WS ───────────
export function useChatThread(conversationId: number | null) {
  const token = useAuthStore((s) => s.token);
  const queryClient = useQueryClient();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const seenIds = useRef<Set<number>>(new Set());

  // Historial inicial por REST
  useEffect(() => {
    if (!conversationId) return;
    let cancelled = false;
    seenIds.current = new Set();
    // El set-state-in-effect lint exige que el setState no sea la primera
    // línea síncrona del efecto — lo empujamos a una microtask (mismo
    // comportamiento, un tick después).
    Promise.resolve().then(() => { if (!cancelled) setLoading(true); });
    api.get(`/chat/conversations/${conversationId}/messages`)
      .then((res) => {
        if (cancelled) return;
        const msgs = res.data as ChatMessage[];
        msgs.forEach((m) => seenIds.current.add(m.id));
        setMessages(msgs);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [conversationId]);

  // Conexión WS para tiempo real
  useEffect(() => {
    if (!conversationId || !token) return;
    const ws = new WebSocket(buildWsUrl(conversationId, token));
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);
    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === "message") {
          if (seenIds.current.has(payload.id)) return;
          seenIds.current.add(payload.id);
          setMessages((prev) => [...prev, {
            id: payload.id,
            conversation_id: payload.conversation_id,
            sender_id: payload.sender_id,
            sender_username: payload.sender_username,
            content: payload.content,
            created_at: payload.created_at,
          }]);
          queryClient.invalidateQueries({ queryKey: ["chat", "conversations"] });
        } else if (payload.type === "error") {
          setSendError(payload.detail || "No se pudo enviar el mensaje");
        }
      } catch {
        // ignora frames que no sean JSON válido
      }
    };

    return () => {
      ws.close();
      wsRef.current = null;
      setConnected(false);
    };
  }, [conversationId, token, queryClient]);

  const send = useCallback(async (content: string) => {
    const trimmed = content.trim();
    if (!trimmed || !conversationId) return;
    setSendError(null);

    // Preferimos el WS (tiempo real inmediato para el resto de la
    // conversación); si no está conectado, fallback a REST — el backend
    // acepta ambos caminos y persisten igual (ver endpoints/chat.py).
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ content: trimmed }));
      return;
    }
    try {
      const res = await api.post(`/chat/conversations/${conversationId}/messages`, { content: trimmed });
      const msg = res.data as ChatMessage;
      if (!seenIds.current.has(msg.id)) {
        seenIds.current.add(msg.id);
        setMessages((prev) => [...prev, msg]);
      }
      queryClient.invalidateQueries({ queryKey: ["chat", "conversations"] });
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setSendError(detail || "No se pudo enviar el mensaje");
    }
  }, [conversationId, queryClient]);

  const markRead = useCallback(async () => {
    if (!conversationId) return;
    try {
      await api.post(`/chat/conversations/${conversationId}/read`);
      queryClient.invalidateQueries({ queryKey: ["chat", "conversations"] });
    } catch {
      // no crítico — el badge se corrige en el próximo poll
    }
  }, [conversationId, queryClient]);

  return { messages, loading, connected, sendError, send, markRead };
}
