"use client";

import { AlertTriangle, XCircle } from "lucide-react";
import type { RejectedPaymentInfo } from "@/hooks/useStudentData";

const PAYMENT_TYPE_LABELS: Record<string, string> = {
  package: "tu compra de paquete",
  renewal: "tu renovación de paquete",
  package_change: "tu cambio de paquete",
  unlimited_recharge: "tu recarga de créditos",
  refund: "tu ajuste de pago",
};

function typeLabel(paymentType: string | null): string {
  if (!paymentType) return "tu pago";
  return PAYMENT_TYPE_LABELS[paymentType] ?? "tu pago";
}

// ─── Aviso de pago rechazado ──────────────────────────────────────────────
// Se muestra tanto en el banner compacto del dashboard como en la pantalla
// completa de "elige tu paquete / renueva" (que es a donde vuelve el
// estudiante después de un rechazo, ya que el enrollment asociado se
// cancela). El backend expone el motivo vía Payment.rejection_reason en
// GET /payments/booking-status → last_rejected_payment.
export default function RejectedPaymentNotice({
  payment,
  variant = "full",
}: {
  payment: RejectedPaymentInfo;
  variant?: "compact" | "full";
}) {
  const rejectedAtLabel = payment.rejected_at
    ? new Date(payment.rejected_at).toLocaleString("es")
    : null;

  if (variant === "compact") {
    return (
      <div className="bg-gradient-to-r from-rose-500 to-red-500 rounded-[2rem] p-6 sm:p-8 text-white relative overflow-hidden shadow-xl shadow-rose-200 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="absolute top-[-40px] right-[-40px] w-48 h-48 bg-white/10 rounded-full blur-2xl" />
        <div className="relative flex items-start gap-3">
          <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center flex-shrink-0">
            <XCircle className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-widest text-white/70 mb-1">
              Pago rechazado
            </p>
            <h2 className="text-lg font-black">
              No pudimos confirmar {typeLabel(payment.payment_type)}
            </h2>
            {payment.rejection_reason && (
              <p className="text-white/90 text-sm mt-1 leading-relaxed">
                &ldquo;{payment.rejection_reason}&rdquo;
              </p>
            )}
            <p className="text-white/70 text-xs mt-1.5">
              Elige un paquete e inténtalo de nuevo cuando quieras.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto bg-rose-50 border border-rose-100 rounded-2xl p-5 flex gap-3 items-start">
      <AlertTriangle className="w-5 h-5 text-rose-500 flex-shrink-0 mt-0.5" />
      <div className="min-w-0">
        <p className="text-sm font-black text-rose-700">
          Tu pago anterior fue rechazado
        </p>
        <p className="text-sm text-rose-600 mt-1 leading-relaxed">
          {payment.rejection_reason
            ? <>Motivo: &ldquo;{payment.rejection_reason}&rdquo;</>
            : "No se indicó un motivo específico. Contacta al staff si tienes dudas."}
        </p>
        {rejectedAtLabel && (
          <p className="text-xs text-rose-400 font-bold mt-1.5">{rejectedAtLabel}</p>
        )}
        <p className="text-xs text-rose-500 mt-2">
          Puedes elegir el mismo paquete u otro y volver a notificar tu pago.
        </p>
      </div>
    </div>
  );
}
