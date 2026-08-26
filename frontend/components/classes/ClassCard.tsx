"use client";

import { useState } from "react";
import { User, Video, X, Clock, RotateCcw, Check, AlertCircle, Phone, Users2 } from "lucide-react";
import api from "@/lib/api";
import { getFlagForNationality } from "@/lib/nationalities";
import { formatTimeTz, formatWeekdayShortTz, formatMonthShortTz, getDayOfMonthTz, getMyDisplayTimezone } from "@/lib/tzFormat";

export interface ClassCardData {
  id: number;
  class_type: string;
  subject?: string | null;
  start_time_utc: string;
  end_time_utc?: string | null;
  duration_minutes?: number;
  status: string;
  meet_link?: string | null;
  notes?: string | null;
  teacher_name?: string | null;
  teacher_avatar?: string | null;
  teacher_timezone?: string | null;
  teacher_phone?: string | null;
  student_name?: string | null;
  teacher_nationality?: string | null;
  student_nationality?: string | null;
  student_avatar?: string | null;
  student_timezone?: string | null;
  student_phone?: string | null;
  cohort_id?: number | null;
  participant_count?: number | null;
  participant_names?: string[] | null;
}

type Role = "student" | "teacher" | "teacher_admin";

interface ClassCardProps {
  class_: ClassCardData;
  role: Role;
  readOnly?: boolean;
  onUpdate?: () => void;
  onReschedule?: () => void;
  onCancel?: () => void;
}

const STATUS_CONFIG: Record<string, { theme: string; label: string; border: string }> = {
  pending:         { theme: "bg-amber-100 text-amber-700",   label: "Pendiente pago", border: "border-l-amber-400" },
  pending_trial:   { theme: "bg-purple-100 text-purple-700", label: "Prueba pdte",    border: "border-l-purple-400" },
  pending_payment: { theme: "bg-blue-100 text-blue-700",     label: "En revisión",    border: "border-l-blue-400" },
  confirmed:       { theme: "bg-emerald-100 text-emerald-700",label: "Confirmada",    border: "border-l-emerald-400" },
  completed:       { theme: "bg-slate-100 text-slate-700",   label: "Completada",     border: "border-l-slate-300" },
  cancelled:       { theme: "bg-red-100 text-red-700",       label: "Cancelada",      border: "border-l-red-400" },
  no_show:         { theme: "bg-red-100 text-red-700",       label: "No asistió",     border: "border-l-red-600" },
  rescheduled:     { theme: "bg-orange-100 text-orange-700", label: "Reagendada",     border: "border-l-orange-400" },
  finalized:       { theme: "bg-slate-100 text-slate-700",   label: "Finalizada",     border: "border-l-slate-300" },
  expired:         { theme: "bg-slate-200 text-slate-600",   label: "Expirada",       border: "border-l-slate-400" },
};

const HISTORY_STATUSES = ["completed", "cancelled", "no_show", "finalized", "expired"];

// BUG-05/17 fix: el profesor puede cambiar libremente el estado de la clase
// a completed/no_show/finalized, sin importar cuál era el estado de origen,
// dentro de una ventana de 72h desde que la clase terminó (ver también
// backend: classes.py update_class_status). La cancelación sigue siendo una
// acción aparte (DELETE /classes/teacher/{id}, ver teacherCancelInline).
const MANUAL_TARGET_STATUSES = ["completed", "no_show", "finalized"];
const MANUAL_STATUS_WINDOW_HOURS = 72;
const TEACHER_CANCELABLE_STATUSES = ["pending_trial", "confirmed", "finalized"];

const STUDENT_CANCELABLE = ["pending", "pending_trial", "pending_payment", "confirmed"];
// BUG-02 fix (ampliado): el estudiante también puede reagendar una clase
// 'finalized', igual que el profesor, sin restricción de antelación (ver
// can_reschedule_class en el backend).
const STUDENT_RESCHEDULABLE = ["pending", "pending_trial", "confirmed", "finalized"];

