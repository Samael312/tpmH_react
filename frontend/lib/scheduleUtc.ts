// Utilidades para convertir horarios semanales recurrentes (guardados como
// "HH:MM" UTC + day_of_week) a la hora local del navegador, de forma
// consistente con la lógica del backend (misma "próxima fecha real" de
// referencia para ese día de la semana, evita el desfase de 1h por DST).

// day_of_week: 0=Lunes...6=Domingo (ISO), igual que el backend
export function getNextWeekdayDate(dayOfWeek: number, from: Date = new Date()): Date {
  const jsDay = from.getDay();           // 0=Domingo...6=Sábado
  const isoToday = (jsDay + 6) % 7;      // 0=Lunes...6=Domingo
  const daysAhead = (dayOfWeek - isoToday + 7) % 7;
  const result = new Date(from);
  result.setDate(from.getDate() + daysAhead);
  return result;
}

export function utcTimeToLocal(utcTimeStr: string, dayOfWeek: number, timeZone: string): string {
  try {
    const [h, m] = utcTimeStr.split(":").map(Number);
    const refDate = getNextWeekdayDate(dayOfWeek);
    const utcDate = new Date(Date.UTC(
      refDate.getFullYear(), refDate.getMonth(), refDate.getDate(), h, m
    ));
    return new Intl.DateTimeFormat("en-GB", {
      timeZone, hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(utcDate);
  } catch {
    return utcTimeStr;
  }
}