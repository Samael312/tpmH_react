"use client";

import { useState } from "react";
import { AlertTriangle, Zap, Clock, ChevronDown } from "lucide-react";
import { Card, Button, Badge } from "@/components/ui";
import { GodModeAction, GodModeField } from "@/lib/godModeActions";
import {
  useRunGodModeAction,
  useGodModeTeachers,
  useGodModeTeacherStudents,
  useGodModeStudentEnrollments,
  useGodModePairClasses,
  useGodModeClassDurations,
  useGodModeTeacherPackages,
  useGodModeTeacherCohorts,
  useGodModePairPayments,
  useGodModeReviewableStudents,
  useGodModeTeacherReviews,
} from "@/hooks/useGodMode";
import { AvailableSlot } from "@/hooks/useStudentData";
import { getMyDisplayTimezone, formatTimeTz } from "@/lib/tzFormat";
import GodModeAvailabilityPicker from "./GodModeAvailabilityPicker";

const baseInputClasses = "w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-800 " +
  "placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-pink-200 focus:border-pink-300 " +
  "disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed";

function SelectShell({
  value, onChange, disabled, placeholder, loading, children,
}: {
  value: string; onChange: (v: string) => void; disabled?: boolean; placeholder: string; loading?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        className={`${baseInputClasses} appearance-none pr-8`}
      >
        <option value="">{loading ? "Cargando..." : placeholder}</option>
        {children}
      </select>
      <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
    </div>
  );
}

