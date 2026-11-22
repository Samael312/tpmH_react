/**
 * Store del chat: una sola conexión WebSocket por sesión, envío optimista, reintento por REST, latido,
 * reconexión y caché por conversación. Se usa un WebSocket falso que el test controla a mano.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChatStore, onChatMessage } from "@/store/chatStore";
import { mockApi, mockApiError, callsTo } from "./fakeApi";

class FakeSocket {
  static instances: FakeSocket[] = [];
  static OPEN = 1; static CONNECTING = 0; static CLOSED = 3;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  throwOnSend = false;
  constructor(public url: string) { FakeSocket.instances.push(this); }
  send(d: string) { if (this.throwOnSend) throw new Error("x"); this.sent.push(d); }
  close() { this.readyState = 3; }
  open() { this.readyState = 1; this.onopen?.(); }
  recv(obj: unknown) { this.onmessage?.({ data: typeof obj === "string" ? obj : JSON.stringify(obj) }); }
  drop(code = 1006) { this.readyState = 3; this.onclose?.({ code }); }
}
const last = () => FakeSocket.instances[FakeSocket.instances.length - 1];
const S = () => useChatStore.getState();
const srv = (id: number, conv = 1, over: Record<string, unknown> = {}) => ({
  id, conversation_id: conv, sender_id: 2, sender_username: "otro", content: `m${id}`, created_at: "2026-01-01T00:00:00Z", delivered_at: null, ...over,
});

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubGlobal("crypto", { randomUUID: () => `uuid-${Math.random()}` });
  S().reset();
});
afterEach(() => { S().reset(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const connect = () => { S().connect("tok", 1); last().open(); return last(); };

describe("chatStore · conexión", () => {
  it("abre un socket, marca conectado y no abre un segundo con las mismas credenciales", () => {
    const ws = connect();
    expect(S().connected).toBe(true);
    expect(ws.url).toMatch(/\/chat\/ws$/);
    S().connect("tok", 1);
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it("cambiar de credenciales cierra el socket anterior y abre otro", () => {
    connect();
    S().connect("otro", 5);
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it("disconnect deja el estado apagado y no reconecta", () => {
    const ws = connect();
    S().disconnect();
    expect(S().connected).toBe(false);
    ws.onclose?.({ code: 1006 });
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it("al caerse reconecta con retroceso y, si ya conectó antes, resincroniza", async () => {
    mockApi("get", /^\/chat\/conversations\/1\/messages/, [srv(1)]);
    const ws = connect();
    await S().ensureHistory(1);
    const v0 = S().eventVersion;
    ws.drop(1006);
    expect(S().connected).toBe(false);
    vi.advanceTimersByTime(31_000);
    expect(FakeSocket.instances).toHaveLength(2);
    last().open();
    expect(S().eventVersion).toBeGreaterThan(v0);
  });

  it("4403 (chat apagado) espera 5 minutos antes de reintentar", () => {
    const ws = connect();
    ws.drop(4403);
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(5 * 60_000);
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it("4401 renueva la sesión y reconecta enseguida", async () => {
    const ws = connect();
    ws.drop(4401);
    await vi.advanceTimersByTimeAsync(10);
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it("el latido manda ping y, sin respuesta, descarta el socket y reconecta", () => {
    const ws = connect();
    vi.advanceTimersByTime(25_000);
    expect(ws.sent.some((s) => s.includes('"ping"'))).toBe(true);
    vi.advanceTimersByTime(8_000);
    expect(S().connected).toBe(false);
    vi.advanceTimersByTime(10);
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it("cualquier mensaje cancela la espera del pong", () => {
    const ws = connect();
    vi.advanceTimersByTime(25_000);
    ws.recv({ type: "pong" });
    vi.advanceTimersByTime(10_000);
    expect(S().connected).toBe(true);
  });

  it("volver a la pestaña con el socket abierto comprueba la conexión; con el socket cerrado reconecta", () => {
    const ws = connect();
    document.dispatchEvent(new Event("visibilitychange"));
    expect(ws.sent.some((s) => s.includes('"ping"'))).toBe(true);
    ws.readyState = 3;
    window.dispatchEvent(new Event("online"));
    vi.advanceTimersByTime(10);
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it("un ping que lanza al enviar descarta el socket", () => {
    const ws = connect();
    ws.throwOnSend = true;
    vi.advanceTimersByTime(25_000);
    expect(S().connected).toBe(false);
  });

  it("onerror no hace nada por sí solo", () => {
    const ws = connect();
    ws.onerror?.();
    expect(S().connected).toBe(true);
  });
});

describe("chatStore · historial", () => {
  it("la primera vez trae el hilo completo y luego solo el delta con after_id", async () => {
    mockApi("get", /^\/chat\/conversations\/1\/messages/, (r: { params?: Record<string, unknown> }) => (r.params?.after_id ? [srv(3)] : [srv(1), srv(2, 1, { delivered_at: "2026-01-01T00:01:00Z" })]));
    await S().ensureHistory(1);
    expect(S().messagesByConversation[1].map((m) => m.id)).toEqual([1, 2]);
    expect(S().messagesByConversation[1][1].status).toBe("delivered");
    expect(S().historyLoadedByConversation[1]).toBe(true);
    await S().ensureHistory(1);
    expect(S().messagesByConversation[1].map((m) => m.id)).toEqual([1, 2, 3]);
    expect(callsTo("get", /messages/).at(-1)!.params).toMatchObject({ after_id: 2 });
    expect(S().fetchingByConversation[1]).toBe(false);
  });

  it("si falla guarda el error para ofrecer reintento", async () => {
    mockApiError("get", /^\/chat\/conversations\/1\/messages/, 500, "x");
    await S().ensureHistory(1);
    expect(S().historyErrorByConversation[1]).toBe("No se pudo cargar la conversación.");
  });

  it("conserva los mensajes pendientes (id negativo) al recargar el historial", async () => {
    mockApi("get", /^\/chat\/conversations\/1\/messages/, [srv(1)]);
    connect();
    S().sendMessage(1, "pendiente");
    await S().ensureHistory(1);
    const ids = S().messagesByConversation[1].map((m) => m.id);
    expect(ids[0]).toBe(1);
    expect(ids.some((i) => i < 0)).toBe(true);
  });

  it("la caché por hilo se limita a 300 mensajes", async () => {
    mockApi("get", /^\/chat\/conversations\/1\/messages/, Array.from({ length: 350 }, (_, i) => srv(i + 1)));
    await S().ensureHistory(1);
    expect(S().messagesByConversation[1]).toHaveLength(300);
    expect(S().messagesByConversation[1][0].id).toBe(51);
  });
});

describe("chatStore · enviar", () => {
  it("sin texto o sin sesión no hace nada", () => {
    S().sendMessage(1, "   ");
    expect(S().messagesByConversation[1]).toBeUndefined();
    S().sendMessage(1, "hola");
    expect(S().messagesByConversation[1]).toBeUndefined();
  });

  it("agrega el mensaje de forma optimista, lo manda por socket y el eco lo concilia", async () => {
    mockApi("get", /^\/chat\/conversations\/1\/messages/, []);
    const ws = connect();
    await S().ensureHistory(1);
    S().sendMessage(1, "  hola ");
    const m = S().messagesByConversation[1][0];
    expect(m).toMatchObject({ status: "sending", content: "hola" });
    expect(m.id).toBeLessThan(0);
    const sent = JSON.parse(ws.sent.at(-1)!);
    expect(sent).toMatchObject({ type: "send", conversation_id: 1, content: "hola" });
    ws.recv({ type: "message", ...srv(10, 1, { sender_id: 1, content: "hola", client_id: sent.client_id }) });
    expect(S().messagesByConversation[1]).toHaveLength(1);
    expect(S().messagesByConversation[1][0]).toMatchObject({ id: 10, status: "sent" });
  });

  it("sin eco en 5 s reenvía por REST con el mismo client_id", async () => {
    mockApi("post", /^\/chat\/conversations\/1\/messages/, (r: { body: { client_id: string } }) => srv(11, 1, { sender_id: 1, content: "hola", client_id: r.body.client_id }));
    connect();
    S().sendMessage(1, "hola");
    await vi.advanceTimersByTimeAsync(5_100);
    expect(callsTo("post", /messages/)).toHaveLength(1);
    expect(S().messagesByConversation[1][0].id).toBe(11);
  });

  it("sin socket abierto va directo por REST; si falla queda «failed» y se puede reintentar", async () => {
    S().connect("tok", 1); // socket sin abrir
    mockApiError("post", /^\/chat\/conversations\/1\/messages/, 500, "x");
    S().sendMessage(1, "hola");
    await vi.advanceTimersByTimeAsync(10);
    const failed = S().messagesByConversation[1][0];
    expect(failed.status).toBe("failed");
    expect(S().errorByConversation[1]).toBe("No se pudo enviar el mensaje");
    mockApi("post", /^\/chat\/conversations\/1\/messages/, srv(12, 1, { sender_id: 1, content: "hola", client_id: failed.client_id }));
    S().retryMessage(1, failed.client_id!);
    expect(S().messagesByConversation[1][0].status).toBe("sending");
    await vi.advanceTimersByTimeAsync(10);
    expect(S().messagesByConversation[1][0]).toMatchObject({ id: 12, status: "sent" });
  });

  it("retryMessage ignora mensajes que no están fallidos o no existen", () => {
    S().retryMessage(1, "nada");
    expect(callsTo("post", /messages/)).toHaveLength(0);
  });

  it("si el socket falla al enviar cae al REST", async () => {
    mockApi("post", /^\/chat\/conversations\/1\/messages/, srv(13, 1, { sender_id: 1 }));
    const ws = connect();
    ws.throwOnSend = true;
    S().sendMessage(1, "hola");
    await vi.advanceTimersByTimeAsync(10);
    expect(callsTo("post", /messages/)).toHaveLength(1);
  });
});

describe("chatStore · mensajes entrantes", () => {
  it("un mensaje de otro en un hilo ya cargado se agrega, sin duplicar, y avisa a los oyentes", async () => {
    mockApi("get", /^\/chat\/conversations\/1\/messages/, [srv(1)]);
    const ws = connect();
    await S().ensureHistory(1);
    const seen = vi.fn();
    const off = onChatMessage(seen);
    const v0 = S().eventVersion;
    ws.recv({ type: "message", ...srv(2) });
    ws.recv({ type: "message", ...srv(2) });
    expect(S().messagesByConversation[1].map((m) => m.id)).toEqual([1, 2]);
    expect(seen).toHaveBeenCalledTimes(2);
    expect(seen.mock.calls[0][1]).toBe(false);
    expect(S().eventVersion).toBe(v0 + 2);
    off();
    ws.recv({ type: "message", ...srv(3) });
    expect(seen).toHaveBeenCalledTimes(2);
  });

  it("en un hilo nunca abierto no crea caché (taparía el historial)", () => {
    const ws = connect();
    ws.recv({ type: "message", ...srv(5, 9) });
    expect(S().messagesByConversation[9]).toBeUndefined();
    expect(S().eventVersion).toBe(1);
  });

  it("«delivered» marca el mensaje como entregado, con o sin conversation_id", async () => {
    mockApi("get", /^\/chat\/conversations\/1\/messages/, [srv(1, 1, { sender_id: 1 }), srv(2, 1, { sender_id: 1 })]);
    const ws = connect();
    await S().ensureHistory(1);
    ws.recv({ type: "delivered", id: 1, conversation_id: 1 });
    ws.recv({ type: "delivered", id: 2 });
    ws.recv({ type: "delivered", id: 999 });
    expect(S().messagesByConversation[1].every((m) => m.status === "delivered")).toBe(true);
  });

  it("un «error» del servidor marca el envío como fallido", async () => {
    mockApi("get", /^\/chat\/conversations\/1\/messages/, []);
    mockApi("post", /^\/chat\/conversations\/1\/messages/, () => new Promise(() => {}));
    const ws = connect();
    await S().ensureHistory(1);
    S().sendMessage(1, "hola");
    const cid = S().messagesByConversation[1][0].client_id;
    ws.recv({ type: "error", client_id: cid, detail: "Chat deshabilitado" });
    expect(S().messagesByConversation[1][0].status).toBe("failed");
    expect(S().errorByConversation[1]).toBe("Chat deshabilitado");
    ws.recv({ type: "error", detail: "sin client" });
  });

  it("un frame que no es JSON se ignora", () => {
    const ws = connect();
    ws.recv("no-json{");
    expect(S().connected).toBe(true);
  });

  it("setActiveConversation y reset limpian el estado", () => {
    S().setActiveConversation(4);
    expect(S().activeConversationId).toBe(4);
    S().reset();
    expect(S().activeConversationId).toBeNull();
    expect(S().messagesByConversation).toEqual({});
  });
});
