import { beforeEach, describe, expect, it, vi } from "vitest";

type Cfg = { params: { limit: number; offset: number } & Record<string, unknown> };
type Reply = { data: unknown; headers: Record<string, string> };

// Servidor falso: un único punto de entrada que cada prueba reemplaza.
const server = vi.hoisted(() => ({
  calls: [] as Cfg[],
  handler: (async () => ({ data: [], headers: {} })) as (path: string, cfg: Cfg) => Promise<Reply>,
}));

vi.mock("@/lib/api", () => ({
  default: {
    get: (path: string, cfg: Cfg) => {
      server.calls.push(cfg);
      return server.handler(path, cfg);
    },
  },
}));

import { fetchAllPages, MAX_ITEMS, PAGE_SIZE } from "@/lib/pagination";

const rows = (from: number, n: number) => Array.from({ length: n }, (_, i) => ({ id: from + i }));

/** N filas en total; respeta limit/offset y anota X-Total-Count (salvo que se pida lo contrario). */
function fakeServer(total: number, { sendHeader = true } = {}) {
  server.handler = async (_path, cfg) => {
    const { limit, offset } = cfg.params;
    const n = Math.max(0, Math.min(limit, total - offset));
    return { data: rows(offset, n), headers: (sendHeader ? { "x-total-count": String(total) } : {}) as Record<string, string> };
  };
}

beforeEach(() => {
  server.calls.length = 0;
});

describe("fetchAllPages", () => {
  it("menos de una página: UNA sola petición, igual que antes", async () => {
    fakeServer(37);
    const r = await fetchAllPages<{ id: number }>("/x");
    expect(server.calls).toHaveLength(1);
    expect(r.rows).toHaveLength(37);
    expect(r.total).toBe(37);
    expect(r.truncated).toBe(false);
  });

  it("lista vacía", async () => {
    fakeServer(0);
    const r = await fetchAllPages<{ id: number }>("/x");
    expect(r.rows).toEqual([]);
    expect(server.calls).toHaveLength(1);
  });

  it("exactamente una página: no pide otra", async () => {
    fakeServer(PAGE_SIZE);
    const r = await fetchAllPages<{ id: number }>("/x");
    expect(r.rows).toHaveLength(PAGE_SIZE);
    expect(server.calls).toHaveLength(1);
  });

  it("más de una página: las concatena en orden y sin duplicados", async () => {
    const total = PAGE_SIZE * 2 + 5;
    fakeServer(total);
    const r = await fetchAllPages<{ id: number }>("/x");
    expect(server.calls).toHaveLength(3);
    expect(r.rows.map((x) => x.id)).toEqual(Array.from({ length: total }, (_, i) => i));
    expect(server.calls.map((c) => c.params.offset)).toEqual([0, PAGE_SIZE, PAGE_SIZE * 2]);
  });

  it("conserva los demás parámetros y añade limit y offset", async () => {
    fakeServer(3);
    await fetchAllPages("/x", { params: { status_filter: "pending", include_history: true } });
    expect(server.calls[0].params).toEqual({ status_filter: "pending", include_history: true, limit: PAGE_SIZE, offset: 0 });
  });

  it("si el servidor no manda X-Total-Count, usa lo cargado y no entra en bucle", async () => {
    fakeServer(10, { sendHeader: false });
    const r = await fetchAllPages<{ id: number }>("/x");
    expect(r.total).toBe(10);
    expect(server.calls).toHaveLength(1);
  });

  it("para si una página llega vacía aunque el total diga que hay más", async () => {
    let n = 0;
    server.handler = async () => ({ data: n++ === 0 ? rows(0, 5) : [], headers: { "x-total-count": "50" } });
    const r = await fetchAllPages<{ id: number }>("/x");
    expect(server.calls).toHaveLength(2);
    expect(r.rows).toHaveLength(5);
    expect(r.truncated).toBe(true);
  });

  it("respeta el tope de seguridad y avisa de que cortó", async () => {
    fakeServer(MAX_ITEMS + 1000);
    const r = await fetchAllPages<{ id: number }>("/x");
    expect(r.rows).toHaveLength(MAX_ITEMS);
    expect(r.truncated).toBe(true);
  });

  it("listados con forma de objeto: extrae las filas y deja los contadores de la primera respuesta", async () => {
    server.handler = async (_p, cfg) => {
      const { limit, offset } = cfg.params;
      const n = Math.max(0, Math.min(limit, 450 - offset));
      return { data: { classes: rows(offset, n), total: 450, upcoming: 7 }, headers: { "x-total-count": "450" } };
    };
    const r = await fetchAllPages<{ id: number }, { classes: { id: number }[]; total: number; upcoming: number }>("/c", {
      rows: (b) => b.classes,
    });
    expect(r.rows).toHaveLength(450);
    expect(r.firstBody.upcoming).toBe(7);
    expect(server.calls).toHaveLength(3);
  });

  it("un error en una página se propaga (react-query lo reintenta o lo muestra)", async () => {
    server.handler = async () => {
      throw new Error("boom");
    };
    await expect(fetchAllPages("/x")).rejects.toThrow("boom");
  });
});
