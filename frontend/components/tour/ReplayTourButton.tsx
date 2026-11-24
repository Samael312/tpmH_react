"use client";

import { Compass } from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { stepsForRole } from "./tourSteps";

/** «Ver guía de la plataforma»: deja la guía pendiente en el store; TourHost (dentro del menú) la abre. */
export default function ReplayTourButton() {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  if (!user || stepsForRole(user.role).length === 0) return null;
  return (
    <button
      type="button"
      onClick={() => setUser({ ...user, tour_completed: false })}
      className="w-full flex items-center justify-center gap-2 py-3 text-sm font-bold text-pink-600 bg-pink-50
                 hover:bg-pink-100 rounded-2xl transition-colors"
    >
      <Compass className="w-4 h-4" />
      Ver guía de la plataforma
    </button>
  );
}
