"use client";

import { useState } from "react";
import { X } from "lucide-react";
import FullScreenModal from "./FullScreenModal";
import Button from "./Button";

interface RejectReasonModalProps {
  open: boolean;
  /** Título del modal, ej. "Rechazar pago" / "Rechazar retiro" */
  title: string;
  /** Texto de contexto opcional (a quién / qué se está rechazando) */
  description?: string;
  onClose: () => void;
  /** Se invoca con el motivo ya validado (no vacío, trimmed) */
  onConfirm: (reason: string) => void | Promise<void>;
  loading?: boolean;
}

// ─── Modal para capturar el motivo de un rechazo (pago / retiro / etc.) ───────
// Reemplaza el uso de window.prompt(), que no se puede estilizar, se ve
// distinto en cada navegador/webview, y en algunos entornos móviles
// embebidos (o si el usuario tiene bloqueados los prompts) directamente no
// aparece o corta el texto.
export default function RejectReasonModal({
  open,
  title,
  description,
  onClose,
  onConfirm,
  loading = false,
}: RejectReasonModalProps) {
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);

  const trimmed = reason.trim();
  const isEmpty = trimmed.length === 0;

  const handleClose = () => {
    setReason("");
    setTouched(false);
    onClose();
  };

  const handleConfirm = async () => {
    setTouched(true);
    if (isEmpty) return;
    await onConfirm(trimmed);
    setReason("");
    setTouched(false);
  };

  return (
    <FullScreenModal
      open={open}
      onClose={handleClose}
      title={title}
      footer={
        <div className="flex gap-3">
          <button
            onClick={handleClose}
            disabled={loading}
            className="flex-1 py-3 text-sm font-bold text-slate-600
                       bg-slate-100 hover:bg-slate-200 rounded-xl
                       transition-colors disabled:opacity-50"
          >
            Cancelar
          </button>
          <Button
            variant="danger"
            loading={loading}
            disabled={isEmpty}
            onClick={handleConfirm}
            className="flex-1 justify-center"
          >
            Confirmar rechazo
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        {description && (
          <p className="text-xs text-slate-500 bg-slate-50 border border-slate-100 rounded-xl p-3">
            {description}
          </p>
        )}
        <div>
          <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
            Motivo del rechazo
          </label>
          <textarea
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onBlur={() => setTouched(true)}
            placeholder="Explica brevemente por qué se rechaza..."
            rows={4}
            className={`w-full rounded-2xl border p-3.5 text-sm text-slate-800
                        placeholder:text-slate-400 shadow-inner resize-none
                        focus:outline-none focus:ring-2 transition-colors
                        ${touched && isEmpty
                          ? "border-rose-300 bg-rose-50/50 focus:ring-rose-200"
                          : "border-slate-200 bg-slate-50/70 focus:ring-pink-200 focus:border-pink-300"
                        }`}
          />
          {touched && isEmpty && (
            <p className="mt-1.5 text-xs font-bold text-rose-600 flex items-center gap-1">
              <X className="w-3.5 h-3.5" /> El motivo es obligatorio.
            </p>
          )}
        </div>
      </div>
    </FullScreenModal>
  );
}
