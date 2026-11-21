import { describe, it, expect } from "vitest";
import { localRangeCells } from "@/lib/weeklyLocal";

describe("localRangeCells (Fase 26: horario semanal en hora local)", () => {
  it("una franja del mismo dia se pinta tal cual, sin conversion", () => {
    expect(localRangeCells(0, "18:00", "20:00")).toEqual([
      { day: 0, hour: 18 }, { day: 0, hour: 19 },
    ]);
  });

  it("fin 23:59 (lo que envia el editor para 24:00) llega hasta la ultima hora del dia", () => {
    const cells = localRangeCells(2, "22:00", "23:59");
    expect(cells).toEqual([{ day: 2, hour: 22 }, { day: 2, hour: 23 }]);
  });

  it("00:00-00:00 son 24 h del mismo dia local", () => {
    const cells = localRangeCells(4, "00:00", "00:00");
    expect(cells).toHaveLength(24);
    expect(cells.every((c) => c.day === 4)).toBe(true);
  });

  it("una franja que cruza la medianoche local deja la cola en el dia siguiente (domingo -> lunes)", () => {
    expect(localRangeCells(6, "22:00", "01:00")).toEqual([
      { day: 6, hour: 22 }, { day: 6, hour: 23 }, { day: 0, hour: 0 },
    ]);
  });

  it("no depende de la zona ni de la fecha: la hora es la misma en cualquier momento del anio", () => {
    const a = localRangeCells(0, "09:00", "12:00");
    expect(a.map((c) => c.hour)).toEqual([9, 10, 11]);
  });
});
