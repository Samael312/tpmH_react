"use client";

import { useCallback } from "react";
import api from "@/lib/api";
import { useAuthStore } from "@/store/authStore";
import ProductTour from "./ProductTour";
import { stepsForRole } from "./tourSteps";

/**
 * Decide si se muestra la guía del menú y guarda el resultado. Es derivado del store (sin estado propio):
 * se abre cuando la cuenta ya terminó el onboarding y `tour_completed === false`. `undefined` (store viejo de
 * localStorage, antes de esta función) NO la abre. Pulsar «Ver guía de la plataforma» en el perfil solo pone
 * `tour_completed=false` en el store.
 */
export default function TourHost() {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const steps = stepsForRole(user?.role);
  const open = !!user && steps.length > 0 && user.onboarding_completed === true && user.tour_completed === false;

  // Terminar y saltar hacen lo mismo. Un fallo del PATCH no bloquea: la guía ya se cerró y, si el servidor no se
  // enteró, volverá a salir en la próxima sesión.
  const done = useCallback(() => {
    const current = useAuthStore.getState().user;
    if (!current) return;
    setUser({ ...current, tour_completed: true });
    api.patch("/users/me", { tour_completed: true }).catch(() => {});
  }, [setUser]);

  return <ProductTour steps={steps} open={open} onFinish={done} onSkip={done} />;
}
