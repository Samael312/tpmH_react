import { afterEach, describe, expect, it, vi } from "vitest";
import { getNextWeekdayDate, utcTimeToLocal } from "@/lib/scheduleUtc";

// Fechas construidas en hora LOCAL del proceso: el día de la semana no depende de la zona de la máquina.
const at = (y: number, m: number, d: number) => new Date(y, m, d, 12, 0, 0); // m: 0 = enero

afterEach(() => {
  vi.useRealTimers();
});

describe("getNextWeekdayDate (0 = lunes ... 6 = domingo)", () => {
  const WEDNESDAY = at(2026, 0, 14); // miércoles 14 de enero de 2026

  it("hoy mismo cuenta como «próximo» si coincide el día", () => {
    expect(getNextWeekdayDate(2, WEDNESDAY).getDate()).toBe(14);
  });

  it("un día posterior de la misma semana", () => {
    expect(getNextWeekdayDate(4, WEDNESDAY).getDate()).toBe(16); // viernes
    expect(getNextWeekdayDate(6, WEDNESDAY).getDate()).toBe(18); // domingo
  });

  it("un día anterior salta a la semana siguiente", () => {
    expect(getNextWeekdayDate(0, WEDNESDAY).getDate()).toBe(19); // lunes
  });

  it("cruza de mes", () => {
    const r = getNextWeekdayDate(0, at(2026, 0, 28)); // miércoles 28 ene -> lunes 2 feb
    expect([r.getMonth(), r.getDate()]).toEqual([1, 2]);
  });

  it("no modifica la fecha de partida", () => {
    const from = at(2026, 0, 14);
    getNextWeekdayDate(0, from);
    expect(from.getDate()).toBe(14);
  });
});

describe("utcTimeToLocal", () => {
  it("convierte la hora UTC a la zona pedida (invierno)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(at(2026, 0, 14));
    expect(utcTimeToLocal("18:00", 0, "America/Caracas")).toBe("14:00");
    expect(utcTimeToLocal("18:00", 0, "Europe/Madrid")).toBe("19:00");
  });

  it("usa la fecha real del próximo día: en verano Madrid va 2 h por delante", () => {
    vi.useFakeTimers();
    vi.setSystemTime(at(2026, 6, 15));
    expect(utcTimeToLocal("18:00", 0, "Europe/Madrid")).toBe("20:00");
    expect(utcTimeToLocal("18:00", 0, "America/Caracas")).toBe("14:00");
  });

  it("zona inválida: devuelve la hora UTC original, sin lanzar", () => {
    vi.useFakeTimers();
    vi.setSystemTime(at(2026, 0, 14));
    expect(utcTimeToLocal("18:00", 0, "No/Existe")).toBe("18:00");
  });
});
