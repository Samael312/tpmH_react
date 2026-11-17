import { useEffect, useState } from "react";

/**
 * Devuelve `value` con retraso: solo cambia cuando el valor lleva `delayMs` sin modificarse.
 * Sirve para no llamar a la API en cada tecla de un buscador (el input usa el valor inmediato
 * y la consulta usa el retrasado).
 */
export function useDebouncedValue<T>(value: T, delayMs = 400): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
