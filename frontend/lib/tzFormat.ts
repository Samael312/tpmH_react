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