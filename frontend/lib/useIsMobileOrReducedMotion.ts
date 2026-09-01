"use client";

import { useEffect, useState } from "react";

/**
 * Devuelve `true` una vez confirmado en el cliente que el viewport es
 * mobile (mismo breakpoint `md` de Tailwind, 768px) o que el usuario
 * tiene "reduce motion" activado en el SO — casos en los que no vale
 * la pena pagar el costo de animaciones decorativas pesadas (ej. el
 * fondo de partículas de Three.js del hero).
 *
 * Arranca en `null` ("todavía no se sabe") en vez de `false`, para que
 * el caller pueda tratar ese estado inicial como "no renderizar todavía"
 * y no dispare la carga del bundle pesado antes de confirmar que hace
 * falta — así en mobile el chunk de three.js ni se descarga.
 */
export function useIsMobileOrReducedMotion(): boolean | null {
  const [value, setValue] = useState<boolean | null>(null);

  useEffect(() => {
    const mobileQuery = window.matchMedia("(max-width: 767px)");
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

    const update = () => setValue(mobileQuery.matches || motionQuery.matches);
    update();

    mobileQuery.addEventListener("change", update);
    motionQuery.addEventListener("change", update);
    return () => {
      mobileQuery.removeEventListener("change", update);
      motionQuery.removeEventListener("change", update);
    };
  }, []);

  return value;
}
