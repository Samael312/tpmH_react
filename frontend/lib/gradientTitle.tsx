// frontend/lib/gradientTitle.tsx
//
// Soporte para "títulos con color" en el landing (config del superadmin):
// el admin escribe el texto normal y envuelve las palabras que quiere
// resaltar con dobles llaves, ej. "Aprende {{idiomas}} a tu ritmo", y
// elige un gradiente predefinido por sección. Acá se parsea ese marcador
// y se renderiza como <span> con gradiente (bg-clip-text), tanto en el
// landing público como en la vista previa del panel admin.
//
// Los gradientes son un set fijo (no color picker libre) para mantener
// consistencia con la paleta de marca ya usada en el resto del sitio
// (ver botones, CTAs, etc. -- todos "from-pink-500 to-rose-400" y
// variantes). Las clases están escritas literales (no armadas por
// template string) para que Tailwind las detecte al escanear el código.

import type { ReactNode } from "react";

export interface GradientPreset {
  id: string;
  label: string;
  /** Clases Tailwind completas para el <span> con bg-clip-text. */
  className: string;
}

export const GRADIENT_PRESETS: GradientPreset[] = [
  {
    id: "pink_rose",
    label: "Rosa → Coral (marca)",
    className: "bg-gradient-to-r from-pink-500 to-rose-400 bg-clip-text text-transparent",
  },
  {
    id: "purple_pink",
    label: "Púrpura → Rosa",
    className: "bg-gradient-to-r from-purple-600 to-pink-500 bg-clip-text text-transparent",
  },
  {
    id: "pink_purple_trio",
    label: "Rosa → Púrpura (tricolor)",
    className: "bg-gradient-to-r from-pink-400 via-rose-400 to-purple-400 bg-clip-text text-transparent",
  },
  {
    id: "amber_orange",
    label: "Ámbar → Naranja",
    className: "bg-gradient-to-r from-amber-500 to-orange-500 bg-clip-text text-transparent",
  },
  {
    id: "emerald_teal",
    label: "Esmeralda → Verde azulado",
    className: "bg-gradient-to-r from-emerald-500 to-teal-400 bg-clip-text text-transparent",
  },
  {
    id: "slate",
    label: "Pizarra (sobrio, oscuro)",
    className: "bg-gradient-to-r from-slate-700 to-slate-900 bg-clip-text text-transparent",
  },
];

export function getGradientPreset(id: string | null | undefined): GradientPreset | null {
  if (!id) return null;
  return GRADIENT_PRESETS.find((g) => g.id === id) ?? null;
}

/**
 * Convierte un texto con marcadores `{{palabra}}` en nodos React, donde las
 * partes marcadas quedan envueltas en un <span> con el gradiente elegido.
 * Si `gradientId` no corresponde a ningún preset (vacío, "none", o el admin
 * todavía no eligió uno), los marcadores simplemente se quitan y el texto
 * se muestra plano -- nunca se filtran las llaves `{{ }}` sin procesar al
 * usuario final.
 */
export function renderGradientTitle(text: string, gradientId?: string | null): ReactNode {
  if (!text) return text;
  const preset = getGradientPreset(gradientId);
  const parts = text.split(/(\{\{[^{}]*\}\})/g).filter((p) => p !== "");

  return parts.map((part, i) => {
    const match = /^\{\{([^{}]*)\}\}$/.exec(part);
    if (!match) return part;
    const word = match[1];
    if (!preset) return word;
    return (
      <span key={i} className={preset.className}>
        {word}
      </span>
    );
  });
}

/** Versión "texto plano" (sin JSX) -- útil para <title>, meta tags, alt, etc. */
export function stripGradientMarkers(text: string): string {
  if (!text) return text;
  return text.replace(/\{\{([^{}]*)\}\}/g, "$1");
}
