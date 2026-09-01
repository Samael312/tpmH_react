import axios from "axios";

/**
 * Reporta un error del frontend a POST /logs/frontend, para que aparezca
 * en la pantalla de Logs de /admin junto a los errores de backend.
 *
 * Usa un cliente axios propio (no `lib/api.ts`) a propósito: si usáramos
 * el cliente normal, un fallo de red al reportar dispararía el mismo
 * interceptor de errores y podría generar un bucle de reportes. Esta
 * llamada nunca debe interrumpir la experiencia del usuario ni lanzar:
 * cualquier fallo se ignora en silencio.
 */
const reportingClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1",
  headers: { "Content-Type": "application/json" },
  timeout: 5000,
});

export interface FrontendErrorReport {
  message: string;
  stack?: string;
  screen: string;
  level?: "error" | "warning";
  status_code?: number;
  extra?: Record<string, unknown>;
}

// Evita mandar el mismo error en bucle si algo lo dispara repetidas veces
// en un ciclo de render corto (ej. un ErrorBoundary que reintenta).
const recentlyReported = new Set<string>();
const DEDUPE_WINDOW_MS = 4000;

function shouldReport(key: string): boolean {
  if (recentlyReported.has(key)) return false;
  recentlyReported.add(key);
  setTimeout(() => recentlyReported.delete(key), DEDUPE_WINDOW_MS);
  return true;
}

export function reportFrontendError(report: FrontendErrorReport) {
  try {
    const key = `${report.screen}|${report.message}`;
    if (!shouldReport(key)) return;

    let token: string | undefined;
    if (typeof document !== "undefined") {
      token = document.cookie
        .split("; ")
        .find((row) => row.startsWith("access_token="))
        ?.split("=")[1];
    }

    reportingClient
      .post(
        "/logs/frontend",
        {
          message: report.message.slice(0, 2000),
          stack: report.stack,
          screen: report.screen,
          level: report.level ?? "error",
          status_code: report.status_code,
          extra: report.extra,
        },
        token ? { headers: { Authorization: `Bearer ${token}` } } : undefined
      )
      .catch(() => {
        // Si ni siquiera se puede reportar el error, no hay nada más que
        // hacer del lado del cliente — se pierde ese log puntual.
      });
  } catch {
    // Nunca dejar que el reporte de errores rompa el flujo normal.
  }
}

/**
 * Se llama una sola vez desde Providers para capturar los errores de JS
 * que no pasan por un ErrorBoundary de React: excepciones sueltas
 * (window.onerror) y promesas rechazadas sin catch (unhandledrejection).
 */
export function installGlobalErrorReporting() {
  if (typeof window === "undefined") return;
  // Evita instalar los listeners dos veces (ej. con Fast Refresh en dev)
  const win = window as typeof window & { __errorReportingInstalled?: boolean };
  if (win.__errorReportingInstalled) return;
  win.__errorReportingInstalled = true;

  window.addEventListener("error", (event) => {
    reportFrontendError({
      message: event.message || "Error de JS no controlado",
      stack: event.error?.stack,
      screen: window.location.pathname,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    reportFrontendError({
      message:
        reason instanceof Error
          ? `${reason.name}: ${reason.message}`
          : `Promesa rechazada sin manejar: ${String(reason)}`,
      stack: reason instanceof Error ? reason.stack : undefined,
      screen: window.location.pathname,
    });
  });
}
