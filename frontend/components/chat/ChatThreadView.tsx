"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Send, WifiOff, Clock, Check, CheckCheck, AlertCircle } from "lucide-react";
import { ChatConversation, ChatMessage, useChatThread } from "@/hooks/useChat";
import { useAuthStore } from "@/store/authStore";
import { decodeToken } from "@/lib/auth";

// ─── Checkmarks (N3) ──────────────────────────────────────────────────────
// reloj = en cola/enviando (todavía no confirma el servidor) · 1 check =
// confirmado por el servidor (persistido) · 2 checks = le llegó a algún
// destinatario conectado (ver core/chat.py::mark_delivered_now). No hay
// estado de "leído" (3er check / azul) — no fue pedido.
function MessageStatusIcon({ status }: { status: ChatMessage["status"] }) {
  // Se renderiza DEBAJO de la burbuja, sobre el fondo claro de la
  // pantalla (no encima del degradé rosa) — por eso usa tonos oscuros,
  // no blancos.
  switch (status) {
    case "sending":
      return <Clock size={12} className="text-slate-300" aria-label="Enviando..." />;
    case "sent":
      return <Check size={13} className="text-slate-300" aria-label="Enviado" />;
    case "delivered":
      return <CheckCheck size={13} className="text-pink-400" aria-label="Entregado" />;
    case "failed":
      return <AlertCircle size={12} className="text-rose-500" aria-label="No se pudo enviar" />;
    default:
      return null;
  }
}

export default function ChatThreadView({
  conversation, onBack, onRegisterRefetch,
}: {
  conversation: ChatConversation;
  onBack?: () => void;
  // Le pasa al padre la función para refrescar el historial de ESTE hilo
  // (por ejemplo el RefreshButton de las páginas /dashboard/chat y
  // /teacher/chat, que refrescan lista + hilo activo en un solo click).
  onRegisterRefetch?: (refetch: () => void) => void;
}) {
  // OJO: `useAuthStore().user.id` NO sirve acá — ningún flujo de login
  // (email/password ni Google, ver app/(public)/login/page.tsx y
  // app/(public)/register/google-complete/page.tsx) lo popula nunca, así
  // que siempre da `undefined` y `isMine` abajo termina siendo `false`
  // para TODOS los mensajes de TODOS los usuarios (el bug real detrás de
  // "todos los mensajes se ven del mismo lado y color"). El id del
  // usuario logueado sí viaja siempre en el JWT (`sub`, ver
  // auth/jwt.py::create_access_token), así que lo sacamos de ahí.
  const token = useAuthStore((s) => s.token);
  const currentUserId = token ? Number(decodeToken(token)?.sub) : undefined;
  const { messages, loading, connected, sendError, send, markRead, refetch } = useChatThread(conversation.id);
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  useEffect(() => {
    onRegisterRefetch?.(refetch);
  }, [onRegisterRefetch, refetch]);

  useEffect(() => {
    markRead();
  }, [conversation.id, markRead]);

  const handleSend = () => {
    if (!draft.trim()) return;
    send(draft);
    setDraft("");
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 flex-shrink-0">
        {onBack && (
          <button onClick={onBack} className="text-slate-400 hover:text-pink-500 transition-colors">
            <ArrowLeft size={18} />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-black text-slate-800 truncate">{conversation.title}</p>
          {conversation.subtitle && <p className="text-[11px] text-slate-400">{conversation.subtitle}</p>}
        </div>
        {!connected && (
          <span title="Reconectando..." className="text-amber-400 flex-shrink-0">
            <WifiOff size={16} />
          </span>
        )}
      </div>

      {/* Mensajes */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 min-h-0">
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-10 w-2/3 rounded-2xl bg-slate-100 animate-pulse" />
            ))}
          </div>
        ) : messages.length === 0 ? (
          <p className="text-center text-xs text-slate-400 py-8">Todavía no hay mensajes. ¡Escribí el primero!</p>
        ) : (
          messages.map((m) => {
            const isMine = !!currentUserId && m.sender_id === currentUserId;
            // Key estable incluso mientras el mensaje es optimista (id
            // negativo temporal) — ver store/chatStore.ts::sendMessage.
            const key = m.client_id ?? m.id;
            return (
              <div key={key} className={`flex ${isMine ? "justify-end" : "justify-start"}`}>
                <div className="max-w-[75%]">
                  {conversation.conversation_type === "group" && !isMine && (
                    <p className="text-[10px] font-bold text-pink-400 mb-0.5 px-1">{m.sender_username}</p>
                  )}
                  <div
                    className={`px-3.5 py-2 rounded-2xl text-sm whitespace-pre-wrap break-words transition-opacity
                      ${isMine
                        ? "bg-gradient-to-r from-pink-500 to-rose-400 text-white rounded-br-md"
                        : "bg-slate-100 text-slate-700 rounded-bl-md"}
                      ${m.status === "sending" ? "opacity-80" : ""}`}
                  >
                    {m.content}
                  </div>
                  {isMine && (
                    <div className="flex justify-end items-center gap-1 mt-0.5 px-1">
                      {m.status === "failed" && (
                        <span className="text-[10px] text-rose-500 font-semibold mr-0.5">No enviado</span>
                      )}
                      <MessageStatusIcon status={m.status} />
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {sendError && (
        <p className="px-4 text-[11px] text-rose-500 font-semibold">{sendError}</p>
      )}

      {/* Input */}
      <div className="flex items-center gap-2 px-3 py-3 border-t border-slate-100 flex-shrink-0">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          placeholder="Escribí un mensaje..."
          maxLength={4000}
          className="flex-1 px-4 py-2.5 rounded-2xl bg-slate-50 border border-slate-100 text-sm
                     focus:outline-none focus:ring-2 focus:ring-pink-200 focus:border-pink-200"
        />
        <button
          onClick={handleSend}
          disabled={!draft.trim()}
          className="w-10 h-10 rounded-2xl flex-shrink-0 flex items-center justify-center
                     bg-gradient-to-br from-pink-500 to-rose-400 text-white disabled:opacity-40
                     transition-opacity"
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  );
}
