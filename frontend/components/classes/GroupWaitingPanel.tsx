// frontend/components/classes/GroupWaitingPanel.tsx

"use client";

import { useState } from "react";
import { Users2, Calendar, Clock, ArrowRightLeft } from "lucide-react";
import ChangePackageModal from "@/components/payments/ChangePackageModal";
import type { StudentEnrollment } from "@/hooks/useStudentData";

const STATUS_LABEL: Record<string, string> = {
  filling: "Llenándose",
  confirmed: "Fecha confirmada",
  in_progress: "En curso",
  completed: "Completada",
  cancelled: "Cancelada",
};

interface Props {
  enrollment: StudentEnrollment;
  onChanged: () => void;
}

export default function GroupWaitingPanel({ enrollment, onChanged }: Props) {
  const [showMigration, setShowMigration] = useState(false);

  const status = enrollment.cohort_status ?? "filling";
  const current = enrollment.cohort_current_students ?? 0;
  const max = enrollment.cohort_max_students ?? 0;
  const progressPct = max > 0 ? Math.min((current / max) * 100, 100) : 0;
  const canMigrate = enrollment.status === "active" && enrollment.payment_status === "paid";

  return (
    <div className="bg-gradient-to-br from-purple-900 via-indigo-900 to-slate-900 rounded-[2rem] p-6 text-white relative overflow-hidden shadow-2xl shadow-indigo-950/20 border border-white/10 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="absolute -top-12 -right-12 w-56 h-56 bg-purple-500/20 rounded-full blur-3xl pointer-events-none" />
      <div className="relative z-10 space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-purple-500/20 text-purple-300 border border-purple-500/30">
            <Users2 className="w-3 h-3" /> Clase grupal
          </span>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold bg-white/10 text-slate-200 border border-white/10">
            {STATUS_LABEL[status] ?? status}
          </span>
        </div>

        <div>
          <h2 className="text-xl font-black text-white tracking-tight">{enrollment.package?.name}</h2>
          <p className="text-slate-300 text-xs font-bold">Con {enrollment.teacher_name || "tu profesor"}</p>
        </div>

        {status === "filling" && (
          <div className="bg-white/10 rounded-2xl p-4 space-y-2">
            <div className="flex items-end justify-between">
              <p className="text-2xl font-black text-white leading-none">
                {current}<span className="text-sm text-slate-400 font-bold">/{max} inscritos</span>
              </p>
            </div>
            <div className="w-full h-2 bg-slate-800/80 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-purple-500 to-pink-400 rounded-full transition-all duration-700"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <p className="text-xs text-slate-300">
              Tu lugar ya está reservado. Te avisaremos apenas tu profesor(a) confirme la fecha de inicio.
            </p>
          </div>
        )}

        {status === "confirmed" && enrollment.cohort_start_date && (
          <div className="bg-white/10 rounded-2xl p-4 flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-500/20 rounded-xl flex items-center justify-center flex-shrink-0">
              <Calendar className="w-5 h-5 text-emerald-300" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Tu grupo inicia el</p>
              <p className="text-sm font-black text-white">
                {new Date(enrollment.cohort_start_date).toLocaleString("es", { dateStyle: "medium", timeStyle: "short" })}
              </p>
            </div>
          </div>
        )}

        {status === "in_progress" && (
          <div className="bg-white/10 rounded-2xl p-4 flex items-center gap-3">
            <Clock className="w-5 h-5 text-emerald-300 flex-shrink-0" />
            <p className="text-sm font-bold text-white">Tu grupo ya está en curso.</p>
          </div>
        )}

        {canMigrate && (status === "filling" || status === "confirmed") && (
          <div className="pt-1 border-t border-white/10">
            <p className="text-xs text-slate-300 pt-3 pb-1">
              ¿Prefieres avanzar a tu propio ritmo?
            </p>
            <button
              onClick={() => setShowMigration(true)}
              className="w-full py-2.5 text-xs font-bold text-purple-200 hover:text-white border border-purple-400/30 hover:border-purple-400/60 rounded-xl transition-all flex items-center justify-center gap-2"
            >
              <ArrowRightLeft className="w-3.5 h-3.5" /> Cambiar a clases individuales
            </button>
          </div>
        )}

        {enrollment.payment_status !== "paid" && (
          <p className="text-xs font-bold text-amber-300 pt-1">
            Tu profesor(a) confirmará tu pago en breve para activar tu cupo.
          </p>
        )}
      </div>

      {showMigration && (
        <ChangePackageModal
          enrollment={enrollment}
          teacherUsername={enrollment.teacher_username}
          onClose={() => setShowMigration(false)}
          onDone={() => { setShowMigration(false); onChanged(); }}
        />
      )}
    </div>
  );
}
