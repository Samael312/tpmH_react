import { useEffect, useRef } from "react";

// Sondeos en segundo plano (Fase 14, E2). Cada petición periódica es una consulta a Neon y un hilo del backend:
// solo se sondea con la pestaña visible, y al volver a ella se refresca en el acto (no hace falta un intervalo
// corto para que el dato parezca «al día»).

export function isPageHidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

/** Para `refetchInterval` de React Query: `ms` con la pestaña visible, nada si está oculta. */
export function visiblePoll(ms: number): () => number | false {
  return () => (isPageHidden() ? false : ms);
}

/** Ejecuta `fn` al montar, cada `ms` con la pestaña visible y al volver a la pestaña. */
export function useVisiblePolling(fn: () => unknown, ms: number, enabled = true): void {
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  }, [fn]);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const run = () => {
      if (!isPageHidden()) void fnRef.current();
    };
    run();
    const interval = setInterval(run, ms);
    document.addEventListener("visibilitychange", run);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", run);
    };
  }, [ms, enabled]);
}
