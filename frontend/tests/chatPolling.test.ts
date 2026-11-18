import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({ default: { get: vi.fn(), post: vi.fn() }, refreshSession: vi.fn() }));

import { CONNECTED_SAFETY_POLL_MS, fallbackPollInterval } from "@/hooks/useChat";
import { reconnectDelay } from "@/store/chatStore";

describe("chat: polling de respaldo", () => {
  it("con el socket conectado solo comprueba cada 5 min; caído, usa el intervalo normal", () => {
    expect(fallbackPollInterval(30000, true)).toBe(CONNECTED_SAFETY_POLL_MS);
    expect(fallbackPollInterval(30000, false)).toBe(30000);
    expect(fallbackPollInterval(45000, false)).toBe(45000);
  });
});

describe("chat: reconexión", () => {
  it("retroceso exponencial con tope de 30 s y componente aleatorio (mitad fija, mitad variable)", () => {
    expect(reconnectDelay(0, () => 0)).toBe(500);
    expect(reconnectDelay(0, () => 1)).toBe(1000);
    expect(reconnectDelay(3, () => 0)).toBe(4000);
    expect(reconnectDelay(3, () => 1)).toBe(8000);
    expect(reconnectDelay(20, () => 0)).toBe(15000);
    expect(reconnectDelay(20, () => 1)).toBe(30000);
  });

  it("dos clientes en el mismo intento no reconectan en el mismo instante", () => {
    expect(reconnectDelay(2, () => 0.1)).not.toBe(reconnectDelay(2, () => 0.9));
  });
});

describe("chat: marcar como leído", () => {
  it("llamadas simultáneas al mismo hilo comparten UN solo POST /read", async () => {
    const { default: api } = await import("@/lib/api");
    const { markConversationRead } = await import("@/hooks/useChat");
    const { QueryClient } = await import("@tanstack/react-query");
    const post = api.post as unknown as ReturnType<typeof vi.fn>;
    post.mockReset();
    post.mockImplementation(() => new Promise((res) => setTimeout(() => res({ data: {} }), 10)));
    const qc = new QueryClient();
    await Promise.all([markConversationRead(qc, 7), markConversationRead(qc, 7), markConversationRead(qc, 8)]);
    expect(post).toHaveBeenCalledTimes(2);
    await markConversationRead(qc, 7); // terminada la anterior, una nueva lectura sí sale
    expect(post).toHaveBeenCalledTimes(3);
  });
});
