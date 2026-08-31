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

  const myTz = getMyDisplayTimezone();

  const setValue = (name: string, v: string) => {
    setValuesState(prev => ({ ...prev, [name]: v }));
    setResult(null);
  };

  // Elegir un profesor distinto invalida todo lo que dependía de él.
  const setTeacherId = (v: string) => {
    setValuesState(prev => ({
      ...prev, teacher_id: v, student_id: "", enrollment_id: "", subject: "", class_id: "", start_time_utc: "",
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
    action.fields.filter(f => f.isPathParam).forEach(f => { pathValues[f.name] = values[f.name] ?? ""; });

    const body: Record<string, unknown> = { reason: reason.trim() };
    action.fields.filter(f => !f.isPathParam && !f.excludeFromPayload).forEach(f => {
      const raw = values[f.name];
      if (raw === undefined || raw === "") return; // campo opcional sin valor: se omite (ajuste parcial en backend)

      if (f.type === "number" || f.type === "enrollment-select" || f.type === "class-select" || f.type === "teacher-select" || f.type === "student-select") {
        body[f.name] = Number(raw);
      } else if (f.type === "checkbox") {
        body[f.name] = raw === "true";
      } else if (f.type === "datetime") {
        body[f.name] = new Date(raw).toISOString();
      } else if (f.type === "availability-picker") {
        body[f.name] = raw; // ya viene en ISO UTC desde el picker
      } else {
        body[f.name] = raw;
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
      case "teacher-select":
        return (
          <SelectShell value={value} onChange={setTeacherId} placeholder="Elige un profesor">
            {teachers.map(t => <option key={t.id} value={t.id}>{t.name} (@{t.username})</option>)}
          </SelectShell>
        );

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

      case "subject-display": {
        const hasEnrollment = !!values["enrollment_id"];
        if (hasEnrollment) {
          return (
            <input disabled value={value || "—"} className={baseInputClasses} />
          );
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

      case "select":
        return (
          <SelectShell value={value} onChange={v => setValue(field.name, v)} placeholder="— sin cambio —">
            {field.options?.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </SelectShell>
        );

      case "checkbox":
        return (
          <label className="flex items-center gap-2 text-sm text-slate-700 font-medium cursor-pointer">
            <input
              type="checkbox"
              checked={value === "true"}
              onChange={e => setValue(field.name, e.target.checked ? "true" : "")}
              className="w-4 h-4 rounded accent-pink-500"
            />
            Sí
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
        {action.fields.map(field => (
          <div key={field.name} className={field.type === "checkbox" ? "flex items-end pb-1" : ""}>
            {field.type !== "checkbox" && (
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
                {field.label} {field.required && <span className="text-rose-400">*</span>}
              </label>
            )}
            {renderField(field)}
          </div>
        ))}
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
