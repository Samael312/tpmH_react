"use client";

import FullScreenModal from "./FullScreenModal";
import Button from "./Button";

interface ConfirmModalProps {
  open: boolean;
  title: string;
  /** Texto de la pregunta/advertencia, ej. "¿Reactivar a este estudiante?" */
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** "danger" para acciones destructivas (banear, cancelar), "primary" para las positivas (desbanear, reactivar) */
  variant?: "danger" | "primary";
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  loading?: boolean;
}

// ─── Modal de confirmación genérico ────────────────────────────────────────
// Reemplaza el uso de window.confirm(), que no se puede estilizar, se ve
// distinto en cada navegador/webview, y en algunos entornos móviles
// embebidos directamente no aparece.
export default function ConfirmModal({
  open,
  title,
  description,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  variant = "primary",
  onClose,
  onConfirm,
  loading = false,
}: ConfirmModalProps) {
  return (
    <FullScreenModal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <div className="flex gap-3">
          <button
            onClick={onClose}
            disabled={loading}
            className="flex-1 py-3 text-sm font-bold text-slate-600
                       bg-slate-100 hover:bg-slate-200 rounded-xl
                       transition-colors disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <Button
            variant={variant}
            loading={loading}
            onClick={onConfirm}
            className="flex-1 justify-center"
          >
            {confirmLabel}
          </Button>
        </div>
      }
    >
      <p className="text-sm text-slate-600 leading-relaxed">{description}</p>
    </FullScreenModal>
  );
}
