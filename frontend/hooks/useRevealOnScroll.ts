"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Detecta cuándo un elemento entra en el viewport para dispararle una
 * animación de entrada (ver components/ui/Reveal.tsx). Se dispara UNA
 * sola vez — una vez visible, se desconecta el observer, así que no
 * "parpadea" si el usuario sube y baja la página.
 *
 * Devuelve `true` de entrada (sin animar nada) cuando el usuario tiene
 * prefers-reduced-motion activado, para no forzarle movimiento que no
 * quiere ver — el contenido aparece directo, sin transición.
 */
export function useRevealOnScroll<T extends HTMLElement = HTMLDivElement>(
  options: IntersectionObserverInit = { threshold: 0.15, rootMargin: "0px 0px -40px 0px" }
) {
  const ref = useRef<T | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) {
      setIsVisible(true);
      return;
    }

    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setIsVisible(true);
        observer.disconnect();
      }
    }, options);

    observer.observe(node);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { ref, isVisible };
}
