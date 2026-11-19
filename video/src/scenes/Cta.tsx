import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { BrandBackground, useIsVertical, usePop } from "../components/common";
import { Chipi3D } from "../components/Chipi3D";
import { MARIA, usePromo } from "../mode";
import { colors, fonts, gradients } from "../theme";

// Cierre: logo, marca, oferta real (la clase de prueba no consume paquete ni se paga) y web.
export function Cta() {
  const v = useIsVertical();
  const frame = useCurrentFrame();
  const logo = usePop(4, 11);
  const name = usePop(14, 14);
  const offer = usePop(26, 13);
  const url = usePop(40, 16);
  const chipi = usePop(10, 12);
  const single = usePromo().mode === "single";
  const pulse = 1 + Math.max(0, Math.sin((frame - 50) / 7)) * 0.04 * (frame > 50 ? 1 : 0);
  const ring = interpolate(frame % 45, [0, 45], [1, 1.5]);
  const ringO = interpolate(frame % 45, [0, 45], [0.5, 0]);

  const block = (
    <div style={{ display: "flex", flexDirection: "column", alignItems: v ? "center" : "flex-start", gap: v ? 34 : 28 }}>
      <div style={{ position: "relative", width: v ? 220 : 170, height: v ? 220 : 170, transform: `scale(${logo})` }}>
        <div style={{ position: "absolute", inset: 0, borderRadius: "50%", border: `6px solid ${colors.primaryLight}`, transform: `scale(${ring})`, opacity: ringO }} />
        <Img src={staticFile("logo.png")} style={{ width: "100%", height: "100%", borderRadius: "50%", boxShadow: "0 24px 60px -12px rgba(233,30,140,.55)" }} />
      </div>
      <div style={{ opacity: name, transform: `translateY(${(1 - name) * 30}px)`, textAlign: v ? "center" : "left" }}>
        <div style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: v ? 112 : 104, color: colors.ink, letterSpacing: -2, lineHeight: 1 }}>
          TuProfe<span style={{ background: gradients.brand, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>Maria</span>
        </div>
        <div style={{ fontFamily: fonts.sans, fontWeight: 500, fontSize: v ? 38 : 34, color: colors.inkMuted, marginTop: 16 }}>
          {single ? `Clases de ${MARIA.language} 1 a 1 con ${MARIA.name}` : "El conocimiento que buscas, como tú lo prefieres"}
        </div>
      </div>
      <div style={{ opacity: offer, transform: `scale(${(0.8 + offer * 0.2) * pulse})` }}>
        <div style={{ background: gradients.brand, color: "white", fontFamily: fonts.display, fontWeight: 800, fontSize: v ? 46 : 40, padding: v ? "30px 54px" : "26px 46px", borderRadius: 999, boxShadow: "0 24px 50px -12px rgba(233,30,140,.65)", whiteSpace: "nowrap" }}>
          Tu primera clase de prueba, gratis
        </div>
      </div>
      <div style={{ opacity: url, transform: `translateY(${(1 - url) * 20}px)`, fontFamily: fonts.display, fontWeight: 700, fontSize: v ? 48 : 42, color: colors.primaryDark }}>
        tuprofemaria.com
      </div>
    </div>
  );

  const chipiView = (
    <div style={{ opacity: chipi, transform: `scale(${0.6 + chipi * 0.4})` }}>
      <Chipi3D width={v ? 680 : 640} height={v ? 740 : 820} yaw={0.2} />
    </div>
  );

  return (
    <AbsoluteFill>
      <BrandBackground />
      {v ? (
        <AbsoluteFill style={{ alignItems: "center", paddingTop: 150 }}>
          {block}
          <div style={{ marginTop: 10 }}>{chipiView}</div>
        </AbsoluteFill>
      ) : (
        <AbsoluteFill style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 40, padding: "0 110px" }}>
          <div style={{ flex: 1 }}>{block}</div>
          {chipiView}
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
}
