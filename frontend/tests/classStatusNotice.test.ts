import { describe, expect, it } from "vitest";
import { finalizedNotice } from "@/lib/classStatusNotice";

const end = new Date("2026-01-10T10:00:00Z");
const after = (h: number) => new Date(end.getTime() + h * 3_600_000);

describe("finalizedNotice", () => {
  it("alumno: pendiente del profesor, sin urgencia", () => {
    const n = finalizedNotice("student", end, after(5));
    expect(n?.urgent).toBe(false);
    expect(n?.text).toMatch(/profesor/);
  });
  it("profesor al inicio: días restantes, no urgente", () => {
    const n = finalizedNotice("teacher", end, after(2));
    expect(n?.urgent).toBe(false);
    expect(n?.text).toContain("2 d 22 h");
  });
  it("profesor con menos de 24 h: urgente", () => {
    const n = finalizedNotice("teacher", end, after(60));
    expect(n?.urgent).toBe(true);
    expect(n?.text).toContain("12 h");
  });
  it("profesor con plazo vencido", () => {
    expect(finalizedNotice("teacher", end, after(73))?.text).toMatch(/vencido/);
  });
  it("admin: nada", () => {
    expect(finalizedNotice("admin", end, after(5))).toBeNull();
  });
});

import { pendingToMark, pendingToMarkText } from "@/lib/classStatusNotice";

describe("pendingToMark", () => {
  const mk = (status: string, hoursAgo: number, class_type = "regular") => ({
    status, class_type, end_time_utc: new Date(end.getTime() - hoursAgo * 3_600_000 + 0).toISOString(),
  });
  // `end` es el «ahora» de estos casos: una clase que terminó hace N h tiene end = ahora - N h.
  const now = end;

  it("sin clases finalized: null", () => {
    expect(pendingToMark([mk("completed", 5), mk("confirmed", 1)], now)).toBeNull();
  });
  it("cuenta solo finalized no externas y toma la más urgente", () => {
    const r = pendingToMark([mk("finalized", 10), mk("finalized", 60), mk("finalized", 80, "external"), mk("no_show", 90)], now);
    expect(r?.count).toBe(2);
    expect(Math.round(r!.hoursLeft)).toBe(12);
  });
  it("texto: singular, plural y vencido", () => {
    expect(pendingToMarkText({ count: 1, hoursLeft: 5.5 })).toBe("Tienes 1 clase por marcar; la más urgente vence en 5 h.");
    expect(pendingToMarkText({ count: 3, hoursLeft: 50 })).toBe("Tienes 3 clases por marcar; la más urgente vence en 2 d 2 h.");
    expect(pendingToMarkText({ count: 2, hoursLeft: -1 })).toMatch(/venció/);
  });
});

// ── F13: acciones manuales de estado del profesor ─────────────────────────────────────────────────────────────────
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CLASS_STATUS_TRANSITIONS, manualStatusTargets } from "@/lib/classStatusNotice";

describe("CLASS_STATUS_TRANSITIONS (contrato con el backend)", () => {
  it("es idéntica a CLASS_STATUS_TRANSITIONS de backend/app/core/class_logic.py", () => {
    const src = readFileSync(resolve(__dirname, "../../backend/app/core/class_logic.py"), "utf-8");
    const block = src.slice(src.indexOf("CLASS_STATUS_TRANSITIONS: dict"), src.indexOf("STATUS_LABELS_ES"));
    const backend: Record<string, string[]> = {};
    for (const m of block.matchAll(/"(\w+)":\s*(set\(\)|\{([^}]*)\})/g)) {
      backend[m[1]] = m[3] ? [...m[3].matchAll(/"(\w+)"/g)].map((x) => x[1]).sort() : [];
    }
    const front = Object.fromEntries(Object.entries(CLASS_STATUS_TRANSITIONS).map(([k, v]) => [k, [...v].sort()]));
    expect(Object.keys(backend).length).toBeGreaterThan(5);
    expect(front).toEqual(backend);
  });
});

describe("manualStatusTargets", () => {
  const now = new Date("2026-11-23T15:00:00Z");
  const h = (n: number) => new Date(now.getTime() + n * 3_600_000);

  it("clase en curso confirmada: las tres opciones", () => {
    expect(manualStatusTargets("confirmed", h(-0.5), h(0.5), now)).toEqual(["completed", "no_show", "finalized"]);
  });
  it("clase futura: solo «sin resolver» (no se puede completar lo que no empezó)", () => {
    expect(manualStatusTargets("confirmed", h(24), h(25), now)).toEqual(["finalized"]);
  });
  it.each(["cancelled", "expired", "rescheduled", "estado_raro"])("%s: ninguna", (s) => {
    expect(manualStatusTargets(s, h(-3), h(-2), now)).toEqual([]);
  });
  it("pending*: sin «finalized»", () => {
    expect(manualStatusTargets("pending", h(-3), h(-2), now)).toEqual(["completed", "no_show"]);
  });
  it("pasadas 72 h del fin: ninguna", () => {
    expect(manualStatusTargets("completed", h(-100), h(-99), now)).toEqual([]);
    expect(manualStatusTargets("completed", h(-75), h(-73), now)).toEqual([]);
    expect(manualStatusTargets("completed", h(-71), h(-70), now)).toEqual(["no_show", "finalized"]);
  });
});
