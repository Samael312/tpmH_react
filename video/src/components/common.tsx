import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { colors, fonts, gradients } from "../theme";

/** true en 9:16 (TikTok), false en 16:9. */
export function useIsVertical() {
  const { width, height } = useVideoConfig();
  return height > width;
}

/** Entrada con muelle (0 → 1) a partir de `delay` frames. */
export function usePop(delay = 0, damping = 14) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, config: { damping, mass: 0.8 } });
}

/** Fondo de la marca: degradado suave y manchas que flotan, como el `animate-blob` de la landing. */
export function BrandBackground({ dark = false }: { dark?: boolean }) {
  const frame = useCurrentFrame();
  const blob = (phase: number, amp: number) => ({
    x: Math.sin((frame + phase) / 45) * amp,
    y: Math.cos((frame + phase) / 60) * amp,
    s: 1 + Math.sin((frame + phase) / 70) * 0.06,
  });
  const b1 = blob(0, 40);
  const b2 = blob(90, 55);
  const b3 = blob(180, 35);
  const base = dark ? `linear-gradient(160deg, #1a1a2e 0%, #2a1435 100%)` : gradients.softBg;
  const blobStyle = (color: string, size: number, b: { x: number; y: number; s: number }, pos: CSSProperties): CSSProperties => ({
    position: "absolute",
    width: size,
    height: size,
    borderRadius: "50%",
    background: color,
    filter: "blur(90px)",
    opacity: dark ? 0.45 : 0.55,
    transform: `translate(${b.x}px, ${b.y}px) scale(${b.s})`,
    ...pos,
  });
  return (
    <AbsoluteFill style={{ background: base, overflow: "hidden" }}>
      <div style={blobStyle(colors.primaryLight, 620, b1, { top: -160, left: -180 })} />
      <div style={blobStyle(colors.purpleSoft, 560, b2, { bottom: -180, right: -160 })} />
      <div style={blobStyle("#FDA4AF", 420, b3, { top: "40%", left: "55%" })} />
    </AbsoluteFill>
  );
}

/** Título de escena: palabras que suben una a una; `highlight` va en el degradado de la marca. */
export function Headline({ text, highlight, size, delay = 0, align = "center", color = colors.ink }: {
  text: string;
  highlight?: string;
  size: number;
  delay?: number;
  align?: "center" | "left";
  color?: string;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const words = text.split(" ");
  const clean = (s: string) => s.replace(/[¿?¡!,.]/g, "");
  const hl = new Set((highlight ?? "").split(" ").filter(Boolean).map(clean));
  return (
    <div style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: size, lineHeight: 1.08, letterSpacing: -1.5, color, textAlign: align, display: "flex", flexWrap: "wrap", justifyContent: align === "center" ? "center" : "flex-start", gap: `0 ${size * 0.26}px` }}>
      {words.map((w, i) => {
        const p = spring({ frame: frame - delay - i * 3, fps, config: { damping: 13, mass: 0.7 } });
        const isHl = hl.has(clean(w));
        return (
          <span key={i} style={{
            display: "inline-block",
            opacity: p,
            transform: `translateY(${(1 - p) * size * 0.6}px)`,
            ...(isHl ? { background: gradients.brand, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" } : {}),
          }}>{w}</span>
        );
      })}
    </div>
  );
}

export function Subtitle({ children, size, delay = 0, align = "center" }: { children: ReactNode; size: number; delay?: number; align?: "center" | "left" }) {
  const p = usePop(delay, 18);
  return (
    <div style={{ fontFamily: fonts.sans, fontWeight: 500, fontSize: size, color: colors.inkMuted, textAlign: align, opacity: p, transform: `translateY(${(1 - p) * 20}px)` }}>
      {children}
    </div>
  );
}

/** Tarjeta blanca con el radio y la sombra de las tarjetas de la web. */
export function AppCard({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ background: colors.surface, borderRadius: 40, boxShadow: "0 30px 80px -20px rgba(233,30,140,0.28), 0 8px 24px rgba(26,26,46,0.08)", border: "1px solid #F3E8EF", ...style }}>
      {children}
    </div>
  );
}

export function Pill({ children, bg, color, size = 22, style }: { children: ReactNode; bg: string; color: string; size?: number; style?: CSSProperties }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, background: bg, color, fontFamily: fonts.sans, fontWeight: 700, fontSize: size, padding: `${size * 0.35}px ${size * 0.8}px`, borderRadius: 999, ...style }}>
      {children}
    </span>
  );
}

/** Aparece y se desvanece dentro de la escena (para que la transición no corte en seco). */
export function fadeOut(frame: number, duration: number, frames = 10) {
  return interpolate(frame, [duration - frames, duration], [1, 0.0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
}
