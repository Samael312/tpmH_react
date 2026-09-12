// frontend/components/payments/RefundDestinationFields.tsx
//
// Campos del modal de "a dónde enviar el reembolso" — reutilizado en:
// - Solicitar reembolso por profesor suspendido (dashboard/teachers)
// - Solicitar reembolso por cohorte cancelada (dashboard, banner "needs_group_refund")
// - Reembolso por downgrade de paquete (PackageCheckout, inline por el layout de 2 columnas)
// Todos los campos son opcionales: el alumno llena el/los que tenga, o deja
// solo una nota libre si no tiene ninguno de los predefinidos.

"use client";

import { Building2, Smartphone, Wallet, StickyNote } from "lucide-react";

export interface RefundDestinationForm {
  bank_name: string;
  bank_account: string;
  account_holder: string;
  mobile_payment: string;
  paypal_or_zelle: string;
  other_notes: string;
}

export const emptyRefundDestinationForm: RefundDestinationForm = {
  bank_name: "", bank_account: "", account_holder: "",
  mobile_payment: "", paypal_or_zelle: "", other_notes: "",
};

export function refundFormToPayload(form: RefundDestinationForm): Record<string, string> | undefined {
  const cleaned = Object.fromEntries(Object.entries(form).filter(([, v]) => v.trim() !== ""));
  return Object.keys(cleaned).length ? cleaned : undefined;
}

export default function RefundDestinationFields({
  value,
  onChange,
}: {
  value: RefundDestinationForm;
  onChange: (form: RefundDestinationForm) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-2 p-3 bg-slate-50 rounded-xl border border-slate-100">
        <p className="flex items-center gap-1.5 text-[10px] font-black text-slate-400 uppercase tracking-widest">
          <Building2 className="w-3.5 h-3.5" /> Transferencia bancaria (opcional)
        </p>
        <input
          placeholder="Banco"
          value={value.bank_name}
          onChange={e => onChange({ ...value, bank_name: e.target.value })}
          className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs"
        />
        <input
          placeholder="Número de cuenta / CLABE / IBAN"
          value={value.bank_account}
          onChange={e => onChange({ ...value, bank_account: e.target.value })}
          className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs"
        />
        <input
          placeholder="Nombre del titular de la cuenta"
          value={value.account_holder}
          onChange={e => onChange({ ...value, account_holder: e.target.value })}
          className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs"
        />
      </div>

      <div className="space-y-2 p-3 bg-slate-50 rounded-xl border border-slate-100">
        <p className="flex items-center gap-1.5 text-[10px] font-black text-slate-400 uppercase tracking-widest">
          <Smartphone className="w-3.5 h-3.5" /> Pago móvil (opcional)
        </p>
        <input
          placeholder="Teléfono / cédula / banco del pago móvil"
          value={value.mobile_payment}
          onChange={e => onChange({ ...value, mobile_payment: e.target.value })}
          className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs"
        />
      </div>

      <div className="space-y-2 p-3 bg-slate-50 rounded-xl border border-slate-100">
        <p className="flex items-center gap-1.5 text-[10px] font-black text-slate-400 uppercase tracking-widest">
          <Wallet className="w-3.5 h-3.5" /> PayPal / Zelle (opcional)
        </p>
        <input
          placeholder="Email de PayPal o Zelle"
          value={value.paypal_or_zelle}
          onChange={e => onChange({ ...value, paypal_or_zelle: e.target.value })}
          className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs"
        />
      </div>

      <div className="space-y-1.5">
        <p className="flex items-center gap-1.5 text-[10px] font-black text-slate-400 uppercase tracking-widest">
          <StickyNote className="w-3.5 h-3.5" /> ¿No tenés ninguno de estos? Dejanos una nota
        </p>
        <textarea
          placeholder="Ej: solo tengo Binance, mi usuario es..."
          value={value.other_notes}
          onChange={e => onChange({ ...value, other_notes: e.target.value })}
          rows={3}
          className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs resize-none"
        />
      </div>
    </div>
  );
}
