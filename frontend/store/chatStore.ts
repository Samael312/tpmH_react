"use client";

// store/chatStore.ts
//
// N3: reemplaza la conexión WS "por conversación" de hooks/useChat.ts por
// UNA sola conexión GLOBAL por sesión (ver backend/app/core/chat_ws.py y
// backend/app/api/v1/endpoints/chat.py::chat_websocket, ahora en
// `/chat/ws` sin conversation_id). Se conecta una vez desde los layouts
// de student/teacher (ver useChatSocketBootstrap más abajo) y se mantiene
// viva sin importar en qué pantalla estés.
//
// Esto resuelve, en un solo lugar:
//   - Punto 1 (checkmarks): cada mensaje que mando se agrega al estado
//     LOCAL de inmediato (optimista, status "sending"), sin esperar el
//     round-trip — el ícono pasa a reloj → check → doble check según los
//     eventos "message"/"delivered" que llegan por este mismo socket.
//   - Punto 3 (badge que no se limpia): emite un evento cada vez que
//     cambia algo relevante para que quien lo use (hooks/useChat.ts)
//     pueda invalidar los queries de React Query en el momento, no en el
//     próximo poll.
//   - Punto 4 (historial lento): `messagesByConversation` actúa como
//     cache en memoria de toda la sesión — la primera vez que se abre un
//     hilo se trae completo (últimos 50), y las siguientes veces
//     (mientras no se recargue la página) solo se pide el delta con
//     `after_id` (ver core/chat.py::get_messages).
//
// DECISIÓN DELIBERADA: este cache vive solo en memoria (no localStorage
// ni IndexedDB) y se resetea en logout / recarga de página. Persistirlo
// en disco significaría dejar contenido de mensajes privados tirado en
// el navegador después de cerrar sesión — en una compu compartida, el
// siguiente usuario podría inspeccionarlo aunque la UI nunca se lo
// muestre. Si más adelante quieren cache entre recargas, IndexedDB +
// borrado explícito en logout es el camino, pero es un trade-off a
// decidir a propósito, no un default.

import { create } from "zustand";
import api from "@/lib/api";

export type ChatMessageStatus = "sending" | "sent" | "delivered" | "failed";

export interface ChatMessage {
  // Mientras status === "sending" este id es un placeholder negativo
  // (nunca choca con un id real de la base, que siempre es positivo) —
  // se reemplaza por el id real apenas el servidor confirma el mensaje.
  id: number;
  client_id?: string;
  conversation_id: number;
  sender_id: number;
  sender_username: string;
  content: string;
  created_at: string;
  delivered_at: string | null;
  status: ChatMessageStatus;
}

interface ServerMessagePayload {
  id: number;
  conversation_id: number;
  sender_id: number;
  sender_username: string;
  content: string;
  created_at: string;
  delivered_at: string | null;
  client_id?: string | null;
}

const MAX_CACHED_PER_CONVERSATION = 300;

function toClientMessage(m: ServerMessagePayload): ChatMessage {
  return {
    id: m.id,
    conversation_id: m.conversation_id,
    sender_id: m.sender_id,
    sender_username: m.sender_username,
    content: m.content,
    created_at: m.created_at,
    delivered_at: m.delivered_at ?? null,
    status: m.delivered_at ? "delivered" : "sent",
  };
}

function capList(list: ChatMessage[]): ChatMessage[] {
  if (list.length <= MAX_CACHED_PER_CONVERSATION) return list;
  return list.slice(list.length - MAX_CACHED_PER_CONVERSATION);
}

// ─── Estado ────────────────────────────────────────────────────────────
interface ChatStoreState {
  connected: boolean;
  // Se incrementa en cada evento entrante relevante (mensaje nuevo,
  // entrega confirmada). hooks/useChat.ts lo escucha para invalidar los
  // queries de React Query (lista de conversaciones, badge de no
  // leídos) en el momento — ver useChatSocketBootstrap.
  eventVersion: number;
  messagesByConversation: Record<number, ChatMessage[]>;
  errorByConversation: Record<number, string | null>;
  // true mientras hay un fetch (inicial o delta) en curso para ese hilo —
  // vive ACÁ, no como useState en el componente, para no violar
  // react-hooks/set-state-in-effect (no hay forma "limpia" de derivar
  // esto en el hook sin llamar setState sincrónicamente en el efecto).
  fetchingByConversation: Record<number, boolean>;
  // true una vez que se hizo al menos el fetch inicial completo de ese
  // hilo EN ESTA SESIÓN — así el hook sabe si mostrar skeleton (primera
  // vez) o solo refrescar en silencio (ya estaba cacheado).
  historyLoadedByConversation: Record<number, boolean>;

