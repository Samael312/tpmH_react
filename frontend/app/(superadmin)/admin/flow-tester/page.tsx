"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Play, Loader2, CheckCircle2, XCircle, SkipForward,
  ChevronDown, ChevronRight, AlertTriangle, Clock, ListChecks,
} from "lucide-react";
import api from "@/lib/api";
import { Card, Badge, Button } from "@/components/ui";
import { usePageTopBar } from "@/lib/mobileTopBar";

// ─── Tipos (calcan la respuesta de /api/v1/flow-tests) ────────────────────

interface FlowTestResult {
  node_id: string;
  module: string;
  name: string;
  outcome: "passed" | "failed" | "skipped" | string;
  duration: number;
  message: string | null;
}

interface FlowTestSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
}

interface FlowTestRunResponse {
  run_id: string;
  status: "running" | "completed";
  include_destructive: boolean;
  started_at: string;
  finished_at: string | null;
  return_code: number | null;
  stderr_tail: string | null;
  tests: FlowTestResult[];
  summary: FlowTestSummary;
}

const POLL_INTERVAL_MS = 1200;

function formatDuration(seconds: number): string {
  if (seconds < 1) return `${Math.round(seconds * 1000)}ms`;
  return `${seconds.toFixed(2)}s`;
}

function prettyTestName(name: string): string {
  // "test_foo[param]" -> "test_foo · param" (más legible en la lista)
  const match = name.match(/^([^[]+)\[(.+)]$/);
  if (!match) return name;
  return `${match[1]} · ${match[2]}`;
}

function outcomeIcon(outcome: string) {
  switch (outcome) {
    case "passed":
      return <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />;
    case "failed":
      return <XCircle className="w-4 h-4 text-rose-500 flex-shrink-0" />;
    case "skipped":
      return <SkipForward className="w-4 h-4 text-amber-500 flex-shrink-0" />;
    default:
      return <Loader2 className="w-4 h-4 text-slate-400 animate-spin flex-shrink-0" />;
  }
}

function groupByModule(tests: FlowTestResult[]): Map<string, FlowTestResult[]> {
  const groups = new Map<string, FlowTestResult[]>();
  for (const t of tests) {
    const list = groups.get(t.module) ?? [];
    list.push(t);
    groups.set(t.module, list);
  }
  return groups;
}

export default function FlowTesterPage() {
  const [run, setRun] = useState<FlowTestRunResponse | null>(null);
  const [includeDestructive, setIncludeDestructive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [collapsedModules, setCollapsedModules] = useState<Set<string>>(new Set());

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const runIdRef = useRef<string | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const fetchRun = useCallback(async (runId: string) => {
    try {
      const { data } = await api.get<FlowTestRunResponse>(`/flow-tests/${runId}`);
      setRun(data);
      if (data.status === "completed") stopPolling();
    } catch (e: unknown) {
      setError(extractErrorMessage(e));
      stopPolling();
    }
  }, [stopPolling]);

  const startRun = useCallback(async () => {
    setError(null);
    setStarting(true);
    stopPolling();
    try {
      const { data } = await api.post<FlowTestRunResponse>("/flow-tests/run", {
        include_destructive: includeDestructive,
      });
      setRun(data);
      runIdRef.current = data.run_id;
      setExpanded(new Set());
      if (data.status === "running") {
        pollRef.current = setInterval(() => fetchRun(data.run_id), POLL_INTERVAL_MS);
      }
    } catch (e: unknown) {
      setError(extractErrorMessage(e));
    } finally {
      setStarting(false);
    }
  }, [includeDestructive, fetchRun, stopPolling]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  usePageTopBar({ title: "Flow Tests", onRefresh: startRun, isFetching: run?.status === "running" || starting });

  const toggleExpanded = (nodeId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId); else next.add(nodeId);
      return next;
    });
  };

  const toggleModule = (module: string) => {
    setCollapsedModules((prev) => {
      const next = new Set(prev);
      if (next.has(module)) next.delete(module); else next.add(module);
      return next;
    });
  };

  const isRunning = run?.status === "running";
  const groups = run ? groupByModule(run.tests) : new Map<string, FlowTestResult[]>();
  const elapsedSeconds = run
    ? ((run.finished_at ? new Date(run.finished_at).getTime() : Date.now()) - new Date(run.started_at).getTime()) / 1000
    : 0;

  return (
    <div className="space-y-6 pb-10">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-black text-slate-900">Flow Tests</h1>
        <p className="text-sm text-slate-500 mt-1 max-w-2xl">
          Corre <code className="px-1.5 py-0.5 bg-slate-100 rounded text-xs">backend/tests/flow</code> contra
          el backend y la base de datos reales de este entorno, usando 4 cuentas fijas de prueba.
          Todo lo que los tests crean (clases, materiales, pagos, tareas...) se borra solo al terminar —
          no queda basura en la BD.
        </p>
      </div>

      {/* Controles */}
      <Card className="p-5">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:justify-between">
          <label className="flex items-start gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={includeDestructive}
              onChange={(e) => setIncludeDestructive(e.target.checked)}
              disabled={isRunning || starting}
              className="mt-1 w-4 h-4 rounded border-slate-300 text-pink-500 focus:ring-pink-400"
            />
            <span>
              <span className="block text-sm font-bold text-slate-800">
                Incluir tests destructivos
              </span>
              <span className="block text-xs text-slate-500 mt-0.5 max-w-md">
                Prueba el flujo completo de compra (reserva de prueba gratuita → paquete → pago → clase).
                Usa el modo dios para forzar estados. Se limpia igual al terminar, pero tarda más.
              </span>
            </span>
          </label>

          <Button
            variant="primary"
            onClick={startRun}
            disabled={isRunning || starting}
            loading={starting}
          >
            {!starting && (isRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />)}
            {isRunning ? "Corriendo..." : "Ejecutar suite"}
          </Button>
        </div>
      </Card>

      {/* Error banner */}
      {error && (
        <Card className="p-4 border-rose-200 bg-rose-50">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-rose-700">No se pudo ejecutar la suite</p>
              <p className="text-sm text-rose-600 mt-1 whitespace-pre-wrap">{error}</p>
            </div>
          </div>
        </Card>
      )}

      {/* Resultado */}
      {run && (
        <>
          {/* Resumen */}
          <Card className="p-5">
            <div className="flex flex-wrap items-center gap-3 justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={isRunning ? "info" : run.summary.failed > 0 ? "danger" : "success"}>
                  {isRunning ? "En curso" : run.summary.failed > 0 ? "Con fallos" : "Todo verde"}
                </Badge>
                <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                  <Clock className="w-3.5 h-3.5" /> {formatDuration(elapsedSeconds)}
                </span>
                <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                  <ListChecks className="w-3.5 h-3.5" /> {run.summary.total} tests
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="success">{run.summary.passed} ok</Badge>
                {run.summary.failed > 0 && <Badge variant="danger">{run.summary.failed} fallos</Badge>}
                {run.summary.skipped > 0 && <Badge variant="warning">{run.summary.skipped} saltados</Badge>}
              </div>
            </div>

            {isRunning && (
              <div className="mt-4 h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full bg-pink-400 animate-pulse" style={{ width: "60%" }} />
              </div>
            )}

            {run.stderr_tail && (
              <div className="mt-4 p-3 bg-slate-900 rounded-xl">
                <p className="text-[10px] uppercase tracking-wider font-bold text-slate-400 mb-1">
                  Salida de error del proceso
                </p>
                <pre className="text-xs text-rose-300 whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
                  {run.stderr_tail}
                </pre>
              </div>
            )}
          </Card>

          {/* Lista agrupada por módulo */}
          <div className="space-y-3">
            {Array.from(groups.entries()).map(([module, tests]) => {
              const failedCount = tests.filter((t) => t.outcome === "failed").length;
              const isCollapsed = collapsedModules.has(module);
              return (
                <Card key={module} className="overflow-hidden">
                  <button
                    onClick={() => toggleModule(module)}
                    className="w-full flex items-center justify-between px-5 py-3 hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      {isCollapsed ? (
                        <ChevronRight className="w-4 h-4 text-slate-400" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-slate-400" />
                      )}
                      <span className="text-sm font-bold text-slate-800">{module}</span>
                      <span className="text-xs text-slate-400">({tests.length})</span>
                    </div>
                    {failedCount > 0 && <Badge variant="danger">{failedCount} fallos</Badge>}
                  </button>

                  {!isCollapsed && (
                    <div className="border-t border-slate-100 divide-y divide-slate-50">
                      {tests.map((t) => (
                        <div key={t.node_id}>
                          <button
                            onClick={() => t.outcome === "failed" && toggleExpanded(t.node_id)}
                            className={`w-full flex items-center gap-3 px-5 py-2.5 text-left ${
                              t.outcome === "failed" ? "hover:bg-rose-50 cursor-pointer" : "cursor-default"
                            }`}
                          >
                            {outcomeIcon(t.outcome)}
                            <span className="text-sm text-slate-700 flex-1 truncate font-mono text-[13px]">
                              {prettyTestName(t.name)}
                            </span>
                            <span className="text-xs text-slate-400 flex-shrink-0">
                              {formatDuration(t.duration)}
                            </span>
                            {t.outcome === "failed" && (
                              expanded.has(t.node_id)
                                ? <ChevronDown className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                                : <ChevronRight className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                            )}
                          </button>
                          {t.outcome === "failed" && expanded.has(t.node_id) && t.message && (
                            <div className="px-5 pb-3">
                              <pre className="text-xs bg-rose-50 text-rose-700 p-3 rounded-xl whitespace-pre-wrap break-words max-h-64 overflow-y-auto border border-rose-100">
                                {t.message}
                              </pre>
                            </div>
                          )}
                          {t.outcome === "skipped" && t.message && (
                            <div className="px-5 pb-3 -mt-1">
                              <p className="text-xs text-amber-600 pl-7">{t.message}</p>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        </>
      )}

      {!run && !error && (
        <Card className="p-10 text-center text-slate-400">
          <ListChecks className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">Todavía no has corrido la suite en esta sesión.</p>
        </Card>
      )}
    </div>
  );
}

function extractErrorMessage(e: unknown): string {
  const err = e as { response?: { data?: { detail?: string } }; message?: string };
  return err?.response?.data?.detail || err?.message || "Error desconocido al hablar con el backend.";
}
