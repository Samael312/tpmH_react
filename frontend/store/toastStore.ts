import { create } from "zustand";

export type ToastVariant = "success" | "error" | "info" | "warning";

export interface ToastItem {
  id: number;
  variant: ToastVariant;
  message: string;
  description?: string;
  duration: number;
}

export interface ToastOptions {
  /** Texto secundario opcional, debajo del mensaje principal */
  description?: string;
  /** Duración en ms antes de auto-cerrarse. 0 = no se cierra solo. */
  duration?: number;
}

interface ToastStoreState {
  toasts: ToastItem[];
  push: (variant: ToastVariant, message: string, options?: ToastOptions) => number;
  dismiss: (id: number) => void;
  clear: () => void;
}

const DEFAULT_DURATION: Record<ToastVariant, number> = {
  success: 4000,
  info: 4000,
  warning: 5000,
  error: 6000,
};

let idCounter = 0;

export const useToastStore = create<ToastStoreState>((set) => ({
  toasts: [],
  push: (variant, message, options) => {
    const id = ++idCounter;
    const duration = options?.duration ?? DEFAULT_DURATION[variant];
    set((state) => ({
      toasts: [...state.toasts, { id, variant, message, description: options?.description, duration }],
    }));
    return id;
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
  clear: () => set({ toasts: [] }),
}));

/**
 * API imperativa de notificaciones, usable desde componentes, hooks,
 * handlers de eventos o incluso fuera de React (p. ej. interceptores de axios).
 *
 * Uso:
 *   toast.success("Clase reservada correctamente");
 *   toast.error("No se pudo guardar el paquete", { description: "Revisa el precio" });
 */
export const toast = {
  success: (message: string, options?: ToastOptions) => useToastStore.getState().push("success", message, options),
  error: (message: string, options?: ToastOptions) => useToastStore.getState().push("error", message, options),
  info: (message: string, options?: ToastOptions) => useToastStore.getState().push("info", message, options),
  warning: (message: string, options?: ToastOptions) => useToastStore.getState().push("warning", message, options),
  dismiss: (id: number) => useToastStore.getState().dismiss(id),
  clear: () => useToastStore.getState().clear(),
};
