// frontend/lib/tzFormat.ts
//
// Utilidades para mostrar instantes UTC (lo que siempre devuelve el backend)
// en la zona horaria CORRECTA de la persona que está mirando la pantalla.
//
// PROBLEMA que resuelve: `new Date(utc).toLocaleTimeString(...)` sin pasar
// `timeZone` usa la zona horaria del dispositivo/navegador donde corre el
// código — NO la zona horaria guardada en el perfil del usuario. Esto provoca
// que, por ejemplo, dos cuentas abiertas en el mismo PC (una de un profesor
// en Caracas y otra de un estudiante en Madrid) vean exactamente la misma
// hora "sin convertir", en vez de cada una ver su propia hora local.
//
// Regla: SIEMPRE pasar `timeZone` explícito a Intl/toLocale*, usando la zona
// horaria guardada en el perfil de la cuenta (no la detectada del navegador)
// como fuente de la verdad.

import { useAuthStore } from "@/store/authStore";

/**
 * Zona horaria a usar para mostrarle algo a la cuenta actualmente logueada.
 * Prioridad:
 *   1. La guardada en su perfil (user.timezone) — la fuente de la verdad.
 *   2. La detectada del navegador, solo como último recurso (ej. antes de
 *      completar el onboarding).
 */
export function getMyDisplayTimezone(): string {
  const stored = useAuthStore.getState().user?.timezone;
  if (stored) return stored;
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** "18:00" — hora en formato 24h para una zona horaria específica */
export function formatTimeTz(utcIso: string, timeZone: string): string {
  return new Date(utcIso).toLocaleTimeString("es", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  });
}

/** "lun" — día de la semana corto en una zona horaria específica */
export function formatWeekdayShortTz(utcIso: string, timeZone: string): string {
  return new Date(utcIso).toLocaleDateString("es", { weekday: "short", timeZone });
}

/** "ene" — mes corto en una zona horaria específica */
export function formatMonthShortTz(utcIso: string, timeZone: string): string {
  return new Date(utcIso)
    .toLocaleDateString("es", { month: "short", timeZone })
    .replace(".", "");
}

/** Día del mes (número) correcto para una zona horaria específica.
 *  OJO: Date.getDate() NO sirve aquí — siempre usa la zona del sistema. */
export function getDayOfMonthTz(utcIso: string, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { day: "numeric", timeZone }).formatToParts(
    new Date(utcIso)
  );
  const day = parts.find((p) => p.type === "day")?.value;
  return day ? parseInt(day, 10) : new Date(utcIso).getDate();
}

/** {hour, minute} correctos para una zona horaria específica.
 *  OJO: Date.getHours()/getMinutes() NO sirven aquí — usan la zona del sistema. */
export function getHourMinuteTz(
  utcIso: string,
  timeZone: string
): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).formatToParts(new Date(utcIso));
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  return { hour, minute };
}

/** Fecha larga tipo "lunes, 13 de enero" en una zona horaria específica */
export function formatDateHumanTz(utcIso: string, timeZone: string): string {
  return new Date(utcIso).toLocaleDateString("es", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone,
  });
}

/** "jueves, 19 de noviembre" para una fecha de calendario "YYYY-MM-DD" ya elegida por la persona. No lleva hora ni
 *  zona: se formatea al mediodía UTC para que ni la zona del navegador ni la del perfil la muevan de día. */
export function formatCalendarDateHuman(dateKey: string): string {
  return new Date(`${dateKey}T12:00:00Z`).toLocaleDateString("es", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}

/** "2026-01-13" — clave de fecha (año-mes-día) correcta para una zona
 *  horaria específica, para comparar/agrupar por "día calendario" tal como
 *  lo percibe la persona (no el día UTC crudo). Usa "en-CA" porque ese
 *  locale es el único que Intl formatea nativamente como YYYY-MM-DD. */
export function getDateKeyTz(utcIso: string, timeZone: string): string {
  return new Date(utcIso).toLocaleDateString("en-CA", { timeZone });
}

/** Desfase (ms) de `timeZone` respecto a UTC en el instante `utcMs` (positivo si va por delante de UTC). */
function tzOffsetMs(utcMs: number, timeZone: string): number {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", minute: "numeric", second: "numeric",
  }).formatToParts(new Date(utcMs));
  const g = (t: string) => parseInt(p.find((x) => x.type === t)?.value ?? "0", 10);
  return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - Math.floor(utcMs / 1000) * 1000;
}

/**
 * Convierte una fecha/hora de pared "YYYY-MM-DDTHH:mm" elegida en `timeZone` al instante UTC (ISO con «Z»).
 * Devuelve null si el texto no es válido. Se recalcula el desfase una vez para acertar en cambios de horario.
 */
export function zonedLocalToUtcIso(local: string, timeZone: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local);
  if (!m) return null;
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  let utc = wall - tzOffsetMs(wall, timeZone);
  utc = wall - tzOffsetMs(utc, timeZone);
  const d = new Date(utc);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}


// ─── Conversión local a ISO UTC según zona horaria IANA ──────────────────
export function localDateTimeToUtcIso(dateStr: string, timeStr: string, timeZone: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const [hour, minute] = timeStr.split(":").map(Number);
  
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const parts = dtf.formatToParts(utcGuess).reduce((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {} as Record<string, string>);
  
  const asUTC = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour) % 24, Number(parts.minute), Number(parts.second)
  );
  const offsetMinutes = (asUTC - utcGuess.getTime()) / 60000;
  return new Date(utcGuess.getTime() - offsetMinutes * 60000).toISOString();
}

// ─── Diferencia de zona horaria entre dos IANA timezones ────────────────────
export function getUtcOffsetMinutes(timeZone: string, date = new Date()): number | null {
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    const parts = dtf.formatToParts(date).reduce((acc, p) => {
      acc[p.type] = p.value;
      return acc;
    }, {} as Record<string, string>);
    const asUTC = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour) % 24, Number(parts.minute), Number(parts.second)
    );
    return (asUTC - date.getTime()) / 60000;
  } catch {
    return null;
  }
}

/** Devuelve la diferencia horaria de `otherTz` respecto a `myTz`, ej. "+3h" o "-1.5h" */
export function getTimezoneDiffLabel(otherTz?: string | null, myTz?: string | null, at: Date = new Date()): string | null {
  if (!otherTz || !myTz) return null;
  const offOther = getUtcOffsetMinutes(otherTz, at);
  const offMy = getUtcOffsetMinutes(myTz, at);
  if (offOther === null || offMy === null) return null;

  const diffHours = (offOther - offMy) / 60;
  if (diffHours === 0) return "Mismo huso horario";

  const sign = diffHours > 0 ? "+" : "";
  const rounded = Math.abs(diffHours % 1) < 0.01 ? diffHours.toFixed(0) : diffHours.toFixed(1);
  return `${sign}${rounded}h respecto a ti`;
}

/** Fecha legible («lunes, 23 de noviembre») de un `YYYY-MM-DD` o ISO, interpretada en la zona del NAVEGADOR (no en la del
 *  perfil). Con `YYYY-MM-DD` el navegador lo toma como UTC, así que en husos negativos sale el día anterior (U6):
 *  para fechas de calendario existe `formatCalendarDateHuman`. */
export function formatDateHuman(dateStr: string): string {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long" });
}
