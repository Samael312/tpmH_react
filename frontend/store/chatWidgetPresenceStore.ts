"use client";

// store/chatWidgetPresenceStore.ts
//
// N2 (ubicación del ChatWidget): puente mínimo para que ChipiWidget sepa,
// SIN que cada una de las ~40 páginas que lo montan tenga que pasarle
// `raised` a mano, si el botón flotante del chat interno está presente
// en la pantalla actual — y si lo está, se corra hacia arriba solo (ver
// components/chipi/ChipiWidget.tsx, que ya tenía el prop `raised`
// pensado para esto pero nunca se usaba en ningún lado).
//
// ChatWidget.tsx marca `mounted: true` mientras su botón flotante está
// visible (es decir, mientras el chat está habilitado para ese rol —
// nunca en /dashboard/chat ni /teacher/chat, que además son las mismas
// pantallas donde ChipiWidget no se monta).

import { create } from "zustand";

interface ChatWidgetPresenceState {
  mounted: boolean;
  setMounted: (mounted: boolean) => void;
}

export const useChatWidgetPresenceStore = create<ChatWidgetPresenceState>((set) => ({
  mounted: false,
  setMounted: (mounted) => set({ mounted }),
}));
