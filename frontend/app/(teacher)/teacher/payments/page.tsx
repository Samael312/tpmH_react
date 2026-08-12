"use client";
import { useState, useEffect, useCallback } from "react";
import { Check, X, Clock, Package as PackageIcon, Loader2 } from "lucide-react";
import api from "@/lib/api";
import ChipiWidget from "@/components/chipi/ChipiWidget";

const TYPE_BADGE: Record<string, { label: (p: any) => string; cls: string }> = {
  single_class:       { label: () => "Clase única", cls: "bg-blue-100 text-blue-700" },
  package:            { label: p => p.installment_total ? `Cuota ${p.installment_index}/${p.installment_total}` : "Paquete", cls: "bg-pink-100 text-pink-700" },
  renewal:            { label: p => p.installment_total ? `Renovación (Cuota ${p.installment_index}/${p.installment_total})` : "Renovación", cls: "bg-emerald-100 text-emerald-700" },
  package_renewal:    { label: p => p.installment_total ? `Renovación (Cuota ${p.installment_index}/${p.installment_total})` : "Renovación", cls: "bg-emerald-100 text-emerald-700" },
  package_change:     { label: p => p.installment_total ? `Cambio (Cuota ${p.installment_index}/${p.installment_total})` : "Cambio de Paquete", cls: "bg-amber-100 text-amber-700" },
  installment:        { label: p => `Cuota ${p.installment_index || 1}/${p.installment_total || 1}`, cls: "bg-indigo-100 text-indigo-700" },
  unlimited_recharge: { label: p => `Recarga ${p.installment_index ? `${p.installment_index} clases` : "Ilimitada"}`, cls: "bg-purple-100 text-purple-700" },
};

export default function TeacherPaymentsPage() {
  const [payments, setPayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [meetLink, setMeetLink] = useState("");
  const [active, setActive] = useState<number | null>(null);
  const [processing, setProcessing] = useState<number | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/payments/pending-review");
      setPayments(res.data);
    } catch {} finally { setLoading(false); }
  }, []);
  useEffect(() => { fetchAll(); }, [fetchAll]);

  const approve = async (p: any) => {
    setProcessing(p.payment_id);
    try {
      await api.patch(`/payments/${p.payment_id}/validate`, {
        action: "approve",
        ...(p.payment_type === "single_class" ? { meet_link: meetLink } : {}),
      });
      setMeetLink(""); setActive(null);
      fetchAll();
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
      fetchAll();
    } catch (e: any) {
      alert(e.response?.data?.detail || "Error rechazando");
    } finally { setProcessing(null); }
  };

  return (
    <div className="space-y-8 max-w-4xl mx-auto pb-12">
      <div>
        <h1 className="text-3xl font-black text-slate-800 tracking-tight">Pagos por confirmar</h1>
        <p className="text-slate-500 mt-1">Cuotas de paquetes, recargas y clases sueltas de tus estudiantes</p>
      </div>

      {loading ? (
        <div className="space-y-3">{[1,2].map(i => <div key={i} className="h-24 bg-slate-50 rounded-2xl animate-pulse" />)}</div>
      ) : payments.length === 0 ? (
        <div className="bg-white border-2 border-dashed border-slate-200 rounded-3xl py-16 text-center">
          <p className="text-slate-500 font-bold">✅ Todo al día. Sin pagos pendientes.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {payments.map(p => {
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
                {p.payment_expires_at && (
                  <p className="text-xs text-amber-600 font-bold flex items-center gap-1 mb-3">
                    <Clock className="w-3.5 h-3.5" /> Expira: {new Date(p.payment_expires_at).toLocaleString("es")}
                  </p>
                )}

                {active === p.payment_id && p.payment_type === "single_class" ? (
                  <div className="flex gap-2">
                    <input value={meetLink} onChange={e => setMeetLink(e.target.value)}
                      placeholder="Link de Google Meet" className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm" />
                    <button onClick={() => approve(p)} disabled={!meetLink || processing === p.payment_id}
                      className="px-4 bg-emerald-500 text-white rounded-xl text-sm font-bold disabled:opacity-50">
                      {processing === p.payment_id ? <Loader2 className="w-4 h-4 animate-spin" /> : "Confirmar"}
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <button
                      onClick={() => p.payment_type === "single_class" ? setActive(p.payment_id) : approve(p)}
                      disabled={processing === p.payment_id}
                      className="flex items-center gap-1.5 px-4 py-2 bg-emerald-500 text-white text-xs font-bold rounded-xl disabled:opacity-50">
                      {processing === p.payment_id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Confirmar pago
                    </button>
                    <button onClick={() => reject(p)} disabled={processing === p.payment_id}
                      className="flex items-center gap-1.5 px-4 py-2 bg-rose-50 text-rose-600 text-xs font-bold rounded-xl">
                      <X className="w-3.5 h-3.5" /> Rechazar
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <ChipiWidget screenName="teacher_payments" />
    </div>
  );
}