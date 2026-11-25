/**
 * Store del chat · casos límite que los otros tests no tocan: un fallo de envío que ya no corresponde a ningún mensaje
 * pendiente, la respuesta REST que llega cuando el hilo ya cambió, y el latido/reconexión en estados poco habituales.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChatStore } from "@/store/chatStore";
import { mockApi, mockApiError } from "./fakeApi";

class FakeSocket {
  static instances: FakeSocket[] = [];
  static OPEN = 1; static CONNECTING = 0; static CLOSED = 3;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  throwOnClose = false;
  constructor(public url: string) { FakeSocket.instances.push(this); }
  send(d: string) { this.sent.push(d); }
  close() { if (this.throwOnClose) throw new Error("close"); this.readyState = 3; }
  open() { this.readyState = 1; this.onopen?.(); }
  recv(obj: unknown) { this.onmessage?.({ data: JSON.stringify(obj) }); }
  drop(code = 1006) { this.readyState = 3; this.onclose?.({ code }); }
}
const last = () => FakeSocket.instances[FakeSocket.instances.length - 1];
const S = () => useChatStore.getState();
const connect = () => { S().connect("tok", 1); last().open(); return last(); };
const srv = (id: number, over: Record<string, unknown> = {}) => ({
  id, conversation_id: 1, sender_id: 1, sender_username: "yo", content: `m${id}`, created_at: "2026-01-01T00:00:00Z", delivered_at: null, ...over,
});
const pings = (ws: FakeSocket) => ws.sent.filter((s) => s.includes('"ping"')).length;

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubGlobal("crypto", { randomUUID: () => `uuid-${Math.random()}` });
  mockApi("get", /^\/chat\/conversations\/1\/messages/, []);
  S().reset();
});
afterEach(() => {
  S().reset();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
});

describe("chatStore · fallos de envío", () => {
  it("un «error» con un client_id que no es de ningún mensaje pendiente no cambia nada", async () => {
    const ws = connect();
    await S().ensureHistory(1);
    const before = S().messagesByConversation;
    ws.recv({ type: "error", client_id: "desconocido", detail: "x" });
    expect(S().messagesByConversation).toBe(before);
    expect(S().errorByConversation[1]).toBeUndefined();
  });

  it("fallar un envío no toca a los demás mensajes pendientes del mismo hilo", async () => {
    mockApi("post", /^\/chat\/conversations\/1\/messages/, () => new Promise(() => {}));
    const ws = connect();
    await S().ensureHistory(1);
    S().sendMessage(1, "uno");
    S().sendMessage(1, "dos");
    const [a, b] = S().messagesByConversation[1];
    ws.recv({ type: "error", client_id: a.client_id, detail: "no" });
    expect(S().messagesByConversation[1].find((m) => m.client_id === a.client_id)!.status).toBe("failed");
    expect(S().messagesByConversation[1].find((m) => m.client_id === b.client_id)!.status).toBe("sending");
  });

  it("un REST que falla cuando el mensaje ya no está pendiente no inventa un error", async () => {
    mockApiError("post", /^\/chat\/conversations\/1\/messages/, 500, "x");
    await S().ensureHistory(1);
    S().connect("tok", 1);                            // sesión con el socket sin abrir: va directo por REST
    S().sendMessage(1, "hola");
    const cid = S().messagesByConversation[1][0].client_id;
    useChatStore.setState((s) => ({
      messagesByConversation: { 1: s.messagesByConversation[1].map((m) => (m.client_id === cid ? { ...m, status: "sent" as const } : m)) },
    }));
    await vi.advanceTimersByTimeAsync(10);
    expect(S().messagesByConversation[1][0].status).toBe("sent");
    expect(S().errorByConversation[1]).toBeFalsy();
  });
});

describe("chatStore · la respuesta REST llega tarde", () => {
  // La respuesta del REST se procesa en un microtask: `interfere` corre de forma síncrona tras enviar, es decir, ANTES de ella.
  const sendByRest = async (interfere: (clientId: string) => void) => {
    mockApi("post", /^\/chat\/conversations\/1\/messages/, srv(10, { content: "hola" }));
    await S().ensureHistory(1);
    S().connect("tok", 1);                             // socket sin abrir: REST
    S().sendMessage(1, "hola");
    interfere(S().messagesByConversation[1][0].client_id as string);
    await vi.advanceTimersByTimeAsync(10);
  };
  const patch = (cid: string, over: Record<string, unknown>) => useChatStore.setState((s) => ({
    messagesByConversation: { 1: s.messagesByConversation[1].map((m) => (m.client_id === cid ? { ...m, ...over } : m)) },
  }));

  it("si el estado se reinició antes de la respuesta no se crea nada", async () => {
    await sendByRest(() => S().reset());
    expect(S().messagesByConversation).toEqual({});
  });

  it("si el hilo está cargado y el pendiente ya no está, añade el mensaje real", async () => {
    await sendByRest(() => useChatStore.setState({ messagesByConversation: { 1: [] } }));
    expect(S().messagesByConversation[1].map((m) => m.id)).toEqual([10]);
  });

  it("si el mensaje real ya estaba en la lista (llegó el eco) no lo duplica", async () => {
    await sendByRest(() => useChatStore.setState((s) => ({
      messagesByConversation: { 1: [{ ...s.messagesByConversation[1][0], id: 10, client_id: undefined, status: "sent" as const }] },
    })));
    expect(S().messagesByConversation[1]).toHaveLength(1);
  });

  it("si el «entregado» llegó antes que la respuesta REST, no se pisa", async () => {
    await sendByRest((cid) => patch(cid, { status: "delivered", delivered_at: "2026-01-01T00:00:05Z" }));
    expect(S().messagesByConversation[1][0]).toMatchObject({ id: 10, status: "delivered", delivered_at: "2026-01-01T00:00:05Z" });
  });
});

describe("chatStore · latido y reconexión en casos poco habituales", () => {
  it("un socket que ya no está abierto no recibe el ping del intervalo", () => {
    const ws = connect();
    ws.readyState = 2;                                 // CLOSING
    vi.advanceTimersByTime(25_000);
    expect(pings(ws)).toBe(0);
  });

  it("dos comprobaciones seguidas reinician la espera del pong en vez de acumularla", () => {
    const ws = connect();
    document.dispatchEvent(new Event("visibilitychange"));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(pings(ws)).toBe(2);
    vi.advanceTimersByTime(7_000);
    expect(S().connected).toBe(true);                  // el segundo ping empezó su propia espera de 8 s
  });

  it("con la pestaña oculta no se comprueba la conexión", () => {
    const ws = connect();
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(pings(ws)).toBe(0);
  });

  it("volver a la pestaña con una reconexión ya programada la adelanta, sin dejar dos temporizadores", () => {
    const ws = connect();
    ws.drop();                                         // programa una reconexión con retroceso
    expect(FakeSocket.instances).toHaveLength(1);
    document.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(5);
    expect(FakeSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.instances).toHaveLength(2);      // el temporizador anterior se canceló
  });

  it("si close() lanza al descartar un socket zombie, igualmente reconecta", () => {
    const ws = connect();
    ws.throwOnClose = true;
    vi.advanceTimersByTime(25_000);                    // ping sin respuesta…
    vi.advanceTimersByTime(8_000);                     // …el pong vence y se descarta
    expect(S().connected).toBe(false);
    vi.advanceTimersByTime(10);
    expect(FakeSocket.instances).toHaveLength(2);
  });
});
