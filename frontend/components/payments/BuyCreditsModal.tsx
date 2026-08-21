"use client";

import { useState } from "react";
import { Check, X, Loader2 } from "lucide-react";
import api from "@/lib/api";
import PaymentMethodsInfo from "./PaymentMethodsInfo";

interface BuyCreditsModalProps {
  enrollmentId: number;
  pricePerClass: number;
  currentCredits: number;
  onClose: () => void;
  onDone: () => void;
}

export default function BuyCreditsModal({
  enrollmentId, pricePerClass, currentCredits, onClose, onDone,
}: BuyCreditsModalProps) {
  const [creditsRequested, setCreditsRequested] = useState(5);
  const [reference, setReference] = useState("");
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const amount = Math.round(creditsRequested * pricePerClass * 100) / 100;

  const notify = async () => {
    setSending(true);
    setError("");
    try {
      await api.post("/payments/notify-payment", {
        type: "unlimited_recharge",
        enrollment_id: enrollmentId,
        credits_requested: creditsRequested,
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
      <div className="flex flex-col items-center py-12 gap-3">
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
      <div className="space-y-5 flex flex-col justify-between">
        <div className="space-y-4">
          <div className="bg-slate-50/80 rounded-2xl p-4 border border-slate-100 flex items-center justify-between">
            <div>
              <p className="text-sm font-black text-slate-800">Flexible</p>
              <p className="text-xs text-slate-500 font-medium">Clases ilimitadas</p>
            </div>
            <div className="text-right">
              <span className="text-[10px] font-bold text-slate-400 block uppercase tracking-wider">Precio/clase</span>
              <span className="text-base font-black text-slate-700">${pricePerClass.toFixed(2)}</span>
            </div>
          </div>

          <div className="bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-2.5 text-xs font-bold text-indigo-700 flex items-center justify-between">
            <span>Créditos actuales disponibles</span>
            <span className="text-sm font-black">{currentCredits}</span>
          </div>

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

          <div className="bg-gradient-to-br from-pink-50 to-rose-50 border border-pink-100 rounded-2xl p-4 text-center">
            <p className="text-[10px] font-black text-pink-500 uppercase tracking-widest mb-1">
              Total por {creditsRequested} clase{creditsRequested !== 1 ? "s" : ""}
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