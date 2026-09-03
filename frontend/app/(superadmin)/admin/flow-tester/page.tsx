"use client";

import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Play, Loader2, CheckCircle2, XCircle, SkipForward, Circle,
  ChevronDown, ChevronRight, AlertTriangle, Clock, ListChecks,
  Info, ShieldAlert, RotateCcw,
} from "lucide-react";
import api from "@/lib/api";
import { Card, Badge, Button } from "@/components/ui";
import ChipiWidget from "@/components/chipi/ChipiWidget";
import { usePageTopBar } from "@/lib/mobileTopBar";
import { getErrorMessage } from "@/lib/errorMessage";

// ─── Tipos (calcan la respuesta de /api/v1/flow-tests) ────────────────────

interface FlowTestManifestEntry {
  node_id: string;
  module: string;
  name: string;
  is_destructive: boolean;
  technical_description: string | null;
  ux_description: string | null;
}

interface FlowTestManifestResponse {
  modules: string[];
  tests: FlowTestManifestEntry[];
}

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
  node_ids: string[] | null;
  started_at: string;
  finished_at: string | null;
  return_code: number | null;
  stderr_tail: string | null;
  tests: FlowTestResult[];
  summary: FlowTestSummary;
}

const POLL_INTERVAL_MS = 1000;

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

function outcomeIcon(outcome: string | undefined) {
  switch (outcome) {
    case "passed":
      return <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />;
    case "failed":
      return <XCircle className="w-4 h-4 text-rose-500 flex-shrink-0" />;
    case "skipped":
      return <SkipForward className="w-4 h-4 text-amber-500 flex-shrink-0" />;
    default:
      return <Circle className="w-3.5 h-3.5 text-slate-300 flex-shrink-0" />;
  }
}

function extractErrorMessage(e: unknown): string {
  return getErrorMessage(e, "Error desconocido al hablar con el backend.");
}

