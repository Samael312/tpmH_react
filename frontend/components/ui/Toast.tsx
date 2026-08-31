"use client";

import { useEffect, useRef } from "react";
import { CheckCircle2, XCircle, Info, AlertTriangle, X } from "lucide-react";
import { useToastStore, ToastItem, ToastVariant } from "@/store/toastStore";

const VARIANT_STYLES: Record<ToastVariant, { icon: typeof CheckCircle2; classes: string; iconClasses: string }> = {
  success: {
    icon: CheckCircle2,
    classes: "bg-white border-emerald-100",
    iconClasses: "text-emerald-500",
  },
  error: {
    icon: XCircle,
    classes: "bg-white border-rose-100",
    iconClasses: "text-rose-500",
  },
  warning: {
    icon: AlertTriangle,
    classes: "bg-white border-amber-100",
    iconClasses: "text-amber-500",
  },
  info: {
    icon: Info,
    classes: "bg-white border-sky-100",
    iconClasses: "text-sky-500",
  },
};

function ToastCard({ toast }: { toast: ToastItem }) {
  const dismiss = useToastStore((s) => s.dismiss);
  const { icon: Icon, classes, iconClasses } = VARIANT_STYLES[toast.variant];
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (toast.duration > 0) {
      timerRef.current = setTimeout(() => dismiss(toast.id), toast.duration);
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast.id, toast.duration]);

  return (
    <div
      role={toast.variant === "error" ? "alert" : "status"}
      aria-live={toast.variant === "error" ? "assertive" : "polite"}
      className={`
        pointer-events-auto w-full max-w-sm flex items-start gap-3
        rounded-2xl border shadow-lg shadow-black/5 px-4 py-3.5
        animate-toast-in ${classes}
      `}
    >
      <Icon className={`w-5 h-5 mt-0.5 shrink-0 ${iconClasses}`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-ink leading-snug break-words">{toast.message}</p>
        {toast.description && (
          <p className="text-xs text-ink-muted mt-0.5 leading-snug break-words">{toast.description}</p>
        )}
      </div>
      <button
        onClick={() => dismiss(toast.id)}
        aria-label="Cerrar notificación"
        className="shrink-0 text-ink-subtle hover:text-ink transition-colors -m-1 p-1 rounded-full"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

/**
 * Contenedor global de notificaciones. Se monta una sola vez en el árbol
 * (ver app/providers.tsx) y renderiza cualquier toast disparado desde
 * cualquier parte de la app vía `useToast()` o `toast` (store/toastStore).
 */
export default function Toaster() {
  const toasts = useToastStore((s) => s.toasts);

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed z-[9999] inset-x-0 top-4 flex flex-col items-center gap-2 px-4 sm:top-auto sm:bottom-4 sm:right-4 sm:items-end sm:px-0 pointer-events-none"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} />
      ))}
    </div>
  );
}
