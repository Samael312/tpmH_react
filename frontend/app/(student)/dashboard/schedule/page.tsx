"use client";

import { useState, useEffect } from "react";
import { useAvailableSlots, useEnrollments, useMyTeachers, useStudentClasses } from "@/hooks/useStudentData";
import {
  Calendar, Clock, CreditCard,
  Check, X, ChevronLeft,
  ChevronRight, AlertCircle, AlertTriangle,
  Sparkles, Package as PackageIcon, Hourglass,
} from "lucide-react";
import api from "@/lib/api";
import Link from "next/link";
import ChipiWidget from "@/components/chipi/ChipiWidget";
import PackageCheckout from "@/components/payments/PackageCheckout";
import { formatTimeTz, formatDateHumanTz, getHourMinuteTz, getMyDisplayTimezone } from "@/lib/tzFormat";
import { priceLabelSuffix } from "@/lib/packageThemes";
import PaymentMethodsInfo from "@/components/payments/PaymentMethodsInfo";

type BookingStage =
  | "loading"
  | "needs_trial"
  | "trial_in_progress"
  | "needs_package"
  | "package_pending_payment"
  | "needs_payment"
  | "needs_renewal"
  | "renew_required"
  | "renewal_pending"
  | "ready";

const DURATIONS = [
  { value: 30, label: "30 min" },
  { value: 60, label: "1 hora" },
];

function extractErrorMessage(e: any, fallback: string): string {
  const detail = e?.response?.data?.detail;
  if (Array.isArray(detail)) {
    return detail.map((d: any) => d?.msg ?? JSON.stringify(d)).join(", ");
  }
  if (typeof detail === "string") {
    return detail;
  }
  return fallback;
}