  connect: (token: string, userId: number) => void;
  disconnect: () => void;
  reset: () => void;
  ensureHistory: (conversationId: number) => Promise<void>;
  sendMessage: (conversationId: number, content: string) => void;
}

// ─── Estado de la conexión (fuera de zustand: no es serializable ni hay
// motivo para que dispare renders por sí solo) ───────────────────────────
let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
let currentToken: string | null = null;
let currentUserId: number | null = null;
let intentionalClose = false;

function buildWsUrl(token: string): string {
  const httpBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";
  const wsBase = httpBase.replace(/^http/, "ws");
  return `${wsBase}/chat/ws?token=${encodeURIComponent(token)}`;
}

export const useChatStore = create<ChatStoreState>()((set, get) => ({
  connected: false,
  eventVersion: 0,
  messagesByConversation: {},
  errorByConversation: {},
  fetchingByConversation: {},
  historyLoadedByConversation: {},

  connect: (token, userId) => {
    // Ya conectado con las mismas credenciales — no abrir un segundo socket.
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) && currentToken === token) {
      return;
    }
    get().disconnect();
    intentionalClose = false;
    currentToken = token;
    currentUserId = userId;
    openSocket(set, get);
  },

  disconnect: () => {
    intentionalClose = true;
    currentToken = null;
    currentUserId = null;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    reconnectAttempts = 0;
    if (ws) {
      try { ws.close(); } catch { /* noop */ }
      ws = null;
    }
    set({ connected: false });
  },

  reset: () => {
    get().disconnect();
    set({
      messagesByConversation: {}, errorByConversation: {}, eventVersion: 0,
      fetchingByConversation: {}, historyLoadedByConversation: {},
    });
  },

  ensureHistory: async (conversationId) => {
    set((state) => ({ fetchingByConversation: { ...state.fetchingByConversation, [conversationId]: true } }));
    try {
      const cached = get().messagesByConversation[conversationId];
      if (!cached || cached.length === 0) {
        const res = await api.get(`/chat/conversations/${conversationId}/messages`);
        const msgs = (res.data as ServerMessagePayload[]).map(toClientMessage);
        set((state) => ({
          messagesByConversation: { ...state.messagesByConversation, [conversationId]: msgs },
          historyLoadedByConversation: { ...state.historyLoadedByConversation, [conversationId]: true },
        }));
        return;
      }
      // Ya lo teníamos cacheado en esta sesión: solo pedimos lo nuevo
      // desde el último id real que tenemos (los "sending" tienen id
      // negativo, se ignoran para este cálculo).
      const lastRealId = cached.reduce((max, m) => (m.id > max ? m.id : max), 0);
      const res = await api.get(`/chat/conversations/${conversationId}/messages`, {
        params: { after_id: lastRealId },
      });
      const fresh = (res.data as ServerMessagePayload[]).map(toClientMessage);
      if (fresh.length > 0) {
        set((state) => {
          const existingIds = new Set(state.messagesByConversation[conversationId]?.map((m) => m.id) ?? []);
          const merged = [
            ...(state.messagesByConversation[conversationId] ?? []),
            ...fresh.filter((m) => !existingIds.has(m.id)),
          ];
          return {
            messagesByConversation: { ...state.messagesByConversation, [conversationId]: capList(merged) },
          };
        });
      }
      set((state) => ({ historyLoadedByConversation: { ...state.historyLoadedByConversation, [conversationId]: true } }));
    } finally {
      set((state) => ({ fetchingByConversation: { ...state.fetchingByConversation, [conversationId]: false } }));
    }
  },

  sendMessage: (conversationId, content) => {
    const trimmed = content.trim();
    if (!trimmed || !currentUserId) return;

    const clientId = crypto.randomUUID();
    const optimistic: ChatMessage = {
      id: -Date.now() - Math.floor(Math.random() * 1000),
      client_id: clientId,
      conversation_id: conversationId,
      sender_id: currentUserId,
      sender_username: "",
      content: trimmed,
      created_at: new Date().toISOString(),
      delivered_at: null,
      status: "sending",
    };

    set((state) => ({
      messagesByConversation: {
        ...state.messagesByConversation,
        [conversationId]: capList([...(state.messagesByConversation[conversationId] ?? []), optimistic]),
      },
      errorByConversation: { ...state.errorByConversation, [conversationId]: null },
    }));

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: "send", conversation_id: conversationId, content: trimmed, client_id: clientId,
      }));
      return;
    }

    // Fallback REST — mismo backend, misma persistencia (ver
    // endpoints/chat.py::post_message) — por si el socket está
    // reconectando en ese instante puntual.
    api.post(`/chat/conversations/${conversationId}/messages`, { content: trimmed })
      .then((res) => {
        const real = toClientMessage(res.data as ServerMessagePayload);
        reconcileOptimistic(useChatStore.setState, conversationId, clientId, real);
      })
      .catch(() => {
        useChatStore.setState((state) => ({
          messagesByConversation: {
            ...state.messagesByConversation,
            [conversationId]: (state.messagesByConversation[conversationId] ?? []).map((m) =>
              m.client_id === clientId ? { ...m, status: "failed" as const } : m
            ),
          },
          errorByConversation: { ...state.errorByConversation, [conversationId]: "No se pudo enviar el mensaje" },
        }));
      });
  },
}));

