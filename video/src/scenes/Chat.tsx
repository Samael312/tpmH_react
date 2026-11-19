import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { AppCard, BrandBackground, Headline, Pill, Subtitle, useIsVertical, usePop } from "../components/common";
import { MARIA, usePromo } from "../mode";
import { colors, fonts, gradients } from "../theme";

// Beneficio 3: chat con el profe, materiales y Chipi (el asistente de la plataforma).
const MESSAGES: { from: "me" | "teacher"; text: string; at: number }[] = [
  { from: "me", text: "¡Hola! ¿Repasamos el pasado simple?", at: 22 },
  { from: "teacher", text: "¡Claro! Te dejé ejercicios en tu panel 📚", at: 46 },
  { from: "me", text: "¡Genial, nos vemos el miércoles! 🙌", at: 70 },
];

function Bubble({ m, size }: { m: (typeof MESSAGES)[number]; size: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - m.at, fps, config: { damping: 13 } });
  const mine = m.from === "me";
  return (
    <div style={{ display: "flex", justifyContent: mine ? "flex-end" : "flex-start", opacity: p, transform: `translateY(${(1 - p) * 30}px) scale(${0.85 + p * 0.15})`, transformOrigin: mine ? "right bottom" : "left bottom" }}>
      <div style={{ maxWidth: "88%", padding: `${size * 0.6}px ${size * 0.85}px`, borderRadius: 30, borderBottomRightRadius: mine ? 8 : 30, borderBottomLeftRadius: mine ? 30 : 8, background: mine ? gradients.brand : colors.surfaceMuted, color: mine ? "white" : colors.ink, fontFamily: fonts.sans, fontWeight: 500, fontSize: size }}>
        {m.text}
      </div>
    </div>
  );
}

function Typing({ at, until }: { at: number; until: number }) {
  const frame = useCurrentFrame();
  if (frame < at || frame >= until) return null;
  return (
    <div style={{ display: "flex", gap: 8, padding: "18px 26px", background: colors.surfaceMuted, borderRadius: 30, alignSelf: "flex-start", width: "fit-content" }}>
      {[0, 1, 2].map((i) => (
        <div key={i} style={{ width: 14, height: 14, borderRadius: "50%", background: colors.inkSubtle, transform: `translateY(${Math.sin((frame + i * 5) / 3) * 5}px)` }} />
      ))}
    </div>
  );
}

export function Chat() {
  const v = useIsVertical();
  const frame = useCurrentFrame();
  const card = usePop(6, 15);
  const chipi = usePop(92, 12);
  const size = v ? 34 : 30;
  const single = usePromo().mode === "single";

  return (
    <AbsoluteFill>
      <BrandBackground />
      <AbsoluteFill style={{ flexDirection: v ? "column" : "row-reverse", alignItems: "center", justifyContent: "center", paddingBottom: v ? 200 : 0, gap: v ? 0 : 90 }}>
        <div style={{ width: v ? 900 : 640, display: "flex", flexDirection: "column", gap: 22, alignItems: v ? "center" : "flex-start" }}>
          <Headline text={single ? `Habla con ${MARIA.name}` : "Habla con tu profe"} highlight={single ? MARIA.name : "tu profe"} size={v ? 104 : 92} align={v ? "center" : "left"} />
          <Subtitle size={v ? 38 : 34} delay={10} align={v ? "center" : "left"}>Chat, materiales y tareas en un solo lugar</Subtitle>
        </div>

        <div style={{ marginTop: v ? 70 : 0, position: "relative" }}>
          <AppCard style={{ width: v ? 880 : 860, padding: 0, overflow: "hidden", opacity: card, transform: `translateY(${(1 - card) * 90}px)` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 20, padding: "26px 34px", borderBottom: `1px solid ${colors.surfaceMuted}` }}>
              <div style={{ width: 72, height: 72, borderRadius: 22, background: gradients.brand, color: "white", fontFamily: fonts.display, fontWeight: 800, fontSize: 28, display: "flex", alignItems: "center", justifyContent: "center" }}>MG</div>
              <div>
                <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 32, color: colors.ink }}>María · Inglés</div>
                <div style={{ fontFamily: fonts.sans, fontSize: 22, color: colors.green, fontWeight: 700 }}>● En línea</div>
              </div>
            </div>
            <div style={{ padding: 34, display: "flex", flexDirection: "column", gap: 18, minHeight: v ? 420 : 380 }}>
              <Bubble m={MESSAGES[0]} size={size} />
              <Typing at={30} until={46} />
              <Bubble m={MESSAGES[1]} size={size} />
              <Bubble m={MESSAGES[2]} size={size} />
              <div style={{ display: "flex", gap: 12, marginTop: 10, opacity: interpolate(frame, [80, 92], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>
                <Pill bg={colors.pink50} color={colors.primaryDark} size={22}>📎 Material: Past Simple.pdf</Pill>
                <Pill bg="#F5F3FF" color={colors.purple} size={22}>✏️ Tarea nueva</Pill>
              </div>
            </div>
          </AppCard>

          {/* Chipi, el asistente: resuelve dudas de la plataforma */}
          <div style={{ position: "absolute", right: v ? -10 : -60, bottom: v ? -150 : -110, display: "flex", alignItems: "center", gap: 16, opacity: chipi, transform: `scale(${0.7 + chipi * 0.3})`, transformOrigin: "right center" }}>
            <div style={{ background: colors.ink, color: "white", fontFamily: fonts.sans, fontWeight: 700, fontSize: v ? 28 : 24, padding: "18px 26px", borderRadius: 28, borderBottomRightRadius: 6, boxShadow: "0 16px 40px -10px rgba(26,26,46,.45)" }}>
              ¿Dudas? Chipi te ayuda al momento
            </div>
            <Img src={staticFile("logo.png")} style={{ width: v ? 110 : 96, height: v ? 110 : 96, borderRadius: "50%", boxShadow: "0 10px 30px -8px rgba(233,30,140,.6)" }} />
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
