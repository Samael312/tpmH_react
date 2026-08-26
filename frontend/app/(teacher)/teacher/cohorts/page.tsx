"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Users2, Plus, Check, Calendar, Lock, Ban, ChevronRight,
  AlertTriangle, Clock,
} from "lucide-react";
import api from "@/lib/api";
import { Card, Badge, Button, Skeleton, FullScreenModal } from "@/components/ui";

interface Package {
  id: number;
  name: string;
  subject: string;
  price: number;
  classes_count: number | null;
  is_group: boolean;
  min_students: number | null;
  max_students: number | null;
}

interface Cohort {
  id: number;
  package_id: number;
  package_name: string | null;
  teacher_id: number;
  start_date: string | null;
  status: "filling" | "confirmed" | "in_progress" | "completed" | "cancelled";
  min_students: number;
  max_students: number;
  current_students: number;
  created_at: string;
  closed_at: string | null;
}

interface Session {
  id: number;
  cohort_id: number;
  start_time_utc: string;
  end_time_utc: string;
  duration: number;
  status: string;
  participant_count: number;
}

const STATUS_LABEL: Record<Cohort["status"], string> = {
  filling: "Llenándose",
  confirmed: "Confirmada",
  in_progress: "En curso",
  completed: "Completada",
  cancelled: "Cancelada",
};

const STATUS_BADGE: Record<Cohort["status"], "success" | "warning" | "info" | "neutral" | "danger"> = {
  filling: "warning",
  confirmed: "info",
  in_progress: "success",
  completed: "neutral",
  cancelled: "danger",
};

