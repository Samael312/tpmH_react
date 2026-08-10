"use client";

import { useState, useEffect, useCallback } from "react";
import { Package as PackageIcon, RefreshCw, Check, User, GraduationCap } from "lucide-react";
import api from "@/lib/api";
import ChipiWidget from "@/components/chipi/ChipiWidget";

interface PendingRequest {
  id: number;
  student_id: number;
  student_username: string;
  student_name: string;
  package_id: number;
  package_name: string;
  classes_used: number;
  classes_total: number | null;
  status: string;
  renewal_requested_package_name: string | null;
  change_requested_package_name: string | null;
  created_at: string;
  teacher_username: string;
  teacher_name: string;
}

const STATUS_LABEL: Record<string, string> = {
  pending_renewal: "Renovación",
  pending_package_change: "Cambio de paquete",
};

const STATUS_BADGE: Record<string, string> = {
  pending_renewal: "bg-amber-100 text-amber-700",
  pending_package_change: "bg-blue-100 text-blue-700",
};

export default function PackageRequestsPage() {
  const [requests, setRequests] = useState<PendingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [approvingId, setApprovingId] = useState<number | null>(null);
  const [error, setError] = useState("");

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/packages/admin/pending-requests");
      setRequests(res.data);
    } catch {
      setError("Error cargando las solicitudes");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const approve = async (req: PendingRequest) => {
    setApprovingId(req.id);
    setError("");
    try {
      if (req.status === "pending_renewal") {
        await api.post(`/packages/${req.id}/activate-renewal`);
      } else {
        await api.post(`/packages/${req.id}/approve-package-change`);
      }
      fetchAll();
    } catch (e: any) {
      setError(e.response?.data?.detail || "Error aprobando la solicitud");
    } finally {
      setApprovingId(null);
    }
  };

  const renewals = requests.filter(r => r.status === "pending_renewal");
  const changes = requests.filter(r => r.status === "pending_package_change");

  return (
    <div className="space-y-8 animate-fade-up bg-white min-h-screen p-6 md:p-8 rounded-[2.5rem] shadow-sm border border-slate-100">

      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h1 className="font-display text-4xl font-bold text-slate-800 mb-2 tracking-tight">
            Solicitudes de Paquetes
          </h1>
          <p className="text-sm text-slate-500 font-medium">
            Renovaciones y cambios de paquete pendientes de toda la plataforma
          </p>
        </div>
        <button
          onClick={fetchAll}
          disabled={loading}
          className="w-9 h-9 rounded-xl bg-white border border-slate-200 flex items-center
                     justify-center shadow-sm hover:bg-slate-50 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 text-slate-600 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-100 text-rose-600 px-4 py-3 rounded-xl text-sm font-bold">
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map(i => <div key={i} className="bg-slate-50 border border-slate-100 rounded-2xl h-28 animate-pulse" />)}
        </div>
      ) : requests.length === 0 ? (
        <div className="p-16 text-center bg-slate-50/50 border-2 border-dashed border-slate-200 rounded-3xl">
          <PackageIcon className="w-10 h-10 text-slate-200 mx-auto mb-3" />
          <p className="text-slate-500 font-bold text-lg">No hay solicitudes pendientes</p>
        </div>
      ) : (
        <div className="space-y-8">
          {[
            { list: renewals, title: "Renovaciones", icon: <PackageIcon className="w-4 h-4" /> },
            { list: changes, title: "Cambios de paquete", icon: <RefreshCw className="w-4 h-4" /> },
          ].map(section => section.list.length > 0 && (
            <div key={section.title} className="space-y-3">
              <div className="flex items-center gap-2">
                {section.icon}
                <h2 className="text-sm font-black text-slate-500 uppercase tracking-widest">
                  {section.title} ({section.list.length})
                </h2>
              </div>

              {section.list.map(req => (
                <div key={req.id} className="bg-white border border-slate-100 rounded-3xl shadow-sm p-6
                                              flex flex-col md:flex-row md:items-center gap-4">
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[10px] font-black uppercase tracking-widest px-2.5 py-0.5 rounded-full ${STATUS_BADGE[req.status]}`}>
                        {STATUS_LABEL[req.status]}
                      </span>
                      <span className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                        <User className="w-3.5 h-3.5 text-slate-400" /> {req.student_name}
                      </span>
                      <span className="text-xs text-slate-400">@{req.student_username}</span>
                    </div>
                    <p className="text-xs text-slate-500 flex items-center gap-1.5">
                      <GraduationCap className="w-3.5 h-3.5 text-slate-400" />
                      Profesor: <span className="font-bold text-slate-700">{req.teacher_name}</span> (@{req.teacher_username})
                    </p>
                    <p className="text-xs text-slate-500">
                      Paquete actual: <span className="font-bold">{req.package_name}</span>
                      {" · "}{req.classes_used}/{req.classes_total ?? "∞"} clases usadas
                    </p>
                    <p className="text-xs font-bold text-emerald-600">
                      Solicita: {req.status === "pending_renewal" ? req.renewal_requested_package_name : req.change_requested_package_name}
                    </p>
                  </div>

                  <button
                    onClick={() => approve(req)}
                    disabled={approvingId === req.id}
                    className="flex items-center justify-center gap-1.5 px-5 py-2.5 bg-gradient-to-r
                               from-pink-500 to-rose-400 text-white text-sm font-bold rounded-xl
                               shadow-md shadow-pink-200 active:scale-[0.98] transition-all disabled:opacity-50 flex-shrink-0"
                  >
                    {approvingId === req.id ? (
                      <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    ) : (
                      <><Check className="w-4 h-4" /> Aprobar</>
                    )}
                  </button>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      <ChipiWidget screenName="admin_package_requests" />
    </div>
  );
}