// ─── Mini calendario ──────────────────────────────────────────────────────────
function MiniCalendar({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());

  const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
  const DAYS = ["L", "M", "X", "J", "V", "S", "D"];

  const firstDay = new Date(year, month, 1).getDay();
  const offset = (firstDay + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = Array.from(
    { length: offset + daysInMonth },
    (_, i) => (i < offset ? null : i - offset + 1)
  );

  const prev = () => {
    if (month === 0) { setMonth(11); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  };
  const next = () => {
    if (month === 11) { setMonth(0); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  };

  return (
    <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] border border-white shadow-2xl shadow-slate-200/50 p-6">
      <div className="flex items-center justify-between mb-5">
        <button onClick={prev} className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors">
          <ChevronLeft className="w-4 h-4 text-slate-600" />
        </button>
        <span className="text-base font-black text-slate-800">
          {MONTHS[month]} {year}
        </span>
        <button onClick={next} className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors">
          <ChevronRight className="w-4 h-4 text-slate-600" />
        </button>
      </div>

      <div className="grid grid-cols-7 mb-2">
        {DAYS.map(d => (
          <div key={d} className="text-center text-[10px] font-black text-slate-400 uppercase tracking-widest py-1">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, i) => {
          if (!day) return <div key={i} />;
          const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const isSelected = dateStr === value;
          const isPast = new Date(dateStr) < new Date(today.toDateString());
          const isToday = dateStr === today.toISOString().split("T")[0];

          return (
            <button
              key={i}
              disabled={isPast}
              onClick={() => onChange(dateStr)}
              className={`
                w-full aspect-square rounded-xl text-sm font-bold
                transition-all duration-150
                ${isSelected
                  ? "bg-gradient-to-br from-pink-500 to-rose-400 text-white shadow-md shadow-pink-100"
                  : isPast
                    ? "text-slate-300 cursor-not-allowed"
                    : isToday
                      ? "bg-pink-50 text-pink-600 border-2 border-pink-200"
                      : "text-slate-700 hover:bg-pink-50 hover:text-pink-600"
                }
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

// ─── Paso: Seleccionar slot ───────────────────────────────────────────────────
function StepSelectSlot({
  onSelect,
  teacherUsername,
  isTrial = false,
}: {
  onSelect: (date: string, slot: any, duration: number, subject?: string) => void;
  teacherUsername: string | null;
  isTrial?: boolean;
}) {
  const [date, setDate] = useState("");
  const [duration, setDuration] = useState(isTrial ? 30 : 60);
  const [subjectOptions, setSubjectOptions] = useState<string[]>([]);
  const [selectedSubject, setSelectedSubject] = useState<string>("");
  const { slots, loading } = useAvailableSlots(date, duration, teacherUsername);
  const myTz = getMyDisplayTimezone();

  useEffect(() => {
    if (!isTrial || !teacherUsername) return;
    api.get(`/teachers/${teacherUsername}`).then(res => {
      const opts = [...(res.data.subjects || []), ...(res.data.languages || [])];
      setSubjectOptions(opts);
      setSelectedSubject(opts[0] || "");
    }).catch(() => setSubjectOptions([]));
  }, [isTrial, teacherUsername]);

  const formatTime = (utc: string) => formatTimeTz(utc, myTz);

  const isPreferredSlot = (slot: any) => {
    if (slot.is_preferred) return true;
    const { hour, minute } = getHourMinuteTz(slot.start_time_utc, myTz);
    const totalMinutes = hour * 60 + minute;
    return totalMinutes >= 18 * 60 && totalMinutes < 22 * 60;
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="space-y-5">
        {isTrial && subjectOptions.length > 1 && (
          <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] border border-white shadow-xl shadow-slate-200/50 p-6">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">
              ¿Qué quieres practicar en esta clase?
            </p>
            <div className="flex flex-wrap gap-2">
              {subjectOptions.map(s => (
                <button
                  key={s}
                  onClick={() => setSelectedSubject(s)}
                  className={`px-4 py-2 rounded-xl text-sm font-bold border-2 transition-all duration-200 ${
                    selectedSubject === s
                      ? "border-pink-400 bg-pink-50 text-pink-600"
                      : "border-transparent bg-slate-100 text-slate-500 hover:border-slate-200"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        <MiniCalendar value={date} onChange={setDate} />

        {!isTrial && (
          <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] border border-white shadow-xl shadow-slate-200/50 p-6">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">
              Duración de la clase
            </p>
            <div className="flex gap-2">
              {DURATIONS.map(d => (
                <button
                  key={d.value}
                  onClick={() => setDuration(d.value)}
                  className={`flex-1 py-2.5 rounded-xl text-xs font-bold border-2 transition-all duration-200 ${
                    duration === d.value
                      ? "border-pink-400 bg-pink-50 text-pink-600"
                      : "border-transparent bg-slate-100 text-slate-500 hover:border-slate-200"
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {isTrial && (
          <div className="bg-purple-50 border border-purple-100 rounded-2xl p-5 flex gap-3 items-start">
            <Sparkles className="w-5 h-5 text-purple-400 flex-shrink-0 mt-0.5" />
            <p className="text-sm font-bold text-purple-700 leading-relaxed">
              Tu primera clase es una prueba gratuita de 30 minutos. Una vez
              completada, podrás elegir tu paquete de clases regulares.
            </p>
          </div>
        )}
      </div>

      <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] border border-white shadow-2xl shadow-slate-200/50 p-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
            Horarios disponibles
            {date && (
              <span className="ml-2 text-slate-300 normal-case font-bold">
                — {new Date(date + "T00:00:00").toLocaleDateString("es", {
                  weekday: "long", day: "numeric", month: "long",
                })}
              </span>
            )}
          </p>
        </div>

        {!date ? (
          <div className="flex flex-col items-center justify-center py-16">
            <Calendar className="w-12 h-12 text-slate-200 mb-3" />
            <p className="text-slate-400 font-bold text-sm">
              Selecciona una fecha
            </p>
          </div>
        ) : loading ? (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-4 border-pink-200 border-t-pink-500 rounded-full animate-spin" />
          </div>
        ) : slots.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <AlertCircle className="w-12 h-12 text-slate-200 mb-3" />
            <p className="text-slate-400 font-bold text-sm text-center">
              No hay disponibilidad para esta fecha
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 max-h-[400px] overflow-y-auto pr-1 pt-3">
            {slots.map((slot, i) => {
              const preferred = isPreferredSlot(slot);
              const blocked = !slot.is_available || slot.is_past;

              return (
                <button
                  key={i}
                  onClick={() => !blocked && onSelect(date, slot, duration, isTrial ? selectedSubject : undefined)}
                  disabled={blocked}
                  className={`
                    relative py-4 px-3 rounded-2xl text-center border-2 transition-all duration-200
                    ${blocked
                      ? "border-slate-100 bg-slate-50 opacity-50 cursor-not-allowed"
                      : "hover:-translate-y-0.5 hover:shadow-md " +
                        (preferred
                          ? "border-purple-300 bg-purple-50/80 hover:border-purple-400 shadow-sm shadow-purple-100"
                          : "border-slate-100 bg-white hover:border-pink-300")
                    }
                  `}
                >
                  {preferred && !blocked && (
                    <div className="absolute -top-2 left-1/2 -translate-x-1/2 bg-purple-500 text-white text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full shadow-sm">
                      Preferido
                    </div>
                  )}
                  {blocked && (
                    <div className="absolute -top-2 left-1/2 -translate-x-1/2 bg-slate-400 text-white text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full shadow-sm">
                      {slot.is_past ? "Pasado" : "Ocupado"}
                    </div>
                  )}
                  <Clock className={`w-4 h-4 mx-auto mb-1.5 ${blocked ? "text-slate-300" : preferred ? "text-purple-500" : "text-slate-400"}`} />
                  <p className={`text-base font-black ${blocked ? "text-slate-400" : preferred ? "text-purple-800" : "text-slate-800"}`}>
                    {formatTime(slot.start_time_utc)}
                  </p>
                  <p className="text-[10px] text-slate-400 font-bold mt-0.5">
                    hasta {formatTime(slot.end_time_utc)}
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Paso: Confirmar clase de prueba ──────────────────────────────────────────
function StepConfirmTrial({
  date,
  slot,
  teacherUsername,
  subject,
  onBack,
  onBooked,
}: {
  date: string;
  slot: any;
  teacherUsername: string | null;
  subject?: string;
  onBack: () => void;
  onBooked: () => void;
}) {
  const [booking, setBooking] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const myTz = getMyDisplayTimezone();
  const fmtDate = formatDateHumanTz(date + "T00:00:00", myTz); 
  const fmtTime = formatTimeTz(slot.start_time_utc, myTz);

  const confirmTrial = async () => {
    setBooking(true);
    setError("");
    try {
      await api.post("/payments/book", {
        teacher_username: teacherUsername,
        start_time_utc: slot.start_time_utc,
        end_time_utc: slot.end_time_utc,
        duration_minutes: 30,
        subject,
      });
      setDone(true);
      setTimeout(onBooked, 2000);
    } catch (e: any) {
      setError(extractErrorMessage(e, "Error reservando la clase de prueba"));
    } finally {
      setBooking(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto space-y-5">
      <div className="bg-gradient-to-r from-purple-500 to-pink-500 rounded-[2rem] p-6 text-white relative overflow-hidden shadow-xl shadow-purple-200">
        <div className="absolute top-[-30px] right-[-30px] w-32 h-32 bg-white/10 rounded-full blur-xl" />
        <p className="text-[10px] font-black uppercase tracking-widest text-white/70 mb-2 flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5" /> Clase de prueba gratuita
        </p>
        <p className="text-2xl font-black capitalize">{fmtDate}</p>
        <div className="flex items-center gap-3 mt-2 flex-wrap">
          <span className="flex items-center gap-1.5 bg-white/20 px-3 py-1.5 rounded-full text-sm font-bold">
            <Clock className="w-3.5 h-3.5" />
            {fmtTime}
          </span>
          <span className="bg-white/20 px-3 py-1.5 rounded-full text-sm font-bold">
            30 min
          </span>
          {subject && (
            <span className="bg-white/20 px-3 py-1.5 rounded-full text-sm font-bold">
              {subject}
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-100 text-rose-600 px-4 py-3 rounded-xl text-xs font-bold flex items-center gap-2">
          <X className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {done ? (
        <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] border border-white shadow-2xl p-10 text-center">
          <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Check className="w-8 h-8 text-emerald-600" />
          </div>
          <h3 className="text-xl font-black text-slate-800 mb-2">¡Prueba reservada!</h3>
          <p className="text-slate-500 text-sm">Prepárate para tu clase de prueba gratuita.</p>
        </div>
      ) : (
        <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] border border-white shadow-2xl shadow-slate-200/50 p-6 space-y-4">
          <p className="text-sm text-slate-500 leading-relaxed">
            Esta clase de prueba es completamente gratuita y no requiere pago.
            Solo confirma el horario para reservarla.
          </p>
          <div className="flex gap-3">
            <button onClick={onBack} className="flex-1 py-3.5 text-sm font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors">
              Volver
            </button>
            <button
              onClick={confirmTrial}
              disabled={booking}
              className="flex-1 py-3.5 text-sm font-bold text-white rounded-xl bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 shadow-lg shadow-purple-200 active:scale-[0.98] transition-all duration-300 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {booking ? (
                <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              ) : (
                <><Sparkles className="w-4 h-4" /> Confirmar clase de prueba</>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Paso: Confirmar y pagar (Clase Suelta / Créditos) ───────────────────────
function StepPayment({
  date, slot, duration, enrollmentId, teacherUsername, onBack, onSuccess,
}: {
  date: string; slot: any; duration: number;
  enrollmentId?: number; teacherUsername: string | null;
  onBack: () => void; onSuccess: () => void;
}) {
  const [reference, setReference] = useState("");
  const [booking, setBooking] = useState(false);
  const [classId, setClassId] = useState<number | null>(null);
  const [notifying, setNotifying] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const myTz = getMyDisplayTimezone();
  const fmtDate = formatDateHumanTz(date + "T00:00:00", myTz);
  const fmtTime = formatTimeTz(slot.start_time_utc, myTz);

  const bookSlot = async () => {
    setBooking(true);
    setError("");
    try {
      const res = await api.post("/payments/book", {
        ...(enrollmentId ? { enrollment_id: enrollmentId } : { teacher_username: teacherUsername }),
        start_time_utc: slot.start_time_utc,
        end_time_utc: slot.end_time_utc,
        duration_minutes: duration,
      });
      if (res.data.status === "confirmed") {
        setDone(true);
        setTimeout(onSuccess, 1500);
        return;
      }
      setClassId(res.data.class_id);
    } catch (e: any) {
      setError(extractErrorMessage(e, "Error reservando el horario"));
    } finally {
      setBooking(false);
    }
  };

  const notify = async () => {
    if (!classId) return;
    setNotifying(true);
    setError("");
    try {
      await api.post("/payments/notify-payment", {
        type: "single_class",
        class_id: classId,
        transaction_reference: reference.trim() || undefined,
      });
      setDone(true);
      setTimeout(onSuccess, 1500);
    } catch (e: any) {
      setError(extractErrorMessage(e, "Error notificando el pago"));
    } finally {
      setNotifying(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto space-y-5">
      <div className="bg-gradient-to-r from-pink-500 to-rose-400 rounded-[2rem] p-6 text-white relative overflow-hidden shadow-xl shadow-pink-200">
        <div className="absolute top-[-30px] right-[-30px] w-32 h-32 bg-white/10 rounded-full blur-xl" />
        <p className="text-[10px] font-black uppercase tracking-widest text-white/70 mb-2">Clase seleccionada</p>
        <p className="text-2xl font-black capitalize">{fmtDate}</p>
        <div className="flex items-center gap-3 mt-2 flex-wrap">
          <span className="flex items-center gap-1.5 bg-white/20 px-3 py-1.5 rounded-full text-sm font-bold">
            <Clock className="w-3.5 h-3.5" /> {fmtTime}
          </span>
          <span className="bg-white/20 px-3 py-1.5 rounded-full text-sm font-bold">{duration} min</span>
        </div>
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-100 text-rose-600 px-4 py-3 rounded-xl text-xs font-bold flex items-center gap-2">
          <X className="w-4 h-4 flex-shrink-0" /> {error}
        </div>
      )}

      {done ? (
        <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] border border-white shadow-2xl p-10 text-center">
          <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Check className="w-8 h-8 text-emerald-600" />
          </div>
          <h3 className="text-xl font-black text-slate-800 mb-2">
            {classId ? "¡Pago notificado!" : "¡Clase confirmada!"}
          </h3>
          <p className="text-slate-500 text-sm">
            {classId
              ? "Tu profesor(a) validará el pago pronto. Tienes una ventana de tiempo limitada — revisa el estado en Mis Clases."
              : "Tu clase quedó agendada usando tus créditos disponibles."}
          </p>
        </div>
      ) : !classId ? (
        <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] border border-white shadow-2xl shadow-slate-200/50 p-6 space-y-4">
          <p className="text-sm text-slate-500 leading-relaxed">
            Confirma este horario para reservarlo.
          </p>
          <div className="flex gap-3">
            <button onClick={onBack} className="flex-1 py-3.5 text-sm font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors">
              Volver
            </button>
            <button
              onClick={bookSlot}
              disabled={booking}
              className="flex-1 py-3.5 text-sm font-bold text-white rounded-xl bg-gradient-to-r from-pink-500 to-rose-400 hover:from-pink-600 hover:to-rose-500 shadow-lg shadow-pink-200 active:scale-[0.98] transition-all duration-300 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {booking ? <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : <><CreditCard className="w-4 h-4" /> Reservar</>}
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] border border-white shadow-2xl shadow-slate-200/50 p-6 space-y-5">
          <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4">
            <p className="text-xs font-bold text-amber-700 leading-relaxed">
              Tu slot está reservado temporalmente. Realiza el pago por tu método habitual
              y confirma abajo — tienes una ventana de tiempo limitada antes de que se libere.
            </p>
          </div>

          <PaymentMethodsInfo />

          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">
              Referencia de transacción (opcional)
            </label>
            <input
              value={reference}
              onChange={e => setReference(e.target.value)}
              placeholder="Ej: últimos 4 dígitos, ID de transferencia..."
              className="w-full bg-slate-50 border-2 border-transparent rounded-xl text-sm font-bold text-slate-800 placeholder:text-slate-400 px-4 py-3.5 focus:outline-none focus:bg-white focus:border-pink-500 focus:ring-4 focus:ring-pink-50 transition-all duration-300"
            />
          </div>

          <button
            onClick={notify}
            disabled={notifying}
            className="w-full py-3.5 text-sm font-bold text-white rounded-xl bg-gradient-to-r from-pink-500 to-rose-400 hover:from-pink-600 hover:to-rose-500 shadow-lg shadow-pink-200 active:scale-[0.98] transition-all duration-300 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {notifying ? <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : <><Check className="w-4 h-4" /> Ya realicé el pago</>}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Pantalla: prueba pendiente ──────────────────────────────────────────────
function TrialInProgressScreen() {
  return (
    <div className="max-w-lg mx-auto">
      <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] border border-white shadow-2xl shadow-slate-200/50 p-10 text-center">
        <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <Hourglass className="w-8 h-8 text-amber-500" />
        </div>
        <h3 className="text-xl font-black text-slate-800 mb-2">Tienes una clase de prueba pendiente</h3>
        <p className="text-slate-500 text-sm leading-relaxed">
          Ya reservaste tu clase de prueba gratuita. Una vez que se complete, podrás elegir tu paquete y agendar más clases.
        </p>
      </div>
    </div>
  );
}

// ─── Pantalla: bloqueo package_pending_payment / needs_payment ────────────────
function PackagePendingPaymentScreen() {
  return (
    <div className="max-w-lg mx-auto">
      <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] border border-white shadow-2xl shadow-slate-200/50 p-10 text-center">
        <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <Hourglass className="w-8 h-8 text-amber-500" />
        </div>
        <h3 className="text-xl font-black text-slate-800 mb-2">Tu pago está en revisión</h3>
        <p className="text-slate-500 text-sm leading-relaxed">
          Ya notificaste tu comprobante de pago. Tu profesor(a) o el equipo lo confirmará
          en breve y tu calendario se desbloqueará automáticamente.
        </p>
      </div>
    </div>
  );
}

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  pending: { label: "Pendiente de pago", cls: "bg-amber-100 text-amber-700" },
  pending_payment: { label: "En revisión", cls: "bg-blue-100 text-blue-700" },
  confirmed: { label: "Confirmada", cls: "bg-emerald-100 text-emerald-700" },
  completed: { label: "Completada", cls: "bg-slate-100 text-slate-600" },
  cancelled: { label: "Cancelada", cls: "bg-red-100 text-red-600" },
  no_show: { label: "No asistió", cls: "bg-red-100 text-red-600" },
  finalized: { label: "Finalizada", cls: "bg-slate-100 text-slate-600" },
};

function EnrollmentClassesList({ classes }: { classes: any[] }) {
  const myTz = getMyDisplayTimezone();
  if (classes.length === 0) {
    return (
      <div className="bg-white/80 backdrop-blur-xl rounded-2xl border border-white shadow-lg p-6 text-center">
        <p className="text-sm text-slate-400 font-bold">Aún no has agendado clases con este paquete</p>
      </div>
    );
  }
  return (
    <div className="bg-white/80 backdrop-blur-xl rounded-2xl border border-white shadow-lg overflow-hidden">
      <div className="px-5 py-3.5 border-b border-slate-100">
        <p className="text-xs font-black text-slate-400 uppercase tracking-widest">
          Clases agendadas con este paquete ({classes.length})
        </p>
      </div>
      <div className="divide-y divide-slate-50 max-h-80 overflow-y-auto">
        {classes.map((c) => {
          const st = STATUS_LABELS[c.status] ?? { label: c.status, cls: "bg-slate-100 text-slate-500" };
          return (
            <div key={c.id} className="px-5 py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-bold text-slate-800 truncate capitalize">
                  {formatDateHumanTz(c.start_time_utc, myTz)}
                </p>
                <p className="text-xs text-slate-500">
                  {formatTimeTz(c.start_time_utc, myTz)} · {c.duration_minutes ?? 60} min
                  {c.subject ? ` · ${c.subject}` : ""}
                </p>
              </div>
              <span className={`text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full flex-shrink-0 ${st.cls}`}>
                {st.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Pantalla: elegir paquete inicial ────────────────────────────────────────
function NeedsPackageScreen({ teacherUsername, onSelected }: { teacherUsername: string | null; onSelected: () => void }) {
  const [packages, setPackages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [checkoutTarget, setCheckoutTarget] = useState<{ pkg: any; enrollmentId: number | null } | null>(null);

  useEffect(() => {
    if (!teacherUsername) { setLoading(false); return; }
    api.get(`/packages/teacher/${teacherUsername}`)
      .then(res => setPackages(res.data))
      .catch(() => setPackages([]))
      .finally(() => setLoading(false));
  }, [teacherUsername]);

  const choose = (pkg: any) => {
    setError("");
    setCheckoutTarget({ pkg, enrollmentId: null });
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-5 flex gap-3 items-start">
        <Check className="w-5 h-5 text-emerald-500 flex-shrink-0 mt-0.5" />
        <p className="text-sm font-bold text-emerald-700 leading-relaxed">
          ¡Completaste tu clase de prueba! Elige un paquete para seguir agendando tus próximas clases.
        </p>
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-100 text-rose-600 px-4 py-3 rounded-xl text-xs font-bold flex items-center gap-2">
          <X className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[1, 2].map(i => (
            <div key={i} className="h-40 bg-white rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : packages.length === 0 ? (
        <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] border border-white shadow-lg py-16 text-center">
          <PackageIcon className="w-10 h-10 text-slate-200 mx-auto mb-3" />
          <p className="text-slate-500 font-bold">No hay paquetes disponibles. Contacta al staff.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {packages.map(pkg => {
            const accent = pkg.color || "#ec4899";
            const priceSuffix = priceLabelSuffix(pkg.classes_count);
            const priceDisplay = pkg.price?.toFixed
              ? (Number.isInteger(pkg.price) ? pkg.price : pkg.price.toFixed(2))
              : pkg.price;
            const bullets: string[] =
              pkg.description_type === "list" && pkg.description_items?.length
                ? pkg.description_items
                : [
                    pkg.classes_count == null ? "Clases ilimitadas" : `${pkg.classes_count} clases`,
                    `${pkg.duration_minutes} min por clase`,
                    "Modalidad 100% online",
                    ...(pkg.description ? [pkg.description] : []),
                  ];

            return (
              <div
                key={pkg.id}
                className="bg-white rounded-[2rem] border border-slate-100 shadow-lg shadow-slate-100 p-6 flex flex-col hover:-translate-y-1 hover:shadow-xl transition-all duration-300"
              >
                <div className="mb-4">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-lg">{pkg.icon || "📦"}</span>
                    <h3 className="text-lg font-black" style={{ color: accent }}>{pkg.name}</h3>
                  </div>
                  <p className="text-xs text-slate-400 font-bold mb-2">{pkg.subject}</p>
                  <div className="flex items-baseline gap-1">
                    <span className="text-4xl font-black text-slate-800">${priceDisplay}</span>
                    <span className="text-slate-500 text-sm font-medium">{priceSuffix}</span>
                    {pkg.allow_installments && pkg.installment_count && (
                      <p className="text-xs font-bold text-slate-400 mb-3 -mt-2">
                        O en {pkg.installment_count} cuotas de $ {(pkg.price / pkg.installment_count).toFixed(2)}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex-1 space-y-2.5 mb-5">
                  {bullets.slice(0, 6).map((item, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <Check className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: accent }} />
                      <span className="text-sm text-slate-600 font-medium">{item}</span>
                    </div>
                  ))}
                </div>

                <button
                  onClick={() => choose(pkg)}
                  className="mt-auto w-full py-3.5 text-sm font-bold text-center rounded-xl transition-all duration-200 active:scale-[0.97] text-white shadow-lg hover:shadow-xl flex items-center justify-center gap-2"
                  style={{ background: `linear-gradient(135deg, ${accent}, ${accent}cc)` }}
                >
                  Elegir este paquete
                </button>
              </div>
            );
          })}
        </div>
      )}

      {checkoutTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setCheckoutTarget(null)} />
          {/* Cambiado de max-w-md a max-w-4xl para aprovechar todo el ancho */}
          <div className="relative w-full max-w-4xl bg-white rounded-[2rem] shadow-2xl p-6 sm:p-8 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between mb-5 flex-shrink-0">
              <h2 className="text-lg font-black text-slate-800">Completar pago</h2>
              <button onClick={() => setCheckoutTarget(null)} className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center">
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>
            <div className="overflow-y-auto pr-2">
              <PackageCheckout
                pkg={checkoutTarget.pkg}
                mode="initial" // (o 'renewal' según corresponda en cada pantalla)
                enrollmentId={checkoutTarget.enrollmentId}
                installmentsPaid={0}
                onClose={() => setCheckoutTarget(null)}
                onDone={onSelected}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Pantalla: renovación requerida ─────────────────────────────────────────
function NeedsRenewalScreen({ teacherUsername, onRequested }: { teacherUsername: string | null; onRequested: () => void }) {
  const [packages, setPackages] = useState<any[]>([]);
  const [lastEnrollmentId, setLastEnrollmentId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [requesting] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [checkoutTarget, setCheckoutTarget] = useState<any>(null);

  useEffect(() => {
    if (!teacherUsername) { setLoading(false); return; }
    Promise.all([
      api.get(`/packages/teacher/${teacherUsername}`),
      api.get("/packages/my-enrollments"),
    ])
      .then(([pkgRes, enrRes]) => {
        setPackages(pkgRes.data);
        setLastEnrollmentId(enrRes.data?.[0]?.id ?? null);
      })
      .catch(() => { setPackages([]); setLastEnrollmentId(null); })
      .finally(() => setLoading(false));
  }, [teacherUsername]);

  const requestRenewal = (pkg: any) => {
    if (!lastEnrollmentId) return;
    setError("");
    setCheckoutTarget({ pkg, enrollmentId: lastEnrollmentId });
  };

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <div className="w-10 h-10 border-4 border-pink-200 border-t-pink-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="bg-amber-50 border border-amber-100 rounded-2xl p-5 flex gap-3 items-start">
        <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
        <p className="text-sm font-bold text-amber-700 leading-relaxed">
          Ya usaste todas las clases de tu paquete anterior. Elige tu siguiente
          paquete — tu profesor(a) confirmará el pago y lo activará.
        </p>
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-100 text-rose-600 px-4 py-3 rounded-xl text-xs font-bold flex items-center gap-2">
          <X className="w-4 h-4 flex-shrink-0" /> {error}
        </div>
      )}

      {packages.length === 0 ? (
        <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] border border-white shadow-lg py-16 text-center">
          <PackageIcon className="w-10 h-10 text-slate-200 mx-auto mb-3" />
          <p className="text-slate-500 font-bold">No hay paquetes disponibles. Contacta al staff.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {packages.map(pkg => {
            const accent = pkg.color || "#ec4899";
            const priceSuffix = priceLabelSuffix(pkg.classes_count);
            const priceDisplay = pkg.price?.toFixed
              ? (Number.isInteger(pkg.price) ? pkg.price : pkg.price.toFixed(2))
              : pkg.price;
            const bullets: string[] =
              pkg.description_type === "list" && pkg.description_items?.length
                ? pkg.description_items
                : [
                    pkg.classes_count == null ? "Clases ilimitadas" : `${pkg.classes_count} clases`,
                    `${pkg.duration_minutes} min por clase`,
                    "Modalidad 100% online",
                    ...(pkg.description ? [pkg.description] : []),
                  ];

            return (
              <div key={pkg.id} className="bg-white rounded-[2rem] border border-slate-100 shadow-lg shadow-slate-100 p-6 flex flex-col hover:-translate-y-1 hover:shadow-xl transition-all duration-300">
                <div className="mb-4">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-lg">{pkg.icon || "📦"}</span>
                    <h3 className="text-lg font-black" style={{ color: accent }}>{pkg.name}</h3>
                  </div>
                  <p className="text-xs text-slate-400 font-bold mb-2">{pkg.subject}</p>
                  <div className="flex items-baseline gap-1">
                    <span className="text-4xl font-black text-slate-800">${priceDisplay}</span>
                    <span className="text-slate-500 text-sm font-medium">{priceSuffix}</span>
                    {pkg.allow_installments && pkg.installment_count && (
                      <p className="text-[11px] font-bold text-slate-400 mt-1">
                        o en {pkg.installment_count} cuotas de $ {(pkg.price / pkg.installment_count).toFixed(2)}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex-1 space-y-2.5 mb-5">
                  {bullets.slice(0, 6).map((item, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <Check className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: accent }} />
                      <span className="text-sm text-slate-600 font-medium">{item}</span>
                    </div>
                  ))}
                </div>

                <button
                  onClick={() => requestRenewal(pkg)}
                  disabled={requesting !== null}
                  className="mt-auto w-full py-3.5 text-sm font-bold text-center rounded-xl transition-all duration-200 active:scale-[0.97] text-white shadow-lg hover:shadow-xl disabled:opacity-50 flex items-center justify-center gap-2"
                  style={{ background: `linear-gradient(135deg, ${accent}, ${accent}cc)` }}
                >
                  {requesting === pkg.id ? (
                    <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  ) : "Solicitar este paquete"}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {checkoutTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setCheckoutTarget(null)} />
          {/* Cambiado de max-w-md a max-w-4xl para aprovechar todo el ancho */}
          <div className="relative w-full max-w-4xl bg-white rounded-[2rem] shadow-2xl p-6 sm:p-8 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between mb-5 flex-shrink-0">
              <h2 className="text-lg font-black text-slate-800">Completar pago</h2>
              <button onClick={() => setCheckoutTarget(null)} className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center">
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>
            <div className="overflow-y-auto pr-2">
              <PackageCheckout
                pkg={checkoutTarget.pkg}
                mode="initial" // (o 'renewal' según corresponda en cada pantalla)
                enrollmentId={checkoutTarget.enrollmentId}
                installmentsPaid={0}
                onClose={() => setCheckoutTarget(null)}
                onDone={onRequested}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Pantalla: renovación en revisión ───────────────────────────────────────
function RenewalPendingScreen() {
  return (
    <div className="max-w-lg mx-auto">
      <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] border border-white shadow-2xl shadow-slate-200/50 p-10 text-center">
        <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <Hourglass className="w-8 h-8 text-amber-500" />
        </div>
        <h3 className="text-xl font-black text-slate-800 mb-2">Renovación en revisión</h3>
        <p className="text-slate-500 text-sm leading-relaxed">
          Ya enviaste tu solicitud de renovación. Tu profesor(a) confirmará tu
          pago y activará el nuevo paquete pronto.
        </p>
      </div>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────
export default function SchedulePage() {
  const [stage, setStage] = useState<BookingStage>("loading");
  const [enrollmentId, setEnrollmentId] = useState<number | null>(null);
  const [step, setStep] = useState<"select" | "payment">("select");
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedSlot, setSelectedSlot] = useState<any>(null);
  const [selectedDuration, setSelectedDuration] = useState(60);
  const [selectedSubject, setSelectedSubject] = useState<string | undefined>(undefined);
  const [selectedTeacherUsername, setSelectedTeacherUsername] = useState<string | null>(null);

  const { enrollments, refetch: refetchEnrollments } = useEnrollments();
  const { classes: allClasses, refetch: refetchClasses } = useStudentClasses(true);
  const { teachers: myTeachers, loading: teachersLoading, isSingleTenant } = useMyTeachers();

  const needsTeacherSelection = !isSingleTenant && myTeachers.length > 1 && !selectedTeacherUsername;
  const teacherBlocked = !teachersLoading && !isSingleTenant && myTeachers.length === 0;

  useEffect(() => {
    if (teachersLoading) return;
    if (myTeachers.length === 1) {
      setSelectedTeacherUsername(myTeachers[0].teacher_username);
      return;
    }
    if (isSingleTenant) {
      setSelectedTeacherUsername(null);
      return;
    }
  }, [teachersLoading, isSingleTenant, myTeachers]);

  const activeEnrollment = selectedTeacherUsername
    ? enrollments.find(e => e.status === "active" && e.teacher_username === selectedTeacherUsername)
    : enrollments.find(e => e.status === "active");

  const loadStage = () => {
    if (!isSingleTenant && !selectedTeacherUsername) { setStage("loading"); return; }
    const params = selectedTeacherUsername ? `?teacher_username=${selectedTeacherUsername}` : "";
    api.get(`/payments/booking-status${params}`)
      .then(res => {
        setStage(res.data.stage);
        if (res.data.enrollment_id) setEnrollmentId(res.data.enrollment_id);
      })
      .catch(() => setStage("ready"));
  };

  useEffect(() => { loadStage(); }, [selectedTeacherUsername, isSingleTenant]);

  const handleSlotSelect = (
    date: string, slot: any, duration: number, subject?: string
  ) => {
    setSelectedDate(date);
    setSelectedSlot(slot);
    setSelectedDuration(duration);
    setSelectedSubject(subject);
    setStep("payment");
  };

  const resetToSelect = () => {
    setStep("select");
    setSelectedDate("");
    setSelectedSlot(null);
    setSelectedSubject(undefined);
  };

  const handleBookingSuccess = () => {
    refetchEnrollments();
    refetchClasses();
    resetToSelect();
  };

  return (
    <>
    <div className="min-h-screen bg-slate-50 relative overflow-hidden">
      {/* Blobs */}
      <div className="fixed top-[-80px] right-[-80px] w-[500px] h-[500px] bg-pink-300/20 rounded-full blur-[100px] pointer-events-none" />
      <div className="fixed bottom-[-80px] left-[-80px] w-[400px] h-[400px] bg-purple-300/15 rounded-full blur-[100px] pointer-events-none" />

      <div className="relative space-y-6">
        {/* Header */}
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="flex items-center gap-4">
            {step === "payment" && stage === "ready" && (
              <button
                onClick={resetToSelect}
                className="w-10 h-10 rounded-xl bg-white border border-slate-200 flex items-center justify-center shadow-sm hover:border-pink-300 transition-colors"
              >
                <ChevronLeft className="w-5 h-5 text-slate-600" />
              </button>
            )}
            <div>
              <h1 className="text-3xl font-black text-slate-800 tracking-tight">
                {stage === "needs_trial" && step === "select" && "Reserva tu clase de prueba"}
                {stage === "needs_trial" && step === "payment" && "Confirmar clase de prueba"}
                {stage === "trial_in_progress" && "Clase de prueba pendiente"}
                {stage === "needs_package" && "Elige tu paquete"}
                {stage === "package_pending_payment" && "Pago pendiente de confirmación"}
                {stage === "needs_payment" && "Pago pendiente de notificación"}
                {(stage === "needs_renewal" || stage === "renew_required") && "Renueva tu paquete"}
                {stage === "renewal_pending" && "Renovación en revisión"}
                {stage === "ready" && step === "select" && "Agendar Clase"}
                {stage === "ready" && step === "payment" && "Confirmar Reserva"}
                {stage === "loading" && "Cargando..."}
              </h1>
              <p className="text-slate-500 mt-1">
                {stage === "needs_trial" && "Tu primera clase es gratuita, sin compromiso"}
                {stage === "trial_in_progress" && "Prepárate para tu clase de prueba gratuita"}
                {stage === "needs_package" && "Selecciona el paquete que mejor se adapte a ti"}
                {stage === "package_pending_payment" && "Tu pago está en revisión. Te avisaremos cuando se confirme."}
                {stage === "needs_payment" && "Notifica tu pago para desbloquear el calendario de agendamiento"}
                {(stage === "needs_renewal" || stage === "renew_required") && "Renueva tu paquete para continuar con tu aprendizaje"}
                {stage === "renewal_pending" && "Tu solicitud de renovación está en revisión"}
                {stage === "ready" && step === "select" && "Selecciona fecha y horario disponible"}
                {stage === "ready" && step === "payment" && "Completa el pago para confirmar tu clase"}
              </p>
            </div>
          </div>

          {/* Steps indicator */}
          {stage === "ready" && (
            <div className="flex items-center gap-3 mt-4">
              {[
                { n: 1, label: "Seleccionar horario" },
                { n: 2, label: "Confirmar y reservar" },
              ].map((s, i) => (
                <div key={s.n} className="flex items-center gap-3">
                  {i > 0 && (
                    <div className={`h-px w-8 transition-colors ${step === "payment" ? "bg-pink-300" : "bg-slate-200"}`} />
                  )}
                  <div className="flex items-center gap-2">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black transition-all duration-300 ${
                      (step === "select" && s.n === 1) || (step === "payment" && s.n <= 2)
                        ? "bg-gradient-to-br from-pink-500 to-rose-400 text-white shadow-md"
                        : "bg-slate-200 text-slate-500"
                    }`}>
                      {s.n}
                    </div>
                    <span className={`text-xs font-bold hidden sm:block transition-colors ${
                      (step === "select" && s.n === 1) || (step === "payment" && s.n === 2)
                        ? "text-pink-600"
                        : "text-slate-400"
                    }`}>
                      {s.label}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {teacherBlocked && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4 flex items-center justify-between gap-4 max-w-2xl animate-in fade-in slide-in-from-top-2 duration-300">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-black text-amber-800">
                  Aún no has elegido un profesor
                </p>
                <p className="text-xs text-amber-700 mt-0.5">
                  Elige tu profesor para poder ver su disponibilidad y agendar clases.
                </p>
              </div>
            </div>
            <Link
              href="/dashboard/teachers"
              className="flex-shrink-0 px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-xl shadow-sm transition-colors whitespace-nowrap"
            >
              Elegir profesor
            </Link>
          </div>
        )}

        {stage === "ready" && step === "payment" && !activeEnrollment && (
          <div className="bg-rose-50 border border-rose-100 text-rose-600 px-4 py-3 rounded-xl text-xs font-bold flex items-center gap-2 max-w-lg mx-auto">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            No tienes un paquete activo. Contacta al staff para adquirir uno antes de reservar una clase.
          </div>
        )}

        {stage === "ready" && activeEnrollment && (
          <div className="max-w-2xl mx-auto w-full space-y-4">
            {activeEnrollment.package?.classes_count == null ? (
              <div className="bg-indigo-50 border border-indigo-100 rounded-2xl px-5 py-4 flex items-center justify-between gap-4">
                <div className="flex items-start gap-3">
                  <PackageIcon className="w-5 h-5 text-indigo-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-black text-indigo-800">
                      Paquete ilimitado — {activeEnrollment.available_credits ?? activeEnrollment.prepaid_unlimited_credits ?? 0} créditos disponibles
                    </p>
                    <p className="text-xs text-indigo-600 mt-0.5">
                      Tu plan es de clases ilimitadas. Puedes comprar más créditos cuando quieras desde tu panel principal.
                    </p>
                  </div>
                </div>
                <Link
                  href="/dashboard"
                  className="flex-shrink-0 px-4 py-2.5 bg-indigo-500 hover:bg-indigo-600 text-white text-xs font-bold rounded-xl shadow-sm transition-colors whitespace-nowrap"
                >
                  Comprar créditos
                </Link>
              </div>
            ) : (
              <div className="bg-emerald-50 border border-emerald-100 rounded-2xl px-5 py-3 flex items-center gap-2">
                <PackageIcon className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                <p className="text-sm font-bold text-emerald-700">
                  Créditos disponibles: {activeEnrollment.available_credits ?? Math.max((activeEnrollment.unlocked_credits ?? 0) - activeEnrollment.classes_used, 0)} / {activeEnrollment.unlocked_credits ?? 0}
                </p>
              </div>
            )}
            <EnrollmentClassesList
              classes={allClasses.filter((c: any) => c.enrollment_id === activeEnrollment.id)}
            />
          </div>
        )}

        {!isSingleTenant && myTeachers.length > 1 && (
          <div className="bg-white/80 backdrop-blur-xl rounded-2xl border border-white shadow-lg p-5 max-w-2xl">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">
              ¿Con cuál de tus profesores quieres agendar?
            </p>
            <div className="flex flex-wrap gap-2">
              {myTeachers.map(t => (
                <button
                  key={t.teacher_username}
                  onClick={() => { setSelectedTeacherUsername(t.teacher_username); resetToSelect(); }}
                  className={`px-4 py-2.5 rounded-xl text-sm font-bold border-2 transition-all ${
                    selectedTeacherUsername === t.teacher_username
                      ? "border-pink-400 bg-pink-50 text-pink-600"
                      : "border-slate-100 bg-white text-slate-600 hover:border-pink-200"
                  }`}
                >
                  {t.name} {t.surname}
                </button>
              ))}
            </div>
          </div>
        )}

        {!needsTeacherSelection && !teacherBlocked && (
          <div className="animate-in fade-in duration-300">
            {stage === "loading" && (
              <div className="flex justify-center py-24">
                <div className="w-10 h-10 border-4 border-pink-200 border-t-pink-500 rounded-full animate-spin" />
              </div>
            )}

            {stage === "needs_trial" && step === "select" && (
              <StepSelectSlot
                onSelect={handleSlotSelect}
                teacherUsername={selectedTeacherUsername}
                isTrial
              />
            )}

            {stage === "needs_trial" && step === "payment" && (
              <StepConfirmTrial
                date={selectedDate}
                slot={selectedSlot}
                teacherUsername={selectedTeacherUsername}
                subject={selectedSubject}
                onBack={resetToSelect}
                onBooked={loadStage}
              />
            )}

            {stage === "trial_in_progress" && <TrialInProgressScreen />}

            {stage === "needs_package" && (
              <NeedsPackageScreen
                teacherUsername={selectedTeacherUsername}
                onSelected={() => {
                  loadStage();
                  refetchEnrollments();
                }}
              />
            )}

            {(stage === "package_pending_payment" || stage === "needs_payment") && (
              <PackagePendingPaymentScreen />
            )}

            {(stage === "needs_renewal" || stage === "renew_required") && (
              <NeedsRenewalScreen
                teacherUsername={selectedTeacherUsername}
                onRequested={loadStage}
              />
            )}

            {stage === "renewal_pending" && <RenewalPendingScreen />}

            {stage === "ready" && step === "select" && (
              <StepSelectSlot
                onSelect={handleSlotSelect}
                teacherUsername={selectedTeacherUsername}
              />
            )}

            {stage === "ready" && step === "payment" && (
              <StepPayment
                date={selectedDate}
                slot={selectedSlot}
                duration={selectedDuration}
                enrollmentId={activeEnrollment?.id}
                teacherUsername={selectedTeacherUsername}
                onBack={resetToSelect}
                onSuccess={handleBookingSuccess}
              />
            )}
          </div>
        )}
      </div>
    </div>
    <ChipiWidget screenName="schedule_student" />
    </>
  );
}