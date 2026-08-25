"use client";
import { useState } from "react";
import { Check, X, Clock, Package as PackageIcon, Loader2, AlertTriangle, RefreshCw } from "lucide-react";
import api from "@/lib/api";
import ChipiWidget from "@/components/chipi/ChipiWidget";
import { useAuthStore } from "@/store/authStore";
import { useTeacherPendingPayments, useTeacherPaymentsHistory } from "@/hooks/useTeacherData";
import Skeleton from "@/components/ui/Skeleton";
import RefreshButton from "@/components/ui/RefreshButton";
import DesktopOnly from "@/components/ui/DesktopOnly";
import { usePageTopBar } from "@/lib/mobileTopBar";

const TYPE_BADGE: Record<string, { label: (p: any) => string; cls: string }> = {
  package:            { label: p => p.installment_total ? `Cuota ${p.installment_index}/${p.installment_total}` : "Paquete", cls: "bg-pink-100 text-pink-700" },
  renewal:            { label: p => p.installment_total ? `Renovación (Cuota ${p.installment_index}/${p.installment_total})` : "Renovación", cls: "bg-emerald-100 text-emerald-700" },
  package_renewal:    { label: p => p.installment_total ? `Renovación (Cuota ${p.installment_index}/${p.installment_total})` : "Renovación", cls: "bg-emerald-100 text-emerald-700" },
  package_change:     { label: p => p.installment_total ? `Cambio (Cuota ${p.installment_index}/${p.installment_total})` : "Cambio de Paquete", cls: "bg-amber-100 text-amber-700" },
  installment:        { label: p => `Cuota ${p.installment_index || 1}/${p.installment_total || 1}`, cls: "bg-indigo-100 text-indigo-700" },
  unlimited_recharge: { label: p => `Recarga ${p.installment_index ? `${p.installment_index} clases` : "Ilimitada"}`, cls: "bg-purple-100 text-purple-700" },
};

