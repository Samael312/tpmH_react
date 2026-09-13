"use client";

import { useState, useEffect } from "react";
import { ChevronDown, Check, MessageCircle, Wallet, Coins, Landmark, Smartphone } from "lucide-react";
import api from "@/lib/api";
import { useAuthStore } from "@/store/authStore";

interface PaymentConfig {
  paypal_enabled: boolean;
  binance_enabled: boolean;
  bank_transfer_enabled: boolean;
  mobile_payment_enabled: boolean;
  paypal_email: string | null;
  binance_address: string | null;
  binance_network: string | null;
  bank_transfer_details: string | null;
  mobile_payment_details: string | null;
  whatsapp_number: string | null;
  has_any_method: boolean;
}

interface MethodEntry {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  iconBg: string;
  iconFg: string;
  rows: { label: string; value: string }[];
}

// Iconos propios (SVG vía lucide-react) en vez de emoji, cuyo render varía
// entre sistemas operativos/navegadores y no encaja con el resto del UI.
const METHOD_STYLES: Record<string, { icon: React.ComponentType<{ className?: string }>; bg: string; fg: string }> = {
  paypal: { icon: Wallet, bg: "bg-blue-100", fg: "text-blue-600" },
  binance: { icon: Coins, bg: "bg-amber-100", fg: "text-amber-600" },
  bank_transfer: { icon: Landmark, bg: "bg-indigo-100", fg: "text-indigo-600" },
  mobile_payment: { icon: Smartphone, bg: "bg-emerald-100", fg: "text-emerald-600" },
};

// Mapea las preferencias guardadas en el perfil del estudiante
// (Paypal, Binance, Zelle, BankTransfer, MobilePayment) a las claves
// de configuración de pago del admin. "Zelle" no tiene método
// correspondiente en la configuración global, así que no se resalta.
const PREFERRED_TO_CONFIG_KEY: Record<string, string> = {
  Paypal: "paypal",
  Binance: "binance",
  BankTransfer: "bank_transfer",
  MobilePayment: "mobile_payment",
};

function buildMethods(config: PaymentConfig): MethodEntry[] {
  const methods: MethodEntry[] = [];
  if (config.paypal_enabled) {
    methods.push({
      key: "paypal",
      label: "PayPal",
      icon: METHOD_STYLES.paypal.icon,
      iconBg: METHOD_STYLES.paypal.bg,
      iconFg: METHOD_STYLES.paypal.fg,
      rows: [{ label: "Email", value: config.paypal_email || "No especificado" }],
    });
  }
  if (config.binance_enabled) {
    methods.push({
      key: "binance",
      label: "Binance (USDT)",
      icon: METHOD_STYLES.binance.icon,
      iconBg: METHOD_STYLES.binance.bg,
      iconFg: METHOD_STYLES.binance.fg,
      rows: [
        { label: "Dirección", value: config.binance_address || "No especificada" },
        { label: "Red", value: config.binance_network || "No especificada" },
      ],
    });
  }
  if (config.bank_transfer_enabled) {
    methods.push({
      key: "bank_transfer",
      label: "Transferencia bancaria",
      icon: METHOD_STYLES.bank_transfer.icon,
      iconBg: METHOD_STYLES.bank_transfer.bg,
      iconFg: METHOD_STYLES.bank_transfer.fg,
      rows: [{ label: "Datos", value: config.bank_transfer_details || "No especificados" }],
    });
  }
  if (config.mobile_payment_enabled) {
    methods.push({
      key: "mobile_payment",
      label: "Pago móvil / Bizum",
      icon: METHOD_STYLES.mobile_payment.icon,
      iconBg: METHOD_STYLES.mobile_payment.bg,
      iconFg: METHOD_STYLES.mobile_payment.fg,
      rows: [{ label: "Datos", value: config.mobile_payment_details || "No especificados" }],
    });
  }
  return methods;
}

export default function PaymentMethodsInfo() {
  const [config, setConfig] = useState<PaymentConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const preferred = useAuthStore((s) => s.user?.preferred_payment_methods) ?? [];

  useEffect(() => {
    api
      .get("/payments/config")
      .then((r) => setConfig(r.data))
      .catch(() => setConfig(null))
      .finally(() => setLoading(false));
  }, []);

  const preferredKeys = new Set(
    preferred.map((p) => PREFERRED_TO_CONFIG_KEY[p]).filter(Boolean)
  );

  const methods = config ? buildMethods(config) : [];

  // Abre automáticamente el primer método preferido del estudiante, si hay uno
  useEffect(() => {
    if (methods.length === 0) return;
    const firstPreferred = methods.find((m) => preferredKeys.has(m.key));
    if (firstPreferred) setOpenKey(firstPreferred.key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  if (loading) {
    return <div className="h-14 bg-slate-50 rounded-xl animate-pulse" />;
  }
  if (!config || !config.has_any_method || methods.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">

      {methods.map((m) => {
        const isPreferred = preferredKeys.has(m.key);
        const isOpen = openKey === m.key;
        return (
          <div
            key={m.key}
            className={`border-2 rounded-xl overflow-hidden transition-all ${
              isPreferred ? "border-pink-300 bg-pink-50/40" : "border-slate-100 bg-white"
            }`}
          >
            <button
              type="button"
              onClick={() => setOpenKey(isOpen ? null : m.key)}
              className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left"
            >
              <span className="flex items-center gap-2 text-sm font-bold text-slate-700">
                <span className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${m.iconBg}`}>
                  <m.icon className={`w-4 h-4 ${m.iconFg}`} />
                </span>
                {m.label}
                {isPreferred && (
                  <span className="text-[9px] font-black uppercase tracking-widest text-pink-600 bg-pink-100 px-2 py-0.5 rounded-full flex items-center gap-1">
                    <Check className="w-2.5 h-2.5" /> Tu preferido
                  </span>
                )}
              </span>
              <ChevronDown
                className={`w-4 h-4 text-slate-400 flex-shrink-0 transition-transform ${
                  isOpen ? "rotate-180" : ""
                }`}
              />
            </button>

            {isOpen && (
              <div className="px-4 pb-3 pt-3 border-t border-slate-100 space-y-1.5">
                {m.rows.map((row, i) => (
                  <div key={i} className="flex justify-between gap-3 text-xs">
                    <span className="text-slate-400 font-bold flex-shrink-0">{row.label}</span>
                    <span className="text-slate-700 font-bold text-right break-all">{row.value}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {config.whatsapp_number && (
        <p className="text-[11px] text-slate-400 font-bold px-1 flex items-center gap-1.5">
          <MessageCircle className="w-3.5 h-3.5 flex-shrink-0" />
          ¿Dudas con el pago? Escribe al {config.whatsapp_number}
        </p>
      )}
    </div>
  );
}