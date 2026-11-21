// Sondas de la auditoría de zona horaria (frontend). Cada test PASA = el bug existe hoy.
// Ejecutar: cd frontend && npx vitest run --config __tz_probes__/vitest.config.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { utcTimeToLocal } from "@/lib/scheduleUtc";
import { localRangeCells } from "@/lib/weeklyLocal";
import { getDateKeyTz, formatCalendarDateHuman, formatTimeTz } from "@/lib/tzFormat";
import { TIMEZONE_OPTIONS } from "@/lib/timezones";
import {
  withBrowserTz, toUtcDateStr, getWeekDates, localDateTimeToUtcIso, getTimezoneDiffLabel,
  hoursFromBlock, backendLocalToUtc,
} from "./helpers";

afterEach(() => { vi.useRealTimers(); });

describe("U1 [legado UTC, ya no aplica al profesor: ver U1-fixed; las preferencias del alumno siguen en UTC] · rejilla semanal: la última hora (23:00) se pierde al recargar", () => {
  it("bloque 22:00-24:00 se guarda como end 23:59 y al hidratar solo vuelve 22:00", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-19T15:00:00Z"));
    const tz = "America/Caracas";
    // guardado: el front manda end_time_local "23:59" (availability/page.tsx:118)
    const s = backendLocalToUtc("22:00", tz, 0, new Date());
    const e = backendLocalToUtc("23:59", tz, 0, new Date());
    const localStart = utcTimeToLocal(s.hhmm, 0, tz);
    const localEnd = utcTimeToLocal(e.hhmm, 0, tz);
    expect([localStart, localEnd]).toEqual(["22:00", "23:59"]);
    expect(hoursFromBlock(localStart, localEnd)).toEqual(["22:00"]); // falta "23:00"
  });
});

describe("U2 · utcTimeToLocal no coincide con el backend en la semana del cambio de hora", () => {
  it("New York: domingo 22:00 guardado el jueves previo al DST se ve como 21:00", () => {
    withBrowserTz("America/New_York", () => {
      vi.useFakeTimers(); vi.setSystemTime(new Date("2026-03-05T17:00:00Z")); // jueves 5 mar, 12:00 EST
      const tz = "America/New_York";
      const saved = backendLocalToUtc("22:00", tz, 6, new Date()); // backend: ref = dom 8 mar (EDT)
      expect(saved.hhmm).toBe("02:00");
      expect(utcTimeToLocal(saved.hhmm, 6, tz)).toBe("21:00"); // el front usa dom 8 a las 02:00Z = sáb 21:00 EST
    });
  });
});

describe("U3 [legado UTC, ya no aplica al profesor: ver U3-fixed] · horario semanal en UTC fijo: la hora local se corre 1h tras el cambio de hora", () => {
  it("Madrid lunes 09:00 guardado en enero se muestra 10:00 en julio", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-01-14T12:00:00Z"));
    const saved = backendLocalToUtc("09:00", "Europe/Madrid", 0, new Date());
    expect(saved.hhmm).toBe("08:00");
    vi.setSystemTime(new Date("2026-07-15T12:00:00Z"));
    expect(utcTimeToLocal(saved.hhmm, 0, "Europe/Madrid")).toBe("10:00");
  });
});

describe("Fase 26 (H1/H5 corregidos para el profesor): el editor semanal recibe y pinta HORA LOCAL, sin conversion UTC", () => {
  it("U1-fixed: 22:00-23:59 local vuelve completo (22:00 y 23:00)", () => {
    expect(localRangeCells(0, "22:00", "23:59").map((c) => c.hour)).toEqual([22, 23]);
  });
  it("U3-fixed: lunes 09:00 local se pinta igual en enero y en julio, en cualquier zona del navegador", () => {
    for (const bz of ["Europe/Madrid", "America/New_York", "Pacific/Auckland"]) {
      withBrowserTz(bz, () => {
        vi.useFakeTimers();
        for (const when of ["2026-01-14T12:00:00Z", "2026-07-15T12:00:00Z", "2026-03-27T12:00:00Z"]) {
          vi.setSystemTime(new Date(when));
          expect(localRangeCells(0, "09:00", "12:00").map((c) => c.hour)).toEqual([9, 10, 11]);
        }
      });
    }
  });
});

