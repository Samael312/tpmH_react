"use client";

import { useEffect, useState } from "react";
import { LifeBuoy, Bug, AlertTriangle, HelpCircle, MoreHorizontal, ChevronDown, Clock, CheckCircle2, Plus } from "lucide-react";
import { useMySupportTickets, markSupportTicketSeen, SupportTicket } from "@/hooks/useSupport";
import SupportTicketModal from "@/components/support/SupportTicketModal";
import Skeleton from "@/components/ui/Skeleton";
import RefreshButton from "@/components/ui/RefreshButton";
import { usePageTopBar } from "@/lib/mobileTopBar";

const CATEGORY_CONFIG: Record<string, { label: string; icon: React.ReactNode }> = {
  bug: { label: "Bug", icon: <Bug className="w-3.5 h-3.5" /> },
  error: { label: "Error", icon: <AlertTriangle className="w-3.5 h-3.5" /> },
  question: { label: "Duda", icon: <HelpCircle className="w-3.5 h-3.5" /> },
  other: { label: "Otro", icon: <MoreHorizontal className="w-3.5 h-3.5" /> },
};

function TicketCard({ ticket, onSeen }: { ticket: SupportTicket; onSeen: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const cfg = CATEGORY_CONFIG[ticket.category] ?? CATEGORY_CONFIG.other;
  const isAnswered = ticket.status === "answered";
  const isUnseen = isAnswered && !ticket.user_notified_seen;

  const toggle = () => {
    setExpanded((p) => !p);
    if (!expanded && isUnseen) {
      markSupportTicketSeen(ticket.id).then(onSeen).catch(() => {});
    }
  };

  return (
    <div
      className={`bg-white/80 backdrop-blur-xl rounded-2xl border border-white shadow-lg
                  border-l-4 ${isAnswered ? "border-l-emerald-400" : "border-l-amber-400"}
                  hover:shadow-xl transition-all duration-300`}
    >
      <button onClick={toggle} className="w-full flex items-start gap-4 p-5 text-left">
        <div className="w-11 h-11 bg-slate-50 rounded-xl flex items-center justify-center flex-shrink-0 text-slate-400">
          {cfg.icon}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            <span
              className={`text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full flex items-center gap-1 ${
                isAnswered ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
              }`}
            >
              {isAnswered ? <CheckCircle2 className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
              {isAnswered ? "Respondido" : "Pendiente"}
            </span>
            {isUnseen && (
              <span className="w-2 h-2 rounded-full bg-pink-500 animate-pulse" title="Sin ver" />
            )}
            <span className="text-[10px] text-slate-400 font-bold">
              {new Date(ticket.created_at).toLocaleDateString("es", { day: "numeric", month: "short" })}
            </span>
          </div>
          <p className="text-sm font-bold text-slate-800 line-clamp-2 leading-snug">{ticket.subject}</p>
        </div>

        <ChevronDown
          className={`w-4 h-4 text-slate-400 flex-shrink-0 mt-1 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
        />
      </button>

      {expanded && (
        <div className="border-t border-slate-100 px-5 pb-5 pt-4 space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
          <div>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Tu mensaje</p>
            <div className="bg-slate-50 rounded-xl p-3">
              <p className="text-xs text-slate-700 leading-relaxed whitespace-pre-wrap">{ticket.message}</p>
            </div>
          </div>

          {isAnswered ? (
            <div>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Respuesta del equipo</p>
              <div className="bg-emerald-50 rounded-xl p-3">
                <p className="text-xs text-emerald-800 leading-relaxed whitespace-pre-wrap">{ticket.admin_response}</p>
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-400 italic">Aún no hay respuesta — te avisaremos por correo en cuanto la tengas.</p>
          )}
        </div>
      )}
    </div>
  );
}

export default function SupportTicketsView({ title = "Soporte" }: { title?: string }) {
  const { tickets, loading, isFetching, refetch } = useMySupportTickets();
  const [modalOpen, setModalOpen] = useState(false);

  // Registra título + refresh en la topbar mobile (renderizada por el layout del rol)
  usePageTopBar({ title, onRefresh: refetch, isFetching });

  const pending = tickets.filter((t) => t.status === "pending").length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="flex items-center gap-3 min-w-0">
          <div className="min-w-0">
            <h1 className="text-3xl font-black text-slate-800 tracking-tight">Soporte</h1>
            <p className="text-slate-500 mt-1">Reporta bugs, errores o dudas y sigue tus respuestas aquí</p>
          </div>
          <RefreshButton onRefresh={refetch} isFetching={isFetching} className="hidden md:flex" />
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white
                     bg-gradient-to-r from-pink-500 to-rose-400 hover:from-pink-600 hover:to-rose-500
                     shadow-lg shadow-pink-200 hover:shadow-pink-300 active:scale-[0.98]
                     transition-all duration-300 flex-shrink-0"
        >
          <Plus className="w-4 h-4" />
          Nuevo ticket
        </button>
      </div>

      {pending > 0 && (
        <div className="bg-amber-50 border border-amber-100 rounded-2xl px-4 py-3 text-xs font-bold text-amber-700">
          Tienes {pending} ticket{pending > 1 ? "s" : ""} en espera de respuesta.
        </div>
      )}

      <div className="space-y-3">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)
        ) : tickets.length === 0 ? (
          <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] border border-white shadow-lg py-16 text-center">
            <LifeBuoy className="w-12 h-12 text-slate-200 mx-auto mb-3" />
            <p className="text-slate-500 font-bold">Aún no has enviado ningún ticket</p>
            <p className="text-slate-400 text-sm mt-1">Si encuentras un bug o tienes una duda, cuéntanoslo aquí.</p>
          </div>
        ) : (
          tickets.map((t) => <TicketCard key={t.id} ticket={t} onSeen={refetch} />)
        )}
      </div>

      <SupportTicketModal open={modalOpen} onClose={() => setModalOpen(false)} onSent={refetch} />
    </div>
  );
}
