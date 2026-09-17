"use client";

import { useState } from "react";
import { MessageCircle, X } from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { usePlatformConfig } from "@/hooks/useStudentData";
import { useChatConversations, useUnreadChatCount, ChatConversation } from "@/hooks/useChat";
import ConversationList from "./ConversationList";
import ChatThreadView from "./ChatThreadView";

export default function ChatWidget() {
  const { user } = useAuthStore();
  const { config } = usePlatformConfig();
  const role = user?.role;
  const isEligible = role === "student" || role === "teacher" || role === "teacher_admin";
  // N2: si el superadmin/teacher_admin lo deshabilitó, ni siquiera se monta
  // el botón flotante — coherente con que el backend también lo bloquea.
  const enabled = isEligible && config?.chat_enabled === true;

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<ChatConversation | null>(null);
  const { conversations, loading } = useChatConversations(enabled);
  const { count } = useUnreadChatCount(enabled && !open);

  if (!enabled) return null;

  return (
    <>
      {/* Botón flotante — posicionado ARRIBA del de ChipiWidget
          (que usa bottom-[calc(4.75rem+safe)] / md:bottom-6). */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-[calc(9.5rem+env(safe-area-inset-bottom))] right-4 sm:right-6 md:bottom-24
                   z-50 w-14 h-14 rounded-2xl bg-gradient-to-br from-pink-500 to-rose-400
                   shadow-lg shadow-pink-300/40 flex items-center justify-center text-white
                   hover:scale-105 active:scale-95 transition-transform"
        aria-label="Chat interno"
      >
        {open ? <X size={22} /> : <MessageCircle size={22} />}
        {!open && count > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[20px] h-5 px-1.5 rounded-full bg-white text-rose-500 text-[10px] font-black flex items-center justify-center border-2 border-rose-400">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>

      {open && (
        <div
          className="fixed bottom-[calc(15.5rem+env(safe-area-inset-bottom))] right-4 sm:right-6 md:bottom-[10.5rem]
                     z-50 w-[calc(100vw-2rem)] max-w-sm h-[70vh] max-h-[560px]
                     bg-white rounded-[2rem] shadow-2xl shadow-pink-300/20 border border-pink-100
                     flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-200"
        >
          {active ? (
            <ChatThreadView conversation={active} onBack={() => setActive(null)} />
          ) : (
            <>
              <div className="px-4 py-3 border-b border-slate-100 flex-shrink-0">
                <p className="text-sm font-black text-slate-800">Chat interno</p>
              </div>
              <ConversationList
                conversations={conversations}
                loading={loading}
                selectedId={null}
                onSelect={setActive}
              />
            </>
          )}
        </div>
      )}
    </>
  );
}
