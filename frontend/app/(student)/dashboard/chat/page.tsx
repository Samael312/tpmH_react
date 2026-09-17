"use client";

import { useState } from "react";
import Card from "@/components/ui/Card";
import ConversationList from "@/components/chat/ConversationList";
import ChatThreadView from "@/components/chat/ChatThreadView";
import { useChatConversations, ChatConversation } from "@/hooks/useChat";
import { MessageCircle } from "lucide-react";

export default function StudentChatPage() {
  const { conversations, loading } = useChatConversations(true);
  const [active, setActive] = useState<ChatConversation | null>(null);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black text-slate-800">Chat</h1>
        <p className="text-slate-400 text-sm font-medium">Hablá directamente con tu profesor o tu grupo.</p>
      </div>

      <Card className="overflow-hidden h-[calc(100vh-240px)] min-h-[420px]">
        <div className="flex h-full">
          {/* Lista — en mobile se oculta si hay una conversación activa */}
          <div className={`w-full md:w-80 md:flex-shrink-0 border-r border-slate-100 flex flex-col
            ${active ? "hidden md:flex" : "flex"}`}>
            <ConversationList
              conversations={conversations}
              loading={loading}
              selectedId={active?.id ?? null}
              onSelect={setActive}
            />
          </div>

          {/* Hilo */}
          <div className={`flex-1 min-w-0 ${active ? "flex" : "hidden md:flex"} flex-col`}>
            {active ? (
              <ChatThreadView conversation={active} onBack={() => setActive(null)} />
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center gap-2 text-slate-300">
                <MessageCircle size={40} />
                <p className="text-sm font-semibold">Elegí una conversación</p>
              </div>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
