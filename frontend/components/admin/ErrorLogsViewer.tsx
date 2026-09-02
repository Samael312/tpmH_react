"use client";

import { useState } from "react";
import { AlertOctagon, ChevronDown, ChevronUp, Monitor, Server } from "lucide-react";
import { Card, Badge, Skeleton, StatCard, RefreshButton } from "@/components/ui";
import { useErrorLogs, useErrorLogStats, useErrorLogUsers, ErrorLogEntry } from "@/hooks/useErrorLogs";
import { usePageTopBar } from "@/lib/mobileTopBar";

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("es-ES", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function LogRow({ entry }: { entry: ErrorLogEntry }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border border-slate-100 rounded-2xl p-4 bg-white">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant={entry.level === "error" ? "danger" : "warning"}>{entry.level}</Badge>
            <Badge variant={entry.source === "backend" ? "info" : "pink"}>
              {entry.source === "backend" ? <Server className="w-3 h-3 mr-1 inline" /> : <Monitor className="w-3 h-3 mr-1 inline" />}
              {entry.source}
            </Badge>
            {entry.status_code && <Badge variant="neutral">{entry.status_code}</Badge>}
            {entry.screen && (
              <span className="text-[11px] font-mono text-slate-400 truncate max-w-[260px]">{entry.screen}</span>
            )}
          </div>
          <p className="text-sm text-slate-700 mt-2 break-words">{entry.message}</p>
          <p className="text-[11px] text-slate-400 mt-1">
            {entry.user_name ? (
              <>
                {entry.user_name}
                {entry.user_role && <span className="text-slate-300"> · {entry.user_role}</span>}
              </>
            ) : (
              "Usuario anónimo / no identificado"
            )}
            {" · "}
            {formatDate(entry.created_at)}
            {entry.method && <span className="text-slate-300"> · {entry.method}</span>}
          </p>
        </div>
        {entry.detail && (
          <button
            onClick={() => setOpen(!open)}
            className="flex-shrink-0 text-slate-400 hover:text-pink-500 transition-colors"
          >
            {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        )}
      </div>

      {open && entry.detail && (
        <div className="mt-3 pt-3 border-t border-slate-100">
          <p className="font-black text-slate-400 uppercase tracking-widest text-[9px] mb-1.5">
            Detalle / stack trace
          </p>
          <pre className="whitespace-pre-wrap text-slate-600 font-mono text-[11px] bg-slate-50 rounded-xl p-3 max-h-64 overflow-y-auto custom-scrollbar">
            {entry.detail}
          </pre>
          {entry.extra_data && (
            <pre className="whitespace-pre-wrap text-slate-500 font-mono text-[11px] bg-slate-50 rounded-xl p-3 mt-2">
              {JSON.stringify(entry.extra_data, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

export default function ErrorLogsViewer() {
  const [source, setSource] = useState<string>("");
  const [level, setLevel] = useState<string>("");
  const [screen, setScreen] = useState("");
  const [userId, setUserId] = useState<string>("");
  const [page, setPage] = useState(1);
  const pageSize = 30;

  const { users } = useErrorLogUsers();

  const { stats, refetch: refetchStats, isFetching: statsFetching } = useErrorLogStats();
  const { items, total, loading, isFetching: logsFetching, refetch: refetchLogs } = useErrorLogs({
    source: source ? (source as "backend" | "frontend") : undefined,
    level: level ? (level as "error" | "warning") : undefined,
    screen: screen || undefined,
    user_id: userId ? Number(userId) : undefined,
    page,
    page_size: pageSize,
  });

  const isFetching = statsFetching || logsFetching;
  const handleRefresh = () => {
    refetchStats();
    refetchLogs();
  };

  // Registra título + refresh en la topbar mobile (la renderiza el layout de admin)
  usePageTopBar({ title: "Logs", onRefresh: handleRefresh, isFetching });

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Últimas 24h" value={stats?.last_24h ?? "—"} icon={<AlertOctagon className="w-5 h-5" />} />
        <StatCard label="Errores" value={stats?.errors ?? "—"} changeType="down" />
        <StatCard label="Advertencias" value={stats?.warnings ?? "—"} changeType="warning" />
        <StatCard label="Total registrado" value={stats?.total ?? "—"} changeType="neutral" />
      </div>

      <Card className="p-5 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <AlertOctagon className="w-4 h-4 text-pink-500" />
            <h3 className="text-sm font-black text-slate-800">Logs de errores</h3>
            <Badge variant="neutral">{total}</Badge>
            <RefreshButton onRefresh={handleRefresh} isFetching={isFetching} className="hidden md:flex" />
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <input
              value={screen}
              onChange={(e) => { setScreen(e.target.value); setPage(1); }}
              placeholder="Buscar por pantalla/endpoint..."
              className="text-xs font-bold border border-slate-200 rounded-xl px-3 py-2 bg-white text-slate-600 w-56"
            />
            <select
              value={userId}
              onChange={(e) => { setUserId(e.target.value); setPage(1); }}
              className="text-xs font-bold border border-slate-200 rounded-xl px-3 py-2 bg-white text-slate-600 max-w-[180px]"
            >
              <option value="">Todos los usuarios</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
            <select
              value={source}
              onChange={(e) => { setSource(e.target.value); setPage(1); }}
              className="text-xs font-bold border border-slate-200 rounded-xl px-3 py-2 bg-white text-slate-600"
            >
              <option value="">Backend y Frontend</option>
              <option value="backend">Solo Backend</option>
              <option value="frontend">Solo Frontend</option>
            </select>
            <select
              value={level}
              onChange={(e) => { setLevel(e.target.value); setPage(1); }}
              className="text-xs font-bold border border-slate-200 rounded-xl px-3 py-2 bg-white text-slate-600"
            >
              <option value="">Errores y Advertencias</option>
              <option value="error">Solo Errores</option>
              <option value="warning">Solo Advertencias</option>
            </select>
          </div>
        </div>

        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-20 rounded-2xl" />
            <Skeleton className="h-20 rounded-2xl" />
            <Skeleton className="h-20 rounded-2xl" />
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-8">
            No hay errores registrados con estos filtros. 🎉
          </p>
        ) : (
          <div className={`space-y-2 max-h-[600px] overflow-y-auto custom-scrollbar pr-1 ${isFetching ? "opacity-70" : ""}`}>
            {items.map((entry) => <LogRow key={entry.id} entry={entry} />)}
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="text-xs font-bold px-3 py-2 rounded-xl border border-slate-200 text-slate-500 disabled:opacity-40"
            >
              Anterior
            </button>
            <span className="text-xs text-slate-400">Página {page} de {totalPages}</span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="text-xs font-bold px-3 py-2 rounded-xl border border-slate-200 text-slate-500 disabled:opacity-40"
            >
              Siguiente
            </button>
          </div>
        )}
      </Card>
    </div>
  );
}
