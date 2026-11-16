"use client";

import { useEffect, useState } from "react";
import { MailWarning } from "lucide-react";
import api from "@/lib/api";
import { useToast } from "@/hooks/useToast";
import { getErrorMessage } from "@/lib/errorMessage";

/**
 * SEC-04: aviso para cuentas con el email sin verificar. Retiros y pagos lo exigen, así que ofrece
 * reenviar el enlace. No muestra nada si la cuenta ya está verificada (o mientras carga).
 */
export default function VerifyEmailBanner() {
  const toast = useToast();
  const [unverified, setUnverified] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .get("/users/me")
      .then((res) => {
        if (alive) setUnverified(res.data?.is_verified === false);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  if (!unverified) return null;

  const resend = async () => {
    setSending(true);
    try {
      await api.post("/auth/resend-verification");
      toast.success("Te enviamos un nuevo enlace. Revisa tu correo.");
    } catch (e) {
      toast.error(getErrorMessage(e, "No se pudo reenviar el enlace"));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mx-4 mt-3 sm:mx-6 flex flex-wrap items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800">
      <MailWarning className="h-5 w-5 flex-shrink-0" />
      <p className="flex-1 text-xs font-bold leading-relaxed">
        Verifica tu email para poder enviar pagos y pedir retiros. Te enviamos un enlace al registrarte.
      </p>
      <button
        onClick={resend}
        disabled={sending}
        className="rounded-xl bg-amber-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-600 disabled:opacity-50"
      >
        {sending ? "Enviando…" : "Reenviar enlace"}
      </button>
    </div>
  );
}
