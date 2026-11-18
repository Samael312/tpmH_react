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
