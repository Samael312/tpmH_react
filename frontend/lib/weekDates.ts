// Tira semanal de «Mis clases» (profesor y alumno). OJO (U4): trabaja en UTC, no en el día local de quien mira.

/** `YYYY-MM-DD` del día UTC de `date`. */
export function toUtcDateStr(date: Date): string {
  return date.toISOString().split("T")[0];
}

/** Los 7 días (lunes → domingo, en UTC) de la semana de `today`. En domingo UTC arranca el lunes SIGUIENTE. */
export function getWeekDates(today: Date = new Date()): Date[] {
  const monday = new Date(today);
  monday.setUTCDate(today.getUTCDate() - today.getUTCDay() + 1);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setUTCDate(monday.getUTCDate() + i);
    return d;
  });
}
