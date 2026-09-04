"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Calendar, ChevronLeft,
  ChevronRight, AlertCircle, X, Check
} from "lucide-react";
import { useStudentClasses, StudentClass } from "@/hooks/useStudentData";
import api from "@/lib/api";
import ChipiWidget from "@/components/chipi/ChipiWidget";
import ClassCard from "@/components/classes/ClassCard";
import { RescheduleModal } from "@/components/classes/RescheduleModal";
import { getMyDisplayTimezone, formatDateHumanTz } from "@/lib/tzFormat";
import Skeleton from "@/components/ui/Skeleton";
import RefreshButton from "@/components/ui/RefreshButton";
import DesktopOnly from "@/components/ui/DesktopOnly";
import { usePageTopBar } from "@/lib/mobileTopBar";
import { useToast } from "@/hooks/useToast";
import { getErrorMessage } from "@/lib/errorMessage";
import { useNow } from "@/lib/useNow";

const HISTORY_STATUSES = ["completed", "cancelled", "no_show", "finalized"];

// ─── Modal Cancelar ───────────────────────────────────────────────────────────
function CancelModal({
  classId,
  classDate,
  cohortId,
  onClose,
  onSaved,
}: {
  classId: number;
  classDate: string;
  cohortId?: number | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isGroup = !!cohortId;
  const [cancelling, setCancelling] = useState(false);
  const [error, setError]           = useState("");
  const [left, setLeft]             = useState(false);
  const router = useRouter();
  const toast = useToast();

  const cancel = async () => {
    setCancelling(true);
    setError("");
    try {
      if (isGroup) {
        // Salir de UNA sesión no basta: sale del grupo por completo,
        // liberando su cupo en todas las sesiones futuras de la cohorte.
        await api.post(`/cohorts/${cohortId}/leave`);
        setLeft(true);
        toast.success("Has salido del grupo correctamente");
        onSaved();
      } else {
        await api.delete(`/classes/${classId}`);
        toast.success("Clase cancelada correctamente");
        onSaved();
        onClose();
      }
    } catch (e) {
      setError(getErrorMessage(e, "Error cancelando la clase"));
    } finally {
      setCancelling(false);
    }
  };

  const dateFormatted = formatDateHumanTz(classDate, getMyDisplayTimezone());

  // Paso 2 (solo grupal): ya salió del grupo — ofrecer elegir nuevo paquete
  if (left) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
        <div className="relative w-full max-w-sm bg-white/95 backdrop-blur-2xl
                        rounded-[2.5rem] shadow-2xl shadow-slate-200/60
                        border border-white p-8
                        animate-in fade-in zoom-in-95 duration-200">
          <div className="flex flex-col items-center text-center mb-6">
            <div className="w-14 h-14 bg-emerald-100 rounded-full flex items-center justify-center mb-4">
              <Check className="w-7 h-7 text-emerald-500" />
            </div>
            <h2 className="text-xl font-black text-slate-800 tracking-tight mb-2">
              Saliste del grupo
            </h2>
            <p className="text-sm text-slate-500">
              Ya no formas parte de esa cohorte. Cuando quieras, puedes elegir un
              nuevo paquete individual o unirte a otro grupo.
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 py-3 text-sm font-bold text-slate-600
                         bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
            >
              Ahora no
            </button>
            <button
              onClick={() => router.push("/dashboard/schedule")}
              className="flex-1 py-3 text-sm font-bold text-white bg-emerald-500
                         hover:bg-emerald-600 rounded-xl shadow-md shadow-emerald-100
                         active:scale-[0.98] transition-all duration-200"
            >
              Elegir paquete
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
           onClick={onClose} />
      <div className="relative w-full max-w-sm bg-white/95 backdrop-blur-2xl
                      rounded-[2.5rem] shadow-2xl shadow-slate-200/60
                      border border-white p-8
                      animate-in fade-in zoom-in-95 duration-200">

        <div className="absolute top-0 right-0 w-40 h-40 bg-red-300/20
                        rounded-full blur-[60px] pointer-events-none" />

        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-14 h-14 bg-red-100 rounded-full flex items-center
                          justify-center mb-4">
            <AlertCircle className="w-7 h-7 text-red-500" />
          </div>
          <h2 className="text-xl font-black text-slate-800 tracking-tight mb-2">
            {isGroup ? "¿Salir del grupo?" : "¿Cancelar clase?"}
          </h2>
          <p className="text-sm text-slate-500">
            {isGroup ? (
              <>
                Esto te saca de <span className="font-bold text-slate-700">todo el grupo</span>,
                no solo de la clase del{" "}
                <span className="font-bold text-slate-700 capitalize">{dateFormatted}</span>.
                Perderás tu cupo en todas las próximas sesiones de esta cohorte.
                Podrás elegir un nuevo paquete después. Esta acción no se puede deshacer.
              </>
            ) : (
              <>
                La clase del{" "}
                <span className="font-bold text-slate-700 capitalize">{dateFormatted}</span>{" "}
                será cancelada. Esta acción no se puede deshacer.
              </>
            )}
          </p>
        </div>

        {error && (
          <div className="mb-4 bg-rose-50 border border-rose-100 text-rose-600
                          px-4 py-3 rounded-xl text-xs font-bold
                          flex items-center gap-2">
            <X className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-3 text-sm font-bold text-slate-600
                       bg-slate-100 hover:bg-slate-200 rounded-xl
                       transition-colors"
          >
            Volver
          </button>
          <button
            onClick={cancel}
            disabled={cancelling}
            className="flex-1 py-3 text-sm font-bold text-white bg-red-500
                       hover:bg-red-600 rounded-xl shadow-md shadow-red-100
                       active:scale-[0.98] transition-all duration-200
                       disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {cancelling ? (
              <div className="w-4 h-4 border-2 border-white/40
                              border-t-white rounded-full animate-spin" />
            ) : (
              <><X className="w-4 h-4" /> {isGroup ? "Salir del grupo" : "Cancelar clase"}</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function toUtcDateStr(date: Date) {
  return date.toISOString().split("T")[0];
}

function getWeekDates() {
  const today = new Date();
  const monday = new Date(today);
  monday.setUTCDate(today.getUTCDate() - today.getUTCDay() + 1);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setUTCDate(monday.getUTCDate() + i);
    return d;
  });
}

const WEEK_DAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const MONTHS = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

function DatePickerCalendar({
  value,
  onSelect,
  onClose,
}: {
  value: string;
  onSelect: (d: string) => void;
  onClose: () => void;
}) {
  const initial = value ? new Date(value + "T00:00:00Z") : new Date();
  const [year, setYear] = useState(initial.getUTCFullYear());
  const [month, setMonth] = useState(initial.getUTCMonth());

  const firstDay = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const offset = (firstDay + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells = Array.from({ length: offset + daysInMonth }, (_, i) => (i < offset ? null : i - offset + 1));

  const todayStr = toUtcDateStr(new Date());

  const select = (day: number) => {
    const d = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    onSelect(d);
    onClose();
  };

  return (
    <div className="absolute right-0 top-full z-50 mt-2 w-72 max-w-[calc(100vw-2rem)] bg-white rounded-2xl shadow-2xl shadow-slate-300/50 border border-slate-100 p-4 animate-in fade-in zoom-in-95 duration-150">
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={() => { if (month === 0) { setMonth(11); setYear(y => y - 1); } else setMonth(m => m - 1); }}
          className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors"
        >
          <ChevronLeft className="w-4 h-4 text-slate-600" />
        </button>
        <span className="text-sm font-black text-slate-800">{MONTHS[month]} {year}</span>
        <button
          onClick={() => { if (month === 11) { setMonth(0); setYear(y => y + 1); } else setMonth(m => m + 1); }}
          className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors"
        >
          <ChevronRight className="w-4 h-4 text-slate-600" />
        </button>
      </div>
      <div className="grid grid-cols-7 mb-1">
        {["L","M","X","J","V","S","D"].map(d => (
          <div key={d} className="text-center text-[10px] font-black text-slate-400 uppercase tracking-widest py-1">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, i) => {
          if (!day) return <div key={i} />;
          const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const isSelected = dateStr === value;
          const isToday = dateStr === todayStr;
          return (
            <button
              key={i}
              onClick={() => select(day)}
              className={`
                w-full aspect-square rounded-lg text-xs font-bold transition-all duration-150
                ${isSelected
                  ? "bg-gradient-to-br from-pink-500 to-rose-400 text-white shadow-md"
                  : isToday
                    ? "bg-pink-50 text-pink-600 border border-pink-200"
                    : "text-slate-700 hover:bg-pink-50 hover:text-pink-600"}
              `}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────
export default function MyClassesPage() {
  const [tab, setTab] = useState<"upcoming" | "history">("upcoming");
  const [rescheduleTarget, setRescheduleTarget] = useState<StudentClass | null>(null);
  const [cancelTarget, setCancelTarget] = useState<{
    id: number; date: string; cohortId: number | null;
  } | null>(null);

  const weekDates = getWeekDates();
  const todayStr = toUtcDateStr(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [showCalendar, setShowCalendar] = useState(false);

  // Se pide siempre el historial completo (una sola query key) para que
  // "Próximas" e "Historial" lean del mismo dataset. Antes, cada tab usaba
  // una query distinta (includeHistory=false / true); al cambiar de tab se
  // mostraban datos de una caché diferente -y potencialmente desactualizada-
  // porque refetch() sólo refresca la query activa, causando que el conteo
  // de "Próximas" fluctuara al alternar entre tabs.
  const { classes, loading, isFetching, refetch } = useStudentClasses(true);

  usePageTopBar({
    title: "Mis Clases",
    onRefresh: refetch,
    isFetching,
  });

  const safeClasses = Array.isArray(classes) ? classes : [];

  // Mismo criterio que usa el backend para "próximas": estado no finalizado
  // Y que todavía no haya empezado. Sin el chequeo de fecha, una clase que
  // ya arrancó pero aún no fue finalizada por el backend se contaría como
  // "próxima" en este tab aunque el backend ya no la considere así.
  const now = useNow();
  const upcomingAll = safeClasses.filter(
    c => !HISTORY_STATUSES.includes(c.status) &&
      new Date(c.start_time_utc).getTime() >= now
  ).sort((a, b) =>
    new Date(a.start_time_utc).getTime() -
    new Date(b.start_time_utc).getTime()
  );

  const history = safeClasses.filter(
    c => HISTORY_STATUSES.includes(c.status)
  ).sort((a, b) =>
    new Date(b.start_time_utc).getTime() -
    new Date(a.start_time_utc).getTime()
  );

  const upcomingFiltered = selectedDate
    ? upcomingAll.filter(c => c.start_time_utc.slice(0, 10) === selectedDate)
    : upcomingAll;

  const displayed = tab === "upcoming" ? upcomingFiltered : history;

  return (
    <>
    <div className="min-h-screen bg-slate-50 relative overflow-hidden">

      <div className="fixed top-[-80px] right-[-80px] w-[500px] h-[500px]
                      bg-pink-300/20 rounded-full blur-[100px]
                      pointer-events-none" />
      <div className="fixed bottom-[-80px] left-[-80px] w-[400px] h-[400px]
                      bg-purple-300/15 rounded-full blur-[100px]
                      pointer-events-none" />

      <div className="relative space-y-6">

        <div className="flex items-center justify-between gap-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div>
            <h1 className="text-3xl font-black text-slate-800 tracking-tight">
              Mis Clases
            </h1>
            <p className="text-slate-500 mt-1">
              Gestiona tus sesiones activas e historial
            </p>
          </div>
          <DesktopOnly>
            <RefreshButton onRefresh={refetch} isFetching={isFetching} />
          </DesktopOnly>
        </div>

        {/* Selector de semana + calendario específico */}
        <div className="bg-slate-50/50 p-4 rounded-2xl border border-pink-50 relative z-20
                        animate-in fade-in slide-in-from-bottom-4 duration-500 delay-75">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-pink-400 uppercase tracking-widest font-bold">
              Semana actual
            </p>
            <div className="relative">
              <button
                onClick={() => setShowCalendar(p => !p)}
                className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-pink-600
                          bg-white border border-slate-200 hover:border-pink-300 px-3 py-1.5 rounded-xl
                          transition-colors"
              >
                <Calendar className="w-3.5 h-3.5" />
                Elegir fecha
              </button>
              {showCalendar && (
                <DatePickerCalendar
                  value={selectedDate ?? todayStr}
                  onSelect={(d) => { setSelectedDate(d); setTab("upcoming"); }}
                  onClose={() => setShowCalendar(false)}
                />
              )}
            </div>
          </div>

          <div className="flex gap-2 overflow-x-auto pb-2">
            {weekDates.map((date) => {
              const dateStr = toUtcDateStr(date);
              const isToday = dateStr === todayStr;
              const isSelected = dateStr === selectedDate;
              const dayIdx = (date.getUTCDay() + 6) % 7;

              return (
                <button
                  key={dateStr}
                  onClick={() => { setSelectedDate(dateStr); setTab("upcoming"); }}
                  className={`
                    flex-shrink-0 flex flex-col items-center px-4 py-3
                    rounded-2xl text-xs transition-all duration-300 shadow-sm
                    ${isSelected
                      ? "bg-gradient-to-br from-pink-500 to-rose-400 text-white shadow-pink-200 shadow-md scale-105 transform"
                      : isToday
                        ? "bg-pink-50 text-pink-600 border border-pink-200 hover:bg-pink-100"
                        : "bg-white text-slate-500 hover:text-pink-500 hover:bg-pink-50/50 border border-slate-100"
                    }
                  `}
                >
                  <span className="font-medium">{WEEK_DAYS[dayIdx]}</span>
                  <span className={`text-lg font-bold mt-1 ${isSelected ? "text-white" : "text-slate-700"} ${isToday && !isSelected ? "text-pink-600" : ""}`}>
                    {date.getUTCDate()}
                  </span>
                </button>
              );
            })}
          </div>

          {selectedDate && (
            <div className="flex items-center gap-2 mt-3 flex-wrap">
              <span className="text-xs font-bold text-slate-500 bg-white px-3 py-1.5 rounded-full border border-slate-100 capitalize">
                Mostrando: {new Date(selectedDate + "T00:00:00Z").toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })}
              </span>
              <button
                onClick={() => setSelectedDate(null)}
                className="flex items-center gap-1 text-xs font-bold text-pink-500 hover:text-pink-600 transition-colors"
              >
                <X className="w-3.5 h-3.5" /> Ver todas las próximas
              </button>
            </div>
          )}
        </div>
        <div className="flex gap-1 bg-white/80 backdrop-blur-xl border
                        border-white rounded-2xl p-1 w-fit shadow-lg
                        shadow-slate-100 animate-in fade-in duration-500
                        delay-100">
          {[
            { key: "upcoming", label: `Próximas (${upcomingAll.length})` },
            { key: "history",  label: "Historial" },
          ].map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key as "upcoming" | "history")}
              className={`
                px-5 py-2.5 rounded-xl text-sm font-bold
                transition-all duration-200
                ${tab === t.key
                  ? "bg-gradient-to-r from-pink-500 to-rose-400 text-white shadow-md"
                  : "text-slate-500 hover:text-slate-700"
                }
              `}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500
                        delay-150 space-y-3">
          {loading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-28 rounded-2xl" />
            ))
          ) : displayed.length === 0 ? (
          <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] border border-white shadow-lg py-16 text-center">
            <Calendar className="w-12 h-12 text-slate-200 mx-auto mb-3" />
            <p className="text-slate-500 font-bold">
              {tab === "upcoming"
                ? selectedDate
                  ? "No tienes clases ese día"
                  : "No tienes clases próximas"
                : "Sin historial todavía"}
            </p>
          </div>
          ) : (
            displayed.map(cls => (
              <ClassCard
                key={cls.id}
                class_={cls}
                role="student"
                onReschedule={() => setRescheduleTarget(cls)}
                onCancel={() =>
                  setCancelTarget({ id: cls.id, date: cls.start_time_utc, cohortId: cls.cohort_id ?? null })
                }
              />
            ))
          )}
        </div>
        
      </div>

      {rescheduleTarget && (
        <RescheduleModal
          classItem={{
            id: rescheduleTarget.id,
            subject: rescheduleTarget.subject,
            start_time_utc: rescheduleTarget.start_time_utc,
            duration_minutes: rescheduleTarget.duration_minutes,
            counterpart_name: rescheduleTarget.teacher_name,
            classType: rescheduleTarget.class_type,
            status: rescheduleTarget.status,
          }}
          teacherUsername={rescheduleTarget.teacher_username}
          endpoint={`/classes/${rescheduleTarget.id}/reschedule`}
          onClose={() => setRescheduleTarget(null)}
          onSaved={refetch}
        />
      )}
      {cancelTarget && (
        <CancelModal
          classId={cancelTarget.id}
          classDate={cancelTarget.date}
          cohortId={cancelTarget.cohortId}
          onClose={() => setCancelTarget(null)}
          onSaved={refetch}
        />
      )}
    </div>
    <ChipiWidget screenName="my_classes_student" />
    </>
  );
}