describe("U4 · Mis clases (profesor y alumno) agrupa por día UTC, no por día local", () => {
  it("clase lunes 21:00 Caracas (= martes 01:00Z) cae en el martes de la tira", () => {
    const start = "2026-11-24T01:00:00Z";
    expect(getDateKeyTz(start, "America/Caracas")).toBe("2026-11-23");
    expect(start.slice(0, 10)).toBe("2026-11-24"); // filtro de dashboard/page.tsx:600,613
  });
  it("hoy es el día UTC: a las 21:00 Caracas el chip de hoy ya marca mañana", () => {
    const now = new Date("2026-11-20T01:00:00Z"); // jueves 19, 21:00 Caracas
    expect(toUtcDateStr(now)).toBe("2026-11-20");
  });
  it("en domingo (UTC) la semana empieza el lunes SIGUIENTE (no incluye hoy)", () => {
    const sunday = new Date("2026-11-22T15:00:00Z");
    const week = getWeekDates(sunday).map(toUtcDateStr);
    expect(week[0]).toBe("2026-11-23");
    expect(week).not.toContain("2026-11-22");
  });
});

describe("U5 · RescheduleCalendar / calendario de tareas: hoy sale como pasado en husos negativos", () => {
  it("Caracas: new Date(YYYY-MM-DD) < new Date(today.toDateString()) para hoy", () => {
    withBrowserTz("America/Caracas", () => {
      const today = new Date("2026-11-19T15:00:00Z"); // 11:00 Caracas
      const dateStr = "2026-11-19";
      const isPast = new Date(dateStr) < new Date(today.toDateString()); // RescheduleModal.tsx:105, homework/page.tsx:172
      expect(isPast).toBe(true);
    });
  });
  it("isToday con toISOString marca mañana como hoy desde las 20:00 Caracas", () => {
    withBrowserTz("America/Caracas", () => {
      const today = new Date("2026-11-20T00:30:00Z"); // 19 nov 20:30 Caracas
      expect(today.toISOString().split("T")[0]).toBe("2026-11-20"); // RescheduleModal.tsx:106
    });
  });
});

describe("U6 · formatDateHuman de RescheduleModal / GodModeAvailabilityPicker muestra el día anterior", () => {
  it("2026-11-23 (lunes) se muestra como domingo 22 en Caracas", () => {
    withBrowserTz("America/Caracas", () => {
      const out = new Date("2026-11-23").toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long" });
      expect(out).toBe("domingo, 22 de noviembre");
      expect(formatCalendarDateHuman("2026-11-23")).toBe("lunes, 23 de noviembre"); // la utilidad correcta ya existe
    });
  });
});

describe("U7 · editar una tarea corre la fecha de entrega en cada guardado", () => {
  it("vence jue 19 23:59 Caracas; abrir y guardar sin tocar => vie 20 03:59 Caracas (+4h)", () => {
    withBrowserTz("America/Caracas", () => {
      const original = new Date("2026-11-19T23:59:00-04:00").toISOString(); // 2026-11-20T03:59:00.000Z
      const due = original.slice(0, 10);       // homework/page.tsx:370
      const dueTime = original.slice(11, 16);  // homework/page.tsx:371
      const saved = new Date(`${due}T${dueTime}:00`).toISOString(); // homework/page.tsx:382
      expect(new Date(saved).getTime() - new Date(original).getTime()).toBe(4 * 3600_000);
    });
  });
  it("crear tarea usa la zona del NAVEGADOR, no la del perfil (viajero en Madrid, perfil Caracas)", () => {
    withBrowserTz("Europe/Madrid", () => {
      const iso = new Date(`2026-11-19T23:59:00`).toISOString(); // homework/page.tsx:621
      expect(formatTimeTz(iso, "America/Caracas")).toBe("18:59");
    });
  });
});