export default function GodModeActionRunner({ action }: { action: GodModeAction }) {
  const [values, setValuesState] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pickerOpenFor, setPickerOpenFor] = useState<string | null>(null);

  const mutation = useRunGodModeAction();

  const teacherId = values["teacher_id"] ? Number(values["teacher_id"]) : undefined;
  const studentId = values["student_id"] ? Number(values["student_id"]) : undefined;

  // Datos compartidos entre los campos en cascada de esta acción — se
  // piden una sola vez acá arriba en vez de que cada campo los pida por
  // su cuenta, para no duplicar peticiones y para poder autocompletar
  // (materia desde el enrollment, duración desde la clase elegida, etc).
  const { teachers } = useGodModeTeachers();
  const { students, loading: loadingStudents } = useGodModeTeacherStudents(teacherId);
  const { enrollments, loading: loadingEnrollments } = useGodModeStudentEnrollments(studentId, teacherId);
  const { classes, loading: loadingClasses } = useGodModePairClasses(teacherId, studentId);
  const { durations } = useGodModeClassDurations();
  const { packages, loading: loadingPackages } = useGodModeTeacherPackages(teacherId);
  const { cohorts, loading: loadingCohorts } = useGodModeTeacherCohorts(teacherId);
  const { payments, loading: loadingPayments } = useGodModePairPayments(teacherId, studentId);
  const { students: reviewableStudents, loading: loadingReviewableStudents } = useGodModeReviewableStudents(teacherId);
  const { reviews, loading: loadingReviews } = useGodModeTeacherReviews(teacherId);

  const myTz = getMyDisplayTimezone();

  const setValue = (name: string, v: string) => {
    setValuesState(prev => ({ ...prev, [name]: v }));
    setResult(null);
  };

  // Elegir un profesor distinto invalida todo lo que dependía de él.
  const setTeacherId = (v: string) => {
    setValuesState(prev => ({
      ...prev, teacher_id: v, student_id: "", enrollment_id: "", subject: "", class_id: "", start_time_utc: "", review_id: "",
    }));
    setResult(null);
  };
  const setStudentId = (v: string) => {
    setValuesState(prev => ({
      ...prev, student_id: v, enrollment_id: "", subject: "", class_id: "", start_time_utc: "",
    }));
    setResult(null);
  };
  const setEnrollmentId = (v: string) => {
    const enr = enrollments.find(e => String(e.id) === v);
    setValuesState(prev => ({ ...prev, enrollment_id: v, subject: enr?.subject ?? prev.subject ?? "" }));
    setResult(null);
  };
  const setClassId = (v: string) => {
    const cls = classes.find(c => String(c.id) === v);
    setValuesState(prev => ({
      ...prev,
      class_id: v,
      duration_minutes: prev.duration_minutes || (cls ? String(cls.duration) : ""),
      start_time_utc: "",
    }));
    setResult(null);
  };

  const missingRequired = action.fields
    .filter(f => f.required)
    .some(f => !values[f.name]?.trim());

  const reasonInvalid = reason.trim().length < 5;

  const handleSubmit = async () => {
    if (missingRequired || reasonInvalid) {
      setConfirming(false);
      return;
    }

    const pathValues: Record<string, string> = {};
    action.fields.filter(f => f.isPathParam).forEach(f => { pathValues[f.sendAs ?? f.name] = values[f.name] ?? ""; });

    const body: Record<string, unknown> = { reason: reason.trim() };
    action.fields.filter(f => !f.isPathParam && !f.excludeFromPayload).forEach(f => {
      const raw = values[f.name];
      if (raw === undefined || raw === "") return; // campo opcional sin valor: se omite (ajuste parcial en backend)
      const key = f.sendAs ?? f.name;

      if (["number", "enrollment-select", "class-select", "teacher-select", "student-select", "duration-select", "package-select", "cohort-select", "payment-select", "review-student-select", "review-select"].includes(f.type)) {
        body[key] = Number(raw);
      } else if (f.type === "checkbox" || f.type === "tri-bool-select") {
        body[key] = raw === "true";
      } else if (f.type === "datetime") {
        body[key] = new Date(raw).toISOString();
      } else if (f.type === "availability-picker") {
        body[key] = raw; // ya viene en ISO UTC desde el picker
      } else {
        body[key] = raw;
      }
    });

    try {
      const data = await mutation.mutateAsync({ action, pathValues, body });
      const message = (data && typeof data === "object" && "message" in data)
        ? String((data as { message: string }).message)
        : "Acción ejecutada correctamente.";
      setResult({ ok: true, message });
      setConfirming(false);
      setValuesState({});
      setReason("");
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
      setResult({ ok: false, message: typeof detail === "string" ? detail : "Ocurrió un error al ejecutar la acción." });
      setConfirming(false);
    }
  };

  const renderField = (field: GodModeField) => {
    const value = values[field.name] ?? "";

    switch (field.type) {
      case "teacher-select": {
        // Solo el campo "teacher_id" dispara el reseteo en cascada
        // (alumno/enrollment/clase dependen de él). Un segundo
        // teacher-select con otro nombre (ej. "to_teacher_id" al
        // transferir alumno) es independiente y no resetea nada.
        const isPrimary = field.name === "teacher_id";
        return (
          <SelectShell value={value} onChange={isPrimary ? setTeacherId : (v => setValue(field.name, v))} placeholder="Elige un profesor">
            {teachers.map(t => <option key={t.id} value={t.id}>{t.name} (@{t.username})</option>)}
          </SelectShell>
        );
      }

      case "student-select":
        return (
          <SelectShell value={value} onChange={setStudentId} disabled={!teacherId} loading={loadingStudents}
            placeholder={!teacherId ? "Elige un profesor primero" : "Elige un alumno"}>
            {students.map(s => <option key={s.id} value={s.id}>{s.name} (@{s.username})</option>)}
          </SelectShell>
        );

      case "enrollment-select":
        return (
          <SelectShell value={value} onChange={setEnrollmentId} disabled={!studentId} loading={loadingEnrollments}
            placeholder={!studentId ? "Elige un alumno primero" : "— sin enrollment (ej. trial) —"}>
            {enrollments.map(e => (
              <option key={e.id} value={e.id}>
                #{e.id} · {e.package_name} ({e.subject ?? "sin materia"}) · {e.classes_used}/{e.classes_total ?? "∞"} · {e.status}
              </option>
            ))}
          </SelectShell>
        );

      case "class-select":
        return (
          <SelectShell value={value} onChange={setClassId} disabled={!studentId} loading={loadingClasses}
            placeholder={!studentId ? "Elige profesor y alumno primero" : "Elige la clase"}>
            {classes.map(c => (
              <option key={c.id} value={c.id}>
                #{c.id} · {new Date(c.start_time_utc).toLocaleString("es", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })} · {c.subject ?? "sin materia"} · {c.status}
              </option>
            ))}
          </SelectShell>
        );

      case "package-select":
        return (
          <SelectShell value={value} onChange={v => setValue(field.name, v)} disabled={!teacherId} loading={loadingPackages}
            placeholder={!teacherId ? "Elige un profesor primero" : "Elige el paquete"}>
            {packages.map(p => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.subject} · {p.is_unlimited ? "ilimitado" : `${p.classes_count} clases`}
              </option>
            ))}
          </SelectShell>
        );

      case "cohort-select":
        return (
          <SelectShell value={value} onChange={v => setValue(field.name, v)} disabled={!teacherId} loading={loadingCohorts}
            placeholder={!teacherId ? "Elige un profesor primero" : "— sin cohorte (individual) —"}>
            {cohorts.map(c => (
              <option key={c.id} value={c.id}>
                #{c.id} · {c.package_name} ({c.subject ?? "sin materia"}) · {c.current_students}/{c.max_students} · {c.status}
              </option>
            ))}
          </SelectShell>
        );

      case "payment-select":
        return (
          <SelectShell value={value} onChange={v => setValue(field.name, v)} disabled={!studentId} loading={loadingPayments}
            placeholder={!studentId ? "Elige profesor y alumno primero" : "Elige el pago"}>
            {payments.map(p => (
              <option key={p.id} value={p.id}>
                #{p.id} · ${p.amount_total} · {p.payment_method} · {p.status} · {new Date(p.created_at).toLocaleDateString("es", { day: "2-digit", month: "short", year: "numeric" })}
              </option>
            ))}
          </SelectShell>
        );

      case "review-student-select":
        return (
          <SelectShell value={value} onChange={v => setValue(field.name, v)} disabled={!teacherId} loading={loadingReviewableStudents}
            placeholder={!teacherId ? "Elige un profesor primero" : "— sin cuenta / no encontrado —"}>
            {reviewableStudents.map(s => <option key={s.id} value={s.id}>{s.name} (@{s.username})</option>)}
          </SelectShell>
        );

      case "review-select":
        return (
          <SelectShell value={value} onChange={v => setValue(field.name, v)} disabled={!teacherId} loading={loadingReviews}
            placeholder={!teacherId ? "Elige un profesor primero" : "Elige la reseña"}>
            {reviews.map(r => (
              <option key={r.id} value={r.id}>
                #{r.id} · {r.student_name} · {r.rating}★ · {r.is_legacy ? "legacy" : "normal"} · {new Date(r.created_at).toLocaleDateString("es", { day: "2-digit", month: "short", year: "numeric" })}
              </option>
            ))}
          </SelectShell>
        );

      case "subject-display": {
        const hasEnrollment = !!values["enrollment_id"];
        if (hasEnrollment) {
          return <input disabled value={value || "—"} className={baseInputClasses} />;
        }
        return (
          <input
            type="text"
            value={value}
            onChange={e => setValue(field.name, e.target.value)}
            placeholder="Materia / idioma (sin enrollment asociado)"
            className={baseInputClasses}
          />
        );
      }

      case "availability-picker": {
        const durationOk = !!values["duration_minutes"];
        const canOpen = !!teacherId && durationOk;
        return (
          <>
            <button
              type="button"
              disabled={!canOpen}
              onClick={() => setPickerOpenFor(field.name)}
              className={`${baseInputClasses} flex items-center justify-between text-left`}
            >
              <span className={value ? "text-slate-800 font-semibold" : "text-slate-400"}>
                {value
                  ? new Date(value).toLocaleString("es", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) + ` (hora local: ${formatTimeTz(value, myTz)})`
                  : !teacherId ? "Elige un profesor primero" : !durationOk ? "Indica la duración primero" : "Elegir horario disponible"}
              </span>
              <Clock className="w-4 h-4 text-pink-400 flex-shrink-0" />
            </button>
            {pickerOpenFor === field.name && teacherId && (
              <GodModeAvailabilityPicker
                teacherUsername={teachers.find(t => t.id === teacherId)?.username ?? ""}
                duration={Number(values["duration_minutes"] || 50)}
                classType={(values["class_type"] as "trial" | "regular" | "group") || (classes.find(c => String(c.id) === values["class_id"])?.class_type as "trial" | "regular" | "group") || "regular"}
                onClose={() => setPickerOpenFor(null)}
                onSelect={(slot: AvailableSlot) => {
                  setValue(field.name, slot.start_time_utc);
                  setPickerOpenFor(null);
                }}
              />
            )}
          </>
        );
      }

      case "duration-select": {
        const classType = values["class_type"] || classes.find(c => String(c.id) === values["class_id"])?.class_type || "regular";
        const options = classType === "trial"
          ? [durations.trial_duration_minutes]
          : durations.allowed_class_durations;
        return (
          <SelectShell value={value} onChange={v => setValue(field.name, v)} placeholder="Elige la duración">
            {options.map(d => <option key={d} value={d}>{d} minutos</option>)}
          </SelectShell>
        );
      }

      case "tri-bool-select":
        return (
          <SelectShell value={value} onChange={v => setValue(field.name, v)} placeholder="Automático (según el estado)">
            <option value="true">Sí — resta 1 crédito</option>
            <option value="false">No — no resta crédito</option>
          </SelectShell>
        );

      case "credit-info": {
        let enr = enrollments.find(e => String(e.id) === values["enrollment_id"]);
        if (!enr) {
          const cls = classes.find(c => String(c.id) === values["class_id"]);
          if (cls?.enrollment_id) enr = enrollments.find(e => e.id === cls.enrollment_id);
        }
        if (!enr) {
          return (
            <p className="text-xs text-slate-400 italic bg-slate-50 rounded-xl px-3 py-2.5">
              Sin enrollment asociado — no hay créditos que mostrar.
            </p>
          );
        }
        const balance = enr.is_unlimited
          ? `${enr.prepaid_unlimited_credits} créditos ilimitados prepagados`
          : `${enr.unlocked_credits} créditos disponibles`;
        return (
          <div className="bg-pink-50/70 border border-pink-100 rounded-xl px-3 py-2.5 text-xs font-bold text-pink-700">
            {balance} · usadas {enr.classes_used}/{enr.classes_total ?? "∞"}
          </div>
        );
      }

      case "payment-info": {
        const pay = payments.find(p => String(p.id) === values["payment_id"]);
        if (!pay) return null;

        const movesWallet = !pay.is_manual_grant && pay.payment_type !== "refund";
        const newAmount = values["amount_total"];
        const newStatus = values["status"];
        const editingApprovedAmount = movesWallet && pay.status === "approved" && !!newAmount && Number(newAmount) !== pay.amount_total;
        const togglingApproval = movesWallet && !!newStatus && newStatus !== pay.status && (pay.status === "approved" || newStatus === "approved");
        const willMoveWallet = editingApprovedAmount || togglingApproval;

        return (
          <div className="space-y-1.5">
            <div className="bg-slate-50 border border-slate-100 rounded-xl px-3 py-2.5 text-xs font-bold text-slate-600">
              Actual: ${pay.amount_total} total · ${pay.amount_teacher} para el profesor · estado <span className="lowercase">{pay.status}</span>
            </div>
            {willMoveWallet && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 text-xs font-bold text-amber-700 flex items-start gap-2">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                Este cambio va a ajustar la billetera del profesor de inmediato (no solo el registro del pago).
              </div>
            )}
          </div>
        );
      }

      case "review-info": {
        const rev = reviews.find(r => String(r.id) === values["review_id"]);
        if (!rev) return null;
        return (
          <div className="bg-slate-50 border border-slate-100 rounded-xl px-3 py-2.5 text-xs font-bold text-slate-600 space-y-0.5">
            <div>
              {rev.student_name} · {rev.rating}★ · {rev.is_legacy ? "legacy" : "normal"} · {new Date(rev.created_at).toLocaleDateString("es", { day: "2-digit", month: "short", year: "numeric" })}
            </div>
            <div className="text-slate-400 font-semibold">
              {rev.total_completed_classes ?? "—"} clases completadas con este profesor
            </div>
            {rev.comment && <div className="text-slate-400 font-semibold italic">&quot;{rev.comment}&quot;</div>}
          </div>
        );
      }

      case "select":
        return (
          <SelectShell value={value} onChange={v => setValue(field.name, v)} placeholder="— sin cambio —">
            {field.options?.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </SelectShell>
        );

      case "checkbox":
        return (
          <label className="flex items-start gap-2.5 text-xs font-semibold text-slate-700 cursor-pointer bg-white border border-slate-200 rounded-xl px-3 py-2.5">
            <input
              type="checkbox"
              checked={value === "true"}
              onChange={e => setValue(field.name, e.target.checked ? "true" : "")}
              className="w-4 h-4 mt-0.5 rounded accent-pink-500 flex-shrink-0"
            />
            <span>{field.label}</span>
          </label>
        );

      case "textarea":
        return (
          <textarea
            value={value}
            onChange={e => setValue(field.name, e.target.value)}
            placeholder={field.placeholder}
            rows={3}
            className={`${baseInputClasses} resize-none`}
          />
        );

      case "datetime":
        return (
          <input type="datetime-local" value={value} onChange={e => setValue(field.name, e.target.value)} className={baseInputClasses} />
        );

      default:
        return (
          <input
            type={field.type === "number" ? "number" : "text"}
            value={value}
            onChange={e => setValue(field.name, e.target.value)}
            placeholder={field.placeholder}
            className={baseInputClasses}
          />
        );
    }
  };

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-black text-slate-800">{action.label}</h3>
            {action.destructive && <Badge variant="danger">Irreversible</Badge>}
          </div>
          <p className="text-xs text-slate-500 mt-1">{action.description}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {action.fields.map(field => {
          // Los checkboxes muestran su propio label inline; "credit-info"
          // tiene label vacío a propósito (es solo un panel informativo).
          // Ocultar la etiqueta superior en ambos casos evita duplicarla.
          const showLabelRow = field.type !== "checkbox" && field.type !== "credit-info" && field.label !== "";
          return (
            <div key={field.name} className={field.type === "checkbox" ? "flex items-end pb-1" : ""}>
              {showLabelRow && (
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
                  {field.label} {field.required && <span className="text-rose-400">*</span>}
                </label>
              )}
              {renderField(field)}
              {field.helpText && (
                <p className="text-[10px] text-slate-400 mt-1">{field.helpText}</p>
              )}
            </div>
          );
        })}
      </div>

      <div className="pt-2 border-t border-slate-100">
        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
          Motivo (obligatorio) <span className="text-rose-400">*</span>
        </label>
        <textarea
          value={reason}
          onChange={e => { setReason(e.target.value); setResult(null); }}
          placeholder="Explica por qué haces este cambio — queda en el log de auditoría."
          rows={2}
          className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-800
                     placeholder:text-slate-400 resize-none focus:outline-none focus:ring-2 focus:ring-pink-200 focus:border-pink-300"
        />
      </div>

      {result && (
        <div className={`text-xs font-semibold p-3 rounded-xl ${result.ok
          ? "bg-emerald-50 text-emerald-700 border border-emerald-100"
          : "bg-rose-50 text-rose-700 border border-rose-100"}`}
        >
          {result.message}
        </div>
      )}

      {!confirming ? (
        <Button
          variant={action.destructive ? "danger" : "primary"}
          disabled={missingRequired || reasonInvalid}
          onClick={() => setConfirming(true)}
          className="w-full justify-center"
        >
          <Zap className="w-4 h-4" />
          Ejecutar
        </Button>
      ) : (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 space-y-3">
          <p className="text-xs font-bold text-amber-800 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            Esto se aplica de inmediato y queda registrado en el log. ¿Confirmas?
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setConfirming(false)}
              className="flex-1 py-2.5 text-xs font-bold text-slate-600 bg-white hover:bg-slate-100 rounded-xl transition-colors border border-slate-200"
            >
              Cancelar
            </button>
            <Button
              variant="danger"
              loading={mutation.isPending}
              onClick={handleSubmit}
              className="flex-1 justify-center"
            >
              Sí, ejecutar
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
