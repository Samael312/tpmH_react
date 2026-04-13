"use client";

import { useState } from "react";
import { useAvailableSlots } from "@/hooks/useStudentData";
import { Calendar, Clock, CreditCard,
         Upload, Check, X, ChevronLeft,
         ChevronRight, AlertCircle, Video } from "lucide-react";
import api from "@/lib/api";

const DURATIONS = [
  { value: 30,  label: "30 min" },
  { value: 60,  label: "1 hora" },
];

const PAYMENT_METHODS = [
  { value: "binance", label: "Binance (USDT)" },
  { value: "paypal",  label: "PayPal" },
  { value: "zelle",   label: "Zelle" },
];

// ─── Mini calendario ──────────────────────────────────────────────────────────
function MiniCalendar({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const today = new Date();
  const [year, setYear]   = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());

  const MONTHS = ["Enero","Febrero","Marzo","Abril","Mayo","Junio",
                  "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
  const DAYS   = ["L","M","X","J","V","S","D"];

  const firstDay   = new Date(year, month, 1).getDay();
  const offset     = (firstDay + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells       = Array.from(
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
      {/* Header */}
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

      {/* Días de la semana */}
      <div className="grid grid-cols-7 mb-2">
        {DAYS.map(d => (
          <div key={d} className="text-center text-[10px] font-black
                                   text-slate-400 uppercase tracking-widest py-1">
            {d}
          </div>
        ))}
      </div>

      {/* Celdas */}
      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, i) => {
          if (!day) return <div key={i} />;
          const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const isSelected = dateStr === value;
          const isPast     = new Date(dateStr) < new Date(today.toDateString());
          const isToday    = dateStr === today.toISOString().split("T")[0];

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

// ─── Paso 1: Seleccionar slot ─────────────────────────────────────────────────
function StepSelectSlot({
  onSelect,
}: {
  onSelect: (date: string, slot: any, duration: number) => void;
}) {
  const [date, setDate]         = useState("");
  const [duration, setDuration] = useState(60);

  const { slots, loading } = useAvailableSlots(date, duration);

  const formatTime = (utc: string) =>
    new Date(utc).toLocaleTimeString("es", {
      hour: "2-digit", minute: "2-digit",
    });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

      {/* Columna izquierda: calendario + duración */}
      <div className="space-y-5">
        <MiniCalendar value={date} onChange={setDate} />

        {/* Duración */}
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
      </div>

      {/* Columna derecha: slots disponibles */}
      <div className="bg-white/80 backdrop-blur-xl rounded-[2rem]
                      border border-white shadow-2xl shadow-slate-200/50 p-6">
        <p className="text-[10px] font-black text-slate-400 uppercase
                      tracking-widest mb-4">
          Horarios disponibles
          {date && (
            <span className="ml-2 text-slate-300 normal-case font-bold">
              — {new Date(date + "T00:00:00").toLocaleDateString("es", {
                weekday: "long", day: "numeric", month: "long",
              })}
            </span>
          )}
        </p>

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
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3
                          max-h-[400px] overflow-y-auto pr-1">
            {slots.map((slot, i) => (
              <button
                key={i}
                onClick={() => onSelect(date, slot, duration)}
                className={`
                  relative py-4 px-3 rounded-2xl text-center
                  border-2 transition-all duration-200
                  hover:-translate-y-0.5 hover:shadow-md
                  ${slot.is_preferred
                    ? "border-purple-300 bg-purple-50 hover:border-purple-400"
                    : "border-slate-100 bg-white hover:border-pink-300"
                  }
                `}
              >
                {slot.is_preferred && (
                  <div className="absolute -top-2 left-1/2 -translate-x-1/2
                                  bg-purple-500 text-white text-[8px] font-black
                                  uppercase tracking-widest px-2 py-0.5 rounded-full">
                    Preferido
                  </div>
                )}
                <Clock className={`w-4 h-4 mx-auto mb-1.5
                  ${slot.is_preferred ? "text-purple-400" : "text-slate-400"}`} />
                <p className={`text-base font-black
                  ${slot.is_preferred ? "text-purple-700" : "text-slate-800"}`}>
                  {formatTime(slot.start_time_utc)}
                </p>
                <p className="text-[10px] text-slate-400 font-bold mt-0.5">
                  hasta {formatTime(slot.end_time_utc)}
                </p>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Paso 2: Confirmar y pagar ────────────────────────────────────────────────
function StepPayment({
  date,
  slot,
  duration,
  onBack,
  onSuccess,
}: {
  date: string;
  slot: any;
  duration: number;
  onBack: () => void;
  onSuccess: () => void;
}) {
  const [method, setMethod]   = useState("binance");
  const [txId, setTxId]       = useState("");
  const [receipt, setReceipt] = useState<File | null>(null);
  const [booking, setBooking] = useState(false);
  const [classId, setClassId] = useState<number | null>(null);
  const [payInfo, setPayInfo] = useState<{
    amount: number;
    instructions: string;
    payment_address: string;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone]             = useState(false);
  const [error, setError]           = useState("");

  // Paso 2a: Reservar slot (crea la clase en estado pending)
  const bookSlot = async () => {
    setBooking(true);
    setError("");
    try {
      const res = await api.post("/payments/book", {
        start_time_utc: slot.start_time_utc,
        end_time_utc:   slot.end_time_utc,
        duration_minutes: duration,
        payment_method: method,
      });
      setClassId(res.data.class_id);
      setPayInfo({
        amount:          res.data.amount,
        instructions:    res.data.payment_instructions,
        payment_address: res.data.payment_address,
      });
    } catch (e: any) {
      setError(e.response?.data?.detail || "Error reservando el horario");
    } finally {
      setBooking(false);
    }
  };

  // Paso 2b: Subir comprobante
  const submitReceipt = async () => {
    if (!classId || !receipt) return;
    setSubmitting(true);
    setError("");
    try {
      const form = new FormData();
      form.append("class_id",      String(classId));
      form.append("payment_method", method);
      form.append("transaction_id", txId);
      form.append("receipt",        receipt);
      await api.post("/payments/submit-receipt", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setDone(true);
      setTimeout(onSuccess, 2000);
    } catch (e: any) {
      setError(e.response?.data?.detail || "Error enviando comprobante");
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

      {/* Resumen de la clase */}
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

      {/* Error */}
      {error && (
        <div className="bg-rose-50 border border-rose-100 text-rose-600
                        px-4 py-3 rounded-xl text-xs font-bold
                        flex items-center gap-2">
          <X className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {done ? (
        /* Éxito */
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
        /* Selección de método */
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
        /* Instrucciones de pago + subir comprobante */
        <div className="bg-white/80 backdrop-blur-xl rounded-[2rem]
                        border border-white shadow-2xl shadow-slate-200/50 p-6
                        space-y-5">

          {/* Instrucciones */}
          <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4">
            <p className="text-[10px] font-black text-amber-600 uppercase
                          tracking-widest mb-2">
              Instrucciones de pago
            </p>
            <p className="text-2xl font-black text-amber-700 mb-2">
              ${payInfo.amount.toFixed(2)}
            </p>
            <p className="text-sm text-amber-700 font-bold mb-1">
              Enviar a:
            </p>
            <p className="text-xs font-mono bg-amber-100 px-3 py-2 rounded-xl
                          text-amber-800 break-all">
              {payInfo.payment_address}
            </p>
            {payInfo.instructions && (
              <p className="text-xs text-amber-600 mt-2">
                {payInfo.instructions}
              </p>
            )}
          </div>

          {/* TX ID */}
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

          {/* Upload comprobante */}
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

// ─── Página principal ─────────────────────────────────────────────────────────
export default function SchedulePage() {
  const [step, setStep] = useState<"select" | "payment">("select");
  const [selectedDate, setSelectedDate]   = useState("");
  const [selectedSlot, setSelectedSlot]   = useState<any>(null);
  const [selectedDuration, setSelectedDuration] = useState(60);

  const handleSlotSelect = (
    date: string, slot: any, duration: number
  ) => {
    setSelectedDate(date);
    setSelectedSlot(slot);
    setSelectedDuration(duration);
    setStep("payment");
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
            {step === "payment" && (
              <button
                onClick={() => setStep("select")}
                className="w-10 h-10 rounded-xl bg-white border border-slate-200
                           flex items-center justify-center shadow-sm
                           hover:border-pink-300 transition-colors"
              >
                <ChevronLeft className="w-5 h-5 text-slate-600" />
              </button>
            )}
            <div>
              <h1 className="text-3xl font-black text-slate-800 tracking-tight">
                {step === "select" ? "Agendar Clase" : "Confirmar Reserva"}
              </h1>
              <p className="text-slate-500 mt-1">
                {step === "select"
                  ? "Selecciona fecha y horario disponible"
                  : "Completa el pago para confirmar tu clase"
                }
              </p>
            </div>
          </div>

          {/* Steps indicator */}
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
        </div>

        {/* Contenido según paso */}
        <div className="animate-in fade-in duration-300">
          {step === "select" ? (
            <StepSelectSlot onSelect={handleSlotSelect} />
          ) : (
            <StepPayment
              date={selectedDate}
              slot={selectedSlot}
              duration={selectedDuration}
              onBack={() => setStep("select")}
              onSuccess={() => setStep("select")}
            />
          )}
        </div>
      </div>
    </div>
  );
}