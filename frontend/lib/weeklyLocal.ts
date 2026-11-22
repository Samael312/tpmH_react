// Fase 26: la disponibilidad semanal del profesor llega en HORA LOCAL ("HH:MM" + día local), así que el
// editor no convierte nada. Este helper solo traduce una franja local a celdas de la rejilla del editor
// (una celda = una hora de un día), para que re-guardar no pierda lo que la API acepta.

export interface GridCell { day: number; hour: number }

const mins = (hhmm: string): number => {
  const [h, m] = hhmm.split(":");
  return parseInt(h, 10) * 60 + parseInt(m ?? "0", 10);
};

/** Celdas (día, hora de inicio) cubiertas por una franja local semanal. Fin "23:59" cuenta como 24:00.
 *  Si fin <= inicio (cruza medianoche; 00:00-00:00 = 24 h) la cola cae en el día local siguiente. */
export function localRangeCells(day: number, startLocal: string, endLocal: string): GridCell[] {
  const start = mins(startLocal);
  let end = endLocal.startsWith("23:5") ? 24 * 60 : mins(endLocal);
  const cells: GridCell[] = [];
  const crosses = end <= start;
  if (crosses) end += 24 * 60;
  for (let h = Math.floor(start / 60); h * 60 < end; h++) {
    cells.push({ day: (day + Math.floor(h / 24)) % 7, hour: h % 24 });
  }
  return cells;
}

/** Hidratación de la rejilla del ALUMNO (preferencias guardadas en UTC): de un bloque local «HH:MM»–«HH:MM» a las horas en
 *  punto que cubre. Un bloque que termina en 23:59 (guardado como fin de día) pierde la última hora (U1, legado). */
export function hoursFromBlock(localStart: string, localEnd: string): string[] {
  const out: string[] = [];
  const startHour = parseInt(localStart.split(":")[0]);
  let endHour = parseInt(localEnd.split(":")[0]);
  if (localEnd.startsWith("00:0") && startHour > 0) endHour = 24;
  for (let h = startHour; h < endHour; h++) out.push(`${h.toString().padStart(2, "0")}:00`);
  return out;
}
