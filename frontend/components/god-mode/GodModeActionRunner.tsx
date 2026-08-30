"use client";

import { useState } from "react";
import { AlertTriangle, Zap } from "lucide-react";
import { Card, Button, Badge } from "@/components/ui";
import { GodModeAction, GodModeField } from "@/lib/godModeActions";
import { useRunGodModeAction } from "@/hooks/useGodMode";

function FieldInput({
  field, value, onChange,
}: { field: GodModeField; value: string; onChange: (v: string) => void }) {
  const base = "w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-800 " +
    "placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-pink-200 focus:border-pink-300";

  if (field.type === "select") {
    return (
      <select value={value} onChange={e => onChange(e.target.value)} className={base}>
        <option value="">— sin cambio —</option>
        {field.options?.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    );
  }

  if (field.type === "checkbox") {
    return (
      <label className="flex items-center gap-2 text-sm text-slate-700 font-medium cursor-pointer">
        <input
          type="checkbox"
          checked={value === "true"}
          onChange={e => onChange(e.target.checked ? "true" : "")}
          className="w-4 h-4 rounded accent-pink-500"
        />
        Sí
      </label>
    );
  }

  if (field.type === "textarea") {
    return (
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={field.placeholder}
        rows={3}
        className={`${base} resize-none`}
      />
    );
  }

  if (field.type === "datetime") {
    return (
      <input
        type="datetime-local"
        value={value}
        onChange={e => onChange(e.target.value)}
        className={base}
      />
    );
  }

  return (
    <input
      type={field.type === "number" ? "number" : "text"}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={field.placeholder}
      className={base}
    />
  );
}

export default function GodModeActionRunner({ action }: { action: GodModeAction }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const mutation = useRunGodModeAction();

  const setValue = (name: string, v: string) => {
    setValues(prev => ({ ...prev, [name]: v }));
    setResult(null);
  };

  const missingRequired = [...action.pathParams, ...action.bodyFields]
    .filter(f => f.required)
    .some(f => !values[f.name]?.trim());

  const reasonInvalid = reason.trim().length < 5;

  const handleSubmit = async () => {
    if (missingRequired || reasonInvalid) {
      setConfirming(false);
      return;
    }

    const pathValues: Record<string, string> = {};
    action.pathParams.forEach(f => { pathValues[f.name] = values[f.name] ?? ""; });

    const body: Record<string, unknown> = { reason: reason.trim() };
    action.bodyFields.forEach(f => {
      const raw = values[f.name];
      if (raw === undefined || raw === "") {
        // Campo opcional sin valor: se omite del body (ajuste parcial en backend)
        return;
      }
      if (f.type === "number") {
        body[f.name] = Number(raw);
      } else if (f.type === "checkbox") {
        body[f.name] = raw === "true";
      } else if (f.type === "datetime") {
        body[f.name] = new Date(raw).toISOString();
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
      setValues({});
      setReason("");
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
      setResult({ ok: false, message: typeof detail === "string" ? detail : "Ocurrió un error al ejecutar la acción." });
      setConfirming(false);
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

      {action.pathParams.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {action.pathParams.map(field => (
            <div key={field.name}>
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
                {field.label} {field.required && <span className="text-rose-400">*</span>}
              </label>
              <FieldInput field={field} value={values[field.name] ?? ""} onChange={v => setValue(field.name, v)} />
            </div>
          ))}
        </div>
      )}

      {action.bodyFields.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-100">
          {action.bodyFields.map(field => (
            <div key={field.name} className={field.type === "checkbox" ? "flex items-end pb-1" : ""}>
              {field.type !== "checkbox" && (
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
                  {field.label} {field.required && <span className="text-rose-400">*</span>}
                </label>
              )}
              <FieldInput field={field} value={values[field.name] ?? ""} onChange={v => setValue(field.name, v)} />
            </div>
          ))}
        </div>
      )}

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
