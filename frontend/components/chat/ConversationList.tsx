"use client";

import { MessageCircle, Users2 } from "lucide-react";
import { ChatConversation } from "@/hooks/useChat";

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "ahora";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

export default function ConversationList({
  conversations, loading, selectedId, onSelect,
}: {
  conversations: ChatConversation[];
  loading: boolean;
  selectedId: number | null;
  onSelect: (c: ChatConversation) => void;
}) {
  if (loading) {
    return (
      <div className="space-y-2 p-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 rounded-2xl bg-slate-100 animate-pulse" />
        ))}
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center px-6 py-10 text-slate-400">
        <MessageCircle size={32} className="opacity-40" />
        <p className="text-sm font-semibold">Todavía no tenés conversaciones</p>
      </div>
    );
  }

  return (
    <div className="overflow-y-auto divide-y divide-slate-50">
      {conversations.map((c) => (
        <button
          key={c.id}
          onClick={() => onSelect(c)}
          className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors
            ${selectedId === c.id ? "bg-pink-50" : "hover:bg-slate-50"}`}
        >
          <div className="w-11 h-11 rounded-2xl flex-shrink-0 bg-gradient-to-br from-pink-500 to-rose-400 flex items-center justify-center text-white overflow-hidden">
            {c.conversation_type === "group" ? (
              <Users2 size={20} />
            ) : c.avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={c.avatar} alt={c.title} className="w-full h-full object-cover" />
            ) : (
              <span className="font-black text-sm">{c.title?.[0]?.toUpperCase() || "?"}</span>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-bold text-slate-800 truncate">{c.title}</p>
              {c.last_message_at && (
                <span className="text-[10px] text-slate-400 flex-shrink-0">{timeAgo(c.last_message_at)}</span>
              )}
            </div>
            <p className="text-xs text-slate-400 truncate">
              {c.last_message_preview || (c.conversation_type === "group" ? "Chat grupal" : "Sin mensajes todavía")}
            </p>
          </div>
          {c.unread_count > 0 && (
            <span className="flex-shrink-0 min-w-[20px] h-5 px-1.5 rounded-full bg-rose-500 text-white text-[10px] font-black flex items-center justify-center">
              {c.unread_count > 99 ? "99+" : c.unread_count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
