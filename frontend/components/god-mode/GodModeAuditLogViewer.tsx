"use client";

import { useState } from "react";
import { History, ChevronDown, ChevronUp } from "lucide-react";
import { Card, Badge, Skeleton } from "@/components/ui";
import { useGodModeAuditLog, GodModeAuditLogEntry } from "@/hooks/useGodMode";

const ENTITY_TYPES = ["enrollment", "cohort", "class", "payment", "student"];

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("es-ES", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function DiffRow({ entry }: { entry: GodModeAuditLogEntry }) {
  const [open, setOpen] = useState(false);
  const hasDiff = entry.before_data || entry.after_data;

  return (
    <div className="border border-slate-100 rounded-2xl p-4 bg-white">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="pink">{entry.action}</Badge>
            <Badge variant="neutral">{entry.entity_type} #{entry.entity_id}</Badge>
            <Badge variant={entry.actor_role === "superadmin" ? "gold" : "info"}>{entry.actor_role}</Badge>
          </div>
          <p className="text-sm text-slate-700 mt-2">{entry.reason}</p>
          <p className="text-[11px] text-slate-400 mt-1">
            {entry.actor_name ?? `Usuario #${entry.actor_user_id}`} · {formatDate(entry.created_at)}
          </p>
        </div>
        {hasDiff && (
          <button
            onClick={() => setOpen(!open)}
            className="flex-shrink-0 text-slate-400 hover:text-pink-500 transition-colors"
          >
            {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        )}
      </div>

      {open && hasDiff && (
        <div className="mt-3 pt-3 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          {entry.before_data && (
            <div className="bg-rose-50/50 rounded-xl p-3">
              <p className="font-black text-rose-400 uppercase tracking-widest text-[9px] mb-1.5">Antes</p>
              <pre className="whitespace-pre-wrap text-slate-600 font-mono text-[11px]">
                {JSON.stringify(entry.before_data, null, 2)}
              </pre>
            </div>
          )}
          {entry.after_data && (
            <div className="bg-emerald-50/50 rounded-xl p-3">
              <p className="font-black text-emerald-500 uppercase tracking-widest text-[9px] mb-1.5">Después</p>
              <pre className="whitespace-pre-wrap text-slate-600 font-mono text-[11px]">
                {JSON.stringify(entry.after_data, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function GodModeAuditLogViewer() {
  const [entityType, setEntityType] = useState<string>("");
  const { items, total, loading } = useGodModeAuditLog({ entity_type: entityType || undefined, limit: 50 });

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-pink-500" />
          <h3 className="text-sm font-black text-slate-800">Historial de auditoría</h3>
          <Badge variant="neutral">{total}</Badge>
        </div>
        <select
          value={entityType}
          onChange={e => setEntityType(e.target.value)}
          className="text-xs font-bold border border-slate-200 rounded-xl px-3 py-2 bg-white text-slate-600"
        >
          <option value="">Todas las entidades</option>
          {ENTITY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-20 rounded-2xl" />
          <Skeleton className="h-20 rounded-2xl" />
          <Skeleton className="h-20 rounded-2xl" />
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-8">Todavía no hay acciones de Modo Dios registradas.</p>
      ) : (
        <div className="space-y-2 max-h-[600px] overflow-y-auto custom-scrollbar pr-1">
          {items.map(entry => <DiffRow key={entry.id} entry={entry} />)}
        </div>
      )}
    </Card>
  );
}
