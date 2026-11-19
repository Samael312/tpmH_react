import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { AppCard, BrandBackground, Headline, Pill, Subtitle, useIsVertical, usePop } from "../components/common";
import { colors, fonts, gradients } from "../theme";

// Beneficio 1: elegir profe. Perfiles de ejemplo (mockup): sin valoraciones ni cifras inventadas.
const TEACHERS = [
  { initials: "MG", name: "María", subject: "Inglés", langs: ["Inglés", "Español"], grad: gradients.brand },
  { initials: "LP", name: "Lucas", subject: "Francés", langs: ["Francés", "Inglés"], grad: `linear-gradient(135deg, ${colors.purple} 0%, ${colors.blue} 100%)` },
  { initials: "SR", name: "Sofía", subject: "Italiano", langs: ["Italiano", "Español"], grad: `linear-gradient(135deg, ${colors.amber} 0%, ${colors.rose} 100%)` },
];

function TeacherCard({ t, i, v, selected }: { t: (typeof TEACHERS)[number]; i: number; v: boolean; selected: number }) {
  const p = usePop(14 + i * 8, 14);
  const s = 1 + selected * 0.05;
  const scale = v ? 1 : 0.92;
  return (
    <AppCard style={{
      width: v ? 860 : 500,
      padding: v ? "34px 40px" : "34px 34px",
      display: "flex",
      flexDirection: v ? "row" : "column",
      alignItems: v ? "center" : "flex-start",
      gap: v ? 32 : 22,
      opacity: p,
      transform: `translateY(${(1 - p) * 80}px) scale(${scale * s})`,
      outline: selected > 0.01 ? `${6 * selected}px solid ${colors.primary}` : "none",
      outlineOffset: 4,
    }}>
      <div style={{ width: 120, height: 120, borderRadius: 32, background: t.grad, display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontFamily: fonts.display, fontWeight: 800, fontSize: 44, flexShrink: 0 }}>
        {t.initials}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, flex: 1 }}>
        <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 42, color: colors.ink }}>
          {t.name} <span style={{ fontWeight: 600, fontSize: 30, color: colors.inkMuted }}>· {t.subject}</span>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {t.langs.map((l) => <Pill key={l} bg={colors.surfaceMuted} color={colors.ink} size={22}>{l}</Pill>)}
        </div>
        <Pill bg={colors.pink100} color={colors.primaryDark} size={22} style={{ alignSelf: "flex-start" }}>🎁 Clase de prueba gratis</Pill>
      </div>
    </AppCard>
  );
}

export function Teachers() {
  const v = useIsVertical();
  const frame = useCurrentFrame();
  // A los ~2,6 s se «elige» a la primera profe.
  const selected = interpolate(frame, [78, 92], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill>
      <BrandBackground />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", paddingBottom: v ? 200 : 40 }}>
        <div style={{ width: v ? 900 : 1500 }}>
          <Headline text="Elige a tu profe ideal" highlight="profe ideal" size={v ? 100 : 88} />
        </div>
        <div style={{ marginTop: 22 }}>
          <Subtitle size={v ? 38 : 34} delay={10}>Filtra por idioma y por los idiomas que habla</Subtitle>
        </div>
        <div style={{ marginTop: v ? 70 : 60, display: "flex", flexDirection: v ? "column" : "row", gap: v ? 34 : 40, alignItems: "center" }}>
          {TEACHERS.map((t, i) => <TeacherCard key={t.name} t={t} i={i} v={v} selected={i === 0 ? selected : 0} />)}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
