export function hexToRgb(hex: string) {
  const clean = hex.replace("#", "").trim();
  const full = clean.length === 3 ? clean.split("").map(c => c + c).join("") : clean;
  const bigint = parseInt(full, 16);
  if (Number.isNaN(bigint)) return { r: 236, g: 72, b: 153 }; // fallback pink-500
  return { r: (bigint >> 16) & 255, g: (bigint >> 8) & 255, b: bigint & 255 };
}

// percent > 0 aclara, percent < 0 oscurece
export function shadeColor(hex: string, percent: number): string {
  try {
    const { r, g, b } = hexToRgb(hex);
    const t = percent < 0 ? 0 : 255;
    const p = Math.abs(percent) / 100;
    const nr = Math.round((t - r) * p) + r;
    const ng = Math.round((t - g) * p) + g;
    const nb = Math.round((t - b) * p) + b;
    return `rgb(${nr}, ${ng}, ${nb})`;
  } catch {
    return hex;
  }
}

export const DEFAULT_THEME_COLOR = "#ec4899";

export const THEME_PRESETS = [
  { label: "Rosa",     value: "#ec4899" },
  { label: "Rojo",     value: "#ef4444" },
  { label: "Naranja",  value: "#f97316" },
  { label: "Ámbar",    value: "#f59e0b" },
  { label: "Esmeralda",value: "#10b981" },
  { label: "Azul",     value: "#3b82f6" },
  { label: "Índigo",   value: "#6366f1" },
  { label: "Violeta",  value: "#8b5cf6" },
  { label: "Slate",    value: "#475569" },
];