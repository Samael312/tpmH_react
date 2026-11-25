import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ user: null as { timezone?: string } | null }));
vi.mock("@/store/authStore", () => ({ useAuthStore: { getState: () => ({ user: auth.user }) } }));

import {
  formatCalendarDateHuman, formatDateHumanTz, formatMonthShortTz, formatTimeTz, formatWeekdayShortTz, getDateKeyTz, getDayOfMonthTz,
  formatDateHuman, getHourMinuteTz, getMyDisplayTimezone, getTimezoneDiffLabel, getUtcOffsetMinutes, localDateTimeToUtcIso,
  zonedLocalToUtcIso,
} from "@/lib/tzFormat";

const CARACAS = "America/Caracas"; // UTC-4 todo el año
const MADRID = "Europe/Madrid";    // UTC+1 en invierno, UTC+2 en verano
// 2026-01-13 02:30 UTC: en Caracas todavía es el día 12 (22:30); en Madrid ya es el 13 (03:30).
const LATE = "2026-01-13T02:30:00Z";

beforeEach(() => {
  auth.user = null;
});

describe("misma instantánea, cada persona ve su hora", () => {
  it("formatTimeTz: Caracas y Madrid ven horas distintas del mismo instante", () => {
    expect(formatTimeTz("2026-01-13T18:00:00Z", CARACAS)).toBe("14:00");
    expect(formatTimeTz("2026-01-13T18:00:00Z", MADRID)).toBe("19:00");
  });

  it("el horario de verano cambia el desfase de Madrid pero no el de Caracas", () => {
    expect(formatTimeTz("2026-07-13T18:00:00Z", MADRID)).toBe("20:00");
    expect(formatTimeTz("2026-07-13T18:00:00Z", CARACAS)).toBe("14:00");
  });
});

describe("cambio de día según la zona", () => {
  it("getDateKeyTz y getDayOfMonthTz usan el día de la zona, no el día UTC", () => {
    expect(getDateKeyTz(LATE, CARACAS)).toBe("2026-01-12");
    expect(getDateKeyTz(LATE, MADRID)).toBe("2026-01-13");
    expect(getDayOfMonthTz(LATE, CARACAS)).toBe(12);
    expect(getDayOfMonthTz(LATE, MADRID)).toBe(13);
  });

  it("el cambio de año también se resuelve por zona", () => {
    expect(getDateKeyTz("2026-01-01T02:00:00Z", CARACAS)).toBe("2025-12-31");
    expect(formatMonthShortTz("2026-01-01T02:00:00Z", CARACAS)).toBe("dic");
    expect(formatMonthShortTz("2026-01-01T02:00:00Z", MADRID)).toBe("ene");
  });

  it("formatWeekdayShortTz / formatDateHumanTz siguen el día de la zona", () => {
    expect(formatWeekdayShortTz(LATE, CARACAS).toLowerCase()).toContain("lun"); // 12 ene 2026 es lunes
    expect(formatWeekdayShortTz(LATE, MADRID).toLowerCase()).toContain("mar");  // 13 ene 2026 es martes
    expect(formatDateHumanTz(LATE, CARACAS)).toMatch(/lunes.*12.*enero/);
  });
});

describe("getHourMinuteTz", () => {
  it("hora y minuto de la zona", () => {
    expect(getHourMinuteTz(LATE, CARACAS)).toEqual({ hour: 22, minute: 30 });
    expect(getHourMinuteTz(LATE, MADRID)).toEqual({ hour: 3, minute: 30 });
  });

  it("medianoche es la hora 0, no 24", () => {
    expect(getHourMinuteTz("2026-01-13T04:05:00Z", CARACAS)).toEqual({ hour: 0, minute: 5 });
  });
});

describe("getMyDisplayTimezone", () => {
  it("prioriza la zona del perfil sobre la del navegador", () => {
    auth.user = { timezone: "Asia/Tokyo" };
    expect(getMyDisplayTimezone()).toBe("Asia/Tokyo");
  });

  it("sin perfil usa la del navegador (nunca vacía)", () => {
    auth.user = { timezone: undefined };
    expect(getMyDisplayTimezone()).toBeTruthy();
    auth.user = null;
    expect(getMyDisplayTimezone()).toBeTruthy();
  });
});

describe("formatCalendarDateHuman", () => {
  it("una fecha de calendario no cambia de día según la zona del navegador (bug: «Miércoles 18» en vez de «Jueves 19»)", () => {
    const original = process.env.TZ;
    for (const tz of ["Europe/Madrid", "America/Los_Angeles", "Pacific/Auckland", "UTC"]) {
      process.env.TZ = tz;
      expect(formatCalendarDateHuman("2026-11-19")).toMatch(/jueves,? 19 de noviembre/i);
    }
    process.env.TZ = original;
  });
});

