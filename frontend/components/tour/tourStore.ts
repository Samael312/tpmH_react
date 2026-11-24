import { create } from "zustand";

/** Estado efímero de la guía: la guía pide abrir el panel «Más» del menú móvil (lo lee BottomTabBar). */
interface TourStore {
  forceMoreOpen: boolean;
  setForceMoreOpen: (v: boolean) => void;
}

export const useTourStore = create<TourStore>()((set) => ({
  forceMoreOpen: false,
  setForceMoreOpen: (v) => set({ forceMoreOpen: v }),
}));
