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
