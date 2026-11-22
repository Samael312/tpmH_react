/** Misma ventana que `CLASS_STATUS_WINDOW_HOURS` del backend (`class_logic.py`). */
export const MANUAL_STATUS_WINDOW_HOURS = 72;

/**
 * Aviso de una clase `finalized` (terminó y nadie la marcó): al profesor le dice cuánto le queda antes de que pase sola a
 * «No asistió» (consume el crédito); al alumno, que depende de su profesor y por qué no puede reseñar aún.
 * Devuelve null si no hay nada que avisar.
 */
export function finalizedNotice(
  role: string,
  endUtc: Date,
  now: Date = new Date(),
): { text: string; urgent: boolean } | null {
  const hoursLeft = MANUAL_STATUS_WINDOW_HOURS - (now.getTime() - endUtc.getTime()) / 3_600_000;
  if (role === "student") return { text: "Pendiente de que tu profesor la marque. Hasta entonces no puedes reseñarla.", urgent: false };
  if (role !== "teacher") return null;
  if (hoursLeft <= 0) return { text: "Plazo vencido: pasará a «No asistió» en cualquier momento.", urgent: true };
  const left = hoursLeft >= 24 ? `${Math.floor(hoursLeft / 24)} d ${Math.floor(hoursLeft % 24)} h` : `${Math.max(1, Math.floor(hoursLeft))} h`;
  return {
    text: `Márcala como completada o no asistida: en ${left} pasará sola a «No asistió» y se descontará el crédito.`,
    urgent: hoursLeft < 24,
  };
}

export interface PendingToMark {
  count: number;
  /** Horas que le quedan a la clase más urgente antes de pasar sola a «No asistió» (<= 0: plazo vencido). */
  hoursLeft: number;
}

/** Clases `finalized` (no externas) que el profesor aún debe marcar. null si no hay ninguna. */
export function pendingToMark(
  classes: { status: string; class_type?: string | null; end_time_utc?: string | null }[],
  now: Date = new Date(),
): PendingToMark | null {
  let count = 0;
  let minLeft = Infinity;
  for (const c of classes) {
    if (c.status !== "finalized" || c.class_type === "external" || !c.end_time_utc) continue;
    const left = MANUAL_STATUS_WINDOW_HOURS - (now.getTime() - new Date(c.end_time_utc).getTime()) / 3_600_000;
    count += 1;
    if (left < minLeft) minLeft = left;
  }
  return count ? { count, hoursLeft: minLeft } : null;
}

/** Texto del resumen del dashboard: «Tienes 3 clases por marcar; la más urgente vence en 5 h». */
export function pendingToMarkText({ count, hoursLeft }: PendingToMark): string {
  const noun = count === 1 ? "1 clase por marcar" : `${count} clases por marcar`;
  if (hoursLeft <= 0) return `Tienes ${noun}; el plazo de la más urgente ya venció.`;
  const when = hoursLeft >= 24 ? `${Math.floor(hoursLeft / 24)} d ${Math.floor(hoursLeft % 24)} h` : `${Math.max(1, Math.floor(hoursLeft))} h`;
  return `Tienes ${noun}; la más urgente vence en ${when}.`;
}

/**
 * Espejo de `CLASS_STATUS_TRANSITIONS` (backend/app/core/class_logic.py): a qué estados se puede pasar a mano desde cada
 * uno. Estados terminales (cancelled, expired, rescheduled) no admiten ninguno. Si el backend cambia la tabla, cámbiala
 * aquí también (hay un test que la compara con el contrato).
 */
export const CLASS_STATUS_TRANSITIONS: Record<string, readonly string[]> = {
  pending: ["confirmed", "cancelled", "completed", "no_show"],
  pending_trial: ["confirmed", "cancelled", "completed", "no_show"],
  pending_payment: ["confirmed", "cancelled", "completed", "no_show"],
  confirmed: ["cancelled", "completed", "no_show", "finalized"],
  finalized: ["completed", "no_show"],
  completed: ["no_show", "finalized"],
  no_show: ["completed", "finalized"],
  cancelled: [],
  expired: [],
  rescheduled: [],
};

const MANUAL_TARGETS = ["completed", "no_show", "finalized"] as const;

/**
 * Estados que el PROFESOR puede poner a mano sobre una clase: solo los permitidos por el backend desde su estado
 * actual, dentro de la ventana de 72 h, y sin marcar «completada/no asistió» una clase que aún no empezó.
 */
export function manualStatusTargets(status: string, startUtc: Date, endUtc: Date, now: Date = new Date()): string[] {
  const hoursSinceEnd = (now.getTime() - endUtc.getTime()) / 3_600_000;
  if (hoursSinceEnd > MANUAL_STATUS_WINDOW_HOURS) return [];
  const allowed = CLASS_STATUS_TRANSITIONS[status] ?? [];
  const started = startUtc.getTime() <= now.getTime();
  return MANUAL_TARGETS.filter((t) => allowed.includes(t) && (started || t === "finalized"));
}
