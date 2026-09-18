"use client";

// app/(superadmin)/admin/chat/page.tsx
//
// N5: panel de solo lectura para que superadmin/teacher_admin puedan
// revisar una conversación ajena (moderación, investigar un reclamo)
// SIN necesitar que nadie les pase capturas. Ver mensajes exige un
// motivo (queda auditado en GodModeAuditLogViewer, mismo mecanismo que
// el resto del Modo Dios) — ver backend/app/api/v1/endpoints/chat.py.

import { useState } from "react";
import { MessageCircle, Search, Users2, Eye, History, ArrowLeft, ShieldAlert } from "lucide-react";
import { Card, Badge, Skeleton, RefreshButton } from "@/components/ui";
import RejectReasonModal from "@/components/ui/RejectReasonModal";
import ChipiWidget from "@/components/chipi/ChipiWidget";
import { usePageTopBar } from "@/lib/mobileTopBar";
import { useChatAdminConversations, useChatAdminMessages, ChatConversationAdmin } from "@/hooks/useChatAdmin";
import { useGodModeEntityHistory } from "@/hooks/useGodMode";

function timeAgo(iso: string | null): string {
  if (!iso) return "Sin mensajes";
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "hace instantes";
  if (mins < 60) return `hace ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `hace ${hours}h`;
  return `hace ${Math.floor(hours / 24)}d`;
}

// ─── Historial de accesos a ESTA conversación (quién la auditó y por qué) ──
function ConversationAccessHistory({ conversationId }: { conversationId: number }) {
  const { history, loading } = useGodModeEntityHistory("chat_conversation", conversationId);
  const [open, setOpen] = useState(false);

  if (loading) return null;
  return (
    <div className="border-t border-slate-100 px-4 py-3">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 text-xs font-bold text-slate-500 hover:text-pink-500 transition-colors"
      >
        <History size={14} />
        Accesos registrados a esta conversación ({history.length})
      </button>
      {open && (
        <div className="mt-2 space-y-1.5 max-h-40 overflow-y-auto pr-1">
          {history.length === 0 ? (
            <p className="text-[11px] text-slate-400">Todavía nadie la revisó.</p>
          ) : (
            history.map((h) => (
              <div key={h.id} className="text-[11px] text-slate-500 bg-slate-50 rounded-xl px-3 py-2">
                <p className="font-bold text-slate-700">
                  {h.actor_name ?? `Usuario #${h.actor_user_id}`} <span className="text-slate-400">· {h.actor_role}</span>
                </p>
                <p className="italic">&ldquo;{h.reason}&rdquo;</p>
                <p className="text-slate-400">{new Date(h.created_at).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ─── Panel de mensajes de la conversación seleccionada ─────────────────────
function ConversationAuditPanel({
  conversation, onBack,
}: {
  conversation: ChatConversationAdmin;
  onBack: () => void;
}) {
  const [reason, setReason] = useState<string | null>(null);
  const [askingReason, setAskingReason] = useState(false);
  const { messages, loading, isFetching, refetch } = useChatAdminMessages(conversation.id, reason);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 flex-shrink-0">
        <button onClick={onBack} className="md:hidden text-slate-400 hover:text-pink-500">
          <ArrowLeft size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-black text-slate-800 truncate">{conversation.title}</p>
          <p className="text-[11px] text-slate-400">{conversation.subtitle} · {conversation.message_count} mensajes</p>
        </div>
        {reason && <RefreshButton onRefresh={refetch} isFetching={isFetching} />}
      </div>

      {!reason ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-8 py-10">
          <ShieldAlert size={32} className="text-amber-400" />
          <p className="text-sm font-bold text-slate-700">Esta conversación tiene contenido privado</p>
          <p className="text-xs text-slate-400 max-w-xs">
            Para ver los mensajes tenés que indicar un motivo. Queda registrado
            en el historial de auditoría, visible para todo el staff.
          </p>
          <button
            onClick={() => setAskingReason(true)}
            className="mt-2 px-5 py-2.5 rounded-2xl bg-gradient-to-r from-pink-500 to-rose-400 text-white text-sm font-bold
                       flex items-center gap-2 shadow-lg shadow-pink-200"
          >
            <Eye size={16} /> Ver mensajes
          </button>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 min-h-0">
          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-2/3 rounded-2xl" />)}
            </div>
          ) : messages.length === 0 ? (
            <p className="text-center text-xs text-slate-400 py-8">No hay mensajes en esta conversación.</p>
          ) : (
            messages.map((m) => (
              <div key={m.id} className="max-w-[80%]">
                <p className="text-[10px] font-bold text-slate-400 mb-0.5 px-1">
                  {m.sender_username} · {new Date(m.created_at).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                </p>
                <div className="px-3.5 py-2 rounded-2xl text-sm bg-slate-100 text-slate-700 whitespace-pre-wrap break-words">
                  {m.content}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      <ConversationAccessHistory conversationId={conversation.id} />

      <RejectReasonModal
        open={askingReason}
        title="Motivo de la revisión"
        description={`Vas a ver los mensajes de "${conversation.title}". Escribí por qué necesitás revisarla — queda auditado.`}
        fieldLabel="Motivo"
        placeholder="Ej: seguimiento de un reclamo del alumno sobre..."
        confirmLabel="Ver mensajes"
        confirmVariant="primary"
        onClose={() => setAskingReason(false)}
        onConfirm={(r) => { setReason(r); setAskingReason(false); }}
      />
    </div>
  );
}

// ─── Página ──────────────────────────────────────────────────────────────
export default function AdminChatAuditPage() {
  const [teacherFilter, setTeacherFilter] = useState("");
  const [studentFilter, setStudentFilter] = useState("");
  const { conversations, loading, isFetching, refetch } = useChatAdminConversations({
    teacher_username: teacherFilter || undefined,
    student_username: studentFilter || undefined,
  });
  const [selected, setSelected] = useState<ChatConversationAdmin | null>(null);

  usePageTopBar({ title: "Auditoría de chats", onRefresh: refetch, isFetching });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-slate-800 tracking-tight">Auditoría de chats</h1>
          <p className="text-slate-500 mt-1">
            Revisá conversaciones del chat interno entre profesores y alumnos. Ver mensajes queda registrado.
          </p>
        </div>
        <div className="hidden md:block">
          <RefreshButton onRefresh={refetch} isFetching={isFetching} />
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-300" />
          <input
            value={teacherFilter}
            onChange={(e) => setTeacherFilter(e.target.value)}
            placeholder="Filtrar por profesor (username)"
            className="w-full pl-9 pr-3 py-2.5 rounded-2xl bg-white border border-slate-100 text-xs font-bold
                       text-slate-600 shadow-sm focus:outline-none focus:ring-2 focus:ring-pink-200"
          />
        </div>
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-300" />
          <input
            value={studentFilter}
            onChange={(e) => setStudentFilter(e.target.value)}
            placeholder="Filtrar por alumno (username)"
            className="w-full pl-9 pr-3 py-2.5 rounded-2xl bg-white border border-slate-100 text-xs font-bold
                       text-slate-600 shadow-sm focus:outline-none focus:ring-2 focus:ring-pink-200"
          />
        </div>
      </div>

      <Card className="overflow-hidden h-[calc(100vh-320px)] min-h-[420px]">
        <div className="flex h-full">
          <div className={`w-full md:w-80 md:flex-shrink-0 border-r border-slate-100 flex flex-col overflow-y-auto
            ${selected ? "hidden md:flex" : "flex"}`}>
            {loading ? (
              <div className="space-y-2 p-3">
                {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-16 rounded-2xl" />)}
              </div>
            ) : conversations.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center px-6 py-10 text-slate-400">
                <MessageCircle size={32} className="opacity-40" />
                <p className="text-sm font-semibold">No hay conversaciones con esos filtros</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-50">
                {conversations.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setSelected(c)}
                    className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors
                      ${selected?.id === c.id ? "bg-pink-50" : "hover:bg-slate-50"}`}
                  >
                    <div className="w-10 h-10 rounded-2xl flex-shrink-0 bg-gradient-to-br from-pink-500 to-rose-400
                                    flex items-center justify-center text-white">
                      {c.conversation_type === "group" ? <Users2 size={18} /> : <MessageCircle size={18} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-slate-800 truncate">{c.title}</p>
                      <p className="text-[10px] text-slate-400 truncate">
                        {c.message_count} mensajes · {timeAgo(c.last_message_at)}
                      </p>
                    </div>
                    {c.conversation_type === "group" && <Badge variant="pink">Grupo</Badge>}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className={`flex-1 min-w-0 ${selected ? "flex" : "hidden md:flex"} flex-col`}>
            {selected ? (
              <ConversationAuditPanel conversation={selected} onBack={() => setSelected(null)} />
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center gap-2 text-slate-300">
                <MessageCircle size={40} />
                <p className="text-sm font-semibold">Elegí una conversación para auditar</p>
              </div>
            )}
          </div>
        </div>
      </Card>

      <ChipiWidget screenName="admin_chat_audit" />
    </div>
  );
}
