import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { AbsoluteFill } from "remotion";
import { Booking } from "./scenes/Booking";
import { Chat } from "./scenes/Chat";
import { Cta } from "./scenes/Cta";
import { Hook } from "./scenes/Hook";
import { MeetMaria } from "./scenes/MeetMaria";
import { PromoContext, type PromoProps } from "./mode";
import { Teachers } from "./scenes/Teachers";

// ~20 s a 30 fps: gancho (3 s) → elegir profe (multi) o conocer a María (single) → reservar → chat → cierre.
// Las transiciones se solapan 12 frames.
export const SCENES = { hook: 90, teachers: 135, booking: 150, chat: 135, cta: 138 } as const;
const T = 12;
export const PROMO_DURATION = Object.values(SCENES).reduce((a, b) => a + b, 0) - T * 4; // 600 frames = 20 s

export function Promo(props: PromoProps) {
  const timing = linearTiming({ durationInFrames: T });
  return (
    <PromoContext.Provider value={props}>
    <AbsoluteFill style={{ background: "#FFF5FA" }}>
      <TransitionSeries>
        <TransitionSeries.Sequence durationInFrames={SCENES.hook}><Hook /></TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={slide({ direction: "from-bottom" })} timing={timing} />
        <TransitionSeries.Sequence durationInFrames={SCENES.teachers}>{props.mode === "single" ? <MeetMaria /> : <Teachers />}</TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={slide({ direction: "from-right" })} timing={timing} />
        <TransitionSeries.Sequence durationInFrames={SCENES.booking}><Booking /></TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={slide({ direction: "from-right" })} timing={timing} />
        <TransitionSeries.Sequence durationInFrames={SCENES.chat}><Chat /></TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={timing} />
        <TransitionSeries.Sequence durationInFrames={SCENES.cta}><Cta /></TransitionSeries.Sequence>
      </TransitionSeries>
    </AbsoluteFill>
    </PromoContext.Provider>
  );
}
