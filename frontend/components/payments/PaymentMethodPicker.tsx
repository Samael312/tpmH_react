"use client";

// Correcciones Extra (informe D1-D14): en todos los modales de
// notificación de pago, el método usado ahora es seleccionable y
// obligatorio -- no se puede notificar el pago sin indicar con cuál de
// los métodos habilitados por el admin se pagó. Ese valor viaja en
// `payment_method` a /payments/notify-payment y /cohorts/{id}/enroll, y
// se muestra después en la card del pago en /admin/payments.
//
// Reusa el mismo catálogo (paypal/binance/bank_transfer/mobile_payment)
// y las mismas etiquetas que PaymentMethodsInfo.tsx, para no duplicar la
// fuente de la verdad de qué métodos existen.

import { useEffect, useState } from "react";
import { Check, Wallet, Coins, Landmark, Smartphone } from "lucide-react";
import api from "@/lib/api";

interface PaymentConfig {
  paypal_enabled: boolean;
  binance_enabled: boolean;
  bank_transfer_enabled: boolean;
  mobile_payment_enabled: boolean;
  has_any_method: boolean;
}

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  paypal: "PayPal",
  binance: "Binance (USDT)",
  bank_transfer: "Transferencia bancaria",
  mobile_payment: "Pago móvil / Bizum",
};

const METHOD_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  paypal: Wallet,
  binance: Coins,
  bank_transfer: Landmark,
  mobile_payment: Smartphone,
};

function enabledKeys(config: PaymentConfig): string[] {
  const keys: string[] = [];
  if (config.paypal_enabled) keys.push("paypal");
  if (config.binance_enabled) keys.push("binance");
  if (config.bank_transfer_enabled) keys.push("bank_transfer");
  if (config.mobile_payment_enabled) keys.push("mobile_payment");
  return keys;
}

interface Props {
  value: string | null;
  onChange: (key: string) => void;
  /** Muestra el input en rojo si el padre intentó enviar sin seleccionar */
  showError?: boolean;
}

export default function PaymentMethodPicker({ value, onChange, showError }: Props) {
  const [config, setConfig] = useState<PaymentConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get("/payments/config")
      .then((r) => setConfig(r.data))
      .catch(() => setConfig(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="h-11 bg-slate-50 rounded-xl animate-pulse" />;
  }

  const keys = config ? enabledKeys(config) : [];

  if (!config || keys.length === 0) {
    // Sin métodos configurados por el admin todavía -- no hay nada entre
    // qué elegir, así que no bloqueamos con un selector vacío.
    return null;
  }

  return (
    <div className="space-y-1.5">
      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">
        ¿Con qué método pagaste? *
      </label>
      <div className="flex flex-wrap gap-2">
        {keys.map((key) => {
          const Icon = METHOD_ICONS[key];
          const selected = value === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onChange(key)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-colors border-2
                ${selected
                  ? "bg-pink-500 border-pink-500 text-white"
                  : "bg-slate-50 border-transparent text-slate-600 hover:bg-slate-100"}`}
            >
              {selected ? <Check className="w-3.5 h-3.5" /> : <Icon className="w-3.5 h-3.5" />}
              {PAYMENT_METHOD_LABELS[key] || key}
            </button>
          );
        })}
      </div>
      {showError && !value && (
        <p className="text-[11px] font-bold text-rose-500">Indica con qué método pagaste antes de continuar.</p>
      )}
    </div>
  );
}
