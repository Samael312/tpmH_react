"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { reportFrontendError } from "@/lib/errorReporting";
import Button from "@/components/ui/Button";

/**
 * Error boundary de Next.js para el árbol de rutas (todo lo que cuelga
 * del layout raíz). A diferencia de `components/ErrorBoundary.tsx` — que
 * es un boundary de React clásico usado dentro de Providers para
 * capturar crashes de render en el cliente — este archivo lo maneja el
 * propio framework y también atrapa errores lanzados en Server
 * Components (p. ej. un `page.tsx` async que falla al hacer fetch).
 *
 * Reporta al mismo endpoint /logs/frontend para que el error termine
 * apareciendo en /admin/logs igual que cualquier otro.
 */
export default function GlobalRouteError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const user = useAuthStore((s) => s.user);

  const homeHref = !user
    ? "/"
    : user.role === "student"
      ? "/dashboard"
      : user.role === "superadmin"
        ? "/admin/dashboard"
        : "/teacher/dashboard";

  useEffect(() => {
    reportFrontendError({
      message: `${error.name || "Error"}: ${error.message}`,
      stack: error.stack,
      screen: typeof window !== "undefined" ? window.location.pathname : "unknown",
      extra: error.digest ? { digest: error.digest } : undefined,
    });
  }, [error]);

  return (
    <main className="min-h-screen flex items-center justify-center px-6 bg-white">
      <div className="max-w-md w-full text-center flex flex-col items-center gap-4">
        <div className="w-16 h-16 rounded-3xl bg-rose-50 flex items-center justify-center">
          <AlertTriangle className="w-8 h-8 text-rose-500" />
        </div>

        <h1 className="font-display font-bold text-xl text-ink">
          Algo salió mal
        </h1>

        <p className="text-sm text-ink-muted max-w-sm">
          Ocurrió un error inesperado al cargar esta página. Ya quedó
          registrado — podés intentar de nuevo o volver al inicio.
        </p>

        {error.digest && (
          <p className="text-xs text-ink-subtle font-mono">
            Referencia: {error.digest}
          </p>
        )}

        <div className="flex flex-col sm:flex-row gap-3 mt-2 w-full sm:w-auto">
          <Link href={homeHref} className="order-2 sm:order-1">
            <Button variant="secondary" size="md" className="w-full">
              Ir al inicio
            </Button>
          </Link>

          <Button
            variant="primary"
            size="md"
            onClick={retry}
            className="order-1 sm:order-2"
          >
            <RotateCcw className="w-4 h-4" />
            Reintentar
          </Button>
        </div>
      </div>
    </main>
  );
}
