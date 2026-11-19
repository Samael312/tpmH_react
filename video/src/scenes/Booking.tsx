import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { AppCard, BrandBackground, Headline, Subtitle, useIsVertical, usePop } from "../components/common";
import { colors, fonts, gradients } from "../theme";

// Beneficio 2: reservar. Recrea el selector de huecos de la web: días, horas libres/ocupadas, botón y aviso.
const DAYS = [["Lun", "23"], ["Mar", "24"], ["Mié", "25"], ["Jue", "26"], ["Vie", "27"]];
const SLOTS = ["09:00", "10:00", "11:00", "12:00", "16:00", "17:00", "18:00", "19:00", "20:00"];
const BUSY = new Set(["10:00", "12:00", "19:00"]);
const PICK = "17:00";

export function Booking() {
  const v = useIsVertical();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const card = usePop(8, 15);

  const dayPick = interpolate(frame, [30, 40], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const slotPick = interpolate(frame, [58, 68], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const press = frame >= 84 && frame < 92 ? 0.94 : 1;
  const toast = spring({ frame: frame - 94, fps, config: { damping: 12 } });

  const w = v ? 880 : 900;
  const cols = 3;
  return (
    <AbsoluteFill>
      <BrandBackground />
      <AbsoluteFill style={{ flexDirection: v ? "column" : "row", alignItems: "center", justifyContent: "center", paddingBottom: v ? 200 : 0, gap: v ? 0 : 90 }}>
        <div style={{ width: v ? 900 : 640, display: "flex", flexDirection: "column", gap: 22, alignItems: v ? "center" : "flex-start" }}>
          <Headline text="Reserva en segundos" highlight="segundos" size={v ? 104 : 92} align={v ? "center" : "left"} />
          <Subtitle size={v ? 38 : 34} delay={10} align={v ? "center" : "left"}>Ves sus huecos libres en tu zona horaria</Subtitle>
        </div>

        <div style={{ position: "relative", marginTop: v ? 70 : 0 }}>
          <AppCard style={{ width: w, padding: 44, opacity: card, transform: `translateY(${(1 - card) * 90}px)` }}>
            <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 34, color: colors.ink, marginBottom: 26 }}>Noviembre · semana 48</div>
            <div style={{ display: "flex", gap: 14, marginBottom: 34 }}>
              {DAYS.map(([d, n], i) => {
                const on = i === 2 ? dayPick : 0;
                return (
                  <div key={d} style={{ flex: 1, borderRadius: 24, padding: "16px 0", textAlign: "center", background: on > 0.5 ? gradients.brand : colors.surfaceSoft, color: on > 0.5 ? "white" : colors.ink, transform: `scale(${1 + on * 0.06})`, boxShadow: on > 0.5 ? "0 10px 24px -8px rgba(233,30,140,.6)" : "none" }}>
                    <div style={{ fontFamily: fonts.sans, fontWeight: 500, fontSize: 22, opacity: 0.8 }}>{d}</div>
                    <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 36 }}>{n}</div>
                  </div>
                );
              })}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 16 }}>
              {SLOTS.map((s, i) => {
                const appear = spring({ frame: frame - 40 - i * 2, fps, config: { damping: 15 } });
                const busy = BUSY.has(s);
                const on = s === PICK ? slotPick : 0;
                return (
                  <div key={s} style={{
                    borderRadius: 20, padding: "20px 0", textAlign: "center", fontFamily: fonts.display, fontWeight: 700, fontSize: 32,
                    opacity: appear * (busy ? 0.45 : 1), transform: `scale(${(0.8 + appear * 0.2) * (1 + on * 0.08)})`,
                    background: on > 0.5 ? gradients.brand : busy ? colors.surfaceMuted : colors.pink50,
                    color: on > 0.5 ? "white" : busy ? colors.inkSubtle : colors.primaryDark,
                    textDecoration: busy ? "line-through" : "none",
                    border: `2px solid ${on > 0.5 ? "transparent" : busy ? "transparent" : colors.pink100}`,
                  }}>{s}</div>
                );
              })}
            </div>
            <div style={{ marginTop: 34, borderRadius: 26, padding: "26px 0", textAlign: "center", background: gradients.brand, color: "white", fontFamily: fonts.display, fontWeight: 800, fontSize: 36, transform: `scale(${press})`, opacity: interpolate(frame, [62, 72], [0.45, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>
              Reservar clase
            </div>
          </AppCard>

          {/* Aviso de confirmación, como el toast de la web */}
          <div style={{ position: "absolute", left: "50%", top: v ? -60 : -50, transform: `translate(-50%, ${(1 - toast) * -40}px) scale(${0.9 + toast * 0.1})`, opacity: toast }}>
            <div style={{ display: "flex", alignItems: "center", gap: 18, background: colors.ink, color: "white", borderRadius: 999, padding: "20px 34px", boxShadow: "0 20px 50px -10px rgba(26,26,46,.5)", whiteSpace: "nowrap" }}>
              <div style={{ width: 46, height: 46, borderRadius: "50%", background: colors.green, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, fontWeight: 800 }}>✓</div>
              <span style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 32 }}>¡Clase reservada! Mié 25 · 17:00</span>
            </div>
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