export default function FlowTesterPage() {
  const queryClient = useQueryClient();

  // Manifiesto (enumeración de tests, sin correr nada). Es un GET estable
  // sin parámetros dinámicos: candidato natural para react-query, con el
  // staleTime/gcTime global (ver providers.tsx) en vez de re-pedirlo cada
  // vez que se monta la pantalla.
  const {
    data: manifest,
    isLoading: loadingManifest,
    isError: manifestIsError,
    error: manifestQueryError,
    refetch: loadManifest,
  } = useQuery({
    queryKey: ["admin", "flow-tests", "manifest"],
    queryFn: async () => {
      const { data } = await api.get<FlowTestManifestResponse>("/flow-tests/manifest");
      return data.tests;
    },
  });
  const manifestError = manifestIsError ? extractErrorMessage(manifestQueryError) : null;

  // Selección / configuración
  const [includeDestructive, setIncludeDestructive] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [collapsedModules, setCollapsedModules] = useState<Set<string>>(new Set());
  const [expandedInfo, setExpandedInfo] = useState<Set<string>>(new Set());
  const [expandedFailure, setExpandedFailure] = useState<Set<string>>(new Set());

  // Corrida en curso / resultado
  const [runId, setRunId] = useState<string | null>(null);
  const [expectedNodeIds, setExpectedNodeIds] = useState<string[]>([]);
  const [starting, setStarting] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);

  // Antes esto era un setInterval manual guardado en un useRef, con su
  // propio cleanup en un useEffect de desmontaje. Con react-query,
  // `refetchInterval` hace el polling solo mientras el status siga
  // "running", y se detiene solo (sin fugas de interval) en cuanto la
  // corrida termina, hay un error, o el componente se desmonta.
  const {
    data: run,
    isError: runIsError,
    error: runQueryError,
  } = useQuery({
    queryKey: ["admin", "flow-tests", "run", runId],
    queryFn: async () => {
      const { data } = await api.get<FlowTestRunResponse>(`/flow-tests/${runId}`);
      return data;
    },
    enabled: !!runId,
    refetchInterval: (query) => {
      if (query.state.status === "error") return false;
      return query.state.data?.status === "running" ? POLL_INTERVAL_MS : false;
    },
    // Cada corrida es un dato efímero e irrepetible (efectos secundarios
    // reales sobre la BD real): no tiene sentido servir una versión
    // "fresca por 60s" desde cache mientras está corriendo o recién
    // terminó.
    staleTime: 0,
    retry: false,
  });
  const runError = runIsError ? extractErrorMessage(runQueryError) : null;
  const error = launchError || runError;

  const launchRun = useCallback(async (nodeIds: string[] | null) => {
    setLaunchError(null);
    setStarting(true);
    setExpandedFailure(new Set());
    try {
      const total = nodeIds ?? (manifest ?? [])
        .filter((t) => includeDestructive || !t.is_destructive)
        .map((t) => t.node_id);
      setExpectedNodeIds(total);

      const { data } = await api.post<FlowTestRunResponse>("/flow-tests/run", {
        include_destructive: includeDestructive,
        node_ids: nodeIds,
      });
      // Sembramos el cache con la respuesta inicial del POST para pintar el
      // resultado al instante (sin esperar el primer refetch); el
      // refetchInterval de arriba retoma el polling solo apenas cambie el
      // runId, si status === "running".
      queryClient.setQueryData(["admin", "flow-tests", "run", data.run_id], data);
      setRunId(data.run_id);
    } catch (e: unknown) {
      setLaunchError(extractErrorMessage(e));
    } finally {
      setStarting(false);
    }
  }, [includeDestructive, manifest, queryClient]);

  const isRunning = run?.status === "running";

  usePageTopBar({
    title: "Flow Tests",
    onRefresh: () => launchRun(null),
    isFetching: isRunning || starting,
  });

  // ─── Derivados ────────────────────────────────────────────────────────

  const modules = useMemo(() => {
    if (!manifest) return [];
    const order: string[] = [];
    for (const t of manifest) if (!order.includes(t.module)) order.push(t.module);
    return order;
  }, [manifest]);

  const resultsByNodeId = useMemo(() => {
    const map = new Map<string, FlowTestResult>();
    if (run) for (const t of run.tests) map.set(t.node_id, t);
    return map;
  }, [run]);

  const runnableIds = useCallback((ids: string[]) => {
    if (!manifest) return [];
    const destructiveSet = new Set(manifest.filter((t) => t.is_destructive).map((t) => t.node_id));
    return ids.filter((id) => includeDestructive || !destructiveSet.has(id));
  }, [manifest, includeDestructive]);

  const toggleSelected = (nodeId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId); else next.add(nodeId);
      return next;
    });
  };

  const toggleModuleSelected = (module: string, ids: string[]) => {
    const runnable = runnableIds(ids);
    const allSelected = runnable.length > 0 && runnable.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) runnable.forEach((id) => next.delete(id));
      else runnable.forEach((id) => next.add(id));
      return next;
    });
  };

  const toggleCollapsed = (module: string) => {
    setCollapsedModules((prev) => {
      const next = new Set(prev);
      if (next.has(module)) next.delete(module); else next.add(module);
      return next;
    });
  };

  const toggleInfo = (nodeId: string) => {
    setExpandedInfo((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId); else next.add(nodeId);
      return next;
    });
  };

  const toggleFailure = (nodeId: string) => {
    setExpandedFailure((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId); else next.add(nodeId);
      return next;
    });
  };

  const busy = isRunning || starting;
  const selectedRunnable = runnableIds(Array.from(selected));

  // Progreso preciso: sabemos de antemano cuántos tests van a correr
  // (expectedNodeIds), así que la barra refleja tests.length/total real,
  // no un porcentaje inventado.
  const completedCount = run?.tests.length ?? 0;
  const expectedTotal = expectedNodeIds.length || run?.summary.total || 0;
  const progressPct = expectedTotal > 0 ? Math.min(100, Math.round((completedCount / expectedTotal) * 100)) : 0;

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
              onChange={(e) => {
                setIncludeDestructive(e.target.checked);
                if (!e.target.checked && manifest) {
                  const destructiveSet = new Set(manifest.filter((t) => t.is_destructive).map((t) => t.node_id));
                  setSelected((prev) => new Set(Array.from(prev).filter((id) => !destructiveSet.has(id))));
                }
              }}
              disabled={busy}
              className="mt-1 w-4 h-4 rounded border-slate-300 text-pink-500 focus:ring-pink-400"
            />
            <span>
              <span className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
                <ShieldAlert className="w-3.5 h-3.5 text-amber-500" />
                Incluir tests destructivos
              </span>
              <span className="block text-xs text-slate-500 mt-0.5 max-w-md">
                Prueba el flujo completo de compra (reserva de prueba gratuita → paquete → pago → clase).
                Usa el modo dios para forzar estados. Se limpia igual al terminar, pero tarda más.
              </span>
            </span>
          </label>

          <div className="flex items-center gap-2 flex-wrap">
            {selectedRunnable.length > 0 && (
              <Button variant="secondary" size="md" onClick={() => launchRun(selectedRunnable)} disabled={busy}>
                <Play className="w-4 h-4" />
                Ejecutar seleccionados ({selectedRunnable.length})
              </Button>
            )}
            <Button variant="primary" onClick={() => launchRun(null)} disabled={busy || loadingManifest}>
              {!starting && (isRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />)}
              {isRunning ? "Corriendo..." : "Ejecutar todo"}
            </Button>
          </div>
        </div>
      </Card>

      {/* Error banner */}
      {(error || manifestError) && (
        <Card className="p-4 border-rose-200 bg-rose-50">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-bold text-rose-700">
                {manifestError ? "No se pudo enumerar los tests" : "No se pudo ejecutar la suite"}
              </p>
              <p className="text-sm text-rose-600 mt-1 whitespace-pre-wrap">{error || manifestError}</p>
              {manifestError && (
                <button
                  onClick={() => loadManifest()}
                  className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-rose-700 hover:underline"
                >
                  <RotateCcw className="w-3 h-3" /> Reintentar
                </button>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* Resumen / progreso de la corrida actual */}
      {run && (
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
                <ListChecks className="w-3.5 h-3.5" /> {completedCount}/{expectedTotal || "?"} tests
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="success">{run.summary.passed} ok</Badge>
              {run.summary.failed > 0 && <Badge variant="danger">{run.summary.failed} fallos</Badge>}
              {run.summary.skipped > 0 && <Badge variant="warning">{run.summary.skipped} saltados</Badge>}
            </div>
          </div>

          {isRunning && expectedTotal > 0 && (
            <div className="mt-4 h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-pink-400 transition-all duration-300"
                style={{ width: `${progressPct}%` }}
              />
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
      )}

      {/* Lista de tests (manifiesto), agrupada por módulo */}
      {loadingManifest && (
        <Card className="p-10 text-center text-slate-400">
          <Loader2 className="w-6 h-6 mx-auto mb-2 animate-spin" />
          <p className="text-sm">Enumerando tests...</p>
        </Card>
      )}

      {!loadingManifest && manifest && (
        <div className="space-y-3">
          {modules.map((module) => {
            const moduleTests = manifest.filter((t) => t.module === module);
            const moduleIds = moduleTests.map((t) => t.node_id);
            const moduleRunnable = runnableIds(moduleIds);
            const allSelected = moduleRunnable.length > 0 && moduleRunnable.every((id) => selected.has(id));
            const someSelected = moduleIds.some((id) => selected.has(id));
            const isCollapsed = collapsedModules.has(module);
            const failedCount = moduleIds.filter((id) => resultsByNodeId.get(id)?.outcome === "failed").length;

            return (
              <Card key={module} className="overflow-hidden">
                <div className="w-full flex items-center gap-3 px-5 py-3 hover:bg-slate-50 transition-colors">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
                    onChange={() => toggleModuleSelected(module, moduleIds)}
                    disabled={busy || moduleRunnable.length === 0}
                    className="w-4 h-4 rounded border-slate-300 text-pink-500 focus:ring-pink-400 flex-shrink-0"
                  />
                  <button
                    onClick={() => toggleCollapsed(module)}
                    className="flex items-center gap-2 flex-1 text-left"
                  >
                    {isCollapsed ? (
                      <ChevronRight className="w-4 h-4 text-slate-400" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-slate-400" />
                    )}
                    <span className="text-sm font-bold text-slate-800">{module}</span>
                    <span className="text-xs text-slate-400">({moduleTests.length})</span>
                  </button>
                  {failedCount > 0 && <Badge variant="danger">{failedCount} fallos</Badge>}
                  <button
                    onClick={() => launchRun(moduleRunnable)}
                    disabled={busy || moduleRunnable.length === 0}
                    title="Ejecutar solo este módulo"
                    className="p-1.5 rounded-lg hover:bg-pink-50 text-slate-400 hover:text-pink-500 disabled:opacity-30 disabled:hover:bg-transparent flex-shrink-0"
                  >
                    <Play className="w-3.5 h-3.5" />
                  </button>
                </div>

                {!isCollapsed && (
                  <div className="border-t border-slate-100 divide-y divide-slate-50">
                    {moduleTests.map((t) => {
                      const result = resultsByNodeId.get(t.node_id);
                      const isDisabledByDestructive = t.is_destructive && !includeDestructive;
                      const infoOpen = expandedInfo.has(t.node_id);
                      const failureOpen = expandedFailure.has(t.node_id);

                      return (
                        <div key={t.node_id}>
                          <div className="flex items-center gap-3 px-5 py-2.5">
                            <input
                              type="checkbox"
                              checked={selected.has(t.node_id)}
                              onChange={() => toggleSelected(t.node_id)}
                              disabled={busy || isDisabledByDestructive}
                              title={isDisabledByDestructive ? "Activa 'Incluir tests destructivos' para seleccionar este test" : undefined}
                              className="w-4 h-4 rounded border-slate-300 text-pink-500 focus:ring-pink-400 flex-shrink-0"
                            />
                            {outcomeIcon(result?.outcome)}
                            <span className="text-sm text-slate-700 flex-1 truncate font-mono text-[13px]">
                              {prettyTestName(t.name)}
                            </span>
                            {t.is_destructive && (
                              <ShieldAlert className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                            )}
                            {result && (
                              <span className="text-xs text-slate-400 flex-shrink-0">
                                {formatDuration(result.duration)}
                              </span>
                            )}
                            <button
                              onClick={() => toggleInfo(t.node_id)}
                              title="Ver descripción técnica y de usuario"
                              className={`p-1 rounded-lg flex-shrink-0 ${infoOpen ? "bg-pink-50 text-pink-500" : "text-slate-300 hover:text-pink-500 hover:bg-pink-50"}`}
                            >
                              <Info className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => launchRun([t.node_id])}
                              disabled={busy || isDisabledByDestructive}
                              title="Ejecutar solo este test"
                              className="p-1 rounded-lg text-slate-300 hover:text-pink-500 hover:bg-pink-50 disabled:opacity-30 disabled:hover:bg-transparent flex-shrink-0"
                            >
                              <Play className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          {infoOpen && (
                            <div className="px-5 pb-3 pl-12 space-y-2">
                              {t.technical_description && (
                                <div>
                                  <p className="text-[10px] uppercase tracking-wider font-bold text-slate-400">Técnico</p>
                                  <p className="text-xs text-slate-600 mt-0.5">{t.technical_description}</p>
                                </div>
                              )}
                              {t.ux_description && (
                                <div>
                                  <p className="text-[10px] uppercase tracking-wider font-bold text-slate-400">Para el usuario</p>
                                  <p className="text-xs text-slate-600 mt-0.5">{t.ux_description}</p>
                                </div>
                              )}
                              {!t.technical_description && !t.ux_description && (
                                <p className="text-xs text-slate-400 italic">Sin descripción disponible para este test.</p>
                              )}
                            </div>
                          )}

                          {result?.outcome === "failed" && result.message && (
                            <div className="px-5 pb-3 pl-12">
                              <button
                                onClick={() => toggleFailure(t.node_id)}
                                className="flex items-center gap-1 text-xs font-bold text-rose-600 hover:underline"
                              >
                                {failureOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                                Ver error
                              </button>
                              {failureOpen && (
                                <pre className="mt-1.5 text-xs bg-rose-50 text-rose-700 p-3 rounded-xl whitespace-pre-wrap break-words max-h-64 overflow-y-auto border border-rose-100">
                                  {result.message}
                                </pre>
                              )}
                            </div>
                          )}

                          {result?.outcome === "skipped" && result.message && (
                            <div className="px-5 pb-3 pl-12 -mt-1">
                              <p className="text-xs text-amber-600">{result.message}</p>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <ChipiWidget screenName="admin_flow_tester" />
    </div>
  );
}
