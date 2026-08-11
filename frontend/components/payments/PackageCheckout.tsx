"use client";

import { useState } from "react";
import { Check, X, Loader2, CreditCard, Split } from "lucide-react";
import api from "@/lib/api";

interface PackageLite {
  id: number;
  name: string;
  price: number;
  classes_count: number | null;
  allows_installments: boolean;
  icon?: string;
  color?: string;
}

interface PackageCheckoutProps {
  pkg: PackageLite;
  /** Enrollment ya creado (renovación/cambio ya en estado pending_*) o recién creado (compra inicial) */
  enrollmentId: number;
  installmentNumber?: 1 | 2; // si ya se pagó la cuota 1, pasar 2 aquí
  onClose: () => void;
  onDone: () => void;
}

export default function PackageCheckout({
  pkg, enrollmentId, installmentNumber, onClose, onDone,
}: PackageCheckoutProps) {
  const [useInstallments, setUseInstallments] = useState(false);
  const [reference, setReference] = useState("");
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  // Si ya viene fijado installmentNumber=2 (pagando la segunda cuota),
  // no mostramos el selector — ya se decidió cuotas al pagar la primera.
  const lockedToInstallment2 = installmentNumber === 2;

  const amount = lockedToInstallment2 || (useInstallments && !lockedToInstallment2)
    ? Math.round((pkg.price / 2) * 100) / 100
    : pkg.price;

  const notify = async () => {
    setSending(true);
    setError("");
    try {
      await api.post("/payments/notify-payment", {
        type: "package",
        enrollment_id: enrollmentId,
        installment_number: lockedToInstallment2 ? 2 : (useInstallments ? 1 : null),
        transaction_reference: reference.trim() || undefined,
      });
      setDone(true);
      setTimeout(() => { onDone(); onClose(); }, 1500);
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
      <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-lg">{pkg.icon || "📦"}</span>
          <p className="text-sm font-black text-slate-800">{pkg.name}</p>
        </div>
        <p className="text-xs text-slate-500">
          {pkg.classes_count == null ? "Clases ilimitadas" : `${pkg.classes_count} clases`}
        </p>
      </div>

      {/* Selector de cuotas — solo si el paquete lo permite y no estamos ya en la cuota 2 */}
      {pkg.allows_installments && !lockedToInstallment2 && (
        <div>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
            Forma de pago
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setUseInstallments(false)}
              className={`flex flex-col items-center gap-1.5 py-3 rounded-xl border-2 text-xs font-bold transition-all ${
                !useInstallments ? "border-pink-400 bg-pink-50 text-pink-600" : "border-slate-100 bg-white text-slate-500"
              }`}
            >
              <CreditCard className="w-4 h-4" /> Pago único (100%)
            </button>
            <button
              onClick={() => setUseInstallments(true)}
              className={`flex flex-col items-center gap-1.5 py-3 rounded-xl border-2 text-xs font-bold transition-all ${
                useInstallments ? "border-pink-400 bg-pink-50 text-pink-600" : "border-slate-100 bg-white text-slate-500"
              }`}
            >
              <Split className="w-4 h-4" /> 2 cuotas (50/50)
            </button>
          </div>
        </div>
      )}

      {lockedToInstallment2 && (
        <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 text-xs font-bold text-amber-700">
          Estás pagando la segunda cuota (50% restante) de este paquete.
        </div>
      )}

      <div className="bg-pink-50 border border-pink-100 rounded-2xl p-4 text-center">
        <p className="text-[10px] font-black text-pink-400 uppercase tracking-widest mb-1">
          {useInstallments || lockedToInstallment2 ? "Monto de esta cuota" : "Monto a pagar"}
        </p>
        <p className="text-3xl font-black text-pink-700">${amount.toFixed(2)}</p>
      </div>

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

      {error && (
        <div className="bg-rose-50 border border-rose-100 text-rose-600 px-4 py-3 rounded-xl text-xs font-bold flex items-center gap-2">
          <X className="w-4 h-4 flex-shrink-0" /> {error}
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={onClose}
          disabled={sending}
          className="flex-1 py-3.5 text-sm font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors disabled:opacity-50"
        >
          Cancelar
        </button>
        <button
          onClick={notify}
          disabled={sending}
          className="flex-1 py-3.5 text-sm font-bold text-white rounded-xl bg-gradient-to-r
                     from-pink-500 to-rose-400 hover:from-pink-600 hover:to-rose-500 shadow-lg
                     shadow-pink-200 active:scale-[0.98] transition-all duration-300 disabled:opacity-50
                     flex items-center justify-center gap-2"
        >
          {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Check className="w-4 h-4" /> Ya realicé el pago</>}
        </button>
      </div>
    </div>
  );
}