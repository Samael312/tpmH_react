import { createContext, useContext } from "react";
import { z } from "zod";

// Dos variantes del anuncio:
//  - "multi": marketplace con varios profesores (elegir profe).
//  - "single": modo single-tenant de la web (PlatformConfig.is_single_tenant), con María (FEATURED_TEACHER_USERNAME)
//    como única profesora.
export const promoSchema = z.object({
  mode: z.enum(["multi", "single"]),
  /** Foto de María dentro de public/ (p. ej. "maria.jpg"); vacío = avatar con su inicial. */
  photo: z.string(),
});
export type PromoProps = z.infer<typeof promoSchema>;

export const PromoContext = createContext<PromoProps>({ mode: "multi", photo: "" });
export const usePromo = () => useContext(PromoContext);

/** Datos de la profesora destacada en modo single-tenant. */
export const MARIA = {
  name: "María",
  initials: "M",
  language: "inglés",
} as const;
