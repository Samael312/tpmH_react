"use client";

import { useEffect, useState, useRef, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, AlertTriangle, Loader2, Calendar } from "lucide-react";
import api from "@/lib/api";
import { usePageTopBar } from "@/lib/mobileTopBar";

function CalendarCallbackInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");

  // Referencia para prevenir doble ejecución en React.StrictMode
  const hasExecuted = useRef(false);

  const runCallback = useCallback(() => {
    const code = searchParams.get("code");
    const oauthError = searchParams.get("error");

    if (oauthError) {
      setStatus("error");
      setErrorMsg(
        oauthError === "access_denied"
          ? "Cancelaste la conexión con Google Calendar."
          : `Google devolvió un error: ${oauthError}`
      );
      return;
    }

    if (!code) {
      setStatus("error");
      setErrorMsg("No se recibió el código de autorización de Google.");
      return;
    }

    setStatus("loading");
    setErrorMsg("");

    api
      .post("/calendar/callback", { code })
      .then(() => {
        setStatus("success");
        setTimeout(() => router.replace("/teacher/profile"), 1800);
      })
      .catch((e) => {
        setStatus("error");
        setErrorMsg(
          e.response?.data?.detail || "Error conectando con Google Calendar."
        );
      });
  }, [searchParams, router]);

  useEffect(() => {
    // Si ya se envió la petición una vez, abortamos las llamadas duplicadas
    if (hasExecuted.current) return;
    hasExecuted.current = true;
    runCallback();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Registra título en la topbar mobile; el refresh solo tiene sentido para reintentar tras un error
  usePageTopBar({
    title: "Conectar calendario",
    onRefresh: status === "error" ? runCallback : undefined,
    isFetching: status === "loading",
  });

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white/90 backdrop-blur-xl rounded-[2rem] border border-white shadow-2xl shadow-slate-200/50 p-10 max-w-sm w-full text-center space-y-4">
        <div className="w-14 h-14 rounded-2xl bg-blue-50 flex items-center justify-center mx-auto">
          <Calendar className="w-7 h-7 text-blue-500" />
        </div>

        {status === "loading" && (
          <>
            <Loader2 className="w-8 h-8 text-blue-500 animate-spin mx-auto" />
            <p className="text-sm font-bold text-slate-600">
              Conectando tu Google Calendar...
            </p>
          </>
        )}

        {status === "success" && (
          <>
            <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center mx-auto">
              <Check className="w-5 h-5 text-emerald-600" />
            </div>
            <p className="text-sm font-bold text-emerald-700">
              ¡Calendario conectado correctamente! Redirigiendo...
            </p>
          </>
        )}

        {status === "error" && (
          <>
            <div className="w-10 h-10 rounded-full bg-rose-100 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-5 h-5 text-rose-500" />
            </div>
            <p className="text-sm font-bold text-rose-600">{errorMsg}</p>
            <div className="flex items-center justify-center gap-3 flex-wrap">
              <button
                onClick={runCallback}
                className="mt-2 px-5 py-2.5 text-xs font-bold text-slate-700 rounded-xl bg-white border border-slate-200 shadow-sm hover:bg-slate-50 active:scale-[0.97] transition-all"
              >
                Reintentar
              </button>
              <button
                onClick={() => router.replace("/teacher/profile")}
                className="mt-2 px-5 py-2.5 text-xs font-bold text-white rounded-xl bg-gradient-to-r from-pink-500 to-rose-400 shadow-md active:scale-[0.97] transition-all"
              >
                Volver a mi perfil
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function CalendarCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-50 flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
        </div>
      }
    >
      <CalendarCallbackInner />
    </Suspense>
  );
}