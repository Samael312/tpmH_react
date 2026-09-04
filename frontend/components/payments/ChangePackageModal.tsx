// frontend/components/payments/ChangePackageModal.tsx
//
// Extraído de app/(student)/dashboard/page.tsx para poder reutilizarlo
// también en la migración grupal -> individual (ver GroupWaitingPanel):
// el cálculo Caso A/B de PackageCheckout ya es genérico por valor, así
// que sirve igual para un enrollment individual que para uno grupal —
// solo hay que asegurarse de no ofrecer paquetes grupales como destino.

"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { useTeacherPackagesFor, type StudentEnrollment, type PackageInfo } from "@/hooks/useStudentData";
import PackageCheckout from "./PackageCheckout";

function ChangePackageModal({ enrollment, teacherUsername, onClose, onDone }: {
  enrollment: StudentEnrollment;
  teacherUsername: string | null | undefined;
  onClose: () => void;
  onDone: () => void;
}) {
  const { packages: rawPackages, loading, isError } = useTeacherPackagesFor(teacherUsername ?? undefined, true);
  // Nunca se ofrece un paquete grupal como destino de un cambio/migración
  // por esta vía — unirse a un grupo requiere elegir una cohorte
  // específica (ver /teacher/[username], sección de clases grupales).
  const packages = rawPackages.filter((p) => p.id !== enrollment.package?.id && !p.is_group);

  const [checkoutTarget, setCheckoutTarget] = useState<PackageInfo | null>(null);
  const [changeOption, setChangeOption] = useState<"full_refund" | "adjust_difference" | null>(null);
  const [optionTarget, setOptionTarget] = useState<PackageInfo | null>(null); // paquete en espera de que elijan Caso A
  const [requesting] = useState<number | null>(null);
  const [error, setError] = useState("");

  // Créditos ya usados/agendados del paquete actual (fuente de verdad: el
  // backend recalcula esto igual al momento de procesar la solicitud).
  const classesTotal = enrollment.classes_total ?? enrollment.package?.classes_count ?? 0;
  const hasUsedCredits = (classesTotal - (enrollment.available_credits ?? classesTotal)) > 0;

  const request = (pkg: PackageInfo) => {
    setError("");
    const isDowngrade =
      pkg.classes_count != null &&
      enrollment.package?.classes_count != null &&
      pkg.classes_count < classesTotal;

    // Regla de negocio 3.1, Caso A: downgrade sin créditos usados — el
    // estudiante elige entre reembolso completo o ajuste por diferencia
    // antes de pasar a confirmar el pago/reembolso.
    if (isDowngrade && !hasUsedCredits) {
      setOptionTarget(pkg);
      return;
    }
    setChangeOption(null);
    setCheckoutTarget(pkg);
  };

  const confirmOption = (option: "full_refund" | "adjust_difference") => {
    setChangeOption(option);
    setCheckoutTarget(optionTarget);
    setOptionTarget(null);
  };

  if (optionTarget) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
        <div className="relative w-full max-w-lg bg-white rounded-[2rem] shadow-2xl p-6 sm:p-8 space-y-4">
          <h2 className="text-lg font-black text-slate-800">Todavía no usaste créditos de tu paquete actual</h2>
          <p className="text-sm text-slate-500">
            Como no agendaste ni completaste ninguna clase con tu paquete actual, puedes elegir:
          </p>
          <div className="space-y-3">
            <button
              onClick={() => confirmOption("full_refund")}
              className="w-full text-left px-4 py-3 rounded-xl border-2 border-slate-200 hover:border-pink-400 transition-colors"
            >
              <p className="text-sm font-bold text-slate-800">Reembolso completo</p>
              <p className="text-xs text-slate-500">
                Te devolvemos el 100% de lo que pagaste por tu paquete actual (${enrollment.package?.price}).
                Tu paquete queda cancelado y podrás comprar el paquete nuevo por separado cuando quieras.
              </p>
            </button>
            <button
              onClick={() => confirmOption("adjust_difference")}
              className="w-full text-left px-4 py-3 rounded-xl border-2 border-slate-200 hover:border-pink-400 transition-colors"
            >
              <p className="text-sm font-bold text-slate-800">Ajustar por diferencia</p>
              <p className="text-xs text-slate-500">
                Pasas directo al paquete nuevo. Si es más caro, pagas la diferencia; si es más barato,
                te devolvemos la diferencia a favor.
              </p>
            </button>
          </div>
          <button onClick={() => setOptionTarget(null)} className="text-xs font-bold text-slate-400 hover:text-slate-600">
            Volver
          </button>
        </div>
      </div>
    );
  }

  if (checkoutTarget) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
        <div className="relative w-full max-w-3xl bg-white rounded-[2rem] shadow-2xl max-h-[85vh] flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-6 sm:px-8 py-5 border-b border-slate-100 flex-shrink-0">
            <h2 className="text-lg font-black text-slate-800">
              {changeOption === "full_refund" ? "Confirmar reembolso" : "Completar pago"}
            </h2>
            <button onClick={onClose} className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center">
              <X className="w-4 h-4 text-slate-500" />
            </button>
          </div>
          <div className="p-6 sm:p-8 overflow-y-auto">
            <PackageCheckout
              pkg={checkoutTarget}
              mode="change"
              enrollmentId={enrollment.id}
              installmentsPaid={0}
              currentCredits={enrollment.available_credits ?? enrollment.prepaid_unlimited_credits ?? 0}
              currentPackagePrice={enrollment.package?.price}
              currentPackageClassesTotal={enrollment.classes_total ?? enrollment.package?.classes_count ?? undefined}
              changeOption={changeOption ?? undefined}
              onClose={onClose}
              onDone={onDone}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-3xl bg-white rounded-[2rem] shadow-2xl max-h-[85vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 sm:px-8 py-5 border-b border-slate-100 flex-shrink-0">
          <h2 className="text-lg font-black text-slate-800">Cambiar de paquete</h2>
          <button onClick={onClose} className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center">
            <X className="w-4 h-4 text-slate-500" />
          </button>
        </div>
        <div className="p-6 sm:p-8 overflow-y-auto space-y-4">
          <p className="text-xs text-slate-500">
            Tu profesor(a) deberá aprobar el cambio. Si eliges un paquete con menos clases que las que ya
            usaste o agendaste, el ajuste (cobro o reembolso de la diferencia) se calcula sobre el valor
            de tu paquete actual, no solo sobre el número de créditos.
          </p>
          {error && <div className="bg-rose-50 text-rose-600 text-xs font-bold px-4 py-3 rounded-xl">{error}</div>}
          
          {isError ? (
            <p className="text-sm text-rose-500 font-bold text-center py-6">
              No se pudieron cargar los paquetes de este profesor.
            </p>
          ) : loading ? (
            <div className="h-24 bg-slate-50 rounded-xl animate-pulse" />
          ) : packages.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-6">No hay otros paquetes disponibles de este profesor</p>
          ) : (
            <div className="space-y-2">
              {packages.map((p) => (
                <div key={p.id} className="flex items-center justify-between bg-slate-50 rounded-xl px-4 py-3">
                  <div>
                    <p className="text-sm font-bold text-slate-800">{p.name}</p>
                    <p className="text-xs text-slate-400">
                      {p.classes_count == null ? "Ilimitadas" : `${p.classes_count} clases`} · ${p.price}
                    </p>
                  </div>
                  <button
                    onClick={() => request(p)}
                    disabled={requesting !== null}
                    className="px-4 py-2 bg-pink-500 text-white text-xs font-bold rounded-xl disabled:opacity-50"
                  >
                    {requesting === p.id ? "..." : "Solicitar"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ChangePackageModal;
