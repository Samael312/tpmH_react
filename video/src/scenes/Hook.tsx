import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { BrandBackground, Headline, Subtitle, useIsVertical, usePop } from "../components/common";
import { Chipi3D } from "../components/Chipi3D";
import { MARIA, usePromo } from "../mode";
import { colors, fonts } from "../theme";

// 0-3 s. Gancho: la pregunta y Chipi saludando.
export function Hook() {
  const v = useIsVertical();
  const frame = useCurrentFrame();
  const chipi = usePop(4, 12);
  const brand = usePop(0, 16);
  const float = Math.sin(frame / 12) * 10;
  const single = usePromo().mode === "single";
  const question = single ? `¿Quieres aprender ${MARIA.language} a tu ritmo?` : "¿Quieres aprender un idioma a tu ritmo?";
  const sub = single ? `Clases 1 a 1 con ${MARIA.name}, 100% online` : "Clases 1 a 1 con profes reales";

  const logoRow = (
    <div style={{ display: "flex", alignItems: "center", gap: 18, opacity: brand, transform: `translateY(${(1 - brand) * -30}px)` }}>
      <Img src={staticFile("logo.png")} style={{ width: v ? 84 : 72, height: v ? 84 : 72, borderRadius: "50%" }} />
      <span style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: v ? 44 : 38, color: colors.ink }}>
        TuProfe<span style={{ color: colors.primary }}>Maria</span>
      </span>
    </div>
  );

  const chipiView = (
    <div style={{ position: "relative", transform: `scale(${0.6 + chipi * 0.4}) translateY(${float}px)`, opacity: chipi }}>
      <div style={{ position: "absolute", inset: "12% 10% 4% 10%", borderRadius: "50%", background: `radial-gradient(circle, ${colors.primaryLight}55 0%, transparent 70%)` }} />
      <Chipi3D width={v ? 760 : 720} height={v ? 820 : 860} yaw={-0.15} />
    </div>
  );

  if (v) {
    return (
      <AbsoluteFill>
        <BrandBackground />
        <AbsoluteFill style={{ alignItems: "center", paddingTop: 170 }}>
          {logoRow}
          <div style={{ marginTop: 70, width: 900 }}>
            <Headline text={question} highlight="a tu ritmo?" size={104} delay={8} />
          </div>
          <div style={{ marginTop: 28 }}>
            <Subtitle size={40} delay={30}>{sub}</Subtitle>
          </div>
        </AbsoluteFill>
        <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 260 }}>{chipiView}</AbsoluteFill>
      </AbsoluteFill>
    );
  }
  const slide = interpolate(frame, [0, 20], [-40, 0], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill>
      <BrandBackground />
      <AbsoluteFill style={{ flexDirection: "row", alignItems: "center", padding: "0 120px" }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 34, transform: `translateX(${slide}px)` }}>
          {logoRow}
          <Headline text={question} highlight="a tu ritmo?" size={96} delay={8} align="left" />
          <Subtitle size={38} delay={30} align="left">{sub}</Subtitle>
        </div>
        <div style={{ width: 720, display: "flex", justifyContent: "center" }}>{chipiView}</div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
