"use client";

import { useState, useEffect } from "react";
import { useAvailableSlots, useEnrollments, useTeacherResolution } from "@/hooks/useStudentData";
import {
  Calendar, Clock, CreditCard,
  Upload, Check, X, ChevronLeft,
  ChevronRight, AlertCircle, Video, AlertTriangle,
  Sparkles, Package as PackageIcon, Hourglass,
} from "lucide-react";
import api from "@/lib/api";
import Link from "next/link";
import ChipiWidget from "@/components/chipi/ChipiWidget";

type BookingStage = "loading" | "needs_trial" | "trial_in_progress" | "needs_package" | "needs_renewal" | "renewal_pending" | "ready";

const DURATIONS = [
  { value: 30, label: "30 min" },
  { value: 60, label: "1 hora" },
];

const PAYMENT_METHODS = [
  { value: "binance", label: "Binance (USDT)" },
  { value: "paypal", label: "PayPal" },
  { value: "zelle", label: "Zelle" },
];

// ─── Helper: normaliza errores de la API (string o array de Pydantic) ────────
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
    <div className="bg-white/80 backdrop-blur-xl rounded-[2rem]
                    border border-white shadow-2xl shadow-slate-200/50 p-6">
      <div className="flex items-center justify-between mb-5">
        <button onClick={prev}
          className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200
                     flex items-center justify-center transition-colors">
          <ChevronLeft className="w-4 h-4 text-slate-600" />
        </button>
        <span className="text-base font-black text-slate-800">
          {MONTHS[month]} {year}
        </span>
        <button onClick={next}
          className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200
                     flex items-center justify-center transition-colors">
          <ChevronRight className="w-4 h-4 text-slate-600" />
        </button>
      </div>

      <div className="grid grid-cols-7 mb-2">
        {DAYS.map(d => (
          <div key={d} className="text-center text-[10px] font-black
                                   text-slate-400 uppercase tracking-widest py-1">
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

// ─── Paso: Seleccionar slot (muestra todos y destaca los preferidos de 18:00 a 22:00 localmente) ─────
function StepSelectSlot({
  onSelect,
  isTrial = false,
}: {
  onSelect: (date: string, slot: any, duration: number) => void;
  isTrial?: boolean;
}) {
  const [date, setDate] = useState("");
  const [duration, setDuration] = useState(isTrial ? 30 : 60);

  const { slots, loading } = useAvailableSlots(date, duration);

  const formatTime = (utc: string) =>
    new Date(utc).toLocaleTimeString("es", {
      hour: "2-digit", minute: "2-digit",
    });

  // Determina si el slot cae dentro del horario preferencial del usuario (18:00 - 22:00 hora local)
  const isPreferredSlot = (slot: any) => {
    if (slot.is_preferred) return true;
    const localDate = new Date(slot.start_time_utc);
    const hour = localDate.getHours();
    const minutes = localDate.getMinutes();
    const totalMinutes = hour * 60 + minutes;
    return totalMinutes >= 18 * 60 && totalMinutes < 22 * 60;
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

      {/* Columna izquierda: calendario + duración */}
      <div className="space-y-5">
        <MiniCalendar value={date} onChange={setDate} />

        {/* Duración — fija en 30min para la clase de prueba */}
        {!isTrial && (
          <div className="bg-white/80 backdrop-blur-xl rounded-[2rem]
                          border border-white shadow-xl shadow-slate-200/50 p-6">
            <p className="text-[10px] font-black text-slate-400 uppercase
                          tracking-widest mb-3">
              Duración de la clase
            </p>
            <div className="flex gap-3">
              {DURATIONS.map(d => (
                <button
                  key={d.value}
                  onClick={() => setDuration(d.value)}
                  className={`flex-1 py-3 rounded-xl text-sm font-bold
                    border-2 transition-all duration-200
                    ${duration === d.value
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
          <div className="bg-purple-50 border border-purple-100 rounded-2xl p-5
                          flex gap-3 items-start">
            <Sparkles className="w-5 h-5 text-purple-400 flex-shrink-0 mt-0.5" />
            <p className="text-sm font-bold text-purple-700 leading-relaxed">
              Tu primera clase es una prueba gratuita de 30 minutos. Una vez
              completada, podrás elegir tu paquete de clases regulares.
            </p>
          </div>
        )}
      </div>

      {/* Columna derecha: todos los slots con los preferidos destacados */}
      <div className="bg-white/80 backdrop-blur-xl rounded-[2rem]
                      border border-white shadow-2xl shadow-slate-200/50 p-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <p className="text-[10px] font-black text-slate-400 uppercase
                        tracking-widest">
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
            <div className="w-8 h-8 border-4 border-pink-200 border-t-pink-500
                            rounded-full animate-spin" />
          </div>
        ) : slots.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <AlertCircle className="w-12 h-12 text-slate-200 mb-3" />
            <p className="text-slate-400 font-bold text-sm text-center">
              No hay disponibilidad para esta fecha
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4
                          max-h-[400px] overflow-y-auto pr-1 pt-3">
            {slots.map((slot, i) => {
              const preferred = isPreferredSlot(slot);
              const blocked = !slot.is_available || slot.is_past;

              return (
                <button
                  key={i}
                  onClick={() => !blocked && onSelect(date, slot, duration)}
                  disabled={blocked}
                  className={`
                      relative py-4 px-3 rounded-2xl text-center
                      border-2 transition-all duration-200
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
                      <div className="absolute -top-2 left-1/2 -translate-x-1/2
                                      bg-purple-500 text-white text-[8px] font-black
                                      uppercase tracking-widest px-2 py-0.5 rounded-full shadow-sm">
                        Preferido
                      </div>
                    )}
                    {blocked && (
                      <div className="absolute -top-2 left-1/2 -translate-x-1/2
                                      bg-slate-400 text-white text-[8px] font-black
                                      uppercase tracking-widest px-2 py-0.5 rounded-full shadow-sm">
                        {slot.is_past ? "Pasado" : "Ocupado"}
                      </div>
                    )}
                    <Clock className={`w-4 h-4 mx-auto mb-1.5
                      ${blocked ? "text-slate-300" : preferred ? "text-purple-500" : "text-slate-400"}`} />
                    <p className={`text-base font-black
                      ${blocked ? "text-slate-400" : preferred ? "text-purple-800" : "text-slate-800"}`}>
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

// ─── Paso: Confirmar clase de prueba (sin pago, reserva directa) ─────────────
function StepConfirmTrial({
  date,
  slot,
  onBack,
  onBooked,
}: {
  date: string;
  slot: any;
  onBack: () => void;
  onBooked: () => void;
}) {
  const [booking, setBooking] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const fmtDate = new Date(date + "T00:00:00").toLocaleDateString("es", {
    weekday: "long", day: "numeric", month: "long",
  });
  const fmtTime = new Date(slot.start_time_utc).toLocaleTimeString("es", {
    hour: "2-digit", minute: "2-digit",
  });

  const confirmTrial = async () => {
    setBooking(true);
    setError("");
    try {
      await api.post("/payments/book", {
        start_time_utc: slot.start_time_utc,
        end_time_utc: slot.end_time_utc,
        duration_minutes: 30,
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
      <div className="bg-gradient-to-r from-purple-500 to-pink-500 rounded-[2rem]
                      p-6 text-white relative overflow-hidden shadow-xl
                      shadow-purple-200">
        <div className="absolute top-[-30px] right-[-30px] w-32 h-32
                        bg-white/10 rounded-full blur-xl" />
        <p className="text-[10px] font-black uppercase tracking-widest
                      text-white/70 mb-2 flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5" /> Clase de prueba gratuita
        </p>
        <p className="text-2xl font-black capitalize">{fmtDate}</p>
        <div className="flex items-center gap-3 mt-2 flex-wrap">
          <span className="flex items-center gap-1.5 bg-white/20 px-3 py-1.5
                           rounded-full text-sm font-bold">
            <Clock className="w-3.5 h-3.5" />
            {fmtTime}
          </span>
          <span className="bg-white/20 px-3 py-1.5 rounded-full text-sm font-bold">
            30 min
          </span>
        </div>
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-100 text-rose-600
                        px-4 py-3 rounded-xl text-xs font-bold
                        flex items-center gap-2">
          <X className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {done ? (
        <div className="bg-white/80 backdrop-blur-xl rounded-[2rem]
                        border border-white shadow-2xl p-10 text-center">
          <div className="w-16 h-16 bg-emerald-100 rounded-full
                          flex items-center justify-center mx-auto mb-4">
            <Check className="w-8 h-8 text-emerald-600" />
          </div>
          <h3 className="text-xl font-black text-slate-800 mb-2">
            ¡Prueba reservada!
          </h3>
          <p className="text-slate-500 text-sm">
            Prepárate para tu clase de prueba gratuita.
          </p>
        </div>
      ) : (
        <div className="bg-white/80 backdrop-blur-xl rounded-[2rem]
                        border border-white shadow-2xl shadow-slate-200/50 p-6
                        space-y-4">
          <p className="text-sm text-slate-500 leading-relaxed">
            Esta clase de prueba es completamente gratuita y no requiere pago.
            Solo confirma el horario para reservarla.
          </p>
          <div className="flex gap-3">
            <button
              onClick={onBack}
              className="flex-1 py-3.5 text-sm font-bold text-slate-600
                         bg-slate-100 hover:bg-slate-200 rounded-xl
                         transition-colors"
            >
              Volver
            </button>
            <button
              onClick={confirmTrial}
              disabled={booking}
              className="flex-1 py-3.5 text-sm font-bold text-white rounded-xl
                         bg-gradient-to-r from-purple-500 to-pink-500
                         hover:from-purple-600 hover:to-pink-600
                         shadow-lg shadow-purple-200 active:scale-[0.98]
                         transition-all duration-300 disabled:opacity-50
                         flex items-center justify-center gap-2"
            >
              {booking ? (
                <div className="w-4 h-4 border-2 border-white/40
                                border-t-white rounded-full animate-spin" />
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

// ─── Paso: Confirmar y pagar (clase regular contra un paquete) ───────────────
function StepPayment({
  date,
  slot,
  duration,
  enrollmentId,
  onBack,
  onSuccess,
}: {
  date: string;
  slot: any;
  duration: number;
  enrollmentId?: number;
  onBack: () => void;
  onSuccess: () => void;
}) {
  const [method, setMethod] = useState("binance");
  const [txId, setTxId] = useState("");
  const [receipt, setReceipt] = useState<File | null>(null);
  const [booking, setBooking] = useState(false);
  const [classId, setClassId] = useState<number | null>(null);
  const [payInfo, setPayInfo] = useState<{
    amount: number;
    instructions: string;
    payment_address: string;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const bookSlot = async () => {
    if (!enrollmentId) {
      setError("No se encontró un paquete activo para reservar esta clase.");
      return;
    }
    setBooking(true);
    setError("");
    try {
      const res = await api.post("/payments/book", {
        enrollment_id: enrollmentId,
        start_time_utc: slot.start_time_utc,
        end_time_utc: slot.end_time_utc,
        duration_minutes: duration,
      });
      setClassId(res.data.class_id);
      setPayInfo({
        amount: res.data.payment_instructions?.amount ?? res.data.amount,
        instructions: res.data.payment_instructions?.whatsapp_number ?? res.data.payment_instructions ?? "",
        payment_address:
          method === "binance"
            ? res.data.payment_instructions?.binance_address
            : res.data.payment_instructions?.paypal_email,
      });
    } catch (e: any) {
      setError(extractErrorMessage(e, "Error reservando el horario"));
    } finally {
      setBooking(false);
    }
  };

  const submitReceipt = async () => {
    if (!classId || !receipt) return;
    setSubmitting(true);
    setError("");
    try {
      const form = new FormData();
      form.append("class_id", String(classId));
      form.append("payment_method", method);
      form.append("transaction_id", txId);
      form.append("receipt", receipt);
      await api.post("/payments/submit-receipt", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setDone(true);
      setTimeout(onSuccess, 2000);
    } catch (e: any) {
      setError(extractErrorMessage(e, "Error enviando comprobante"));
    } finally {
      setSubmitting(false);
    }
  };

  const fmtDate = new Date(date + "T00:00:00").toLocaleDateString("es", {
    weekday: "long", day: "numeric", month: "long",
  });
  const fmtTime = new Date(slot.start_time_utc).toLocaleTimeString("es", {
    hour: "2-digit", minute: "2-digit",
  });

  return (
    <div className="max-w-lg mx-auto space-y-5">

      <div className="bg-gradient-to-r from-pink-500 to-rose-400 rounded-[2rem]
                      p-6 text-white relative overflow-hidden shadow-xl
                      shadow-pink-200">
        <div className="absolute top-[-30px] right-[-30px] w-32 h-32
                        bg-white/10 rounded-full blur-xl" />
        <p className="text-[10px] font-black uppercase tracking-widest
                      text-white/70 mb-2">
          Clase seleccionada
        </p>
        <p className="text-2xl font-black capitalize">{fmtDate}</p>
        <div className="flex items-center gap-3 mt-2 flex-wrap">
          <span className="flex items-center gap-1.5 bg-white/20 px-3 py-1.5
                           rounded-full text-sm font-bold">
            <Clock className="w-3.5 h-3.5" />
            {fmtTime}
          </span>
          <span className="bg-white/20 px-3 py-1.5 rounded-full text-sm font-bold">
            {duration} min
          </span>
        </div>
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-100 text-rose-600
                        px-4 py-3 rounded-xl text-xs font-bold
                        flex items-center gap-2">
          <X className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {done ? (
        <div className="bg-white/80 backdrop-blur-xl rounded-[2rem]
                        border border-white shadow-2xl p-10 text-center">
          <div className="w-16 h-16 bg-emerald-100 rounded-full
                          flex items-center justify-center mx-auto mb-4">
            <Check className="w-8 h-8 text-emerald-600" />
          </div>
          <h3 className="text-xl font-black text-slate-800 mb-2">
            ¡Comprobante enviado!
          </h3>
          <p className="text-slate-500 text-sm">
            La profesora revisará tu pago y confirmará la clase
          </p>
        </div>
      ) : !payInfo ? (
        <div className="bg-white/80 backdrop-blur-xl rounded-[2rem]
                        border border-white shadow-2xl shadow-slate-200/50 p-6
                        space-y-5">
          <p className="text-[10px] font-black text-slate-400 uppercase
                        tracking-widest">
            Método de pago
          </p>

          <div className="space-y-3">
            {PAYMENT_METHODS.map(pm => (
              <button
                key={pm.value}
                onClick={() => setMethod(pm.value)}
                className={`w-full flex items-center gap-3 px-4 py-4
                  rounded-2xl border-2 transition-all duration-200
                  ${method === pm.value
                    ? "border-pink-400 bg-pink-50"
                    : "border-slate-100 bg-white hover:border-slate-200"
                  }`}
              >
                <div className={`w-5 h-5 rounded-full border-2 flex-shrink-0
                  flex items-center justify-center
                  ${method === pm.value
                    ? "border-pink-500 bg-pink-500"
                    : "border-slate-300"
                  }`}>
                  {method === pm.value && (
                    <div className="w-2 h-2 bg-white rounded-full" />
                  )}
                </div>
                <span className="text-sm font-bold text-slate-700">
                  {pm.label}
                </span>
              </button>
            ))}
          </div>

          <div className="flex gap-3">
            <button
              onClick={onBack}
              className="flex-1 py-3.5 text-sm font-bold text-slate-600
                         bg-slate-100 hover:bg-slate-200 rounded-xl
                         transition-colors"
            >
              Volver
            </button>
            <button
              onClick={bookSlot}
              disabled={booking}
              className="flex-1 py-3.5 text-sm font-bold text-white rounded-xl
                         bg-gradient-to-r from-pink-500 to-rose-400
                         hover:from-pink-600 hover:to-rose-500
                         shadow-lg shadow-pink-200 active:scale-[0.98]
                         transition-all duration-300 disabled:opacity-50
                         flex items-center justify-center gap-2"
            >
              {booking ? (
                <div className="w-4 h-4 border-2 border-white/40
                                border-t-white rounded-full animate-spin" />
              ) : (
                <><CreditCard className="w-4 h-4" /> Reservar</>
              )}
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-white/80 backdrop-blur-xl rounded-[2rem]
                        border border-white shadow-2xl shadow-slate-200/50 p-6
                        space-y-5">

          <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4">
            <p className="text-[10px] font-black text-amber-600 uppercase
                          tracking-widest mb-2">
              Instrucciones de pago
            </p>
            <p className="text-2xl font-black text-amber-700 mb-2">
              ${payInfo.amount?.toFixed ? payInfo.amount.toFixed(2) : payInfo.amount}
            </p>
            <p className="text-sm text-amber-700 font-bold mb-1">
              Enviar a:
            </p>
            <p className="text-xs font-mono bg-amber-100 px-3 py-2 rounded-xl
                          text-amber-800 break-all">
              {payInfo.payment_address || "Contacta al staff para los datos de pago"}
            </p>
            {payInfo.instructions && (
              <p className="text-xs text-amber-600 mt-2">
                {payInfo.instructions}
              </p>
            )}
          </div>

          <div className="group">
            <label className="text-[10px] font-black text-slate-400
                              uppercase tracking-widest block mb-1.5">
              ID de transacción (opcional)
            </label>
            <input
              value={txId}
              onChange={e => setTxId(e.target.value)}
              placeholder="Ej: TXN123456789"
              className="w-full bg-slate-50 border-2 border-transparent
                         rounded-xl text-sm font-bold text-slate-800
                         placeholder:text-slate-400 px-4 py-3.5
                         focus:outline-none focus:bg-white
                         focus:border-pink-500 focus:ring-4 focus:ring-pink-50
                         transition-all duration-300"
            />
          </div>

          <div>
            <label className="text-[10px] font-black text-slate-400
                              uppercase tracking-widest block mb-1.5">
              Comprobante de pago
            </label>
            <label className={`flex flex-col items-center justify-center
              gap-3 p-6 rounded-2xl border-2 border-dashed cursor-pointer
              transition-all duration-200
              ${receipt
                ? "border-emerald-300 bg-emerald-50"
                : "border-slate-200 bg-slate-50 hover:border-pink-300 hover:bg-pink-50/50"
              }`}>
              <input
                type="file"
                accept="image/*,.pdf"
                className="hidden"
                onChange={e => setReceipt(e.target.files?.[0] ?? null)}
              />
              {receipt ? (
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 bg-emerald-100 rounded-xl
                                  flex items-center justify-center">
                    <Check className="w-5 h-5 text-emerald-600" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-800">
                      {receipt.name}
                    </p>
                    <p className="text-xs text-slate-500">
                      {(receipt.size / 1024).toFixed(0)} KB
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  <div className="w-10 h-10 bg-slate-100 rounded-xl
                                  flex items-center justify-center">
                    <Upload className="w-5 h-5 text-slate-400" />
                  </div>
                  <p className="text-sm font-bold text-slate-500">
                    Subir captura o PDF
                  </p>
                </>
              )}
            </label>
          </div>

          <button
            onClick={submitReceipt}
            disabled={!receipt || submitting}
            className="w-full py-3.5 text-sm font-bold text-white rounded-xl
                       bg-gradient-to-r from-pink-500 to-rose-400
                       hover:from-pink-600 hover:to-rose-500
                       shadow-lg shadow-pink-200 active:scale-[0.98]
                       transition-all duration-300 disabled:opacity-50
                       disabled:cursor-not-allowed flex items-center
                       justify-center gap-2"
          >
            {submitting ? (
              <div className="w-4 h-4 border-2 border-white/40
                              border-t-white rounded-full animate-spin" />
            ) : (
              <><Check className="w-4 h-4" /> Enviar comprobante</>
            )}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Pantalla: prueba pendiente de completar ─────────────────────────────────
function TrialInProgressScreen() {
  return (
    <div className="max-w-lg mx-auto">
      <div className="bg-white/80 backdrop-blur-xl rounded-[2rem]
                      border border-white shadow-2xl shadow-slate-200/50
                      p-10 text-center">
        <div className="w-16 h-16 bg-amber-100 rounded-full
                        flex items-center justify-center mx-auto mb-4">
          <Hourglass className="w-8 h-8 text-amber-500" />
        </div>
        <h3 className="text-xl font-black text-slate-800 mb-2">
          Tienes una clase de prueba pendiente
        </h3>
        <p className="text-slate-500 text-sm leading-relaxed">
          Ya reservaste tu clase de prueba gratuita. Una vez que se complete,
          podrás elegir tu paquete y agendar más clases.
        </p>
      </div>
    </div>
  );
}

// ─── Pantalla: elegir paquete inicial ────────────────────────────────────────
function NeedsPackageScreen({ onSelected }: { onSelected: () => void }) {
  const [packages, setPackages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selecting, setSelecting] = useState<number | null>(null);
  const [error, setError] = useState("");
  const { teacherUsername } = useTeacherResolution();

  useEffect(() => {
    if (!teacherUsername) { setLoading(false); return; }
    api.get(`/packages/teacher/${teacherUsername}`)
      .then(res => setPackages(res.data))
      .catch(() => setPackages([]))
      .finally(() => setLoading(false));
  }, [teacherUsername]);

  const choose = async (packageId: number) => {
    setSelecting(packageId);
    setError("");
    try {
      await api.post(`/packages/select-initial?package_id=${packageId}`);
      onSelected();
    } catch (e: any) {
      setError(extractErrorMessage(e, "Error seleccionando el paquete"));
    } finally {
      setSelecting(null);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-5
                      flex gap-3 items-start">
        <Check className="w-5 h-5 text-emerald-500 flex-shrink-0 mt-0.5" />
        <p className="text-sm font-bold text-emerald-700 leading-relaxed">
          ¡Completaste tu clase de prueba! Elige un paquete para seguir
          agendando tus próximas clases.
        </p>
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-100 text-rose-600
                        px-4 py-3 rounded-xl text-xs font-bold
                        flex items-center gap-2">
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
        <div className="bg-white/80 backdrop-blur-xl rounded-[2rem]
                        border border-white shadow-lg py-16 text-center">
          <PackageIcon className="w-10 h-10 text-slate-200 mx-auto mb-3" />
          <p className="text-slate-500 font-bold">
            No hay paquetes disponibles. Contacta al staff.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {packages.map(pkg => (
            <div
              key={pkg.id}
              className="bg-white/80 backdrop-blur-xl rounded-[1.75rem]
                        border border-white shadow-xl shadow-slate-200/50
                        p-6 flex flex-col hover:-translate-y-1 hover:shadow-2xl
                        transition-all duration-300"
            >
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center mb-4 text-lg"
                style={{ backgroundColor: `${pkg.color || "#ec4899"}1a` }}
              >
                {pkg.icon || "📦"}
              </div>
              <h3 className="text-lg font-black text-slate-800 mb-1">{pkg.name}</h3>
                  <p className="text-xs text-slate-400 font-bold mb-3">
                    {pkg.subject} · {pkg.classes_count == null ? "Ilimitadas" : `${pkg.classes_count} clases`} · {pkg.duration_minutes} min c/u
                  </p>
                  {pkg.description_type === "list" && pkg.description_items?.length ? (
                    <ul className="text-xs text-slate-500 mb-4 space-y-1">
                      {pkg.description_items.map((item: string, i: number) => (
                        <li key={i} className="flex items-start gap-1.5">
                          <span style={{ color: pkg.color || "#ec4899" }}>✓</span> {item}
                        </li>
                      ))}
                    </ul>
                  ) : pkg.description ? (
                    <p className="text-xs text-slate-500 mb-4">{pkg.description}</p>
                  ) : null}
                  <p className="text-2xl font-black mb-5" style={{ color: pkg.color || "#ec4899" }}>
                    ${pkg.price?.toFixed ? pkg.price.toFixed(2) : pkg.price}
                  </p>
              <button
                onClick={() => choose(pkg.id)}
                disabled={selecting !== null}
                className="mt-auto w-full py-3 text-sm font-bold text-white
                           rounded-xl bg-gradient-to-r from-pink-500 to-rose-400
                           hover:from-pink-600 hover:to-rose-500
                           shadow-md shadow-pink-200 active:scale-[0.98]
                           transition-all duration-300 disabled:opacity-50
                           flex items-center justify-center gap-2"
              >
                {selecting === pkg.id ? (
                  <div className="w-4 h-4 border-2 border-white/40
                                  border-t-white rounded-full animate-spin" />
                ) : (
                  "Elegir este paquete"
                )}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Pantalla: agotó un paquete, debe pedir renovación ───────────────────────
function NeedsRenewalScreen({ onRequested }: { onRequested: () => void }) {
  const [packages, setPackages] = useState<any[]>([]);
  const [lastEnrollmentId, setLastEnrollmentId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [requesting, setRequesting] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const { teacherUsername } = useTeacherResolution();

  useEffect(() => {
    if (!teacherUsername) { setLoading(false); return; }
    Promise.all([
      api.get(`/packages/teacher/${teacherUsername}`),
      api.get("/packages/my-enrollments"),
    ])
      .then(([pkgRes, enrRes]) => {
        setPackages(pkgRes.data);
        // El más reciente es el que acaba de agotarse
        setLastEnrollmentId(enrRes.data?.[0]?.id ?? null);
      })
      .catch(() => { setPackages([]); setLastEnrollmentId(null); })
      .finally(() => setLoading(false));
  }, [teacherUsername]);

  const requestRenewal = async (packageId: number) => {
    if (!lastEnrollmentId) return;
    setRequesting(packageId);
    setError("");
    try {
      await api.post("/packages/request-renewal", {
        current_enrollment_id: lastEnrollmentId,
        new_package_id: packageId,
      });
      setDone(true);
      setTimeout(onRequested, 1500);
    } catch (e: any) {
      setError(extractErrorMessage(e, "Error solicitando la renovación"));
    } finally {
      setRequesting(null);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <div className="w-10 h-10 border-4 border-pink-200 border-t-pink-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (done) {
    return (
      <div className="max-w-lg mx-auto bg-white/80 backdrop-blur-xl rounded-[2rem]
                      border border-white shadow-2xl p-10 text-center">
        <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <Check className="w-8 h-8 text-emerald-600" />
        </div>
        <h3 className="text-xl font-black text-slate-800 mb-2">¡Solicitud enviada!</h3>
        <p className="text-slate-500 text-sm">
          Tu profesor(a) confirmará tu pago y activará el nuevo paquete en breve.
        </p>
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
        <div className="bg-rose-50 border border-rose-100 text-rose-600 px-4 py-3
                        rounded-xl text-xs font-bold flex items-center gap-2">
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
          {packages.map(pkg => (
            <div key={pkg.id} className="bg-white/80 backdrop-blur-xl rounded-[1.75rem]
                            border border-white shadow-xl shadow-slate-200/50 p-6 flex flex-col
                            hover:-translate-y-1 hover:shadow-2xl transition-all duration-300">
              <div className="w-10 h-10 bg-pink-50 rounded-xl flex items-center justify-center mb-4">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center mb-4 text-lg"
                  style={{ backgroundColor: `${pkg.color || "#ec4899"}1a` }}
                >
                  {pkg.icon || "📦"}
                </div>
                <h3 className="text-lg font-black text-slate-800 mb-1">{pkg.name}</h3>
                <p className="text-xs text-slate-400 font-bold mb-3">
                  {pkg.subject} · {pkg.classes_count == null ? "Ilimitadas" : `${pkg.classes_count} clases`} · {pkg.duration_minutes} min c/u
                </p>
                {pkg.description_type === "list" && pkg.description_items?.length ? (
                  <ul className="text-xs text-slate-500 mb-4 space-y-1">
                    {pkg.description_items.map((item: string, i: number) => (
                      <li key={i} className="flex items-start gap-1.5">
                        <span style={{ color: pkg.color || "#ec4899" }}>✓</span> {item}
                      </li>
                    ))}
                  </ul>
                ) : pkg.description ? (
                  <p className="text-xs text-slate-500 mb-4">{pkg.description}</p>
                ) : null}
                <p className="text-2xl font-black mb-5" style={{ color: pkg.color || "#ec4899" }}>
                  ${pkg.price?.toFixed ? pkg.price.toFixed(2) : pkg.price}
                </p>
              </div>
              <button
                onClick={() => requestRenewal(pkg.id)}
                disabled={requesting !== null}
                className="mt-auto w-full py-3 text-sm font-bold text-white rounded-xl
                           bg-gradient-to-r from-pink-500 to-rose-400 hover:from-pink-600 hover:to-rose-500
                           shadow-md shadow-pink-200 active:scale-[0.98] transition-all duration-300
                           disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {requesting === pkg.id ? (
                  <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                ) : "Solicitar este paquete"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Pantalla: renovación ya solicitada, esperando aprobación ────────────────
function RenewalPendingScreen() {
  return (
    <div className="max-w-lg mx-auto">
      <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] border border-white
                      shadow-2xl shadow-slate-200/50 p-10 text-center">
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
  const [step, setStep] = useState<"select" | "payment">("select");
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedSlot, setSelectedSlot] = useState<any>(null);
  const [selectedDuration, setSelectedDuration] = useState(60);

  const { enrollments, refetch: refetchEnrollments } = useEnrollments();
  const activeEnrollment = enrollments.find(e => e.status === "active");

  const {
    loading: resolvingTeacher,
    isSingleTenant,
    teacherUsername,
    hasChosenTeacher,
  } = useTeacherResolution();

  const teacherBlocked = !resolvingTeacher && !isSingleTenant && !hasChosenTeacher;

  const loadStage = () => {
    api.get("/payments/booking-status")
      .then(res => setStage(res.data.stage))
      .catch(() => setStage("ready"));
  };

  useEffect(() => { loadStage(); }, []);

  const handleSlotSelect = (
    date: string, slot: any, duration: number
  ) => {
    setSelectedDate(date);
    setSelectedSlot(slot);
    setSelectedDuration(duration);
    setStep("payment");
  };

  const resetToSelect = () => {
    setStep("select");
    setSelectedDate("");
    setSelectedSlot(null);
  };

  return (
    <div className="min-h-screen bg-slate-50 relative overflow-hidden">

      {/* Blobs */}
      <div className="fixed top-[-80px] right-[-80px] w-[500px] h-[500px]
                      bg-pink-300/20 rounded-full blur-[100px]
                      pointer-events-none" />
      <div className="fixed bottom-[-80px] left-[-80px] w-[400px] h-[400px]
                      bg-purple-300/15 rounded-full blur-[100px]
                      pointer-events-none" />

      <div className="relative space-y-6">

        {/* Header */}
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="flex items-center gap-4">
            {step === "payment" && stage === "ready" && (
              <button
                onClick={resetToSelect}
                className="w-10 h-10 rounded-xl bg-white border border-slate-200
                           flex items-center justify-center shadow-sm
                           hover:border-pink-300 transition-colors"
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
                {stage === "needs_renewal" && "Renueva tu paquete"}
                {stage === "renewal_pending" && "Renovación en revisión"}
                {stage === "ready" && step === "select" && "Agendar Clase"}
                {stage === "ready" && step === "payment" && "Confirmar Reserva"}
                {stage === "loading" && "Cargando..."}
              </h1>
              <p className="text-slate-500 mt-1">
                {stage === "needs_trial" && "Tu primera clase es gratuita, sin compromiso"}
                {stage === "trial_in_progress" && "Prepárate para tu clase de prueba gratuita"}
                {stage === "needs_package" && "Selecciona el paquete que mejor se adapte a ti"}
                {stage === "needs_renewal" && "Renueva tu paquete para continuar con tu aprendizaje"}
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
                { n: 2, label: "Confirmar y pagar" },
              ].map((s, i) => (
                <div key={s.n} className="flex items-center gap-3">
                  {i > 0 && (
                    <div className={`h-px w-8 transition-colors
                      ${step === "payment" ? "bg-pink-300" : "bg-slate-200"}`} />
                  )}
                  <div className="flex items-center gap-2">
                    <div className={`w-7 h-7 rounded-full flex items-center
                      justify-center text-xs font-black transition-all duration-300
                      ${(step === "select" && s.n === 1) ||
                        (step === "payment" && s.n <= 2)
                        ? "bg-gradient-to-br from-pink-500 to-rose-400 text-white shadow-md"
                        : "bg-slate-200 text-slate-500"
                      }`}>
                      {s.n}
                    </div>
                    <span className={`text-xs font-bold hidden sm:block
                      transition-colors
                      ${(step === "select" && s.n === 1) ||
                        (step === "payment" && s.n === 2)
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
          <div className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4
                          flex items-center justify-between gap-4 max-w-2xl
                          animate-in fade-in slide-in-from-top-2 duration-300">
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
              className="flex-shrink-0 px-4 py-2.5 bg-amber-500 hover:bg-amber-600
                         text-white text-xs font-bold rounded-xl shadow-sm
                         transition-colors whitespace-nowrap"
            >
              Elegir profesor
            </Link>
          </div>
        )}

        {stage === "ready" && step === "payment" && !activeEnrollment && (
          <div className="bg-rose-50 border border-rose-100 text-rose-600
                          px-4 py-3 rounded-xl text-xs font-bold
                          flex items-center gap-2 max-w-lg mx-auto">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            No tienes un paquete activo. Contacta al staff para adquirir uno
            antes de reservar una clase.
          </div>
        )}

        <div className={`animate-in fade-in duration-300 ${teacherBlocked ? "opacity-40 pointer-events-none select-none" : ""}`}>
          {stage === "loading" && (
            <div className="flex justify-center py-24">
              <div className="w-10 h-10 border-4 border-pink-200 border-t-pink-500
                              rounded-full animate-spin" />
            </div>
          )}

          {stage === "needs_trial" && step === "select" && (
            <StepSelectSlot onSelect={handleSlotSelect} isTrial />
          )}

          {stage === "needs_trial" && step === "payment" && (
            <StepConfirmTrial
              date={selectedDate}
              slot={selectedSlot}
              onBack={resetToSelect}
              onBooked={loadStage}
            />
          )}

          {stage === "trial_in_progress" && <TrialInProgressScreen />}

          {stage === "needs_package" && (
            <NeedsPackageScreen
              onSelected={() => {
                loadStage();
                refetchEnrollments();
              }}
            />
          )}

          {stage === "needs_renewal" && (
            <NeedsRenewalScreen onRequested={loadStage} />
          )}

          {stage === "renewal_pending" && <RenewalPendingScreen />}

          {stage === "ready" && step === "select" && (
            <StepSelectSlot onSelect={handleSlotSelect} />
          )}

          {stage === "ready" && step === "payment" && (
            <StepPayment
              date={selectedDate}
              slot={selectedSlot}
              duration={selectedDuration}
              enrollmentId={activeEnrollment?.id}
              onBack={resetToSelect}
              onSuccess={resetToSelect}
            />
          )}
        </div>
      </div>
      <ChipiWidget screenName="schedule" />
    </div>
  );
}