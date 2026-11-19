import { beforeEach, describe, expect, it, vi } from "vitest";

type Cfg = { params: { limit: number; offset: number } };
const server = vi.hoisted(() => ({
  calls: [] as Cfg[],
  total: 0 as number | null,
}));

vi.mock("@/lib/api", () => ({
  default: {
    get: async (_path: string, cfg: Cfg) => {
      server.calls.push(cfg);
      const { limit, offset } = cfg.params;
      const t = server.total ?? 0;
      const n = Math.max(0, Math.min(limit, t - offset));
      return {
        data: Array.from({ length: n }, (_, i) => ({ id: offset + i })),
        headers: server.total === null ? {} : { "x-total-count": String(t) },
      };
    },
  },
}));

import { fetchPage, nextOffset, LOAD_MORE_PAGE_SIZE } from "@/lib/loadMore";

beforeEach(() => {
  server.calls.length = 0;
  server.total = 0;
});

describe("fetchPage / nextOffset", () => {
  it("pide solo una página con limit y offset", async () => {
    server.total = 120;
    const p = await fetchPage("/x", 0);
    expect(server.calls).toHaveLength(1);
    expect(server.calls[0].params).toEqual({ limit: LOAD_MORE_PAGE_SIZE, offset: 0 });
    expect(p.rows).toHaveLength(LOAD_MORE_PAGE_SIZE);
    expect(p.total).toBe(120);
    expect(nextOffset(p)).toBe(LOAD_MORE_PAGE_SIZE);
  });

  it("última página: no hay siguiente", async () => {
    server.total = 120;
    const p = await fetchPage("/x", 100);
    expect(p.rows).toHaveLength(20);
    expect(nextOffset(p)).toBeUndefined();
  });

  it("exactamente una página llena: no hay siguiente", async () => {
    server.total = LOAD_MORE_PAGE_SIZE;
    expect(nextOffset(await fetchPage("/x", 0))).toBeUndefined();
  });

  it("sin X-Total-Count y página vacía: termina", async () => {
    server.total = null;
    const p = await fetchPage("/x", 0);
    expect(nextOffset(p)).toBeUndefined();
  });
});

describe("fetchPage con forma de cuerpo (Fase 14, E6: /admin/users)", () => {
  it("usa el parámetro de desplazamiento indicado, saca filas y total del cuerpo y devuelve el cuerpo", async () => {
    server.total = null; // sin X-Total-Count: el total viene del cuerpo
    const calls: Record<string, unknown>[] = [];
    const api = (await import("@/lib/api")).default as unknown as { get: (p: string, c: { params: Record<string, unknown> }) => unknown };
    const orig = api.get;
    api.get = async (_p, cfg) => {
      calls.push(cfg.params);
      return { data: { total: 120, active_count: 100, users: [{ id: 1 }, { id: 2 }] }, headers: {} };
    };
    try {
      type Body = { total: number; active_count: number; users: { id: number }[] };
      const p = await fetchPage<{ id: number }, Body>("/admin/users", 50, 50, { role: "student" }, {
        rows: (b) => b.users,
        totalOf: (b) => b.total,
        offsetParam: "skip",
      });
      expect(calls[0]).toEqual({ role: "student", limit: 50, skip: 50 });
      expect(p.rows).toHaveLength(2);
      expect(p.total).toBe(120);
      expect(p.body.active_count).toBe(100);
      expect(nextOffset(p)).toBe(52);
    } finally {
      api.get = orig;
    }
  });
});
