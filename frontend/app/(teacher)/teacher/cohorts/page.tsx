"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Users2, Plus, Check, Calendar, Lock, Ban, ChevronRight,
  AlertTriangle, Clock, X, UserCheck, UserX, RefreshCw, RotateCcw, Pencil, MessagesSquare,
} from "lucide-react";
import { useRouter } from "next/navigation";
import api from "@/lib/api";
import { Card, Badge, Button, Skeleton, FullScreenModal, ConfirmModal } from "@/components/ui";
import RefreshButton from "@/components/ui/RefreshButton";
import DesktopOnly from "@/components/ui/DesktopOnly";
import ChipiWidget from "@/components/chipi/ChipiWidget";
import { usePageTopBar } from "@/lib/mobileTopBar";
import {
  useTeacherCohorts,
  useTeacherPackages,
  useCohortMembers,
  type TeacherCohortItem as Cohort,
  type TeacherPackage as Package,
} from "@/hooks/useTeacherData";
import { RescheduleCalendar } from "@/components/classes/RescheduleModal";
import { useAvailableSlots, type AvailableSlot } from "@/hooks/useStudentData";
import { useAuthStore } from "@/store/authStore";
import { getMyDisplayTimezone, formatTimeTz, getDateKeyTz } from "@/lib/tzFormat";
import { useBusinessRules } from "@/hooks/useBusinessRules";
import { getErrorMessage } from "@/lib/errorMessage";
import { useToast } from "@/hooks/useToast";
import { usePlatformConfig } from "@/hooks/useStudentData";
import { openGroupConversation } from "@/hooks/useChat";

interface Session {
  id: number;
  cohort_id: number;
  start_time_utc: string;
  end_time_utc: string;
  duration: number;
  status: string;
  participant_count: number;
}

interface SessionParticipant {
  student_id: number;
  student_name: string;
  attendance_status: "confirmed" | "no_show" | "cancelled";
}

const STATUS_LABEL: Record<Cohort["status"], string> = {
  filling: "Llenándose",
  confirmed: "Confirmado",
  in_progress: "En curso",
  completed: "Completado",
  cancelled: "Cancelado",
};

const STATUS_BADGE: Record<Cohort["status"], "success" | "warning" | "info" | "neutral" | "danger"> = {
  filling: "warning",
  confirmed: "info",
  in_progress: "success",
  completed: "neutral",
  cancelled: "danger",
};

