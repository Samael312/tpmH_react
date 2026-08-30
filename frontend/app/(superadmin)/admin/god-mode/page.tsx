"use client";

import { useState } from "react";
import { Crown, ShieldAlert } from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { usePageTopBar } from "@/lib/mobileTopBar";
import { GOD_MODE_ACTIONS, GOD_MODE_CATEGORIES, GodModeAction } from "@/lib/godModeActions";
import GodModeActionRunner from "@/components/god-mode/GodModeActionRunner";
import GodModeAuditLogViewer from "@/components/god-mode/GodModeAuditLogViewer";

export default function GodModePage() {
  const { user } = useAuthStore();
  const [category, setCategory] = useState<typeof GOD_MODE_CATEGORIES[number]>("Créditos y Paquetes");
  const [selectedAction, setSelectedAction] = useState<GodModeAction | null>(null);

  usePageTopBar({ title: "Modo Dios" });

  const isSuperadmin = user?.role === "superadmin";
  const actionsInCategory = GOD_MODE_ACTIONS.filter(a => a.category === category)
    // Un teacher_admin no puede transferir alumnos entre profesores (solo superadmin, validado también en backend)
    .filter(a => isSuperadmin || a.id !== "student.transfer_teacher");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4 bg-gradient-to-r from-slate-900 to-slate-800 rounded-[2rem] p-6 text-white">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-400 to-yellow-500 flex items-center justify-center flex-shrink-0 shadow-lg shadow-amber-500/20">
          <Crown className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-lg font-black">Modo Dios</h1>
          <p className="text-xs text-slate-300 mt-1 max-w-2xl">
            Acciones que se saltan las reglas normales de negocio: créditos, paquetes, cohortes, clases y pagos.
            Cada acción queda registrada con tu usuario y el motivo que escribas — no se puede deshacer desde acá.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 text-amber-800 text-xs font-bold rounded-2xl px-4 py-3">
        <ShieldAlert className="w-4 h-4 flex-shrink-0" />
        {isSuperadmin
          ? "Como superadmin, estas acciones aplican sobre cualquier profesor o alumno de la plataforma."
          : "Como teacher_admin, estas acciones solo aplican sobre tus propios alumnos y cohortes."}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
        {/* Selector de categoría / acción */}
        <div className="space-y-4">
          <div className="flex lg:flex-col gap-1.5 overflow-x-auto lg:overflow-visible pb-1">
            {GOD_MODE_CATEGORIES.map(cat => (
              <button
                key={cat}
                onClick={() => { setCategory(cat); setSelectedAction(null); }}
                className={`flex-shrink-0 text-left px-4 py-2.5 rounded-xl text-xs font-bold transition-colors whitespace-nowrap
                  ${category === cat ? "bg-pink-500 text-white shadow-md shadow-pink-200" : "bg-white text-slate-500 border border-slate-100 hover:border-pink-200"}`}
              >
                {cat}
              </button>
            ))}
          </div>

          <div className="space-y-1.5">
            {actionsInCategory.map(action => (
              <button
                key={action.id}
                onClick={() => setSelectedAction(action)}
                className={`w-full text-left px-4 py-3 rounded-xl text-xs font-semibold transition-colors
                  ${selectedAction?.id === action.id ? "bg-slate-800 text-white" : "bg-white text-slate-600 border border-slate-100 hover:border-pink-200"}`}
              >
                {action.label}
              </button>
            ))}
          </div>
        </div>

        {/* Formulario de la acción seleccionada */}
        <div>
          {selectedAction ? (
            <GodModeActionRunner key={selectedAction.id} action={selectedAction} />
          ) : (
            <div className="h-full min-h-[200px] flex items-center justify-center text-sm text-slate-400 bg-white border border-dashed border-slate-200 rounded-[2rem]">
              Elige una acción de la izquierda para empezar.
            </div>
          )}
        </div>
      </div>

      <GodModeAuditLogViewer />
    </div>
  );
}