function PersonAvatar({ name, url, className }: { name?: string | null; url?: string | null; className?: string }) {
  if (url) return <img src={url} alt={name ?? ""} className={`${className} object-cover`} />;
  return (
    <div className={`${className} bg-slate-200 flex items-center justify-center text-slate-500 font-bold text-[10px]`}>
      {name ? name.charAt(0).toUpperCase() : <User className="w-3 h-3" />}
    </div>
  );
}

// ─── Conversión local a ISO UTC según zona horaria IANA ──────────────────
function localDateTimeToUtcIso(dateStr: string, timeStr: string, timeZone: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const [hour, minute] = timeStr.split(":").map(Number);
  
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const parts = dtf.formatToParts(utcGuess).reduce((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {} as Record<string, string>);
  
  const asUTC = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour) % 24, Number(parts.minute), Number(parts.second)
  );
  const offsetMinutes = (asUTC - utcGuess.getTime()) / 60000;
  return new Date(utcGuess.getTime() - offsetMinutes * 60000).toISOString();
}

// ─── Diferencia de zona horaria entre dos IANA timezones ────────────────────
function getUtcOffsetMinutes(timeZone: string, date = new Date()): number | null {
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    const parts = dtf.formatToParts(date).reduce((acc, p) => {
      acc[p.type] = p.value;
      return acc;
    }, {} as Record<string, string>);
    const asUTC = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour) % 24, Number(parts.minute), Number(parts.second)
    );
    return (asUTC - date.getTime()) / 60000;
  } catch {
    return null;
  }
}

/** Devuelve la diferencia horaria de `otherTz` respecto a `myTz`, ej. "+3h" o "-1.5h" */
function getTimezoneDiffLabel(otherTz?: string | null, myTz?: string | null): string | null {
  if (!otherTz || !myTz) return null;
  const offOther = getUtcOffsetMinutes(otherTz);
  const offMy = getUtcOffsetMinutes(myTz);
  if (offOther === null || offMy === null) return null;

  const diffHours = (offOther - offMy) / 60;
  if (diffHours === 0) return "Mismo huso horario";

  const sign = diffHours > 0 ? "+" : "";
  const rounded = Math.abs(diffHours % 1) < 0.01 ? diffHours.toFixed(0) : diffHours.toFixed(1);
  return `${sign}${rounded}h respecto a ti`;
}

