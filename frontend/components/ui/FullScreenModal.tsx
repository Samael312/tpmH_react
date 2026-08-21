"use client";

import { X } from "lucide-react";
import { useEffect } from "react";

interface FullScreenModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  /** Botón(es) de acción principal, quedan pegados al borde inferior (sticky CTA) */
  footer?: React.ReactNode;
}

export default function FullScreenModal({ open, onClose, title, children, footer }: FullScreenModalProps) {
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] bg-white flex flex-col sm:items-center sm:justify-center sm:bg-slate-900/40 sm:backdrop-blur-sm sm:p-4">
      <div className="flex flex-col w-full h-full sm:h-auto sm:max-h-[90vh] sm:max-w-lg sm:rounded-[2rem] bg-white sm:shadow-2xl overflow-hidden">

        {/* Header fijo con X — siempre visible al hacer scroll en el form */}
        <div
          className="flex items-center justify-between px-5 py-4 border-b border-slate-100 flex-shrink-0"
          style={{ paddingTop: "calc(env(safe-area-inset-top) + 1rem)" }}
        >
          <h2 className="text-base font-black text-slate-800 truncate pr-4">{title}</h2>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors flex-shrink-0"
          >
            <X className="w-4 h-4 text-slate-500" />
          </button>
        </div>

        {/* Contenido scrolleable */}
        <div className="flex-1 overflow-y-auto p-5">{children}</div>

        {/* CTA pegado abajo, alcanzable con el pulgar, respeta safe area */}
        {footer && (
          <div
            className="flex-shrink-0 border-t border-slate-100 p-4 bg-white"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1rem)" }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}