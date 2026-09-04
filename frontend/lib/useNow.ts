import { useEffect, useState } from "react";

/**
 * Devuelve el timestamp actual (ms), refrescado periódicamente.
 *
 * Llamar a `Date.now()` directamente en el cuerpo de un componente lo hace
 * impuro (ver regla `react-hooks/purity`): dos renders del mismo componente
 * podrían devolver valores distintos sin que cambie ningún estado/prop, lo
 * que puede producir resultados inconsistentes si React decide volver a
 * renderizar por otros motivos. Este hook resuelve eso guardando el valor en
 * estado (inicializado de forma perezosa, que sí está permitido) y
 * actualizándolo desde un efecto con `setInterval`.
 */
export function useNow(intervalMs = 60000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}