describe("U8 · localDateTimeToUtcIso (reagendar inline de ClassCard) falla 1h el día del cambio de hora", () => {
  it("New York 8 mar 2026 05:00 (EDT) => devuelve 10:00Z (=06:00 EDT) en vez de 09:00Z", () => {
    expect(localDateTimeToUtcIso("2026-03-08", "05:00", "America/New_York")).toBe("2026-03-08T10:00:00.000Z");
  });
  it("Madrid 25 oct 2026 01:30 (CEST) => 00:30Z (=02:30 CEST) en vez de 23:30Z", () => {
    expect(localDateTimeToUtcIso("2026-10-25", "01:30", "Europe/Madrid")).toBe("2026-10-25T00:30:00.000Z");
  });
});

describe("U9 · etiqueta de diferencia horaria", () => {
  it("usa el offset de HOY, no el del día de la clase (Madrid vs Caracas)", () => {
    const hoy = new Date("2026-03-10T12:00:00Z");   // Madrid aún +1
    const clase = new Date("2026-04-10T12:00:00Z"); // Madrid +2
    expect(getTimezoneDiffLabel("Europe/Madrid", "America/Caracas", hoy)).toBe("+5h respecto a ti");
    expect(getTimezoneDiffLabel("Europe/Madrid", "America/Caracas", clase)).toBe("+6h respecto a ti");
  });
  it("Kathmandu (+5:45) se redondea a +9.8h", () => {
    expect(getTimezoneDiffLabel("Asia/Kathmandu", "America/Caracas", new Date("2026-11-19T12:00:00Z"))).toBe("+9.8h respecto a ti");
  });
});

describe("U10 · TIMEZONE_OPTIONS", () => {
  it("todas son IANA válidas, pero solo 16 zonas y una es alias legado", () => {
    for (const o of TIMEZONE_OPTIONS) expect(() => new Intl.DateTimeFormat("en", { timeZone: o.value })).not.toThrow();
    expect(TIMEZONE_OPTIONS.length).toBe(16);
    const values = TIMEZONE_OPTIONS.map(o => o.value);
    expect(values).toContain("America/Buenos_Aires"); // alias backward de America/Argentina/Buenos_Aires
    for (const missing of ["Asia/Kolkata", "America/Guayaquil", "America/Panama", "America/Montevideo", "America/La_Paz",
      "America/Santo_Domingo", "America/Guatemala", "America/Costa_Rica", "America/Denver", "America/Toronto",
      "Europe/Lisbon", "Europe/Berlin", "Atlantic/Canary", "Australia/Sydney"]) {
      expect(values).not.toContain(missing);
    }
  });
});

describe("Funciona bien (control)", () => {
  it("formatTimeTz / getDateKeyTz con medias horas y 45 min", () => {
    const iso = "2026-11-19T18:30:00Z";
    expect(formatTimeTz(iso, "Asia/Kolkata")).toBe("00:00");
    expect(getDateKeyTz(iso, "Asia/Kolkata")).toBe("2026-11-20");
    expect(formatTimeTz(iso, "Asia/Kathmandu")).toBe("00:15");
  });
  it("utcTimeToLocal con Kolkata (offset +5:30) da horas en punto locales", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-19T12:00:00Z"));
    const s = backendLocalToUtc("09:00", "Asia/Kolkata", 2, new Date());
    expect(s.hhmm).toBe("03:30");
    expect(utcTimeToLocal(s.hhmm, 2, "Asia/Kolkata")).toBe("09:00");
  });
  it("formatCalendarDateHuman no se mueve de día en ninguna zona", () => {
    for (const tz of ["Pacific/Kiritimati", "Pacific/Pago_Pago", "America/Caracas", "Asia/Tokyo"]) {
      withBrowserTz(tz, () => expect(formatCalendarDateHuman("2026-11-23")).toBe("lunes, 23 de noviembre"));
    }
  });
});
