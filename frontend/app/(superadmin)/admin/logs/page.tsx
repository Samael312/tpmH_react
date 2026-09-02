"use client";

import { AlertOctagon } from "lucide-react";
import ErrorLogsViewer from "@/components/admin/ErrorLogsViewer";
import ChipiWidget from "@/components/chipi/ChipiWidget";

export default function LogsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-start gap-4 bg-gradient-to-r from-slate-900 to-slate-800 rounded-[2rem] p-6 text-white">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-rose-400 to-red-500 flex items-center justify-center flex-shrink-0 shadow-lg shadow-rose-500/20">
          <AlertOctagon className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-lg font-black">Logs</h1>
          <p className="text-xs text-slate-300 mt-1 max-w-2xl">
            Errores de backend (excepciones no controladas y problemas de negocio en pagos,
            clases, cohortes y paquetes) y de frontend (crashes de React y llamadas a la API
            fallidas), con la pantalla donde ocurrieron y el usuario afectado cuando se pudo
            identificar.
          </p>
        </div>
      </div>

      <ErrorLogsViewer />

      <ChipiWidget screenName="admin_logs" />
    </div>
  );
}
