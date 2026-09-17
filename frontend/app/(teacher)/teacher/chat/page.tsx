"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Card from "@/components/ui/Card";
import ConversationList from "@/components/chat/ConversationList";
import ChatThreadView from "@/components/chat/ChatThreadView";
import { useChatConversations, ChatConversation } from "@/hooks/useChat";
import { MessageCircle } from "lucide-react";

export default function TeacherChatPage() {
  const { conversations, loading } = useChatConversations(true);
  const [active, setActive] = useState<ChatConversation | null>(null);
  const searchParams = useSearchParams();

  // Deep-link desde el email de "nuevo mensaje" (ver core/email.py::
  // send_new_chat_message_teacher_email) — abre directo la conversación.
  useEffect(() => {
    const conversationId = searchParams.get("conversation");
    if (!conversationId || loading || conversations.length === 0) return;
    const found = conversations.find((c) => c.id === Number(conversationId));
    if (!found) return;
    Promise.resolve().then(() => setActive(found));
  }, [searchParams, conversations, loading]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black text-slate-800">Chat</h1>
        <p className="text-slate-400 text-sm font-medium">Hablá directamente con tus estudiantes o tus grupos.</p>
      </div>

      <Card className="overflow-hidden h-[calc(100vh-240px)] min-h-[420px]">
        <div className="flex h-full">
          <div className={`w-full md:w-80 md:flex-shrink-0 border-r border-slate-100 flex flex-col
            ${active ? "hidden md:flex" : "flex"}`}>
            <ConversationList
              conversations={conversations}
              loading={loading}
              selectedId={active?.id ?? null}
              onSelect={setActive}
            />
          </div>

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
