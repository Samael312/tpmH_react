/** Primer elemento que coincide con `selector` y está visible. Sidebar y pestañas móviles comparten `data-tour`, y el
 *  que no corresponde al tamaño de pantalla está con display:none (getClientRects vacío). */
export function resolveVisibleTarget(selector: string): HTMLElement | null {
  const all = document.querySelectorAll<HTMLElement>(selector);
  for (const el of Array.from(all)) {
    if (el.getClientRects().length > 0) return el;
  }
  return null;
}

/** Espera (rAF) a que aparezca un elemento visible; null si no aparece en `timeoutMs`. Sirve para los ítems del panel «Más». */
export function waitForVisibleTarget(selector: string, timeoutMs = 600): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      const el = resolveVisibleTarget(selector);
      if (el) return resolve(el);
      if (Date.now() - start >= timeoutMs) return resolve(null);
      requestAnimationFrame(tick);
    };
    tick();
  });
}
