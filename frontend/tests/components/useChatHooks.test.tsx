/**
 * Hooks del chat: marcar leído (optimista + una petición por hilo), badge de no leídos, abrir conversaciones y el
 * puente WebSocket → React Query (mensaje nuevo, hilo abierto, conversación desconocida, revalidación con debounce).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";

const hoisted = vi.hoisted(() => ({ listeners: new Set<(m: unknown, mine: boolean) => void>() }));
vi.mock("@/store/chatStore", async (orig) => {
  const actual = await orig<typeof import("@/store/chatStore")>();
  return {
    ...actual,
    onChatMessage: (l: (m: unknown, mine: boolean) => void) => { hoisted.listeners.add(l); return () => { hoisted.listeners.delete(l); }; },
  };
});

import {
  markConversationRead, openDirectConversation, openGroupConversation, useChatSocketBootstrap, useChatThread, useUnreadChatCount,
  useChatConversations, fallbackPollInterval, type ChatConversation,
} from "@/hooks/useChat";
import { useChatStore } from "@/store/chatStore";
import { useAuthStore } from "@/store/authStore";
import { mockApi, callsTo } from "./fakeApi";
import { makeUser } from "./fakeApi";

const CONV = (id: number, unread = 0): ChatConversation => ({
  id, conversation_type: "direct", title: `C${id}`, subtitle: null, avatar: null, other_username: `u${id}`,
  cohort_id: null, last_message_preview: "viejo", last_message_at: "2026-01-01T00:00:00Z", unread_count: unread,
});
const MSG = (conversation_id: number, over: Record<string, unknown> = {}) => ({
  id: 1, conversation_id, sender_id: 9, sender_username: "otro", content: "Hola nuevo", created_at: "2026-02-01T00:00:00Z", delivered_at: null, ...over,
});

let qc: QueryClient;
const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  hoisted.listeners.clear();
  useChatStore.setState({ connected: false, activeConversationId: null, pulseKey: 0, eventVersion: 0, messagesByConversation: {} } as never);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("markConversationRead", () => {
  it("quita los no leídos del cache al instante y confirma con el servidor una sola vez", async () => {
    mockApi("post", "/chat/conversations/1/read", {});
    qc.setQueryData(["chat", "conversations"], [CONV(1, 3), CONV(2, 1)]);
    qc.setQueryData(["chat", "unread-count"], 4);
    await Promise.all([markConversationRead(qc, 1), markConversationRead(qc, 1)]);
    expect(qc.getQueryData<ChatConversation[]>(["chat", "conversations"])?.find((c) => c.id === 1)?.unread_count).toBe(0);
    expect(callsTo("post", "/chat/conversations/1/read")).toHaveLength(1);
  });

  it("un hilo sin no leídos no toca el contador global", async () => {
    mockApi("post", "/chat/conversations/2/read", {});
    qc.setQueryData(["chat", "conversations"], [CONV(2, 0)]);
    qc.setQueryData(["chat", "unread-count"], 5);
    await markConversationRead(qc, 2);
    expect(qc.getQueryData(["chat", "unread-count"])).toBe(5);
  });
});

describe("useUnreadChatCount y useChatConversations", () => {
  it("el contador viene del servidor; desactivado vale 0", async () => {
    mockApi("get", "/chat/conversations/unread-count", { unread_count: 7 });
    const on = renderHook(() => useUnreadChatCount(true), { wrapper });
    await waitFor(() => expect(on.result.current.count).toBe(7));
    const off = renderHook(() => useUnreadChatCount(false), { wrapper });
    expect(off.result.current.count).toBe(0);
  });

  it("la lista de conversaciones carga y marca error si falla", async () => {
    mockApi("get", "/chat/conversations", [CONV(1), CONV(2)]);
    const { result } = renderHook(() => useChatConversations(true), { wrapper });
    await waitFor(() => expect(result.current.conversations).toHaveLength(2));
    expect(result.current.isError).toBe(false);
  });

  it("con la pestaña oculta no hay polling de respaldo", () => {
    const spy = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    expect(fallbackPollInterval(30000, false)).toBe(false);
    spy.mockRestore();
  });
});

describe("abrir conversaciones", () => {
  it("directa y grupal piden su ruta y devuelven la conversación", async () => {
    mockApi("get", "/chat/conversations/direct/ana", CONV(1));
    mockApi("get", "/chat/conversations/group/4", CONV(4));
    expect((await openDirectConversation("ana")).id).toBe(1);
    expect((await openGroupConversation(4)).id).toBe(4);
  });
});

describe("useChatThread", () => {
  it("sin conversación no envía, no reintenta, no marca leído y refetch es no-op", async () => {
    const { result } = renderHook(() => useChatThread(null), { wrapper });
    result.current.send("hola");
    result.current.retryMessage("c1");
    await result.current.markRead();
    await result.current.refetch();
    expect(result.current.messages).toEqual([]);
    expect(callsTo("post", /\/read/)).toHaveLength(0);
  });

  it("con conversación: carga historial, ignora texto en blanco y envía por el store", async () => {
    mockApi("get", /^\/chat\/conversations\/1\/messages/, []);
    mockApi("post", "/chat/conversations/1/read", {});
    const send = vi.fn();
    const retry = vi.fn();
    useChatStore.setState({ sendMessage: send, retryMessage: retry } as never);
    const { result } = renderHook(() => useChatThread(1), { wrapper });
    await waitFor(() => expect(callsTo("get", /\/chat\/conversations\/1\/messages/).length).toBeGreaterThan(0));
    act(() => { result.current.send("   "); result.current.send("Hola"); result.current.retryMessage("c9"); });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(1, "Hola");
    expect(retry).toHaveBeenCalledWith(1, "c9");
    await act(async () => { await result.current.markRead(); });
    expect(callsTo("post", "/chat/conversations/1/read")).toHaveLength(1);
  });
});

describe("useChatSocketBootstrap", () => {
  const emit = (m: unknown, mine = false) => act(() => { hoisted.listeners.forEach((l) => l(m, mine)); });
  const mountBootstrap = (enabled = true) => {
    useAuthStore.setState({ user: makeUser("student") } as never);
    const connect = vi.fn(); const disconnect = vi.fn();
    useChatStore.setState({ connect, disconnect } as never);
    qc.setQueryData(["chat", "conversations"], [CONV(1, 0), CONV(2, 0)]);
    qc.setQueryData(["chat", "unread-count"], 0);
    const view = renderHook(() => useChatSocketBootstrap(enabled), { wrapper });
    return { ...view, connect, disconnect };
  };
  const list = () => qc.getQueryData<ChatConversation[]>(["chat", "conversations"])!;

  it("conecta con el usuario y desconecta al desmontar o al desactivarse", () => {
    const { connect, disconnect, unmount } = mountBootstrap(true);
    expect(connect).toHaveBeenCalled();
    unmount();
    expect(disconnect).toHaveBeenCalled();
    const off = mountBootstrap(false);
    expect(off.connect).not.toHaveBeenCalled();
    expect(off.disconnect).toHaveBeenCalled();
  });

  it("mensaje ajeno de otro hilo: sube preview, no leídos, badge y pulso, y reordena", () => {
    mountBootstrap();
    emit(MSG(2));
    expect(list()[0]).toMatchObject({ id: 2, last_message_preview: "Hola nuevo", unread_count: 1 });
    expect(qc.getQueryData(["chat", "unread-count"])).toBe(1);
    expect(useChatStore.getState().pulseKey).toBe(1);
  });

  it("mensaje propio no suma no leídos", () => {
    mountBootstrap();
    emit(MSG(2, { sender_id: 1 }), true);
    expect(list()[0]).toMatchObject({ id: 2, unread_count: 0 });
    expect(qc.getQueryData(["chat", "unread-count"])).toBe(0);
  });

  it("si el hilo está abierto y la pestaña visible lo marca leído en el acto", async () => {
    mockApi("post", "/chat/conversations/1/read", {});
    mountBootstrap();
    useChatStore.setState({ activeConversationId: 1 } as never);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    emit(MSG(1));
    expect(list().find((c) => c.id === 1)?.unread_count).toBe(0);
    await waitFor(() => expect(callsTo("post", "/chat/conversations/1/read")).toHaveLength(1));
  });

  it("hilo abierto pero pestaña oculta: cuenta como no leído", () => {
    mountBootstrap();
    useChatStore.setState({ activeConversationId: 1 } as never);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    emit(MSG(1));
    expect(list().find((c) => c.id === 1)?.unread_count).toBe(1);
  });

  it("conversación desconocida: invalida la lista para traerla completa", () => {
    mountBootstrap();
    const spy = vi.spyOn(qc, "invalidateQueries");
    emit(MSG(99));
    expect(spy).toHaveBeenCalledWith({ queryKey: ["chat", "conversations"] });
  });

  it("los eventos del socket revalidan lista y badge con un debounce de 1 s", () => {
    vi.useFakeTimers();
    mountBootstrap();
    const spy = vi.spyOn(qc, "invalidateQueries");
    act(() => { useChatStore.setState((s) => ({ eventVersion: s.eventVersion + 1 })); });
    act(() => { useChatStore.setState((s) => ({ eventVersion: s.eventVersion + 1 })); });
    expect(spy).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1000); });
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
