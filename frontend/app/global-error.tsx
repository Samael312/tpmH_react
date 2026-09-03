"use client";

import { useEffect } from "react";
import Link from "next/link";
import { reportFrontendError } from "@/lib/errorReporting";
import "./globals.css";

/**
 * Último recurso: se activa solo si el propio `app/layout.tsx` (o algo
 * que renderiza junto a él, como Providers) lanza un error. Next.js
 * reemplaza TODO el árbol por este componente, así que tiene que traer
 * su propio <html>/<body> — layout.tsx no se está renderizando.
 *
 * Se mantiene deliberadamente simple y sin depender de Providers (React
 * Query, MobileTopBarProvider, etc.), ya que esos son parte de lo que
 * pudo haber fallado. `useAuthStore` es seguro de usar igual: es un
 * store de Zustand sin Context de por medio, no requiere Providers.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    reportFrontendError({
      message: `${error.name || "Error"}: ${error.message}`,
      stack: error.stack,
      screen: typeof window !== "undefined" ? window.location.pathname : "unknown",
      extra: error.digest ? { digest: error.digest } : undefined,
    });
  }, [error]);

  return (
    <html lang="es">
      <body className="font-sans antialiased bg-white text-ink">
        <main className="min-h-screen flex items-center justify-center px-6">
          <div className="max-w-md w-full text-center flex flex-col items-center gap-4">
            <div className="w-16 h-16 rounded-3xl bg-rose-50 flex items-center justify-center">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="w-8 h-8 text-rose-500"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"
                />
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 17h.01" />
              </svg>
            </div>

            <h1 className="font-display font-bold text-xl">
              Algo salió mal
            </h1>

            <p className="text-sm text-ink-muted max-w-sm">
              La aplicación tuvo un problema inesperado al iniciar. Ya
              quedó registrado — probá recargar la página.
            </p>

            {error.digest && (
              <p className="text-xs text-ink-subtle font-mono">
                Referencia: {error.digest}
              </p>
            )}

            <div className="flex flex-col sm:flex-row gap-3 mt-2 w-full sm:w-auto">
              <Link
                href="/"
                className="order-2 sm:order-1 inline-flex items-center justify-center gap-2 px-6 py-3 text-sm rounded-2xl bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 hover:border-pink-200 font-semibold shadow-sm transition-all"
              >
                Ir al inicio
              </Link>

              <button
                onClick={retry}
                className="order-1 sm:order-2 inline-flex items-center justify-center gap-2 px-6 py-3 text-sm rounded-2xl bg-gradient-to-r from-pink-500 to-rose-400 text-white font-bold shadow-lg shadow-pink-200 hover:shadow-pink-300 transform active:scale-95 transition-all"
              >
                Reintentar
              </button>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
