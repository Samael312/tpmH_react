"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Calendar, Link as LinkIcon, Unlink,
  RefreshCw, Check, AlertTriangle,
  Loader2
} from "lucide-react";
import api from "@/lib/api";
import { getMyDisplayTimezone } from "@/lib/tzFormat";
import { useCalendarStatus, type CalendarStatus } from "@/hooks/useTeacherData";
import Skeleton from "@/components/ui/Skeleton";
import { useToast } from "@/hooks/useToast";
import { getErrorMessage } from "@/lib/errorMessage";

interface SyncResult {
  new_count:              number;
  updated_count:          number;
  deleted_count:          number;
  imported_new_count?:    number;
  imported_updated_count?: number;
  imported_cancelled_count?: number;
  msg:                    string;
}

export default function CalendarSync() {
  const { status, loading, isError, refetch } = useCalendarStatus();
  const queryClient = useQueryClient();
  const toast = useToast();

  // Sincronización
  const [syncing, setSyncing]       = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [syncError, setSyncError]   = useState("");

  // Conexión OAuth
  const [connecting, setConnecting] = useState(false);

  // Desconexión
  const [disconnecting, setDisconnecting]   = useState(false);
  const [confirmDisconnect, setConfirm]     = useState(false);

  // Toggle sync habilitado
  const [togglingSync, setTogglingSync] = useState(false);

  // ── Iniciar OAuth ──
  const connectCalendar = async () => {
    setConnecting(true);
    try {
      const res = await api.get("/calendar/auth-url");
      // Redirigir al flujo OAuth de Google
      window.location.href = res.data.auth_url;
    } catch (e) {
      toast.error(getErrorMessage(e, "No se pudo iniciar la conexión con Google Calendar"));
      setConnecting(false);
    }
  };

  // ── Desconectar ──
  const disconnect = async () => {
    setDisconnecting(true);
    try {
      await api.post("/calendar/disconnect");
      await refetch();
      setConfirm(false);
      toast.success("Google Calendar desconectado correctamente");
    } catch (e) {
      toast.error(getErrorMessage(e, "No se pudo desconectar el calendario"));
    } finally {
      setDisconnecting(false);
    }
  };

  // ── Toggle sync ──
  const toggleSync = async () => {
    if (!status) return;
    setTogglingSync(true);
    try {
      await api.post("/calendar/toggle", {
        enabled: !status.sync_enabled,
      });
      queryClient.setQueryData<CalendarStatus>(
        ["teacher", "calendar", "status"],
        (prev) => (prev ? { ...prev, sync_enabled: !prev.sync_enabled } : prev)
      );
      toast.success(!status.sync_enabled ? "Sincronización automática activada" : "Sincronización automática desactivada");
    } catch (e) {
      toast.error(getErrorMessage(e, "No se pudo cambiar la sincronización automática"));
    } finally {
      setTogglingSync(false);
    }
  };

  // ── Sincronizar ahora ──
  const syncNow = async () => {
    setSyncing(true);
    setSyncError("");
    setSyncResult(null);
    try {
      const res = await api.post("/calendar/sync");
      setSyncResult(res.data);
      queryClient.setQueryData<CalendarStatus>(
        ["teacher", "calendar", "status"],
        (prev) => (prev ? { ...prev, last_sync_at: new Date().toISOString() } : prev)
      );
      // El sync no solo empuja clases propias hacia Google: también
      // puede traer clases nuevas importadas de Preply (o actualizar/
      // cancelar las que ya existían). Sin esto, el profesor tendría que
      // recargar la página a mano para verlas aparecer en su agenda.
      queryClient.invalidateQueries({ queryKey: ["teacher", "classes"] });
      toast.success("Calendario sincronizado correctamente");
    } catch (e) {
      const msg = getErrorMessage(e, "Error al sincronizar");
      setSyncError(msg);
      toast.error(msg);
    } finally {
      setSyncing(false);
    }
  };

  const formatDate = (iso: string | null) => {
    if (!iso) return "Nunca";
    const d = new Date(iso);
    return d.toLocaleString("es", {
      day:    "2-digit",
      month:  "short",
      year:   "numeric",
      hour:   "2-digit",
      minute: "2-digit",
      timeZone: getMyDisplayTimezone(),
    });
  };

  if (loading) {
    return (
      <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] border border-white shadow-lg p-7 space-y-4">
        <div className="flex items-center gap-3">
          <Skeleton className="w-9 h-9 rounded-xl" />
          <Skeleton className="h-5 w-40 rounded-lg" />
        </div>
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-12 w-full rounded-xl" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] border border-white shadow-lg p-7 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center">
            <Calendar className="w-5 h-5 text-blue-500" />
          </div>
          <h2 className="text-lg font-black text-slate-800 tracking-tight">
            Google Calendar
          </h2>
        </div>
        <div className="bg-rose-50 border border-rose-100 rounded-2xl px-4 py-3.5 flex items-center gap-3 flex-wrap">
          <AlertTriangle className="w-4 h-4 text-rose-500 flex-shrink-0" />
          <span className="text-xs font-bold text-rose-600 flex-1">
            No se pudo cargar el estado de tu calendario.
          </span>
          <button
            onClick={() => refetch()}
            className="flex items-center gap-1.5 text-xs font-bold text-rose-700 bg-rose-100 hover:bg-rose-200 px-3 py-1.5 rounded-lg transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Reintentar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="bg-white/80 backdrop-blur-xl rounded-[2rem] border
                    border-white shadow-lg p-7 space-y-6"
    >
      {/* Header sección */}
      <div className="flex items-center gap-3">
        <div
          className="w-9 h-9 rounded-xl bg-blue-50 flex items-center
                        justify-center"
        >
          <Calendar className="w-5 h-5 text-blue-500" />
        </div>
        <div>
          <h2 className="text-lg font-black text-slate-800 tracking-tight">
            Google Calendar
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Sincroniza tus clases con tu calendario de Google
          </p>
        </div>
      </div>

      {/* ─── Estado de conexión ─── */}
      {!status?.connected ? (
        /* SIN CONECTAR */
        <div className="space-y-4">
          <div
            className="bg-slate-50 border-2 border-dashed border-slate-200
                          rounded-2xl p-6 text-center"
          >
            <Calendar className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <p className="text-sm font-black text-slate-600 mb-1">
              Calendario no conectado
            </p>
            <p className="text-xs text-slate-400 leading-relaxed max-w-sm mx-auto">
              Conecta tu Google Calendar para sincronizar automáticamente
              tus clases. Las clases de Preply también se importarán.
            </p>
          </div>

          <button
            onClick={connectCalendar}
            disabled={connecting}
            className="w-full py-3.5 flex items-center justify-center gap-3
                         text-sm font-bold text-white rounded-xl
                         bg-gradient-to-r from-blue-500 to-blue-600
                         shadow-lg shadow-blue-200 hover:shadow-blue-300
                         active:scale-[0.98] transition-all duration-300
                         disabled:opacity-60"
          >
            {connecting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                {/* Logo Google (SVG inline) */}
                <svg viewBox="0 0 24 24" className="w-4 h-4">
                  <path
                    fill="white"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26
                       1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92
                       3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="white"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23
                       1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99
                       20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="white"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43
                       8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  />
                  <path
                    fill="white"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09
                       14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6
                       3.3-4.53 6.16-4.53z"
                  />
                </svg>
                Conectar Google Calendar
              </>
            )}
          </button>

          <p className="text-[10px] text-slate-400 text-center font-bold">
            Se solicitarán permisos de lectura y escritura en tu calendario
          </p>
        </div>
      ) : (
        /* CONECTADO */
        <div className="space-y-5">

          {/* Badge conectado */}
          <div
            className="flex items-center justify-between bg-blue-50
                          border border-blue-100 rounded-2xl px-4 py-3.5"
          >
            <div className="flex items-center gap-3">
              <div
                className="w-8 h-8 bg-blue-100 rounded-xl flex items-center
                              justify-center"
              >
                <LinkIcon className="w-4 h-4 text-blue-600" />
              </div>
              <div>
                <p className="text-xs font-black text-blue-700">
                  Conectado
                </p>
                {status.calendar_id && (
                  <p className="text-[10px] text-blue-500 truncate max-w-[200px]">
                    {status.calendar_id}
                  </p>
                )}
              </div>
            </div>
            <div
              className="w-2.5 h-2.5 bg-blue-400 rounded-full animate-pulse"
            />
          </div>

          {/* Toggle sync automático */}
          <div
            className="flex items-center justify-between bg-slate-50
                          rounded-2xl px-4 py-3.5"
          >
            <div>
              <p className="text-sm font-black text-slate-700">
                Sincronización automática
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                Se sincroniza sola en segundo plano cada 30 minutos
              </p>
            </div>
            <button
              onClick={toggleSync}
              disabled={togglingSync}
              className={`
                relative w-11 h-6 rounded-full transition-colors duration-300
                ${status.sync_enabled
                  ? "bg-blue-500"
                  : "bg-slate-300"
                }
              `}
            >
              <div
                className={`
                  absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-sm
                  transition-transform duration-300
                  ${status.sync_enabled
                    ? "translate-x-[22px]"
                    : "translate-x-0.5"
                  }
                `}
              />
              {togglingSync && (
                <Loader2
                  className="absolute inset-0 m-auto w-3 h-3
                               text-white animate-spin"
                />
              )}
            </button>
          </div>

          {/* Última sincronización */}
          <div
            className="text-xs text-slate-500 font-bold flex items-center
                          gap-2"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Última sincronización: {formatDate(status.last_sync_at)}
          </div>

          {/* ─── Sincronizar ahora ─── */}
          <div className="space-y-3">
            <button
              onClick={syncNow}
              disabled={syncing}
              className="w-full py-3.5 flex items-center justify-center gap-2
                           text-sm font-bold text-white rounded-xl
                           bg-gradient-to-r from-blue-500 to-indigo-500
                           shadow-lg shadow-blue-200 hover:shadow-blue-300
                           active:scale-[0.98] transition-all duration-300
                           disabled:opacity-60"
            >
              {syncing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Sincronizando...
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4" />
                  Sincronizar ahora
                </>
              )}
            </button>

            {/* Resultado */}
            {syncResult && (
              <div
                className="bg-emerald-50 border border-emerald-100 rounded-xl
                              px-4 py-3 space-y-1
                              animate-in fade-in slide-in-from-top-2 duration-300"
              >
                <div className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                  <p className="text-xs font-black text-emerald-700">
                    Sincronización completada
                  </p>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-emerald-600 font-bold pl-6">
                  <span>+{syncResult.new_count} nuevas</span>
                  <span>↑{syncResult.updated_count} actualizadas</span>
                  <span>-{syncResult.deleted_count} eliminadas</span>
                  {!!syncResult.imported_new_count && (
                    <span>📥 +{syncResult.imported_new_count} Preply</span>
                  )}
                  {!!syncResult.imported_updated_count && (
                    <span>📥 ↑{syncResult.imported_updated_count} Preply</span>
                  )}
                  {!!syncResult.imported_cancelled_count && (
                    <span>📥 -{syncResult.imported_cancelled_count} Preply</span>
                  )}
                </div>
              </div>
            )}

            {/* Error sync */}
            {syncError && (
              <div
                className="bg-rose-50 border border-rose-100 rounded-xl
                              px-4 py-3 flex items-center gap-2
                              animate-in fade-in duration-300"
              >
                <AlertTriangle className="w-4 h-4 text-rose-500 flex-shrink-0" />
                <p className="text-xs font-bold text-rose-600">{syncError}</p>
              </div>
            )}
          </div>

          {/* ─── Desconectar ─── */}
          {!confirmDisconnect ? (
            <button
              onClick={() => setConfirm(true)}
              className="w-full py-2.5 flex items-center justify-center gap-2
                           text-xs font-bold text-slate-500 hover:text-red-500
                           bg-transparent hover:bg-red-50 border-2 border-slate-200
                           hover:border-red-200 rounded-xl transition-all duration-200"
            >
              <Unlink className="w-3.5 h-3.5" />
              Desconectar calendario
            </button>
          ) : (
            <div className="space-y-3">
              <div
                className="bg-red-50 border border-red-100 rounded-xl
                              px-4 py-3"
              >
                <p className="text-xs font-black text-red-700 mb-0.5">
                  ¿Desconectar Google Calendar?
                </p>
                <p className="text-[10px] text-red-500">
                  Se revocarán los permisos y se detendrá la sincronización
                  automática. Tus clases existentes no se eliminarán.
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setConfirm(false)}
                  className="flex-1 py-2.5 text-xs font-bold text-slate-600
                               bg-slate-100 hover:bg-slate-200 rounded-xl
                               transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={disconnect}
                  disabled={disconnecting}
                  className="flex-1 py-2.5 text-xs font-bold text-white
                               bg-red-500 hover:bg-red-600 rounded-xl
                               shadow-sm active:scale-[0.97] transition-all
                               disabled:opacity-50 flex items-center
                               justify-center gap-1.5"
                >
                  {disconnecting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <>
                      <Unlink className="w-3.5 h-3.5" />
                      Desconectar
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}