export default function TeacherCohortsPage() {
  const [cohorts, setCohorts] = useState<Cohort[]>([]);
  const [groupPackages, setGroupPackages] = useState<Package[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ package_id: "", min_students: "3", max_students: "6" });

  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [sessionsByCohort, setSessionsByCohort] = useState<Record<number, Session[]>>({});

  const [closingCohort, setClosingCohort] = useState<Cohort | null>(null);
  const [closeDate, setCloseDate] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  const [schedulingCohort, setSchedulingCohort] = useState<Cohort | null>(null);
  const [sessionForm, setSessionForm] = useState({ date: "", time: "", duration: "60" });

  const loadData = useCallback(async () => {
    setError(null);
    try {
      const [cohortsRes, packagesRes] = await Promise.all([
        api.get<Cohort[]>("/cohorts/teacher"),
        api.get<Package[]>("/packages/my-packages"),
      ]);
      setCohorts(cohortsRes.data);
      setGroupPackages(packagesRes.data.filter((p) => p.is_group));
    } catch {
      setError("No pudimos cargar tus cohortes. Intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const toggleExpand = async (cohort: Cohort) => {
    if (expandedId === cohort.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(cohort.id);
    if (!sessionsByCohort[cohort.id]) {
      try {
        const res = await api.get<Session[]>(`/cohorts/${cohort.id}/sessions`);
        setSessionsByCohort((prev) => ({ ...prev, [cohort.id]: res.data }));
      } catch {
        // silencioso: la sección simplemente queda vacía
      }
    }
  };

  const handleCreate = async () => {
    if (!form.package_id) return;
    setCreating(true);
    try {
      await api.post("/cohorts/", {
        package_id: Number(form.package_id),
        min_students: Number(form.min_students),
        max_students: Number(form.max_students),
      });
      setShowCreate(false);
      setForm({ package_id: "", min_students: "3", max_students: "6" });
      await loadData();
    } catch (err: any) {
      alert(err?.response?.data?.detail || "No se pudo crear la cohorte");
    } finally {
      setCreating(false);
    }
  };

  const handleClose = async () => {
    if (!closingCohort || !closeDate) return;
    setActionLoading(true);
    try {
      await api.post(`/cohorts/${closingCohort.id}/close`, {
        start_date: new Date(closeDate).toISOString(),
      });
      setClosingCohort(null);
      setCloseDate("");
      await loadData();
    } catch (err: any) {
      alert(err?.response?.data?.detail || "No se pudo cerrar la cohorte");
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancel = async (cohort: Cohort) => {
    if (!confirm(`¿Cancelar la cohorte de "${cohort.package_name}"? Se liberará el cupo de los ${cohort.current_students} alumno(s) inscrito(s), quienes podrán migrar a clases individuales.`)) {
      return;
    }
    try {
      await api.post(`/cohorts/${cohort.id}/cancel`);
      await loadData();
    } catch (err: any) {
      alert(err?.response?.data?.detail || "No se pudo cancelar la cohorte");
    }
  };

  const handleScheduleSession = async () => {
    if (!schedulingCohort || !sessionForm.date || !sessionForm.time) return;
    setActionLoading(true);
    try {
      const startTimeUtc = new Date(`${sessionForm.date}T${sessionForm.time}:00`).toISOString();
      await api.post(`/cohorts/${schedulingCohort.id}/sessions`, {
        start_time_utc: startTimeUtc,
        duration_minutes: Number(sessionForm.duration),
      });
      const res = await api.get<Session[]>(`/cohorts/${schedulingCohort.id}/sessions`);
      setSessionsByCohort((prev) => ({ ...prev, [schedulingCohort.id]: res.data }));
      setSchedulingCohort(null);
      setSessionForm({ date: "", time: "", duration: "60" });
    } catch (err: any) {
      alert(err?.response?.data?.detail || "No se pudo agendar la sesión");
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 pb-24 sm:pb-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-black text-slate-800 flex items-center gap-2">
            <Users2 className="w-5 h-5 text-pink-500" /> Clases grupales
          </h1>
          <p className="text-sm text-slate-500 mt-1">Gestiona tus cohortes: cupos, fecha de inicio y sesiones.</p>
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="w-4 h-4" /> Nueva cohorte
        </Button>
      </div>

      {loading && (
        <div className="space-y-3">
          {[1, 2].map((i) => <Skeleton key={i} className="h-28 rounded-[2rem]" />)}
        </div>
      )}

      {error && (
        <Card className="p-6 text-center text-sm text-rose-500">{error}</Card>
      )}

      {!loading && !error && cohorts.length === 0 && (
        <Card className="p-10 text-center">
          <Users2 className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-sm font-semibold text-slate-600">Aún no tienes cohortes grupales</p>
          <p className="text-xs text-slate-400 mt-1">
            Necesitas al menos un paquete marcado como grupal para poder abrir una cohorte.
          </p>
        </Card>
      )}

      <div className="space-y-4">
        {cohorts.map((cohort) => (
          <Card key={cohort.id} className="p-5" hover>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-bold text-slate-800 truncate">{cohort.package_name}</h3>
                  <Badge variant={STATUS_BADGE[cohort.status]}>{STATUS_LABEL[cohort.status]}</Badge>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  {cohort.current_students}/{cohort.max_students} inscritos
                  {cohort.current_students < cohort.min_students && cohort.status === "filling" && (
                    <span className="text-amber-600"> · debajo del mínimo sugerido ({cohort.min_students})</span>
                  )}
                </p>
                {cohort.start_date && (
                  <p className="text-xs text-slate-500 mt-1 flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5" />
                    Inicia el {new Date(cohort.start_date).toLocaleString("es", { dateStyle: "medium", timeStyle: "short" })}
                  </p>
                )}
              </div>

              <button
                onClick={() => toggleExpand(cohort)}
                className="w-8 h-8 rounded-xl bg-slate-50 hover:bg-slate-100 flex items-center justify-center flex-shrink-0"
              >
                <ChevronRight className={`w-4 h-4 text-slate-500 transition-transform ${expandedId === cohort.id ? "rotate-90" : ""}`} />
              </button>
            </div>

            {/* Barra de progreso de cupo */}
            <div className="mt-3 h-2 rounded-full bg-slate-100 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-pink-400 to-rose-400 transition-all"
                style={{ width: `${Math.min((cohort.current_students / cohort.max_students) * 100, 100)}%` }}
              />
            </div>

            {/* Acciones */}
            {cohort.status === "filling" && (
              <div className="flex flex-wrap gap-2 mt-4">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => { setClosingCohort(cohort); setCloseDate(""); }}
                  disabled={cohort.current_students === 0}
                >
                  <Lock className="w-3.5 h-3.5" /> Cerrar con integrantes actuales
                </Button>
                <Button size="sm" variant="danger" onClick={() => handleCancel(cohort)}>
                  <Ban className="w-3.5 h-3.5" /> Cancelar cohorte
                </Button>
              </div>
            )}
            {cohort.status === "confirmed" && (
              <div className="flex flex-wrap gap-2 mt-4">
                <Button size="sm" onClick={() => setSchedulingCohort(cohort)}>
                  <Plus className="w-3.5 h-3.5" /> Agendar sesión
                </Button>
              </div>
            )}

            {/* Sesiones (expandible) */}
            {expandedId === cohort.id && (
              <div className="mt-4 pt-4 border-t border-slate-100">
                {!sessionsByCohort[cohort.id] ? (
                  <p className="text-xs text-slate-400">Cargando sesiones…</p>
                ) : sessionsByCohort[cohort.id].length === 0 ? (
                  <p className="text-xs text-slate-400">
                    {cohort.status === "filling"
                      ? "Cierra la cohorte para poder agendar sesiones."
                      : "Todavía no hay sesiones agendadas."}
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {sessionsByCohort[cohort.id].map((s) => (
                      <li key={s.id} className="flex items-center justify-between text-xs bg-slate-50 rounded-xl px-3 py-2">
                        <span className="flex items-center gap-1.5 text-slate-600">
                          <Clock className="w-3.5 h-3.5" />
                          {new Date(s.start_time_utc).toLocaleString("es", { dateStyle: "medium", timeStyle: "short" })}
                          {" · "}{s.duration} min
                        </span>
                        <span className="text-slate-400">{s.participant_count} alumno(s)</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </Card>
        ))}
      </div>

      {/* ── Modal: crear cohorte ── */}
      <FullScreenModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title="Nueva cohorte grupal"
        footer={
          <Button className="w-full" onClick={handleCreate} loading={creating} disabled={!form.package_id}>
            <Check className="w-4 h-4" /> Crear cohorte
          </Button>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wide">Paquete grupal</label>
            {groupPackages.length === 0 ? (
              <p className="text-sm text-amber-600 mt-2">
                No tienes ningún paquete marcado como grupal todavía. Créalo primero desde &quot;Paquetes&quot;.
              </p>
            ) : (
              <select
                className="w-full mt-2 border border-slate-200 rounded-xl px-3 py-2.5 text-sm"
                value={form.package_id}
                onChange={(e) => setForm({ ...form, package_id: e.target.value })}
              >
                <option value="">Selecciona un paquete…</option>
                {groupPackages.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} — ${p.price} ({p.classes_count} clases)</option>
                ))}
              </select>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wide">Mínimo de alumnos</label>
              <input
                type="number"
                min={1}
                className="w-full mt-2 border border-slate-200 rounded-xl px-3 py-2.5 text-sm"
                value={form.min_students}
                onChange={(e) => setForm({ ...form, min_students: e.target.value })}
              />
              <p className="text-[11px] text-slate-400 mt-1">Solo de referencia — igual puedes cerrar con menos.</p>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wide">Máximo de alumnos</label>
              <input
                type="number"
                min={1}
                className="w-full mt-2 border border-slate-200 rounded-xl px-3 py-2.5 text-sm"
                value={form.max_students}
                onChange={(e) => setForm({ ...form, max_students: e.target.value })}
              />
            </div>
          </div>
        </div>
      </FullScreenModal>

      {/* ── Modal: cerrar cohorte ── */}
      <FullScreenModal
        open={!!closingCohort}
        onClose={() => setClosingCohort(null)}
        title="Cerrar cohorte"
        footer={
          <Button className="w-full" onClick={handleClose} loading={actionLoading} disabled={!closeDate}>
            <Lock className="w-4 h-4" /> Confirmar cierre
          </Button>
        }
      >
        {closingCohort && (
          <div className="space-y-4">
            {closingCohort.current_students < closingCohort.min_students && (
              <div className="flex gap-2 bg-amber-50 border border-amber-100 rounded-xl p-3 text-xs text-amber-700">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                <span>
                  Tienes {closingCohort.current_students} de los {closingCohort.min_students} alumnos
                  que definiste como mínimo. Puedes cerrar igual con el grupo actual.
                </span>
              </div>
            )}
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wide">Fecha y hora de inicio</label>
              <input
                type="datetime-local"
                className="w-full mt-2 border border-slate-200 rounded-xl px-3 py-2.5 text-sm"
                value={closeDate}
                onChange={(e) => setCloseDate(e.target.value)}
              />
            </div>
          </div>
        )}
      </FullScreenModal>

      {/* ── Modal: agendar sesión ── */}
      <FullScreenModal
        open={!!schedulingCohort}
        onClose={() => setSchedulingCohort(null)}
        title="Agendar sesión grupal"
        footer={
          <Button
            className="w-full"
            onClick={handleScheduleSession}
            loading={actionLoading}
            disabled={!sessionForm.date || !sessionForm.time}
          >
            <Calendar className="w-4 h-4" /> Agendar
          </Button>
        }
      >
        <div className="space-y-4">
          <p className="text-xs text-slate-500">
            Se creará una sesión compartida e inscribirá automáticamente a todos los alumnos con pago confirmado de esta cohorte.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wide">Fecha</label>
              <input
                type="date"
                className="w-full mt-2 border border-slate-200 rounded-xl px-3 py-2.5 text-sm"
                value={sessionForm.date}
                onChange={(e) => setSessionForm({ ...sessionForm, date: e.target.value })}
              />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wide">Hora</label>
              <input
                type="time"
                className="w-full mt-2 border border-slate-200 rounded-xl px-3 py-2.5 text-sm"
                value={sessionForm.time}
                onChange={(e) => setSessionForm({ ...sessionForm, time: e.target.value })}
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wide">Duración (minutos)</label>
            <input
              type="number"
              min={15}
              step={15}
              className="w-full mt-2 border border-slate-200 rounded-xl px-3 py-2.5 text-sm"
              value={sessionForm.duration}
              onChange={(e) => setSessionForm({ ...sessionForm, duration: e.target.value })}
            />
          </div>
        </div>
      </FullScreenModal>
    </div>
  );
}