describe("zonedLocalToUtcIso (hora de pared en una zona → instante UTC)", () => {
  it("convierte con el desfase de cada zona y de cada estación", () => {
    expect(zonedLocalToUtcIso("2026-01-13T14:00", CARACAS)).toBe("2026-01-13T18:00:00.000Z");
    expect(zonedLocalToUtcIso("2026-01-13T19:00", MADRID)).toBe("2026-01-13T18:00:00.000Z");
    expect(zonedLocalToUtcIso("2026-07-13T20:00", MADRID)).toBe("2026-07-13T18:00:00.000Z");
  });

  it("acierta justo después del cambio de horario (Madrid, 29-mar-2026 03:30 = 01:30 UTC)", () => {
    expect(zonedLocalToUtcIso("2026-03-29T03:30", MADRID)).toBe("2026-03-29T01:30:00.000Z");
  });

  it("devuelve null si el texto no es una fecha/hora válida", () => {
    expect(zonedLocalToUtcIso("mañana", MADRID)).toBeNull();
    expect(zonedLocalToUtcIso("", MADRID)).toBeNull();
    expect(zonedLocalToUtcIso("2026-13-45T99:99", MADRID)).toBeNull();
  });
});

describe("localDateTimeToUtcIso", () => {
  it("fecha y hora de pared + zona → ISO UTC", () => {
    expect(localDateTimeToUtcIso("2026-01-13", "14:00", CARACAS)).toBe("2026-01-13T18:00:00.000Z");
    expect(localDateTimeToUtcIso("2026-07-13", "20:00", MADRID)).toBe("2026-07-13T18:00:00.000Z");
  });

  it("pasa al día anterior o siguiente cuando la zona lo exige", () => {
    expect(localDateTimeToUtcIso("2026-01-12", "22:30", CARACAS)).toBe("2026-01-13T02:30:00.000Z");
    expect(localDateTimeToUtcIso("2026-01-13", "00:30", MADRID)).toBe("2026-01-12T23:30:00.000Z");
  });
});

describe("getUtcOffsetMinutes / getTimezoneDiffLabel", () => {
  const winter = new Date("2026-01-13T12:00:00Z");
  const summer = new Date("2026-07-13T12:00:00Z");

  it("desfase en minutos respecto a UTC, con horario de verano y medias horas", () => {
    expect(getUtcOffsetMinutes(CARACAS, winter)).toBe(-240);
    expect(getUtcOffsetMinutes(MADRID, winter)).toBe(60);
    expect(getUtcOffsetMinutes(MADRID, summer)).toBe(120);
    expect(getUtcOffsetMinutes("Asia/Kolkata", winter)).toBe(330);
  });

  it("una zona inválida da null; sin fecha usa «ahora»", () => {
    expect(getUtcOffsetMinutes("Mars/Olympus", winter)).toBeNull();
    expect(getUtcOffsetMinutes("UTC")).toBe(0);
  });

  it("etiqueta la diferencia respecto a quien mira", () => {
    expect(getTimezoneDiffLabel(MADRID, CARACAS, winter)).toBe("+5h respecto a ti");
    expect(getTimezoneDiffLabel(CARACAS, MADRID, winter)).toBe("-5h respecto a ti");
    expect(getTimezoneDiffLabel("Asia/Kolkata", MADRID, winter)).toBe("+4.5h respecto a ti");
    expect(getTimezoneDiffLabel(MADRID, MADRID, winter)).toBe("Mismo huso horario");
  });

  it("sin alguna de las zonas, o con una inválida, no hay etiqueta", () => {
    expect(getTimezoneDiffLabel(null, MADRID)).toBeNull();
    expect(getTimezoneDiffLabel(MADRID, undefined)).toBeNull();
    expect(getTimezoneDiffLabel("", "")).toBeNull();
    expect(getTimezoneDiffLabel("Mars/Olympus", MADRID, winter)).toBeNull();
    expect(getTimezoneDiffLabel(MADRID, "Mars/Olympus", winter)).toBeNull();
    expect(getTimezoneDiffLabel(MADRID, CARACAS)).toMatch(/respecto a ti$/);          // «ahora» por defecto
  });
});

describe("formatDateHuman", () => {
  it("vacío da cadena vacía y una fecha ISO da «día, N de mes»", () => {
    expect(formatDateHuman("")).toBe("");
    expect(formatDateHuman("2026-01-13T12:00:00Z")).toMatch(/martes.*13.*enero/);
  });
});