export default function TeacherCohortsPage() {
  const router = useRouter();
  const { config: platformConfig } = usePlatformConfig();
  const {
    cohorts,
    loading: loadingCohorts,
    isFetching: fetchingCohorts,
    isError: cohortsError,
    refetch: refetchCohorts,
  } = useTeacherCohorts();
  const {
    packages: allPackages,
    loading: loadingPackages,
    isFetching: fetchingPackages,
    isError: packagesError,
    refetch: refetchPackages,
  } = useTeacherPackages();

  const groupPackages: Package[] = (allPackages ?? []).filter((p) => p.is_group);
  const loading = loadingCohorts || loadingPackages;
  const isFetching = fetchingCohorts || fetchingPackages;
  const error = (cohortsError || packagesError)
    ? "No pudimos cargar tus grupos. Intenta de nuevo."
    : null;

  const loadData = useCallback(async () => {
    await Promise.all([refetchCohorts(), refetchPackages()]);
  }, [refetchCohorts, refetchPackages]);

  usePageTopBar({
    title: "Clases grupales",
    onRefresh: loadData,
    isFetching,
  });

  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ package_id: "", min_students: "3", max_students: "6" });

  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [sessionsByCohort, setSessionsByCohort] = useState<Record<number, Session[]>>({});
  const [attendanceSession, setAttendanceSession] = useState<Session | null>(null);
  const [attendanceSummaryCohort, setAttendanceSummaryCohort] = useState<Cohort | null>(null);
  // Integrantes de la cohorte expandida — se recargan cada vez que se
  // abre una cohorte distinta, así se ve en vivo quién se va uniendo
  // mientras el grupo todavía está "filling".
  const {
    members: expandedMembers,
    loading: loadingMembers,
    refetch: refetchMembers,
  } = useCohortMembers(expandedId);

  const [closingCohort, setClosingCohort] = useState<Cohort | null>(null);
  // Corrección QA: antes esto era un solo <input type="datetime-local">
  // suelto (closeDate), sin validar contra la disponibilidad real del
  // profesor — y la fecha elegida acá nunca generaba una Class de verdad,
  // solo quedaba guardada como metadata en la cohorte. Ahora reutiliza el
  // mismo selector de calendario + horarios reales que "Agendar sesión"
  // (ver GroupSessionSlotPicker más abajo), porque esa fecha/hora también
  // debe crear la primera sesión del grupo.
  const [closeForm, setCloseForm] = useState<{ date: string; selectedSlot: AvailableSlot | null; duration: string }>({ date: "", selectedSlot: null, duration: "50" });
  // D14: cuando el paquete de la cohorte que se está cerrando tiene
  // horario fijo/recurrente, en vez del selector libre de fecha/hora se
  // muestran estas próximas coincidencias con el patrón configurado.
  const [recurringCandidates, setRecurringCandidates] = useState<{ start_time_utc: string; available: boolean; reason: string | null }[]>([]);
  const [loadingRecurringCandidates, setLoadingRecurringCandidates] = useState(false);
  const [selectedRecurringStart, setSelectedRecurringStart] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<Cohort | null>(null);
  const [completeTarget, setCompleteTarget] = useState<Cohort | null>(null);
  const [reopenTarget, setReopenTarget] = useState<Cohort | null>(null);
  // D13: antes las cohortes 'completed'/'cancelled' desaparecían del todo
  // de la lista (solo se ocultaba 'cancelled', y 'completed' quedaba
  // mezclada con las activas sin separación) -- ahora viven en su propio
  // tab "Historial" en vez de perderse.
  const [cohortTab, setCohortTab] = useState<"active" | "history">("active");
  // D12: editar min/max de una cohorte ya creada -- antes esto solo
  // existía vía Modo Dios (staff), el profesor no tenía forma de
  // corregir el cupo que definió al crear la cohorte.
  const [editingCohort, setEditingCohort] = useState<Cohort | null>(null);
  const [editForm, setEditForm] = useState({ min_students: "", max_students: "" });
  const [editing, setEditing] = useState(false);

  const [schedulingCohort, setSchedulingCohort] = useState<Cohort | null>(null);
  const { rules } = useBusinessRules();
  const [sessionForm, setSessionForm] = useState<{ date: string; selectedSlot: AvailableSlot | null; duration: string }>({ date: "", selectedSlot: null, duration: "50" });
  const toast = useToast();
  const teacherUsername = useAuthStore((s) => s.user?.username) ?? null;
  const { slots: sessionSlots, loading: sessionSlotsLoading } = useAvailableSlots(
    sessionForm.date, Number(sessionForm.duration) || 50, teacherUsername, "group"
  );
  const { slots: closeSlots, loading: closeSlotsLoading } = useAvailableSlots(
    closeForm.date, Number(closeForm.duration) || 50, teacherUsername, "group"
  );
  const myTz = getMyDisplayTimezone();

  // D14: si el paquete de la cohorte que se está cerrando tiene horario
  // fijo/recurrente, se cargan las próximas coincidencias con ese patrón
  // en vez de dejar elegir una fecha/hora libre.
  const closingPackage = closingCohort ? allPackages.find(p => p.id === closingCohort.package_id) : null;
  const isFixedSchedule = closingPackage?.group_schedule_mode === "fixed";

  // Corrección QA (UX calendario horario fijo): antes `recurringCandidates`
  // solo se mostraba como una lista plana de botones (máx. 8-20 fechas
  // sueltas), lo que no dejaba ver de un vistazo qué días de la semana
  // coinciden con el patrón. Ahora se deriva un mapa fecha→candidato (clave
  // YYYY-MM-DD en la zona horaria del profesor) para poder resaltar esos
  // días directamente en un calendario mensual real.
  const recurringByDate = new Map<string, { start_time_utc: string; available: boolean; reason: string | null }>();
  for (const c of recurringCandidates) {
    recurringByDate.set(getDateKeyTz(c.start_time_utc, myTz), c);
  }
  const recurringHighlightedDates = new Set(recurringByDate.keys());
  const recurringUnavailableDates = new Set(
    recurringCandidates.filter(c => !c.available).map(c => getDateKeyTz(c.start_time_utc, myTz))
  );
  const selectedRecurringDateKey = closeForm.date || null;

  useEffect(() => {
    if (!closingCohort || !isFixedSchedule) {
      setRecurringCandidates([]);
      setSelectedRecurringStart(null);
      return;
    }
    setLoadingRecurringCandidates(true);
    // count=20 (tope máximo que acepta el backend): así el calendario tiene
    // suficientes ocurrencias resaltadas para cubrir ~2-3 meses hacia
    // adelante según la frecuencia del patrón, sin necesidad de paginar.
    api.get(`/cohorts/${closingCohort.id}/recurring-candidates?count=20`)
      .then(res => setRecurringCandidates(res.data))
      .catch(() => setRecurringCandidates([]))
      .finally(() => setLoadingRecurringCandidates(false));
  }, [closingCohort, isFixedSchedule]);

  // La duración por defecto de ambos forms depende del catálogo configurado
  // por el superadmin, que llega async — se sincroniza cuando esté disponible.
  useEffect(() => {
    if (rules.allowed_class_durations?.length) {
      setSessionForm(f => (
        rules.allowed_class_durations.includes(Number(f.duration))
          ? f
          : { ...f, duration: String(rules.allowed_class_durations[0]) }
      ));
      setCloseForm(f => (
        rules.allowed_class_durations.includes(Number(f.duration))
          ? f
          : { ...f, duration: String(rules.allowed_class_durations[0]) }
      ));
    }
  }, [rules.allowed_class_durations]);

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
      toast.success("Grupo creado correctamente");
    } catch (err) {
      toast.error(getErrorMessage(err, "No se pudo crear el grupo"));
    } finally {
      setCreating(false);
    }
  };

  const handleClose = async () => {
    if (!closingCohort) return;
    if (isFixedSchedule && !selectedRecurringStart) return;
    if (!isFixedSchedule && !closeForm.selectedSlot) return;
    if (closingCohort.current_students < closingCohort.min_students) {
      const ok = window.confirm(
        `Estás cerrando este grupo con ${closingCohort.current_students} de ${closingCohort.min_students} alumnos mínimos sugeridos. ` +
        `¿Confirmas que quieres iniciarla igual con menos integrantes?`
      );
      if (!ok) return;
    }
    setActionLoading(true);
    try {
      // La fecha/hora elegida acá ya no es solo metadata: el backend usa
      // este mismo start_date + duration_minutes para crear de una vez la
      // primera sesión (Class) real del grupo (ver close_cohort_endpoint).
      // D14: si el paquete es de horario fijo, start_date es la ocurrencia
      // elegida del patrón recurrente y el backend genera TODA la serie
      // de sesiones automáticamente (no solo la primera).
      await api.post(`/cohorts/${closingCohort.id}/close`, {
        start_date: isFixedSchedule ? selectedRecurringStart : closeForm.selectedSlot!.start_time_utc,
        duration_minutes: isFixedSchedule ? (closingPackage?.duration_minutes ?? 50) : Number(closeForm.duration),
      });
      setClosingCohort(null);
      setCloseForm({ date: "", selectedSlot: null, duration: String(rules.allowed_class_durations?.[0] ?? 50) });
      setSelectedRecurringStart(null);
      await loadData();
      toast.success(isFixedSchedule ? "Grupo cerrado — se agendaron todas las sesiones automáticamente" : "Grupo cerrado e iniciado correctamente");
    } catch (err) {
      toast.error(getErrorMessage(err, "No se pudo cerrar el grupo"));
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancel = async (cohort: Cohort) => {
    setActionLoading(true);
    try {
      await api.post(`/cohorts/${cohort.id}/cancel`);
      await loadData();
      toast.success("Grupo cancelado correctamente");
    } catch (err) {
      toast.error(getErrorMessage(err, "No se pudo cancelar el grupo"));
    } finally {
      setActionLoading(false);
      setCancelTarget(null);
    }
  };

  const handleComplete = async (cohort: Cohort) => {
    setActionLoading(true);
    try {
      await api.post(`/cohorts/${cohort.id}/complete`);
      await loadData();
      toast.success("Grupo finalizado correctamente");
    } catch (err) {
      toast.error(getErrorMessage(err, "No se pudo finalizar el grupo"));
    } finally {
      setActionLoading(false);
      setCompleteTarget(null);
    }
  };

  // Corrección QA: antes un grupo cerrado por error (o que el profesor
  // quiere reabrir para seguir aceptando inscripciones) se quedaba
  // "confirmed" para siempre, sin forma de volver a "filling".
  const handleReopen = async (cohort: Cohort) => {
    setActionLoading(true);
    try {
      await api.post(`/cohorts/${cohort.id}/reopen`);
      await loadData();
      toast.success("Grupo reabierto — vuelve a aceptar inscripciones");
    } catch (err) {
      toast.error(getErrorMessage(err, "No se pudo reabrir el grupo"));
    } finally {
      setActionLoading(false);
      setReopenTarget(null);
    }
  };

  const handleEditQuota = async () => {
    if (!editingCohort) return;
    setEditing(true);
    try {
      await api.patch(`/cohorts/${editingCohort.id}`, {
        min_students: Number(editForm.min_students),
        max_students: Number(editForm.max_students),
      });
      setEditingCohort(null);
      await loadData();
      toast.success("Cupo del grupo actualizado");
    } catch (err) {
      toast.error(getErrorMessage(err, "No se pudo actualizar el cupo"));
    } finally {
      setEditing(false);
    }
  };

  const handleScheduleSession = async () => {
    if (!schedulingCohort || !sessionForm.date || !sessionForm.selectedSlot) return;
    setActionLoading(true);
    try {
      await api.post(`/cohorts/${schedulingCohort.id}/sessions`, {
        start_time_utc: sessionForm.selectedSlot.start_time_utc,
        duration_minutes: Number(sessionForm.duration),
      });
      const res = await api.get<Session[]>(`/cohorts/${schedulingCohort.id}/sessions`);
      setSessionsByCohort((prev) => ({ ...prev, [schedulingCohort.id]: res.data }));
      setSchedulingCohort(null);
      setSessionForm({ date: "", selectedSlot: null, duration: String(rules.allowed_class_durations?.[0] ?? 50) });
      toast.success("Sesión agendada correctamente");
    } catch (err) {
      toast.error(getErrorMessage(err, "No se pudo agendar la sesión"));
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 relative overflow-hidden">
      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 py-8 pb-24 sm:pb-8 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black text-slate-800 tracking-tight flex items-center gap-2.5">
            <Users2 className="w-7 h-7 text-pink-500" /> Clases grupales
          </h1>
          <p className="text-sm text-slate-500 mt-1">Gestiona tus grupos: cupos, fecha de inicio y sesiones.</p>
        </div>
        <div className="flex items-center gap-2">
          <DesktopOnly>
            <RefreshButton onRefresh={loadData} isFetching={isFetching} />
          </DesktopOnly>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="w-4 h-4" /> Nuevo grupo
          </Button>
        </div>
      </div>

      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-28 rounded-[2rem]" />)}
        </div>
      )}

      {error && !loading && (
        <Card className="p-6 text-center text-sm text-rose-500 flex flex-col items-center gap-3">
          <span>{error}</span>
          <button
            onClick={() => loadData()}
            className="flex items-center gap-2 px-4 py-2 bg-pink-500 hover:bg-pink-600 text-white text-xs font-bold rounded-xl transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Reintentar
          </button>
        </Card>
      )}

      {!loading && !error && cohorts.length === 0 && (
        <Card className="p-10 text-center">
          <Users2 className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-sm font-semibold text-slate-600">Aún no tienes grupos</p>
          <p className="text-xs text-slate-400 mt-1">
            Necesitas al menos un paquete marcado como grupal para poder abrir un grupo.
          </p>
        </Card>
      )}

      {(() => {
        const activeCohorts = cohorts.filter(c => c.status === "filling" || c.status === "confirmed" || c.status === "in_progress");
        const historyCohorts = cohorts.filter(c => c.status === "completed" || c.status === "cancelled");
        const visibleCohorts = cohortTab === "active" ? activeCohorts : historyCohorts;

        return (
          <>
            {!loading && !error && cohorts.length > 0 && (
              <div className="flex items-center gap-1.5 bg-slate-100 rounded-xl p-1 w-fit">
                <button
                  onClick={() => setCohortTab("active")}
                  className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                    cohortTab === "active" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  Activos ({activeCohorts.length})
                </button>
                <button
                  onClick={() => setCohortTab("history")}
                  className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                    cohortTab === "history" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  Historial ({historyCohorts.length})
                </button>
              </div>
            )}

            {!loading && !error && cohorts.length > 0 && visibleCohorts.length === 0 && (
              <Card className="p-8 text-center">
                <p className="text-sm font-semibold text-slate-500">
                  {cohortTab === "active" ? "No tienes grupos activos por ahora." : "Todavía no hay grupos en tu historial."}
                </p>
              </Card>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {visibleCohorts.map((cohort) => (
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

              <div className="flex items-center gap-1.5 flex-shrink-0">
                {(platformConfig?.chat_enabled ?? true) && (
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      try {
                        await openGroupConversation(cohort.id);
                      } finally {
                        router.push("/teacher/chat");
                      }
                    }}
                    title="Chat grupal"
                    className="w-8 h-8 rounded-xl bg-pink-50 hover:bg-pink-100 flex items-center justify-center"
                  >
                    <MessagesSquare className="w-4 h-4 text-pink-500" />
                  </button>
                )}
                <button
                  onClick={() => toggleExpand(cohort)}
                  className="w-8 h-8 rounded-xl bg-slate-50 hover:bg-slate-100 flex items-center justify-center flex-shrink-0"
                >
                  <ChevronRight className={`w-4 h-4 text-slate-500 transition-transform ${expandedId === cohort.id ? "rotate-90" : ""}`} />
                </button>
              </div>
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
                  onClick={() => { setClosingCohort(cohort); setCloseForm({ date: "", selectedSlot: null, duration: String(rules.allowed_class_durations?.[0] ?? 50) }); }}
                  disabled={cohort.current_students === 0}
                >
                  <Lock className="w-3.5 h-3.5" /> Cerrar con integrantes actuales
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => { setEditingCohort(cohort); setEditForm({ min_students: String(cohort.min_students), max_students: String(cohort.max_students) }); }}
                >
                  <Pencil className="w-3.5 h-3.5" /> Editar cupo
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => setCancelTarget(cohort)}
                  title="El grupo todavía no arrancó ninguna clase — se cancela por completo y los alumnos inscritos quedan libres de elegir otro paquete"
                >
                  <Ban className="w-3.5 h-3.5" /> Abortar / Cancelar (sin empezar clases)
                </Button>
              </div>
            )}
            {cohort.status === "confirmed" && (
              <div className="flex flex-wrap gap-2 mt-4">
                <Button size="sm" onClick={() => setSchedulingCohort(cohort)}>
                  <Plus className="w-3.5 h-3.5" /> Agendar sesión
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setCompleteTarget(cohort)}
                  title="Marca el grupo como terminado. Si llegó al mínimo de alumnos, cada alumno sigue su ciclo normal; si quedó por debajo, se cancela la inscripción de los que quedan y se les notifica"
                >
                  <Check className="w-3.5 h-3.5" /> Finalizar grupo
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => { setEditingCohort(cohort); setEditForm({ min_students: String(cohort.min_students), max_students: String(cohort.max_students) }); }}
                >
                  <Pencil className="w-3.5 h-3.5" /> Editar cupo
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setReopenTarget(cohort)}>
                  <RotateCcw className="w-3.5 h-3.5" /> Reabrir
                </Button>
              </div>
            )}

            {cohort.status === "in_progress" && (
              <div className="flex flex-wrap gap-2 mt-4">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setCompleteTarget(cohort)}
                  title="Marca el grupo como terminado. Si llegó al mínimo de alumnos, cada alumno sigue su ciclo normal; si quedó por debajo, se cancela la inscripción de los que quedan y se les notifica"
                >
                  <Check className="w-3.5 h-3.5" /> Finalizar grupo
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => { setEditingCohort(cohort); setEditForm({ min_students: String(cohort.min_students), max_students: String(cohort.max_students) }); }}
                >
                  <Pencil className="w-3.5 h-3.5" /> Editar cupo
                </Button>
              </div>
            )}

            {/* Integrantes (expandible) — quiénes se van uniendo al grupo */}
            {expandedId === cohort.id && (
              <div className="mt-4 pt-4 border-t border-slate-100">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">
                    Integrantes ({cohort.current_students}/{cohort.max_students})
                  </p>
                  <button
                    onClick={() => refetchMembers()}
                    disabled={loadingMembers}
                    className="w-6 h-6 rounded-lg hover:bg-slate-100 flex items-center justify-center flex-shrink-0 disabled:opacity-40"
                    title="Actualizar lista de integrantes"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 text-slate-400 ${loadingMembers ? "animate-spin" : ""}`} />
                  </button>
                </div>
                {loadingMembers ? (
                  <div className="space-y-1.5">
                    {[1, 2].map(i => <Skeleton key={i} className="h-9 rounded-xl" />)}
                  </div>
                ) : expandedMembers.length === 0 ? (
                  <p className="text-xs text-slate-400">
                    Todavía no hay ningún alumno inscrito en este grupo.
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {expandedMembers.map((m) => (
                      <li key={m.enrollment_id} className="flex items-center gap-2.5 bg-slate-50 rounded-xl px-3 py-2">
                        {m.student_avatar ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={m.student_avatar} alt="" className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
                        ) : (
                          <div className="w-7 h-7 rounded-full bg-pink-100 text-pink-600 flex items-center justify-center text-[11px] font-black flex-shrink-0">
                            {m.student_name.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <span className="text-sm font-bold text-slate-700 truncate flex-1">{m.student_name}</span>
                        {m.payment_status !== "paid" && (
                          <Badge variant="warning">Pago pendiente</Badge>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
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
                      ? "Cierra el grupo para poder agendar sesiones."
                      : "Todavía no hay sesiones agendadas."}
                  </p>
                ) : (
                  <>
                    <ul className="space-y-2">
                      {sessionsByCohort[cohort.id].map((s) => (
                        <li key={s.id} className="flex items-center justify-between text-xs bg-slate-50 rounded-xl px-3 py-2">
                          <span className="flex items-center gap-1.5 text-slate-600">
                            <Clock className="w-3.5 h-3.5" />
                            {new Date(s.start_time_utc).toLocaleString("es", { dateStyle: "medium", timeStyle: "short" })}
                            {" · "}{s.duration} min
                          </span>
                          <button
                            onClick={() => setAttendanceSession(s)}
                            className="text-pink-600 font-bold hover:underline flex items-center gap-1"
                          >
                            {s.participant_count} alumno(s)
                          </button>
                        </li>
                      ))}
                    </ul>
                    {/* Corrección QA: antes solo se podía ver/marcar asistencia
                        sesión por sesión — no había un resumen acumulado que
                        muestre patrones (ej. un alumno que falta seguido). */}
                    {sessionsByCohort[cohort.id].some(s => new Date(s.start_time_utc) <= new Date()) && (
                      <button
                        onClick={() => setAttendanceSummaryCohort(cohort)}
                        className="mt-3 w-full text-xs font-bold text-slate-600 bg-slate-50 hover:bg-slate-100 rounded-xl px-3 py-2.5 flex items-center justify-center gap-1.5 transition-colors"
                      >
                        <UserCheck className="w-3.5 h-3.5" /> Ver historial de asistencia
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </Card>
              ))}
            </div>
          </>
        );
      })()}

      {/* ── Modal: crear cohorte ── */}
      <FullScreenModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title="Nuevo Grupo"
        footer={
          <Button className="w-full" onClick={handleCreate} loading={creating} disabled={!form.package_id}>
            <Check className="w-4 h-4" /> Crear Grupo
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
                onChange={(e) => {
                  const pkg = groupPackages.find(p => String(p.id) === e.target.value);
                  setForm({
                    ...form,
                    package_id: e.target.value,
                    // Los cupos min/max de la cohorte deben coincidir con los
                    // configurados en el paquete grupal elegido, no ser libres.
                    min_students: pkg?.min_students != null ? String(pkg.min_students) : form.min_students,
                    max_students: pkg?.max_students != null ? String(pkg.max_students) : form.max_students,
                  });
                }}
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
                readOnly
                disabled
                className="w-full mt-2 border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-slate-50 text-slate-500 cursor-not-allowed"
                value={form.min_students}
              />
              <p className="text-[11px] text-slate-400 mt-1">Definido en el paquete grupal — igual puedes cerrar con menos.</p>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wide">Máximo de alumnos</label>
              <input
                type="number"
                min={1}
                readOnly
                disabled
                className="w-full mt-2 border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-slate-50 text-slate-500 cursor-not-allowed"
                value={form.max_students}
              />
              <p className="text-[11px] text-slate-400 mt-1">Definido en el paquete grupal.</p>
            </div>
          </div>
        </div>
      </FullScreenModal>

      {/* ── Modal: cerrar cohorte ── */}
      <FullScreenModal
        open={!!closingCohort}
        onClose={() => !actionLoading && setClosingCohort(null)}
        title="Cerrar grupo"
        footer={
          <Button
            className="w-full"
            onClick={handleClose}
            loading={actionLoading}
            disabled={isFixedSchedule ? !selectedRecurringStart : !closeForm.selectedSlot}
          >
            <Lock className="w-4 h-4" />
            {isFixedSchedule ? "Confirmar cierre y agendar todas las sesiones" : "Confirmar cierre y agendar 1ª sesión"}
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

            {isFixedSchedule ? (
              <>
                <p className="text-xs text-slate-500">
                  Este paquete tiene horario fijo (
                  {(closingPackage?.group_recurring_days_of_week ?? []).map(d => ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"][d]).join(", ")}
                  {" "}{closingPackage?.group_recurring_time_local}). Elegí en el calendario a partir de cuál día arrancar —
                  se agendarán automáticamente las {closingPackage?.classes_count ?? "N"} sesiones del paquete.
                </p>
                {loadingRecurringCandidates ? (
                  <Skeleton className="h-40 rounded-2xl" />
                ) : recurringCandidates.length === 0 ? (
                  <p className="text-xs text-rose-500 font-bold">
                    No se encontraron próximas coincidencias con el patrón configurado.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 items-start">
                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
                        1. Elegí el día de inicio
                      </label>
                      {/* Corrección QA: antes esto era una lista vertical plana
                          con las próximas ~8 coincidencias sueltas -- no se
                          veía de un vistazo qué días de la semana coinciden
                          con el patrón (ej. lunes y viernes). Ahora se
                          resaltan directamente en el calendario mensual los
                          días que coinciden, igual que en "Agendar sesión" /
                          reagendar. */}
                      <RescheduleCalendar
                        value={selectedRecurringDateKey ?? ""}
                        onChange={(dateStr) => {
                          const candidate = recurringByDate.get(dateStr);
                          setCloseForm({ ...closeForm, date: dateStr });
                          if (candidate?.available) setSelectedRecurringStart(candidate.start_time_utc);
                          else setSelectedRecurringStart(null);
                        }}
                        highlightedDates={recurringHighlightedDates}
                        unavailableDates={recurringUnavailableDates}
                        restrictToHighlighted
                      />
                      <div className="flex items-center gap-3 mt-2 text-[10px] font-bold text-slate-400">
                        <span className="flex items-center gap-1">
                          <span className="w-2.5 h-2.5 rounded bg-indigo-50 border-2 border-indigo-300 inline-block" /> Día del patrón, libre
                        </span>
                        <span className="flex items-center gap-1">
                          <span className="w-2.5 h-2.5 rounded bg-slate-100 border border-slate-200 inline-block" /> Día del patrón, ocupado
                        </span>
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
                        2. Vista previa de las sesiones
                      </label>
                      <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1 bg-slate-50/80 border border-slate-100 rounded-2xl p-2.5">
                        {recurringCandidates.map(c => {
                          const dateKey = getDateKeyTz(c.start_time_utc, myTz);
                          const isSelectedStart = selectedRecurringStart === c.start_time_utc;
                          // Preview: si ya eligieron un día de inicio, las sesiones
                          // anteriores a esa fecha no formarían parte del grupo.
                          const beforeStart = selectedRecurringDateKey ? dateKey < selectedRecurringDateKey : false;
                          return (
                            <div
                              key={c.start_time_utc}
                              className={`px-3 py-2 rounded-xl text-xs font-bold flex items-center justify-between gap-2 ${
                                isSelectedStart
                                  ? "bg-indigo-500 text-white"
                                  : beforeStart || !c.available
                                    ? "text-slate-300 bg-transparent line-through"
                                    : "text-slate-600 bg-white border border-slate-100"
                              }`}
                            >
                              <span className="capitalize">{new Date(c.start_time_utc).toLocaleString("es", { dateStyle: "medium", timeStyle: "short" })}</span>
                              {!c.available && <span className="text-[10px] normal-case font-medium">{c.reason}</span>}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <>
                <p className="text-xs text-slate-500">
                  La fecha y horario que elijas acá quedan como la fecha de inicio del grupo <strong>y</strong>{" "}
                  generan de una vez la primera sesión (clase) real de la cohorte.
                </p>

                {/* Corrección QA: antes esto era un <input type="datetime-local">
                    suelto, sin validar contra la disponibilidad real del
                    profesor, y la fecha elegida nunca generaba una Class de
                    verdad — solo quedaba como metadata de la cohorte. Ahora
                    reutiliza el mismo selector de calendario + horarios reales
                    que "Agendar sesión" (ver GroupSessionSlotPicker). */}
                <GroupSessionSlotPicker
                  allowedDurations={rules.allowed_class_durations}
                  duration={closeForm.duration}
                  onDurationChange={(d) => setCloseForm({ ...closeForm, duration: d, selectedSlot: null })}
                  date={closeForm.date}
                  onDateChange={(d) => setCloseForm({ ...closeForm, date: d, selectedSlot: null })}
                  slots={closeSlots}
                  slotsLoading={closeSlotsLoading}
                  selectedSlot={closeForm.selectedSlot}
                  onSelectSlot={(slot) => setCloseForm({ ...closeForm, selectedSlot: slot })}
                  myTz={myTz}
                  disabled={actionLoading}
                />
              </>
            )}
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
            disabled={!sessionForm.date || !sessionForm.selectedSlot}
          >
            <Calendar className="w-4 h-4" /> Agendar
          </Button>
        }
      >
        <div className="space-y-4">
          <p className="text-xs text-slate-500">
            Se creará una sesión compartida e inscribirá automáticamente a todos los alumnos con pago confirmado de este grupo.
          </p>

          <GroupSessionSlotPicker
            allowedDurations={rules.allowed_class_durations}
            duration={sessionForm.duration}
            onDurationChange={(d) => setSessionForm({ ...sessionForm, duration: d, selectedSlot: null })}
            date={sessionForm.date}
            onDateChange={(d) => setSessionForm({ ...sessionForm, date: d, selectedSlot: null })}
            slots={sessionSlots}
            slotsLoading={sessionSlotsLoading}
            selectedSlot={sessionForm.selectedSlot}
            onSelectSlot={(slot) => setSessionForm({ ...sessionForm, selectedSlot: slot })}
            myTz={myTz}
          />
        </div>
      </FullScreenModal>

      {attendanceSession && (
        <AttendanceModal
          session={attendanceSession}
          onClose={() => setAttendanceSession(null)}
        />
      )}

      {attendanceSummaryCohort && (
        <AttendanceSummaryModal
          cohort={attendanceSummaryCohort}
          onClose={() => setAttendanceSummaryCohort(null)}
        />
      )}

      <ConfirmModal
        open={!!cancelTarget}
        title="Abortar / Cancelar grupo (sin empezar clases)"
        description={cancelTarget ? `¿Abortar el grupo de "${cancelTarget.package_name}"? Todavía no arrancó ninguna clase. Se cancelará la inscripción de los ${cancelTarget.current_students} alumno(s), quienes quedarán libres de elegir un nuevo paquete (individual u otro grupo).` : ""}
        confirmLabel="Abortar grupo"
        variant="danger"
        onClose={() => setCancelTarget(null)}
        onConfirm={() => { if (cancelTarget) return handleCancel(cancelTarget) }}
        loading={actionLoading}
      />

      <ConfirmModal
        open={!!completeTarget}
        title="Finalizar grupo"
        description={
          completeTarget
            ? (completeTarget.current_students < completeTarget.min_students
              ? `⚠️ Este grupo NO llegó al mínimo (${completeTarget.current_students} de ${completeTarget.min_students} alumnos). Al finalizarlo, se cancelará la inscripción de los ${completeTarget.current_students} alumno(s) que quedan y se les notificará para que elijan un nuevo paquete — el efecto es el mismo que cancelarlo. Úsalo cuando el grupo ya tuvo clases y quieras cerrarlo por no haber alcanzado el cupo.`
              : "El grupo alcanzó el mínimo de alumnos y se marcará como finalizado normalmente. Se cancelará cualquier sesión futura que haya quedado agendada de más, pero los alumnos mantienen su inscripción.")
            : ""
        }
        confirmLabel="Finalizar"
        variant={completeTarget && completeTarget.current_students < completeTarget.min_students ? "danger" : "primary"}
        onClose={() => setCompleteTarget(null)}
        onConfirm={() => { if (completeTarget) return handleComplete(completeTarget) }}
        loading={actionLoading}
      />

      <ConfirmModal
        open={!!reopenTarget}
        title="Reabrir grupo"
        description={reopenTarget ? `¿Reabrir el grupo de "${reopenTarget.package_name}"? Volverá a estar "abierta" (aceptando inscripciones nuevas) y tendrás que cerrarla de nuevo para fijar una fecha de inicio.` : ""}
        confirmLabel="Reabrir"
        variant="primary"
        onClose={() => setReopenTarget(null)}
        onConfirm={() => { if (reopenTarget) return handleReopen(reopenTarget) }}
        loading={actionLoading}
      />

      {/* ── Modal: editar cupo (D12) ── */}
      <FullScreenModal
        open={!!editingCohort}
        onClose={() => setEditingCohort(null)}
        title="Editar cupo"
        footer={
          <Button
            className="w-full"
            onClick={handleEditQuota}
            loading={editing}
            disabled={!editForm.min_students || !editForm.max_students}
          >
            <Check className="w-4 h-4" /> Guardar cambios
          </Button>
        }
      >
        <div className="space-y-4">
          <p className="text-xs text-slate-500">
            {editingCohort?.package_name} — actualmente {editingCohort?.current_students} alumno(s) inscritos.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wide">Mínimo de alumnos</label>
              <input
                type="number"
                min={1}
                className="w-full mt-2 border border-slate-200 rounded-xl px-3 py-2.5 text-sm"
                value={editForm.min_students}
                onChange={(e) => setEditForm({ ...editForm, min_students: e.target.value })}
              />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wide">Máximo de alumnos</label>
              <input
                type="number"
                min={1}
                className="w-full mt-2 border border-slate-200 rounded-xl px-3 py-2.5 text-sm"
                value={editForm.max_students}
                onChange={(e) => setEditForm({ ...editForm, max_students: e.target.value })}
              />
              {editingCohort && (
                <p className="text-[11px] text-slate-400 mt-1">
                  No puede ser menor que los {editingCohort.current_students} ya inscritos.
                </p>
              )}
            </div>
          </div>
        </div>
      </FullScreenModal>

      <ChipiWidget screenName="teacher_cohorts" />
      </div>
    </div>
  );
}

// ─── Selector de fecha real + horario disponible para sesiones grupales ────
// Corrección QA: antes tanto "Cerrar cohorte" (fecha de inicio) como
// "Agendar sesión" tenían su propio formulario de fecha/hora — el primero
// era un <input type="datetime-local"> suelto sin validar disponibilidad
// real, y el segundo ya usaba RescheduleCalendar + useAvailableSlots. Se
// extrae la UI compartida acá para que ambos flujos generen una sesión
// real (Class) contra un horario que sabemos que existe de verdad.
function GroupSessionSlotPicker({
  allowedDurations,
  duration,
  onDurationChange,
  date,
  onDateChange,
  slots,
  slotsLoading,
  selectedSlot,
  onSelectSlot,
  myTz,
  disabled = false,
}: {
  allowedDurations: number[];
  duration: string;
  onDurationChange: (d: string) => void;
  date: string;
  onDateChange: (d: string) => void;
  slots: AvailableSlot[];
  slotsLoading: boolean;
  selectedSlot: AvailableSlot | null;
  onSelectSlot: (slot: AvailableSlot) => void;
  myTz: string;
  // Correcciones Extra: al confirmar el cierre de la cohorte, los
  // horarios quedan bloqueados mientras la petición está en curso -- antes
  // se podía seguir cambiando fecha/duración/horario mientras el POST
  // /close ya estaba en vuelo, lo que podía terminar mandando una
  // selección distinta a la que el profesor vio en pantalla al confirmar.
  disabled?: boolean;
}) {
  return (
    <>
      <div className={disabled ? "pointer-events-none opacity-50" : undefined}>
      <div>
        <label className="text-xs font-bold text-slate-500 uppercase tracking-wide">Duración</label>
        <div className="flex flex-wrap gap-2 mt-2">
          {allowedDurations.map(d => (
            <button
              key={d}
              type="button"
              disabled={disabled}
              onClick={() => onDurationChange(String(d))}
              className={`px-4 py-2 rounded-xl text-sm font-bold border-2 transition-colors ${
                Number(duration) === d
                  ? "border-pink-400 bg-pink-50 text-pink-600"
                  : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"
              }`}
            >
              {d} min
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 items-start">
        <div>
          <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
            1. Elige la fecha
          </label>
          <RescheduleCalendar value={date} onChange={onDateChange} />
        </div>

        <div>
          <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
            2. Elige el horario disponible
          </label>

          {!date ? (
            <div className="flex flex-col items-center justify-center h-[240px] bg-slate-50/80 border border-slate-100 rounded-2xl p-6 text-center">
              <Calendar className="w-9 h-9 text-slate-300 mb-2" />
              <p className="text-xs text-slate-500 font-bold">Primero selecciona una fecha en el calendario</p>
            </div>
          ) : slotsLoading ? (
            <div className="flex flex-col items-center justify-center h-[240px] bg-slate-50/80 rounded-2xl">
              <div className="w-8 h-8 border-4 border-pink-200 border-t-pink-500 rounded-full animate-spin mb-2" />
              <p className="text-xs font-semibold text-slate-400">Buscando horarios...</p>
            </div>
          ) : slots.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-[240px] bg-slate-50/80 border border-slate-100 rounded-2xl p-6 text-center">
              <AlertTriangle className="w-9 h-9 text-amber-400 mb-2" />
              <p className="text-xs text-slate-700 font-black mb-1">Sin disponibilidad</p>
              <p className="text-[11px] text-slate-400">No hay huecos libres en este día. Prueba con otra fecha.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 h-[240px] overflow-y-auto pr-1">
              {slots.map((slot, i) => {
                const isSelected = selectedSlot?.start_time_utc === slot.start_time_utc;
                const blocked = !slot.is_available || slot.is_past || slot.too_soon;
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => !blocked && onSelectSlot(slot)}
                    disabled={blocked || disabled}
                    className={`py-2.5 px-3 rounded-xl text-center border-2 flex flex-col items-center justify-center transition-all duration-200
                      ${blocked ? "border-slate-100 bg-slate-50 opacity-50 cursor-not-allowed"
                        : isSelected ? "border-pink-500 bg-pink-50 shadow-md shadow-pink-100"
                        : "border-slate-100 bg-white hover:border-pink-200 shadow-sm"}`}
                  >
                    <span className={`text-sm font-black tracking-tight ${blocked ? "text-slate-400" : isSelected ? "text-pink-600" : "text-slate-700"}`}>
                      {formatTimeTz(slot.start_time_utc, myTz)}
                    </span>
                    {blocked && (
                      <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider mt-0.5">
                        {slot.is_past ? "Pasado" : slot.too_soon ? "Muy pronto" : "Ocupado"}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
      </div>
    </>
  );
}

// ─── Modal de asistencia por alumno de una sesión grupal ─────────────────────
// Antes el único estado disponible era el de la Class compartida (todo el
// grupo "completado" o "no_show" a la vez). Esto permite marcar
// individualmente quién asistió a ESTA sesión puntual.
function AttendanceModal({ session, onClose }: { session: Session; onClose: () => void }) {
  const [participants, setParticipants] = useState<SessionParticipant[] | null>(null);
  const [error, setError] = useState("");
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const toast = useToast();

  useEffect(() => {
    api.get<SessionParticipant[]>(`/cohorts/sessions/${session.id}/participants`)
      .then(res => setParticipants(res.data))
      .catch((e) => setError(getErrorMessage(e, "No se pudo cargar la lista")));
  }, [session.id]);

  const mark = async (studentId: number, status: "confirmed" | "no_show") => {
    setUpdatingId(studentId);
    try {
      await api.patch(`/cohorts/sessions/${session.id}/participants/${studentId}/attendance`, {
        attendance_status: status,
      });
      setParticipants(prev =>
        prev ? prev.map(p => p.student_id === studentId ? { ...p, attendance_status: status } : p) : prev
      );
      toast.success(status === "confirmed" ? "Asistencia marcada como confirmada" : "Asistencia marcada como ausente");
    } catch (e) {
      setError(getErrorMessage(e, "No se pudo actualizar la asistencia"));
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <FullScreenModal
      open
      onClose={onClose}
      title="Asistencia de la sesión"
    >
      <div className="space-y-3">
        <p className="text-xs text-slate-500 flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5" />
          {new Date(session.start_time_utc).toLocaleString("es", { dateStyle: "medium", timeStyle: "short" })}
        </p>

        {error && (
          <div className="bg-rose-50 border border-rose-100 text-rose-600 px-4 py-3 rounded-xl text-xs font-bold flex items-center gap-2">
            <X className="w-4 h-4 flex-shrink-0" /> {error}
          </div>
        )}

        {!participants ? (
          <p className="text-xs text-slate-400">Cargando integrantes…</p>
        ) : participants.length === 0 ? (
          <p className="text-xs text-slate-400">No hay integrantes activos en esta sesión.</p>
        ) : (
          <ul className="space-y-2">
            {participants.map(p => (
              <li key={p.student_id} className="flex items-center justify-between bg-slate-50 rounded-xl px-3 py-2.5">
                <span className="text-sm font-bold text-slate-700">{p.student_name}</span>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => mark(p.student_id, "confirmed")}
                    disabled={updatingId === p.student_id}
                    className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors disabled:opacity-50 ${
                      p.attendance_status === "confirmed" ? "bg-emerald-500 text-white" : "bg-white text-emerald-500 border border-emerald-200 hover:bg-emerald-50"
                    }`}
                    title="Marcar como asistió"
                  >
                    <UserCheck className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => mark(p.student_id, "no_show")}
                    disabled={updatingId === p.student_id}
                    className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors disabled:opacity-50 ${
                      p.attendance_status === "no_show" ? "bg-rose-500 text-white" : "bg-white text-rose-500 border border-rose-200 hover:bg-rose-50"
                    }`}
                    title="Marcar como no asistió"
                  >
                    <UserX className="w-4 h-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </FullScreenModal>
  );
}

// ─── Modal: historial de asistencia acumulado por alumno ───────────────────
// Corrección QA: antes la única vista de asistencia era por sesión puntual
// (AttendanceModal, arriba) — no existía un resumen a lo largo del ciclo
// completo de la cohorte que le permita al profesor notar patrones (un
// alumno que falta seguido, por ejemplo).
interface AttendanceSummary {
  student_id: number;
  student_name: string;
  sessions_confirmed: number;
  sessions_no_show: number;
  sessions_total: number;
}

function AttendanceSummaryModal({ cohort, onClose }: { cohort: Cohort; onClose: () => void }) {
  const [summary, setSummary] = useState<AttendanceSummary[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get<AttendanceSummary[]>(`/cohorts/${cohort.id}/attendance-summary`)
      .then(res => setSummary(res.data))
      .catch((e) => setError(getErrorMessage(e, "No se pudo cargar el historial")));
  }, [cohort.id]);

  return (
    <FullScreenModal open onClose={onClose} title="Historial de asistencia">
      <div className="space-y-3">
        <p className="text-xs text-slate-500">
          Sesiones ya realizadas del grupo de &quot;{cohort.package_name}&quot;.
        </p>
        {error && <p className="text-xs font-bold text-rose-500">{error}</p>}
        {!summary ? (
          <p className="text-xs text-slate-400">Cargando…</p>
        ) : summary.length === 0 ? (
          <p className="text-xs text-slate-400">Todavía no hay sesiones pasadas para mostrar asistencia.</p>
        ) : (
          <ul className="space-y-2">
            {summary.map((s) => {
              const rate = s.sessions_total > 0 ? Math.round((s.sessions_confirmed / s.sessions_total) * 100) : 0;
              return (
                <li key={s.student_id} className="bg-slate-50 rounded-xl px-3.5 py-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm font-bold text-slate-700">{s.student_name}</span>
                    <span className={`text-xs font-black ${rate >= 80 ? "text-emerald-600" : rate >= 50 ? "text-amber-600" : "text-rose-600"}`}>
                      {s.sessions_confirmed}/{s.sessions_total} ({rate}%)
                    </span>
                  </div>
                  <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${rate >= 80 ? "bg-emerald-400" : rate >= 50 ? "bg-amber-400" : "bg-rose-400"}`}
                      style={{ width: `${rate}%` }}
                    />
                  </div>
                  {s.sessions_no_show > 0 && (
                    <p className="text-[11px] text-rose-500 font-semibold mt-1">
                      {s.sessions_no_show} inasistencia{s.sessions_no_show !== 1 ? "s" : ""}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </FullScreenModal>
  );
}

