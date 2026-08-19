// frontend/components/payments/PackageCheckout.tsx

"use client";

import { useState } from "react";
import { Check, X, Loader2, CreditCard, Split } from "lucide-react";
import api from "@/lib/api";
import PaymentMethodsInfo from "./PaymentMethodsInfo";

export interface PackageLite {
  id: number;
  name: string;
  price: number;
  classes_count: number | null;
  allow_installments: boolean;
  installment_count: number | null;
  installment_amount: number | null;
  icon?: string;
}

export interface PackageCheckoutProps {
  pkg: PackageLite;
  mode: "initial" | "renewal" | "change";
  enrollmentId: number | null;
  installmentsPaid: number;
  onClose: () => void;
  onDone: () => void;
}

export default function PackageCheckout({
  pkg,
  mode,
  enrollmentId,
  installmentsPaid,
  onClose,
  onDone,
}: PackageCheckoutProps) {
  const isUnlimited = pkg.classes_count == null;
  const [creditsRequested, setCreditsRequested] = useState(5);
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

  const amount = isUnlimited
    ? Math.round(creditsRequested * pkg.price * 100) / 100
    : (useInstallments || alreadyMidInstallments)
      ? installmentAmountCalculated
      : pkg.price;

  const notify = async () => {
    setSending(true);
    setError("");
    try {
      const typeMap = { initial: "package", renewal: "renewal", change: "package_change" } as const;
      await api.post("/payments/notify-payment", {
        type: typeMap[mode],
        enrollment_id: enrollmentId ?? undefined,
        package_id: pkg.id,
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
      <div className="flex flex-col items-center py-12 gap-3 animate-fade-in">
        <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center shadow-inner">
          <Check className="w-8 h-8 text-emerald-600" />
        </div>
        <p className="font-black text-slate-800 text-xl">¡Pago notificado!</p>
        <p className="text-xs text-slate-500 text-center max-w-sm leading-relaxed">
          Tu profesor(a) o el equipo administrativo validará la transacción en breve.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 w-full">
      {/* Columna Izquierda: Información, selectores y totales */}
      <div className="space-y-5 flex flex-col justify-between">
        <div className="space-y-4">
          <div className="bg-slate-50/80 rounded-2xl p-4 border border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-2xl">{pkg.icon || "📦"}</span>
              <div>
                <p className="text-sm font-black text-slate-800">{pkg.name}</p>
                <p className="text-xs text-slate-500 font-medium">
                  {isUnlimited ? "Clases ilimitadas" : `${pkg.classes_count} clases incluidas`}
                </p>
              </div>
            </div>
            <div className="text-right">
              <span className="text-[10px] font-bold text-slate-400 block uppercase tracking-wider">{isUnlimited ? "Precio/clase" : "Total"}</span>
              <span className="text-base font-black text-slate-700">${pkg.price.toFixed(2)}</span>
            </div>
          </div>

          {isUnlimited ? (
            <div>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
                ¿Cuántas clases quieres comprar?
              </p>
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => setCreditsRequested(p => Math.max(1, p - 1))}
                  className="w-10 h-10 rounded-xl bg-slate-100 hover:bg-slate-200 font-black text-slate-600 transition-colors">−</button>
                <input
                  type="number" min={1} value={creditsRequested}
                  onChange={e => setCreditsRequested(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-24 text-center bg-slate-50 border-2 border-transparent rounded-xl text-lg font-black text-slate-800 py-2 focus:outline-none focus:border-pink-500"
                />
                <button type="button" onClick={() => setCreditsRequested(p => p + 1)}
                  className="w-10 h-10 rounded-xl bg-slate-100 hover:bg-slate-200 font-black text-slate-600 transition-colors">+</button>
                <span className="text-xs font-bold text-slate-400">clases</span>
              </div>
            </div>
          ) : pkg.allow_installments && !alreadyMidInstallments && (
            <div>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
                Modalidad de pago
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setUseInstallments(false)}
                  className={`flex flex-col items-center gap-1 py-3 px-3 rounded-xl border-2 text-xs font-bold transition-all ${
                    !useInstallments ? "border-pink-500 bg-pink-50 text-pink-600 shadow-sm" : "border-slate-100 bg-white text-slate-500 hover:bg-slate-50"
                  }`}>
                  <CreditCard className="w-4 h-4" /> Único (${pkg.price.toFixed(2)})
                </button>
                <button type="button" onClick={() => setUseInstallments(true)}
                  className={`flex flex-col items-center gap-1 py-3 px-3 rounded-xl border-2 text-xs font-bold transition-all ${
                    useInstallments ? "border-pink-500 bg-pink-50 text-pink-600 shadow-sm" : "border-slate-100 bg-white text-slate-500 hover:bg-slate-50"
                  }`}>
                  <Split className="w-4 h-4" /> {pkg.installment_count || 1} cuotas (${installmentAmountCalculated.toFixed(2)})
                </button>
              </div>
            </div>
          )}

          {!isUnlimited && alreadyMidInstallments && (
            <div className="bg-amber-50 border border-amber-200/60 rounded-xl px-4 py-3 text-xs font-bold text-amber-800 flex items-center justify-between">
              <span>Pagando cuota en curso</span>
              <span className="bg-amber-200/60 px-2 py-0.5 rounded-md text-[11px]">
                {nextIndex} de {pkg.installment_count || 1}
              </span>
            </div>
          )}

          <div className="bg-gradient-to-br from-pink-50 to-rose-50 border border-pink-100 rounded-2xl p-4 text-center">
            <p className="text-[10px] font-black text-pink-500 uppercase tracking-widest mb-1">
              {isUnlimited
                ? `Total por ${creditsRequested} clase${creditsRequested !== 1 ? "s" : ""}`
                : useInstallments || alreadyMidInstallments
                  ? `Monto de la cuota ${alreadyMidInstallments ? nextIndex : 1}`
                  : "Monto total a transferir"}
            </p>
            <p className="text-3xl font-black text-pink-600">${amount.toFixed(2)} USD</p>
          </div>
        </div>

        <div>
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">
            Mensaje de transacción (opcional)
          </label>
          <input
            type="text" value={reference} onChange={(e) => setReference(e.target.value)}
            placeholder="Ej: últimos 4 dígitos..."
            className="w-full bg-slate-50 border-2 border-transparent rounded-xl text-xs font-bold
                       text-slate-800 placeholder:text-slate-400 px-4 py-3.5 focus:outline-none
                       focus:bg-white focus:border-pink-500 focus:ring-4 focus:ring-pink-50 transition-all"
          />
        </div>
      </div>

      {/* Columna Derecha: Métodos de pago y botones de acción */}
      <div className="flex flex-col justify-between space-y-4">
        <div className="space-y-3">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
            Métodos de pago disponibles
          </p>
          <div className="max-h-[300px] overflow-y-auto pr-1">
            <PaymentMethodsInfo />
          </div>
        </div>

        {error && (
          <div className="bg-rose-50 border border-rose-100 text-rose-600 px-4 py-3 rounded-xl text-xs font-bold flex items-center gap-2">
            <X className="w-4 h-4 flex-shrink-0" /><span>{error}</span>
          </div>
        )}

        <div className="flex gap-3 pt-3 border-t border-slate-100">
          <button type="button" onClick={onClose} disabled={sending}
            className="flex-1 py-3.5 text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors disabled:opacity-50">
            Cancelar
          </button>
          <button type="button" onClick={notify} disabled={sending}
            className="flex-1 py-3.5 text-xs font-bold text-white rounded-xl bg-gradient-to-r
                       from-pink-500 to-rose-400 hover:from-pink-600 hover:to-rose-500 shadow-lg
                       shadow-pink-200 active:scale-[0.98] transition-all duration-300 disabled:opacity-50
                       flex items-center justify-center gap-2">
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Check className="w-4 h-4" /> Ya realicé el pago</>}
          </button>
        </div>
      </div>
    </div>
  );
}