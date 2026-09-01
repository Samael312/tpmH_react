"use client";

import { Component, ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { reportFrontendError } from "@/lib/errorReporting";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Atrapa crashes no controlados del árbol de React (errores de render,
 * de lifecycle methods y de constructores de los componentes hijos) y
 * los reporta a la pantalla de Logs de /admin, en vez de dejar la
 * pantalla en blanco sin rastro alguno.
 *
 * No atrapa errores dentro de event handlers (onClick, etc.) ni de
 * código async — esos los cubre `installGlobalErrorReporting()` en
 * lib/errorReporting.ts vía window.onerror / unhandledrejection.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    reportFrontendError({
      message: `${error.name}: ${error.message}`,
      stack: [error.stack, info.componentStack].filter(Boolean).join("\n\n"),
      screen: typeof window !== "undefined" ? window.location.pathname : "unknown",
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-[50vh] flex flex-col items-center justify-center text-center px-6 gap-3">
          <div className="w-12 h-12 rounded-2xl bg-rose-50 flex items-center justify-center">
            <AlertTriangle className="w-6 h-6 text-rose-500" />
          </div>
          <h2 className="text-sm font-black text-slate-800">Algo salió mal</h2>
          <p className="text-xs text-slate-400 max-w-sm">
            Ocurrió un error inesperado en esta pantalla. Ya quedó registrado —
            probá recargar la página.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-2 text-xs font-bold px-4 py-2 rounded-xl bg-slate-900 text-white hover:bg-slate-800 transition-colors"
          >
            Recargar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
