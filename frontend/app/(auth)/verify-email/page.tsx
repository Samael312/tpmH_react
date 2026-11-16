"use client";

import { useEffect, useRef, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { Check, ArrowLeft, AlertTriangle } from "lucide-react";
import api from "@/lib/api";
import ChipiWidget from "@/components/chipi/ChipiWidget";
import Skeleton from "@/components/ui/Skeleton";
import { getErrorMessage } from "@/lib/errorMessage";
import { useLandingData } from "@/hooks/useLandingData";

type Status = "loading" | "success" | "error";

function VerifyEmailContent() {
  const token = useSearchParams().get("token");
  const [status, setStatus] = useState<Status>(token ? "loading" : "error");
  const [message, setMessage] = useState(token ? "" : "Este enlace no es válido.");
  const sent = useRef(false); // el modo estricto de React ejecuta los efectos dos veces: el token es de un solo uso

  useEffect(() => {
    if (!token || sent.current) return;
    sent.current = true;
    api
      .post("/auth/verify-email", { token })
      .then(() => setStatus("success"))
      .catch((e: unknown) => {
        setStatus("error");
        setMessage(getErrorMessage(e, "No se pudo verificar tu email."));
      });
  }, [token]);

  if (status === "loading") {
    return (
      <div className="space-y-4">
        <Skeleton className="h-14 w-full rounded-xl" />
        <Skeleton className="h-12 w-full rounded-xl" />
      </div>
    );
  }

  if (status === "success") {
    return (
      <div className="flex flex-col items-center py-8 text-center">
        <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mb-4">
          <Check className="w-8 h-8 text-emerald-600" />
        </div>
        <h2 className="text-lg font-black text-slate-800 mb-2">¡Email verificado!</h2>
        <p className="text-sm text-slate-500 mb-6">Ya puedes enviar pagos, pedir retiros y vincular Google.</p>
        <Link href="/login" className="text-sm font-bold text-pink-600 hover:text-pink-700">
          Ir a la plataforma →
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center py-8 text-center">
      <div className="w-16 h-16 bg-rose-100 rounded-full flex items-center justify-center mb-4">
        <AlertTriangle className="w-8 h-8 text-rose-500" />
      </div>
      <h2 className="text-lg font-black text-slate-800 mb-2">No pudimos verificar tu email</h2>
      <p className="text-sm text-slate-500 mb-6">
        {message || "El enlace expiró o ya fue usado."} Inicia sesión y pide un nuevo enlace desde el aviso que verás en tu panel.
      </p>
      <Link href="/login" className="text-sm font-bold text-pink-600 hover:text-pink-700">
        Iniciar sesión →
      </Link>
    </div>
  );
}

export default function VerifyEmailPage() {
  const { platformName } = useLandingData();

  return (
    <>
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4 relative overflow-hidden">
        <div className="absolute top-[-100px] right-[-80px] w-[400px] h-[400px] bg-pink-300/20 rounded-full blur-[100px] pointer-events-none" />

        <div className="relative w-full max-w-sm sm:max-w-md animate-in fade-in slide-in-from-bottom-6 duration-500">
          <div className="flex flex-col items-center mb-8">
            <div className="w-14 h-14 rounded-[1.25rem] overflow-hidden shadow-xl shadow-pink-200 mb-4 bg-white p-2">
              <Image src="/assets/logo.png" alt={platformName} width={56} height={56} className="object-contain w-full h-full" />
            </div>
            <h1 className="text-2xl font-black text-slate-800 tracking-tight">Verificar email</h1>
          </div>

          <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] border border-white shadow-2xl shadow-slate-200/50 p-6 sm:p-8">
            <Suspense fallback={<Skeleton className="h-14 w-full rounded-xl" />}>
              <VerifyEmailContent />
            </Suspense>
          </div>

          <Link href="/login" className="flex items-center justify-center gap-2 text-sm font-bold text-slate-500 hover:text-pink-600 transition-colors mt-6">
            <ArrowLeft className="w-4 h-4" />
            Volver al inicio de sesión
          </Link>
        </div>
      </div>

      <ChipiWidget screenName="verify-email" />
    </>
  );
}
