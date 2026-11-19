import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { BrandBackground, Headline, Pill, Subtitle, useIsVertical, usePop } from "../components/common";
import { MARIA, usePromo } from "../mode";
import { colors, fonts, gradients } from "../theme";

// Single-tenant: sustituye a «Elige a tu profe». Recrea el hero de la landing en ese modo: foto girada en marco
// redondeado con borde blanco y halo rosa, y tarjetas que flotan alrededor (animate-[float]).
export function MeetMaria() {
  const v = useIsVertical();
  const frame = useCurrentFrame();
  const { photo } = usePromo();
  const card = usePop(10, 13);
  const b1 = usePop(36, 13);
  const b2 = usePop(46, 13);
  const b3 = usePop(56, 13);
  const float = (phase: number) => Math.sin((frame + phase) / 18) * 10;
  const rot = interpolate(card, [0, 1], [10, 3]);

  const w = v ? 560 : 470;
  const h = v ? 680 : 570;

  const portrait = (
    <div style={{ position: "relative", width: w, height: h, opacity: card, transform: `scale(${0.8 + card * 0.2})` }}>
      <div style={{ position: "absolute", inset: -20, borderRadius: 90, background: `linear-gradient(135deg, #FDA4AF, #F9A8D4)`, filter: "blur(40px)", opacity: 0.55 }} />
      <div style={{ position: "absolute", inset: 0, borderRadius: 72, overflow: "hidden", border: "10px solid white", boxShadow: "0 40px 80px -20px rgba(233,30,140,.45)", transform: `rotate(${rot}deg)`, background: gradients.brand }}>
        {photo ? (
          <Img src={staticFile(photo)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontFamily: fonts.display, fontWeight: 800, fontSize: w * 0.45 }}>
            {MARIA.initials}
          </div>
        )}
      </div>
      <div style={{ position: "absolute", top: -30, right: -50, opacity: b1, transform: `translateY(${float(0) + (1 - b1) * 30}px)` }}>
        <Badge icon="🗣️" title="Clases de inglés" sub="Desde principiante hasta avanzado" />
      </div>
      <div style={{ position: "absolute", bottom: v ? 70 : 50, left: -70, opacity: b2, transform: `translateY(${float(30) + (1 - b2) * 30}px)` }}>
        <Badge icon="💻" title="100% online" sub="Clases 1 a 1 personalizadas" />
      </div>
      <div style={{ position: "absolute", bottom: -36, right: -30, opacity: b3, transform: `translateY(${float(60) + (1 - b3) * 30}px)` }}>
        <Pill bg={colors.ink} color="white" size={v ? 30 : 26} style={{ boxShadow: "0 16px 40px -10px rgba(26,26,46,.5)" }}>🎁 Primera clase de prueba gratis</Pill>
      </div>
    </div>
  );

  const text = (
    <div style={{ width: v ? 920 : 720, display: "flex", flexDirection: "column", gap: 22, alignItems: v ? "center" : "flex-start" }}>
      <Headline text={`Conoce a ${MARIA.name}, tu profe de ${MARIA.language}`} highlight={`${MARIA.name}, ${MARIA.language}`} size={v ? 96 : 88} align={v ? "center" : "left"} />
      <Subtitle size={v ? 38 : 34} delay={12} align={v ? "center" : "left"}>Aprende con ella, a tu ritmo y desde casa</Subtitle>
    </div>
  );

  return (
    <AbsoluteFill>
      <BrandBackground />
      <AbsoluteFill style={{ flexDirection: v ? "column" : "row", alignItems: "center", justifyContent: "center", gap: v ? 90 : 140, paddingBottom: v ? 200 : 0 }}>
        {text}
        {portrait}
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

function Badge({ icon, title, sub }: { icon: string; title: string; sub: string }) {
  const v = useIsVertical();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, background: "rgba(255,255,255,.96)", borderRadius: 28, padding: "18px 24px", boxShadow: "0 20px 40px -12px rgba(26,26,46,.25)", border: "1px solid #F1F5F9" }}>
      <div style={{ width: v ? 60 : 52, height: v ? 60 : 52, borderRadius: "50%", background: colors.pink100, display: "flex", alignItems: "center", justifyContent: "center", fontSize: v ? 30 : 26 }}>{icon}</div>
      <div>
        <div style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: v ? 28 : 24, color: colors.ink }}>{title}</div>
        <div style={{ fontFamily: fonts.sans, fontWeight: 700, fontSize: v ? 20 : 17, color: colors.inkSubtle }}>{sub}</div>
      </div>
    </div>
  );
}
