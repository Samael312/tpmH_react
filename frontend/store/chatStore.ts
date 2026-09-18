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

// Si el eco del servidor no llega en este tiempo, el mensaje se reenvía por
// REST con el mismo client_id (idempotente en el backend — no se duplica).
const ACK_TIMEOUT_MS = 5000;
// Heartbeat: detecta sockets "zombie" (proxy que los cortó, móvil que
// durmió) que siguen en readyState OPEN pero ya no entregan nada.
const PING_INTERVAL_MS = 25000;
const PONG_TIMEOUT_MS = 8000;

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
  // Hilo que el usuario tiene abierto AHORA (ChatThreadView lo registra al
  // montar): un mensaje entrante en ese hilo se considera leído; en
  // cualquier otro queda como "nuevo" en la lista y suma al badge.
  activeConversationId: number | null;
  // Se incrementa con cada mensaje entrante que queda como no leído —
  // ChatWidget lo usa como `key` para reiniciar la animación de pulso.
  pulseKey: number;

  connect: (token: string, userId: number) => void;
  disconnect: () => void;
  reset: () => void;
  ensureHistory: (conversationId: number) => Promise<void>;
  sendMessage: (conversationId: number, content: string) => void;
  retryMessage: (conversationId: number, clientId: string) => void;
  setActiveConversation: (conversationId: number | null) => void;
}

// ─── Listeners de mensajes entrantes (los usa hooks/useChat.ts para
// actualizar el cache de React Query al instante, sin refetch) ───────────
type IncomingMessageListener = (message: ServerMessagePayload, isMine: boolean) => void;
const incomingListeners = new Set<IncomingMessageListener>();
export function onChatMessage(listener: IncomingMessageListener): () => void {
  incomingListeners.add(listener);
  return () => { incomingListeners.delete(listener); };
}

// ─── Estado de la conexión (fuera de zustand: no es serializable ni hay
// motivo para que dispare renders por sí solo) ───────────────────────────
let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
let currentToken: string | null = null;
let currentUserId: number | null = null;
let intentionalClose = false;
let hasConnectedOnce = false;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let pongTimer: ReturnType<typeof setTimeout> | null = null;
let lifecycleListenersAttached = false;

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
  activeConversationId: null,
  pulseKey: 0,

  connect: (token, userId) => {
    // Ya conectado con las mismas credenciales — no abrir un segundo socket.
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) && currentToken === token) {
      return;
    }
    get().disconnect();
    intentionalClose = false;
    currentToken = token;
    currentUserId = userId;
    attachLifecycleListeners();
    openSocket();
  },

  disconnect: () => {
    intentionalClose = true;
    currentToken = null;
    currentUserId = null;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    reconnectAttempts = 0;
    hasConnectedOnce = false;
    stopHeartbeat();
    detachLifecycleListeners();
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
      activeConversationId: null, pulseKey: 0,
    });
  },

  setActiveConversation: (conversationId) => set({ activeConversationId: conversationId }),

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
      try {
        ws.send(JSON.stringify({
          type: "send", conversation_id: conversationId, content: trimmed, client_id: clientId,
        }));
        // Sin eco a tiempo → REST con el mismo client_id (idempotente).
        setTimeout(() => {
          const stillSending = useChatStore.getState().messagesByConversation[conversationId]
            ?.some((m) => m.client_id === clientId && m.status === "sending");
          if (stillSending) postViaRest(conversationId, trimmed, clientId);
        }, ACK_TIMEOUT_MS);
        return;
      } catch { /* socket roto: cae al REST de abajo */ }
    }

    // Fallback REST — mismo camino en el backend (endpoints/chat.py::
    // post_message → _send_and_fanout) — para cuando el socket está
    // reconectando en ese instante puntual.
    postViaRest(conversationId, trimmed, clientId);
  },

  retryMessage: (conversationId, clientId) => {
    const msg = get().messagesByConversation[conversationId]?.find((m) => m.client_id === clientId);
    if (!msg || msg.status !== "failed") return;
    set((state) => ({
      messagesByConversation: {
        ...state.messagesByConversation,
        [conversationId]: (state.messagesByConversation[conversationId] ?? []).map((m) =>
          m.client_id === clientId ? { ...m, status: "sending" as const } : m
        ),
      },
      errorByConversation: { ...state.errorByConversation, [conversationId]: null },
    }));
    postViaRest(conversationId, msg.content, clientId);
  },
}));

function postViaRest(conversationId: number, content: string, clientId: string) {
  api.post(`/chat/conversations/${conversationId}/messages`, { content, client_id: clientId })
    .then((res) => {
      reconcileOptimistic(useChatStore.setState, conversationId, clientId, toClientMessage(res.data as ServerMessagePayload));
    })
    .catch(() => markFailed(clientId, "No se pudo enviar el mensaje"));
}

