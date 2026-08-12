"use client";

import { useState } from "react";
import { Check, X, Loader2, CreditCard, Split } from "lucide-react";
import api from "@/lib/api";

interface PackageLite {
  id: number;
  name: string;
  price: number;
  classes_count: number | null;
  allow_installments: boolean;
  installment_count: number | null;
  installment_amount: number | null;
  icon?: string;
}

interface PackageCheckoutProps {
  pkg: PackageLite;
  enrollmentId: number;
  installmentsPaid: number; // 0 si es la primera vez
  onClose: () => void;
  onDone: () => void;
}

export default function PackageCheckout({
  pkg,
  enrollmentId,
  installmentsPaid,
  onClose,
  onDone,
}: PackageCheckoutProps) {
  const [useInstallments, setUseInstallments] = useState(installmentsPaid > 0);
  const [reference, setReference] = useState("");
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const alreadyMidInstallments = installmentsPaid > 0;
  const nextIndex = installmentsPaid + 1;

  const installmentAmountCalculated =
    pkg.installment_amount ??
    Math.round((pkg.price / (pkg.installment_count || 1)) * 100) / 100;

  const amount =
    useInstallments || alreadyMidInstallments
      ? installmentAmountCalculated
      : pkg.price;

  const notify = async () => {
    setSending(true);
    setError("");
    try {
      await api.post("/payments/notify-payment", {
        type: "package",
        enrollment_id: enrollmentId,
        installment_index: useInstallments || alreadyMidInstallments ? nextIndex : null,
        transaction_reference: reference.trim() || undefined,
      });
      setDone(true);
      setTimeout(() => {
        onDone();
        onClose();
      }, 1500);
    } catch (e: any) {
      setError(e.response?.data?.detail || "Error notificando el pago");
    } finally {
      setSending(false);
    }
  };

  if (done) {
    return (
      <div className="flex flex-col items-center py-10 gap-3">
        <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center">
          <Check className="w-7 h-7 text-emerald-600" />
        </div>
        <p className="font-bold text-slate-700">¡Pago notificado!</p>
        <p className="text-xs text-slate-500 text-center max-w-xs">
          Tu profesor(a) o el staff lo validará en breve. Verás tus créditos disponibles
          en cuanto se apruebe.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header del paquete */}
      <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-lg">{pkg.icon || "📦"}</span>
          <p className="text-sm font-black text-slate-800">{pkg.name}</p>
        </div>
        <p className="text-xs text-slate-500">
          {pkg.classes_count == null ? "Clases ilimitadas" : `${pkg.classes_count} clases`}
        </p>
      </div>

      {/* Selector de cuotas (Solo si lo permite y no está ya pagando cuotas) */}
      {pkg.allow_installments && !alreadyMidInstallments && (
        <div>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
            Forma de pago
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setUseInstallments(false)}
              className={`flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl border-2 text-xs font-bold transition-all ${
                !useInstallments
                  ? "border-pink-400 bg-pink-50 text-pink-600"
                  : "border-slate-100 bg-white text-slate-500 hover:bg-slate-50"
              }`}
            >
              <CreditCard className="w-4 h-4" /> Pago único (${pkg.price.toFixed(2)})
            </button>
            <button
              type="button"
              onClick={() => setUseInstallments(true)}
              className={`flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl border-2 text-xs font-bold transition-all ${
                useInstallments
                  ? "border-pink-400 bg-pink-50 text-pink-600"
                  : "border-slate-100 bg-white text-slate-500 hover:bg-slate-50"
              }`}
            >
              <Split className="w-4 h-4" /> {pkg.installment_count || 1} cuotas de ${installmentAmountCalculated.toFixed(2)}
            </button>
          </div>
        </div>
      )}

      {/* Banner si ya está en proceso de pago de cuotas */}
      {alreadyMidInstallments && (
        <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 text-xs font-bold text-amber-700">
          Pagando cuota {nextIndex} de {pkg.installment_count || 1}
        </div>
      )}

      {/* Card de monto */}
      <div className="bg-pink-50 border border-pink-100 rounded-2xl p-4 text-center">
        <p className="text-[10px] font-black text-pink-400 uppercase tracking-widest mb-1">
          {useInstallments || alreadyMidInstallments
            ? `Monto de la cuota ${alreadyMidInstallments ? nextIndex : 1}`
            : "Monto a pagar"}
        </p>
        <p className="text-3xl font-black text-pink-700">${amount.toFixed(2)}</p>
      </div>

      {/* Input de referencia */}
      <div>
        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">
          Referencia de transacción (opcional)
        </label>
        <input
          value={reference}
          onChange={e => setReference(e.target.value)}
          placeholder="Ej: últimos 4 dígitos, ID de transferencia..."
          className="w-full bg-slate-50 border-2 border-transparent rounded-xl text-sm font-bold
                     text-slate-800 placeholder:text-slate-400 px-4 py-3 focus:outline-none
                     focus:bg-white focus:border-pink-500 focus:ring-4 focus:ring-pink-50 transition-all"
        />
      </div>

      {/* Mensaje de error */}
      {error && (
        <div className="bg-rose-50 border border-rose-100 text-rose-600 px-4 py-3 rounded-xl text-xs font-bold flex items-center gap-2">
          <X className="w-4 h-4 flex-shrink-0" /> {error}
        </div>
      )}

      {/* Botones de acción */}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={onClose}
          disabled={sending}
          className="flex-1 py-3.5 text-sm font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors disabled:opacity-50"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={notify}
          disabled={sending}
          className="flex-1 py-3.5 text-sm font-bold text-white rounded-xl bg-gradient-to-r
                     from-pink-500 to-rose-400 hover:from-pink-600 hover:to-rose-500 shadow-lg
                     shadow-pink-200 active:scale-[0.98] transition-all duration-300 disabled:opacity-50
                     flex items-center justify-center gap-2"
        >
          {sending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <><Check className="w-4 h-4" /> Ya realicé el pago</>
          )}
        </button>
      </div>
    </div>
  );
}