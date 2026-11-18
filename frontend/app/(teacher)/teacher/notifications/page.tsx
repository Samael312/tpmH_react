"use client";

import { Bell, CheckCheck } from "lucide-react";
import ChipiWidget from "@/components/chipi/ChipiWidget";
import Skeleton from "@/components/ui/Skeleton";
import LoadMoreButton from "@/components/ui/LoadMoreButton";
import { usePageTopBar } from "@/lib/mobileTopBar";
import { useTeacherNotifications } from "@/hooks/useTeacherNotifications";

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString("es", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function TeacherNotificationsPage() {
  const { notifications, loading, isFetching, isError, refetch, hasMore, loadMore, loadingMore, markRead, markAllRead, marking } =
    useTeacherNotifications();
  const unread = notifications.filter((n) => !n.is_read).length;

  usePageTopBar({ title: "Avisos", onRefresh: refetch, isFetching });

  return (
    <>
      <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-black text-slate-800 flex items-center gap-2">
              <Bell className="w-5 h-5 text-indigo-500" /> Avisos
            </h1>
            <p className="text-xs text-slate-500 font-medium mt-0.5">Cambios automáticos que afectan a tus clases.</p>
          </div>
          {unread > 0 && (
            <button
              type="button"
              onClick={() => markAllRead()}
              disabled={marking}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 disabled:opacity-60 transition-colors"
            >
              <CheckCheck className="w-4 h-4" /> Marcar todo como leído
            </button>
          )}
        </div>

        {isError ? (
          <div className="bg-rose-50 border border-rose-200 rounded-2xl p-6 text-center text-sm font-bold text-rose-700">
            No se pudieron cargar los avisos.{" "}
            <button type="button" onClick={() => refetch()} className="underline">Reintentar</button>
          </div>
        ) : loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full rounded-2xl" />)}
          </div>
        ) : notifications.length === 0 ? (
          <div className="bg-white border-2 border-dashed border-slate-200 rounded-3xl py-16 text-center">
            <p className="text-slate-500 font-bold">No tienes avisos.</p>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden divide-y divide-slate-100">
            {notifications.map((n) => (
              <div key={n.id} className={`p-4 sm:p-5 flex items-start gap-3 ${n.is_read ? "" : "bg-indigo-50/40"}`}>
                <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${n.is_read ? "bg-transparent" : "bg-indigo-500"}`} aria-hidden />
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-sm font-black text-slate-800">{n.title}</p>
                  {n.message && <p className="text-xs text-slate-600 font-medium whitespace-pre-line">{n.message}</p>}
                  <p className="text-[10px] text-slate-400 font-medium">{formatWhen(n.created_at)}</p>
                </div>
                {!n.is_read && (
                  <button
                    type="button"
                    onClick={() => markRead(n.id)}
                    disabled={marking}
                    className="shrink-0 text-[11px] font-bold text-indigo-600 hover:underline disabled:opacity-60"
                  >
                    Marcar leído
                  </button>
                )}
              </div>
            ))}
            <LoadMoreButton hasMore={hasMore} loading={loadingMore} onClick={loadMore} />
          </div>
        )}
      </div>
      <ChipiWidget screenName="notifications_teacher" />
    </>
  );
}