function markFailed(clientId: string, detail: string) {
  useChatStore.setState((state) => {
    const next = { ...state.messagesByConversation };
    let failedIn: number | null = null;
    for (const key of Object.keys(next)) {
      const convoId = Number(key);
      if (next[convoId].some((m) => m.client_id === clientId && m.status === "sending")) {
        next[convoId] = next[convoId].map((m) =>
          m.client_id === clientId ? { ...m, status: "failed" as const } : m
        );
        failedIn = convoId;
      }
    }
    if (failedIn === null) return {};
    return {
      messagesByConversation: next,
      errorByConversation: { ...state.errorByConversation, [failedIn]: detail },
    };
  });
}

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
    const prev = list[idx];
    // El "delivered" puede llegar antes que la respuesta REST — no lo pisamos.
    next[idx] = {
      ...real,
      client_id: clientId,
      status: prev.status === "delivered" ? "delivered" : real.status,
      delivered_at: prev.delivered_at ?? real.delivered_at,
    };
    return { messagesByConversation: { ...state.messagesByConversation, [conversationId]: next } };
  });
}

// ─── Conexión ────────────────────────────────────────────────────────────

function stopHeartbeat() {
  if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
  if (pongTimer) { clearTimeout(pongTimer); pongTimer = null; }
}

function scheduleReconnect(delay: number) {
  if (intentionalClose || !currentToken) return;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (!intentionalClose && currentToken) openSocket();
  }, delay);
}

// Descarta un socket que dejó de responder y reconecta YA (sin esperar a
// que el navegador se dé cuenta, lo cual con un socket zombie puede tardar
// minutos).
function dropSocket(socket: WebSocket) {
  if (ws !== socket) return;
  stopHeartbeat();
  socket.onopen = socket.onclose = socket.onerror = socket.onmessage = null;
  try { socket.close(); } catch { /* noop */ }
  ws = null;
  useChatStore.setState({ connected: false });
  scheduleReconnect(0);
}

function probe(socket: WebSocket) {
  if (ws !== socket || socket.readyState !== WebSocket.OPEN) return;
  try {
    socket.send(JSON.stringify({ type: "ping" }));
  } catch {
    dropSocket(socket);
    return;
  }
  if (pongTimer) clearTimeout(pongTimer);
  pongTimer = setTimeout(() => dropSocket(socket), PONG_TIMEOUT_MS);
}

// Al volver a la pestaña o recuperar red, comprobamos la conexión en el
// acto (móvil: el SO suele haber matado el socket mientras dormía).
function handleWake() {
  if (intentionalClose || !currentToken) return;
  if (document.visibilityState === "hidden") return;
  if (ws && ws.readyState === WebSocket.OPEN) {
    probe(ws);
  } else if (!ws || ws.readyState === WebSocket.CLOSED) {
    reconnectAttempts = 0;
    scheduleReconnect(0);
  }
}

function attachLifecycleListeners() {
  if (lifecycleListenersAttached || typeof window === "undefined") return;
  document.addEventListener("visibilitychange", handleWake);
  window.addEventListener("online", handleWake);
  lifecycleListenersAttached = true;
}

function detachLifecycleListeners() {
  if (!lifecycleListenersAttached || typeof window === "undefined") return;
  document.removeEventListener("visibilitychange", handleWake);
  window.removeEventListener("online", handleWake);
  lifecycleListenersAttached = false;
}

// Tras una RE-conexión pudo haberse perdido algo: traemos el delta de los
// hilos cacheados y forzamos la revalidación de lista + badge.
function resyncAfterReconnect() {
  const state = useChatStore.getState();
  Object.keys(state.messagesByConversation).forEach((id) => { void state.ensureHistory(Number(id)); });
  useChatStore.setState((s) => ({ eventVersion: s.eventVersion + 1 }));
}

function openSocket() {
  if (!currentToken) return;
  const socket = new WebSocket(buildWsUrl(currentToken));
  ws = socket;

  socket.onopen = () => {
    reconnectAttempts = 0;
    useChatStore.setState({ connected: true });
    stopHeartbeat();
    pingTimer = setInterval(() => probe(socket), PING_INTERVAL_MS);
    if (hasConnectedOnce) resyncAfterReconnect();
    hasConnectedOnce = true;
  };

  socket.onclose = () => {
    useChatStore.setState({ connected: false });
    if (intentionalClose || ws !== socket) return;
    stopHeartbeat();
    // Backoff simple: 1s, 2s, 4s, 8s... tope 30s.
    const delay = Math.min(30000, 1000 * 2 ** reconnectAttempts);
    reconnectAttempts += 1;
    scheduleReconnect(delay);
  };

  socket.onerror = () => {
    // onclose se dispara igual después de un error — no duplicamos lógica acá.
  };

  socket.onmessage = (event) => {
    // Cualquier frame prueba que la conexión está viva.
    if (pongTimer) { clearTimeout(pongTimer); pongTimer = null; }

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
      incomingListeners.forEach((fn) => fn(data, isMine));
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
    } else if (payload.type === "error") {
      // El servidor rechazó el envío (chat deshabilitado, no participante,
      // etc.): sin esto el mensaje quedaba en "sending" para siempre.
      const clientId = payload.client_id as string | null | undefined;
      if (clientId) markFailed(clientId, (payload.detail as string) || "No se pudo enviar el mensaje");
    }
  };
}