export default function TeacherPaymentsPage() {
  const role = useAuthStore(s => s.user?.role);
  const canManagePayments = role === "teacher_admin" || role === "superadmin";

  const [tab, setTab] = useState<'pending' | 'history'>('pending');
  const isPendingTab = tab === 'pending';

  const {
    payments,
    loading: pendingLoading,
    isFetching: pendingFetching,
    isError: pendingError,
    refetch: refetchPending,
  } = useTeacherPendingPayments(isPendingTab);

  const {
    history,
    loading: historyLoading,
    isFetching: historyFetching,
    isError: historyError,
    refetch: refetchHistory,
  } = useTeacherPaymentsHistory(!isPendingTab);

  const [processing, setProcessing] = useState<number | null>(null);

  // Datos/estado de la tab activa
  const list = isPendingTab ? payments : history;
  const loading = isPendingTab ? pendingLoading : historyLoading;
  const isFetching = isPendingTab ? pendingFetching : historyFetching;
  const isError = isPendingTab ? pendingError : historyError;
  const refetchActive = isPendingTab ? refetchPending : refetchHistory;

  usePageTopBar({
    title: "Pagos",
    onRefresh: refetchActive,
    isFetching,
  });

  // BUG-04/12 fix: se eliminó "single_class" — ya no hace falta pedir el
  // link de Meet al aprobar (se genera solo vía Google Calendar al reservar).
  const approve = async (p: any) => {
    setProcessing(p.payment_id);
    try {
      await api.patch(`/payments/${p.payment_id}/validate`, {
        action: "approve",
      });
      refetchPending();
    } catch (e: any) {
      alert(e.response?.data?.detail || "Error aprobando");
    } finally { setProcessing(null); }
  };

  const reject = async (p: any) => {
    const reason = prompt("Motivo del rechazo:");
    if (!reason) return;
    setProcessing(p.payment_id);
    try {
      await api.patch(`/payments/${p.payment_id}/validate`, { action: "reject", rejection_reason: reason });
      refetchPending();
    } catch (e: any) {
      alert(e.response?.data?.detail || "Error rechazando");
    } finally { setProcessing(null); }
  };

  return (
    <>
    <div className="space-y-8 max-w-4xl mx-auto pb-12">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-slate-800 tracking-tight">Pagos</h1>
          <p className="text-slate-500 mt-1">Gestión de cuotas, recargas y validaciones</p>
        </div>
        <DesktopOnly>
          <RefreshButton onRefresh={refetchActive} isFetching={isFetching} />
        </DesktopOnly>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 bg-slate-100 p-1 rounded-2xl w-fit">
        {(['pending', 'history'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-6 py-2 rounded-xl text-sm font-bold transition-all ${
              tab === t ? 'bg-white shadow-sm text-pink-600' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {t === 'pending' ? 'Pendientes' : 'Historial'}
          </button>
        ))}
      </div>

      {isError ? (
        <div className="bg-white border border-rose-100 rounded-3xl py-16 text-center flex flex-col items-center gap-4">
          <div className="w-14 h-14 bg-rose-100 rounded-full flex items-center justify-center">
            <AlertTriangle className="w-7 h-7 text-rose-500" />
          </div>
          <div>
            <p className="text-slate-800 font-black">
              No se pudo cargar {isPendingTab ? "los pagos pendientes" : "el historial"}
            </p>
            <p className="text-sm text-slate-500 mt-1">Revisa tu conexión e inténtalo de nuevo.</p>
          </div>
          <button
            onClick={() => refetchActive()}
            className="flex items-center gap-2 px-5 py-2.5 bg-pink-500 hover:bg-pink-600 text-white text-sm font-bold rounded-xl shadow-sm transition-colors"
          >
            <RefreshCw className="w-4 h-4" /> Reintentar
          </button>
        </div>
      ) : loading ? (
        <div className="space-y-3">
          {[1, 2].map(i => <Skeleton key={i} className="h-24 w-full rounded-2xl" />)}
        </div>
      ) : list.length === 0 ? (
        <div className="bg-white border-2 border-dashed border-slate-200 rounded-3xl py-16 text-center">
          <p className="text-slate-500 font-bold">
            {isPendingTab ? '✅ Todo al día. Sin pagos pendientes.' : 'No hay historial disponible.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {list.map(p => {
            const badge = TYPE_BADGE[p.payment_type] || {
              label: () => p.payment_type || "Pago",
              cls: "bg-slate-100 text-slate-700"
            };

            const packageName = p.requested_package_name || p.package_name;

            return (
              <div key={p.payment_id} className="bg-white border border-slate-100 rounded-2xl shadow-sm p-5">
                <div className="flex items-center gap-3 flex-wrap mb-2">
                  <span className={`text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full ${badge.cls}`}>
                    {badge.label(p)}
                  </span>
                  <span className="text-sm font-bold text-slate-800">{p.student_name}</span>
                  <span className="text-xs text-slate-400">@{p.student_username}</span>
                  <span className="ml-auto text-pink-600 font-black bg-pink-50 px-3 py-1 rounded-full text-sm">
                    ${p.amount.toFixed(2)}
                  </span>
                </div>
                {packageName && <p className="text-xs text-slate-500 mb-1">Paquete: {packageName}</p>}
                {p.transaction_reference && <p className="text-xs text-slate-400 font-mono mb-2">Ref: {p.transaction_reference}</p>}

                {isPendingTab && p.payment_expires_at && (
                  <p className="text-xs text-amber-600 font-bold flex items-center gap-1 mb-3">
                    <Clock className="w-3.5 h-3.5" /> Expira: {new Date(p.payment_expires_at).toLocaleString("es")}
                  </p>
                )}

                {isPendingTab ? (
                  !canManagePayments ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-500 bg-slate-100 px-3 py-2 rounded-xl">
                        En espera de confirmación por el staff
                      </span>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <button
                        onClick={() => approve(p)}
                        disabled={processing === p.payment_id}
                        className="flex items-center gap-1.5 px-4 py-2 bg-emerald-500 text-white text-xs font-bold rounded-xl disabled:opacity-50">
                        {processing === p.payment_id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Confirmar pago
                      </button>
                      <button onClick={() => reject(p)} disabled={processing === p.payment_id}
                        className="flex items-center gap-1.5 px-4 py-2 bg-rose-50 text-rose-600 text-xs font-bold rounded-xl">
                        <X className="w-3.5 h-3.5" /> Rechazar
                      </button>
                    </div>
                  )
                ) : (
                  <div className="mt-2">
                    {p.status === 'approved' ? (
                      <div className="flex items-center gap-2 text-xs font-bold text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-lg w-fit">
                        <Check className="w-3.5 h-3.5" /> Aprobado: {p.validated_at ? new Date(p.validated_at).toLocaleDateString() : ''}
                      </div>
                    ) : (
                      <div className="text-rose-600 text-xs font-bold">
                        <div className="bg-rose-50 px-3 py-1.5 rounded-lg w-fit mb-1 flex items-center gap-1">
                          <X className="w-3.5 h-3.5" /> Rechazado
                        </div>
                        {p.rejection_reason && <p className="italic px-1">"{p.rejection_reason}"</p>}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <ChipiWidget screenName="teacher_payments" />
    </div>
    </>
  );
}