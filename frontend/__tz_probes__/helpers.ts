// Copias literales de funciones NO exportadas de los componentes, para poder sondearlas.
// Si el componente cambia, actualiza la copia (cada una cita su origen).

/** Node relee process.env.TZ en caliente: simula "navegador en esa zona". */
export function withBrowserTz<T>(tz: string, fn: () => T): T {
  const prev = process.env.TZ;
  process.env.TZ = tz;
  try { return fn(); } finally { process.env.TZ = prev; }
}

/** app/(teacher)/teacher/dashboard/page.tsx:42-55 y app/(student)/dashboard/classes/page.tsx:322-335 */
export function toUtcDateStr(date: Date) {
  return date.toISOString().split("T")[0];
}
export function getWeekDates(today: Date) {
  const monday = new Date(today);
  monday.setUTCDate(today.getUTCDate() - today.getUTCDay() + 1);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setUTCDate(monday.getUTCDate() + i);
    return d;
  });
}

/** components/classes/ClassCard.tsx:104-125 */
export function localDateTimeToUtcIso(dateStr: string, timeStr: string, timeZone: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const [hour, minute] = timeStr.split(":").map(Number);
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const parts = dtf.formatToParts(utcGuess).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {} as Record<string, string>);
  const asUTC = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour) % 24, Number(parts.minute), Number(parts.second));
  const offsetMinutes = (asUTC - utcGuess.getTime()) / 60000;
  return new Date(utcGuess.getTime() - offsetMinutes * 60000).toISOString();
}

/** components/classes/ClassCard.tsx:128-163 */
function getUtcOffsetMinutes(timeZone: string, date = new Date()): number | null {
  try {
    const dtf = new Intl.DateTimeFormat("en-US", { timeZone, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const parts = dtf.formatToParts(date).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {} as Record<string, string>);
    const asUTC = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour) % 24, Number(parts.minute), Number(parts.second));
    return Math.round((asUTC - date.getTime()) / 60000);
  } catch { return null; }
}
export function getTimezoneDiffLabel(otherTz: string, myTz: string, at = new Date()): string | null {
  const offOther = getUtcOffsetMinutes(otherTz, at);
  const offMy = getUtcOffsetMinutes(myTz, at);
  if (offOther === null || offMy === null) return null;
  const diffHours = (offOther - offMy) / 60;
  if (diffHours === 0) return "Mismo huso horario";
  const sign = diffHours > 0 ? "+" : "";
  const rounded = Math.abs(diffHours % 1) < 0.01 ? diffHours.toFixed(0) : diffHours.toFixed(1);
  return `${sign}${rounded}h respecto a ti`;
}

/** Hidratación de la rejilla semanal: app/(teacher)/teacher/availability/page.tsx:61-80
 *  (idéntica en app/(student)/dashboard/availability/page.tsx:68-92). Recibe las horas locales ya convertidas. */
export function hoursFromBlock(localStart: string, localEnd: string): string[] {
  const out: string[] = [];
  const startHour = parseInt(localStart.split(":")[0]);
  let endHour = parseInt(localEnd.split(":")[0]);
  if (localEnd.startsWith("00:0") && startHour > 0) endHour = 24;
  for (let h = startHour; h < endHour; h++) out.push(`${h.toString().padStart(2, "0")}:00`);
  return out;
}

/** Puerto a TS de backend/app/core/timezone.py::convert_local_time_to_utc (para simular el guardado). */
export function backendLocalToUtc(timeStr: string, tz: string, dayOfWeek: number, now: Date): { hhmm: string; utcDow: number } {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).formatToParts(now);
  const g = (t: string) => p.find(x => x.type === t)!.value;
  const wd = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(g("weekday"));
  const ahead = (dayOfWeek - wd + 7) % 7;
  const ref = new Date(Date.UTC(+g("year"), +g("month") - 1, +g("day") + ahead));
  const dateStr = ref.toISOString().slice(0, 10);
  const iso = localDateTimeToUtcIsoExact(dateStr, timeStr, tz);
  const d = new Date(iso);
  return { hhmm: iso.slice(11, 16), utcDow: (d.getUTCDay() + 6) % 7 };
}
/** Conversión local→UTC correcta (dos pasadas), solo para la simulación del backend. */
export function localDateTimeToUtcIsoExact(dateStr: string, timeStr: string, tz: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = timeStr.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  let t = wall;
  for (let i = 0; i < 2; i++) t = wall - (getUtcOffsetMinutes(tz, new Date(t)) ?? 0) * 60000;
  return new Date(t).toISOString();
}
