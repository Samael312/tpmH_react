import { Composition } from "remotion";
import { promoSchema } from "./mode";
import { Promo, PROMO_DURATION } from "./Promo";
import { FPS } from "./theme";

// Mismo vídeo en dos formatos (cada escena reordena su contenido según la orientación, useIsVertical) y dos variantes:
// marketplace con varios profesores (Promo*) y single-tenant con María como profesora destacada (Maria*).
// `photo` apunta a un archivo de public/; vacío = avatar con la inicial.
const MARIA_PHOTO = "";

export function RemotionRoot() {
  const common = { component: Promo, schema: promoSchema, durationInFrames: PROMO_DURATION, fps: FPS } as const;
  return (
    <>
      <Composition id="PromoVertical" {...common} width={1080} height={1920} defaultProps={{ mode: "multi", photo: "" }} />
      <Composition id="PromoWide" {...common} width={1920} height={1080} defaultProps={{ mode: "multi", photo: "" }} />
      <Composition id="MariaVertical" {...common} width={1080} height={1920} defaultProps={{ mode: "single", photo: MARIA_PHOTO }} />
      <Composition id="MariaWide" {...common} width={1920} height={1080} defaultProps={{ mode: "single", photo: MARIA_PHOTO }} />
    </>
  );
}