function reconcileOptimistic(
  setState: typeof useChatStore.setState,
  conversationId: number,
  clientId: string,
  real: ChatMessage,
) {
  setState((state) => {
    const list = state.messagesByConversation[conversationId] ?? [];
    const idx = list.findIndex((m) => m.client_id === clientId);
    if (idx === -1) {
      // Llegó el eco antes de que reconciliáramos (raro, pero por las
      // dudas no duplicamos si el id real ya está en la lista).
      if (list.some((m) => m.id === real.id)) return {};
      return {
        messagesByConversation: {
          ...state.messagesByConversation,
          [conversationId]: capList([...list, real]),
        },
      };
    }
    const next = [...list];
    next[idx] = { ...real, client_id: clientId };
    return { messagesByConversation: { ...state.messagesByConversation, [conversationId]: next } };
  });
}

function openSocket(
  set: (partial: Partial<ChatStoreState> | ((s: ChatStoreState) => Partial<ChatStoreState>)) => void,
  get: () => ChatStoreState,
) {
  if (!currentToken) return;
  const socket = new WebSocket(buildWsUrl(currentToken));
  ws = socket;

  socket.onopen = () => {
    reconnectAttempts = 0;
    set({ connected: true });
  };

  socket.onclose = () => {
    set({ connected: false });
    if (intentionalClose || ws !== socket) return;
    // Backoff simple: 1s, 2s, 4s, 8s... tope 30s — mismo criterio que el
    // resto del proyecto usa para polling en segundo plano (ver
    // hooks/useChat.ts / useUnreadSupportCount).
    const delay = Math.min(30000, 1000 * 2 ** reconnectAttempts);
    reconnectAttempts += 1;
    reconnectTimer = setTimeout(() => {
      if (!intentionalClose && currentToken) openSocket(set, get);
    }, delay);
  };

  socket.onerror = () => {
    // onclose se dispara igual después de un error — no duplicamos lógica acá.
  };

  socket.onmessage = (event) => {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(event.data);
    } catch {
      return;
    }

    if (payload.type === "message") {
      const data = payload as unknown as ServerMessagePayload;
      const isMine = data.sender_id === currentUserId;
      if (isMine && data.client_id) {
        reconcileOptimistic(useChatStore.setState, data.conversation_id, data.client_id, toClientMessage(data));
      } else {
        useChatStore.setState((state) => {
          const list = state.messagesByConversation[data.conversation_id] ?? [];
          if (list.some((m) => m.id === data.id)) return {};
          return {
            messagesByConversation: {
              ...state.messagesByConversation,
              [data.conversation_id]: capList([...list, toClientMessage(data)]),
            },
          };
        });
      }
      useChatStore.setState((state) => ({ eventVersion: state.eventVersion + 1 }));
    } else if (payload.type === "delivered") {
      const conversationId = payload.conversation_id as number | undefined;
      const id = payload.id as number;
      useChatStore.setState((state) => {
        const next = { ...state.messagesByConversation };
        const targetConvoId = conversationId ?? Object.keys(next).map(Number).find((cId) =>
          next[cId]?.some((m) => m.id === id)
        );
        if (targetConvoId == null || !next[targetConvoId]) return {};
        next[targetConvoId] = next[targetConvoId].map((m) =>
          m.id === id && m.status !== "delivered" ? { ...m, status: "delivered", delivered_at: m.delivered_at ?? new Date().toISOString() } : m
        );
        return { messagesByConversation: next, eventVersion: state.eventVersion + 1 };
      });
    }
    // "error": no rompe nada por sí solo — el mensaje ya quedó en
    // "sending" y el fallback REST (o un reintento manual) se encarga.
  };
}