export default function ClassCard({
  class_, role, readOnly = false, onUpdate, onReschedule, onCancel,
}: ClassCardProps) {
  const [updating, setUpdating] = useState(false);
  const [showInlineReschedule, setShowInlineReschedule] = useState(false);
  const [newDate, setNewDate] = useState("");
  const [newTime, setNewTime] = useState("");
  const [error, setError] = useState("");

  const cfg = STATUS_CONFIG[class_.status] ?? STATUS_CONFIG.pending;
  const start = new Date(class_.start_time_utc);
  const duration = class_.duration_minutes || 60;
  const endDate = class_.end_time_utc ? new Date(class_.end_time_utc) : new Date(start.getTime() + duration * 60000);
  
  const isPast = endDate < new Date();
  const isHistory = HISTORY_STATUSES.includes(class_.status);
  const isGroup = class_.class_type === "group";

  const personName = role === "student" ? class_.teacher_name : class_.student_name;
  const personAvatar = role === "student" ? class_.teacher_avatar : class_.student_avatar;
  const personNationality = role === "student" ? class_.teacher_nationality : class_.student_nationality;
  const personLabel = role === "student" ? "Prof." : "Est.";

  // En una sesión grupal no hay un único "estudiante" (Class.student_id es
  // NULL) — el profesor ve cuántos alumnos hay inscritos en vez del nombre
  // de uno solo; el alumno sigue viendo a su profesor normalmente.
  const groupmateCount = Math.max((class_.participant_count ?? 0) - (role === "student" ? 1 : 0), 0);

  const personPhone = role === "student" ? class_.teacher_phone : class_.student_phone;
  const myTimezone = (role === "teacher" ? class_.teacher_timezone : class_.student_timezone) || getMyDisplayTimezone();
  const otherTimezone = role === "teacher" ? class_.student_timezone : class_.teacher_timezone;
  const tzDiffLabel = getTimezoneDiffLabel(otherTimezone, myTimezone);

  const dayOfWeek = formatWeekdayShortTz(class_.start_time_utc, myTimezone);

  // --- LÓGICA DE API ---
  const teacherUpdateStatus = async (newStatus: string) => {
    setUpdating(true); setError("");
    try {
      await api.patch(`/classes/${class_.id}/status`, { status: newStatus });
      onUpdate?.();
    } catch (e: any) { setError(e.response?.data?.detail || "Error actualizando"); } 
    finally { setUpdating(false); }
  };

  const processReschedule = async () => {
    if (!newDate || !newTime) return;
    setUpdating(true); setError("");
    try {
      const myTz = (role === "teacher" ? class_.teacher_timezone : class_.student_timezone) || getMyDisplayTimezone();
      const startUtc = localDateTimeToUtcIso(newDate, newTime, myTz);
      const endUtc = new Date(new Date(startUtc).getTime() + duration * 60000).toISOString();
      const endpoint = role === "teacher" 
        ? `/classes/teacher/${class_.id}/reschedule`
        : `/classes/${class_.id}/reschedule`;
      
      await api.patch(endpoint, { start_time_utc: startUtc, end_time_utc: endUtc });
      setShowInlineReschedule(false); setNewDate(""); setNewTime("");
      onUpdate?.();
    } catch (e: any) { setError(e.response?.data?.detail || "Error reagendando"); } 
    finally { setUpdating(false); }
  };

  const studentCancelInline = async () => {
    setUpdating(true); setError("");
    try {
      await api.delete(`/classes/${class_.id}`);
      onUpdate?.();
    } catch (e: any) { setError(e.response?.data?.detail || "Error al cancelar"); } 
    finally { setUpdating(false); }
  };

  const teacherCancelInline = async () => {
    setUpdating(true); setError("");
    try {
      await api.delete(`/classes/teacher/${class_.id}`);
      onUpdate?.();
    } catch (e: any) { setError(e.response?.data?.detail || "Error al cancelar"); } 
    finally { setUpdating(false); }
  };

  // --- HANDLERS ---
  const handleRescheduleClick = () => {
    if (onReschedule) { onReschedule(); return; }
    setShowInlineReschedule(true);
  };

  const handleCancelClick = () => {
    if (onCancel) { onCancel(); return; }
    role === "teacher" ? teacherCancelInline() : studentCancelInline();
  };

  // --- PERMISOS ---
  // BUG-05/17 fix: transiciones manuales libres (completed/no_show/finalized),
  // acotadas por la ventana de 72h desde el fin de la clase.
  const hoursSinceEnd = (Date.now() - endDate.getTime()) / (1000 * 60 * 60);
  const withinManualStatusWindow = hoursSinceEnd <= MANUAL_STATUS_WINDOW_HOURS;
  const teacherNextActions = role === "teacher" && withinManualStatusWindow
    ? MANUAL_TARGET_STATUSES.filter((s) => s !== class_.status)
    : [];
  const canReschedule = role === "teacher"
    ? !["completed", "cancelled", "no_show"].includes(class_.status)
    : STUDENT_RESCHEDULABLE.includes(class_.status) && !isGroup;
  const canCancel = role === "teacher"
    ? TEACHER_CANCELABLE_STATUSES.includes(class_.status)
    : STUDENT_CANCELABLE.includes(class_.status) && !isGroup;

  // BUG-05/17 fix: antes 'showTeacherActions' exigía !isPast, lo que ocultaba
  // los botones de Completar/No asistió justo cuando más se necesitan (después
  // de que la clase terminó). Ahora se basan en la ventana de 72h.
  const showTeacherActions = role === "teacher" && withinManualStatusWindow && !readOnly;
  // Una clase 'finalized' ya pasó por definición, pero tanto profesor como
  // estudiante pueden reagendarla sin restricción de antelación (BUG-02
  // ampliado), así que el estado 'finalized' siempre puede ignorar el
  // bloqueo por isPast a la hora de mostrar el botón de reagendar.
  const canBypassPastForReschedule = role === "teacher" || class_.status === "finalized";
  const hasAnyAction = !readOnly && ((canReschedule && (!isPast || canBypassPastForReschedule)) || (canCancel && (!isPast || role === "teacher")) || showTeacherActions);

  return (
    <div className={`group bg-white/90 backdrop-blur-xl rounded-2xl border border-white/80 shadow-lg shadow-slate-100/80 border-l-4 ${cfg.border} p-5 hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden ${isHistory ? "opacity-75 hover:opacity-100" : ""}`}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        
        {/* LADO IZQUIERDO: Info Principal */}
        <div className="flex items-start gap-4 flex-1 min-w-0">
          
          {/* Bloque de Fecha */}
          <div className="flex flex-col items-center justify-center bg-pink-50/80 text-pink-600 rounded-2xl px-3.5 py-2.5 min-w-[64px] border border-pink-100/60 flex-shrink-0">
            <span className="text-[10px] font-black uppercase tracking-wider text-pink-400">
              {dayOfWeek}
            </span>
            <span className="text-xl font-black tracking-tight text-slate-800">
              {getDayOfMonthTz(class_.start_time_utc, myTimezone)}
            </span>
            <span className="text-[10px] font-bold text-pink-500 uppercase">
              {formatMonthShortTz(class_.start_time_utc, myTimezone)}
            </span>
          </div>

          {/* Bloque de Contenido */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              <span className={`text-[10px] font-black uppercase tracking-widest px-2.5 py-0.5 rounded-full ${cfg.theme}`}>
                {cfg.label}
              </span>
              {class_.class_type === "trial" && (
                <span className="text-[10px] font-black uppercase tracking-widest px-2.5 py-0.5 rounded-full bg-purple-100 text-purple-700">
                  Prueba
                </span>
              )}
              {isGroup && (
                <span className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest px-2.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
                  <Users2 className="w-2.5 h-2.5" /> Grupal
                </span>
              )}
              {tzDiffLabel && (
                <span className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest px-2.5 py-0.5 rounded-full bg-sky-100 text-sky-700">
                  <Clock className="w-2.5 h-2.5" /> {tzDiffLabel}
                </span>
              )}
            </div>

            {/* ASIGNATURA DESTACADA */}
            <h3 className="text-base font-black text-slate-800 truncate mb-1">
              {class_.subject ?? "Clase sin asignatura"}
            </h3>

            {/* Tiempo y Persona */}
            <div className="flex items-center gap-3 text-xs font-semibold text-slate-500 flex-wrap mb-2">
              <span className="flex items-center gap-1.5 bg-slate-100 px-2.5 py-1 rounded-lg text-slate-600">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                {formatTimeTz(class_.start_time_utc, myTimezone)}
                {" – "}
                {class_.end_time_utc ? formatTimeTz(class_.end_time_utc, myTimezone) : formatTimeTz(endDate.toISOString(), myTimezone)}
                {" "}({duration} min)
              </span>
              
              {personName && !(isGroup && role === "teacher") && (
                <span className="flex items-center gap-1.5 text-slate-500">
                  <PersonAvatar name={personName} url={personAvatar} className="w-5 h-5 rounded-full flex-shrink-0" />
                  {personLabel}: <strong className="text-slate-700 truncate max-w-[120px]">{personName}</strong>
                  {personNationality && (
                    <span className="text-[10px] font-bold text-slate-400 ml-0.5">
                      {getFlagForNationality(personNationality)} {personNationality}
                    </span>
                  )}
                </span>
              )}

              {isGroup && role === "teacher" && (
                <span
                  className="flex items-center gap-1.5 text-slate-500"
                  title={class_.participant_names?.join(", ") || undefined}
                >
                  <Users2 className="w-3.5 h-3.5 text-indigo-400" />
                  <strong className="text-slate-700">{class_.participant_count ?? 0} alumno(s)</strong> inscrito(s)
                </span>
              )}

              {isGroup && role === "student" && groupmateCount > 0 && (
                <span className="flex items-center gap-1.5 text-slate-500">
                  <Users2 className="w-3.5 h-3.5 text-indigo-400" />
                  +{groupmateCount} compañero(s)
                </span>
              )}

              {personPhone && (
                <span className="flex items-center gap-1.5 bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded-lg font-bold">
                  <Phone className="w-3.5 h-3.5 text-emerald-500" />
                  {personPhone}
                </span>
              )}
            </div>

            {class_.notes && (
              <p className="text-xs text-slate-500 italic mb-2 truncate">"{class_.notes}"</p>
            )}
            {error && (
              <p className="text-xs font-bold text-red-500 mb-2 truncate">{error}</p>
            )}
          </div>
        </div>

        {/* LADO DERECHO: Acciones */}
        {hasAnyAction && (
          <div className="flex sm:flex-col gap-2 items-stretch sm:items-end justify-end flex-shrink-0 border-t sm:border-t-0 pt-3 sm:pt-0 border-slate-100">
            
            {showInlineReschedule ? (
              <div className="flex flex-col gap-2 bg-slate-50 p-2 rounded-xl border border-slate-100 w-full sm:w-auto">
                <input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} className="text-xs px-2 py-1.5 rounded-lg border border-slate-200 bg-white" />
                <input type="time" value={newTime} onChange={e => setNewTime(e.target.value)} className="text-xs px-2 py-1.5 rounded-lg border border-slate-200 bg-white" />
                <div className="flex gap-1.5 mt-1">
                  <button onClick={processReschedule} disabled={updating} className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white py-1.5 rounded-lg text-xs font-bold transition-colors">OK</button>
                  <button onClick={() => setShowInlineReschedule(false)} className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-700 py-1.5 rounded-lg text-xs font-bold transition-colors">X</button>
                </div>
              </div>
            ) : (
              <>
                {showTeacherActions && teacherNextActions.includes("completed") && (
                  <button onClick={() => teacherUpdateStatus("completed")} disabled={updating} className="flex items-center justify-center gap-1.5 text-xs font-bold text-emerald-600 bg-emerald-50 hover:bg-emerald-100 px-3.5 py-2 rounded-xl transition-colors disabled:opacity-50">
                    <Check className="w-3.5 h-3.5" /> Completar
                  </button>
                )}
                {showTeacherActions && teacherNextActions.includes("no_show") && (
                  <button onClick={() => teacherUpdateStatus("no_show")} disabled={updating} className="flex items-center justify-center gap-1.5 text-xs font-bold text-orange-600 bg-orange-50 hover:bg-orange-100 px-3.5 py-2 rounded-xl transition-colors disabled:opacity-50">
                    <AlertCircle className="w-3.5 h-3.5" /> No asistió
                  </button>
                )}
                {showTeacherActions && teacherNextActions.includes("finalized") && (
                  <button onClick={() => teacherUpdateStatus("finalized")} disabled={updating} className="flex items-center justify-center gap-1.5 text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 px-3.5 py-2 rounded-xl transition-colors disabled:opacity-50">
                    <Clock className="w-3.5 h-3.5" /> Sin resolver
                  </button>
                )}
                {canReschedule && (!isPast || canBypassPastForReschedule) && (
                  <button onClick={handleRescheduleClick} disabled={updating} className="flex items-center justify-center gap-1.5 text-xs font-bold text-purple-600 bg-purple-50 hover:bg-purple-100 px-3.5 py-2 rounded-xl transition-colors disabled:opacity-50">
                    <RotateCcw className="w-3.5 h-3.5" /> Reagendar
                  </button>
                )}
                {canCancel && (!isPast || role === "teacher") && (
                  <button onClick={handleCancelClick} disabled={updating} className="flex items-center justify-center gap-1.5 text-xs font-bold text-red-500 bg-red-50 hover:bg-red-100 px-3.5 py-2 rounded-xl transition-colors disabled:opacity-50">
                    <X className="w-3.5 h-3.5" /> Cancelar
                  </button>
                )}
              </>
            )}
          </div>
        )}

      </div>
    </div>
  );
}