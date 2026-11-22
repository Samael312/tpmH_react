// Ayudas de las sondas. TODO lo que se sondea se importa del código REAL (lib/*): aquí ya no hay copias del frontend.
// Lo único que no es del frontend es `backendLocalToUtc`: un puerto a TS de backend/app/core/timezone.py para simular
// "guardado en el servidor" y comparar con lo que luego pinta el frontend.
import { getUtcOffsetMinutes } from "@/lib/tzFormat";

/** Node relee process.env.TZ en caliente: simula "navegador en esa zona". */
export function withBrowserTz<T>(tz: string, fn: () => T): T {
  const prev = process.env.TZ;
  process.env.TZ = tz;
  try { return fn(); } finally { process.env.TZ = prev; }
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
