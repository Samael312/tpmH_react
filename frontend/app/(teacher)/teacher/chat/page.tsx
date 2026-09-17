"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Card from "@/components/ui/Card";
import ConversationList from "@/components/chat/ConversationList";
import ChatThreadView from "@/components/chat/ChatThreadView";
import ChipiWidget from "@/components/chipi/ChipiWidget";
import RefreshButton from "@/components/ui/RefreshButton";
import { useChatConversations, ChatConversation } from "@/hooks/useChat";
import { usePlatformConfig } from "@/hooks/useStudentData";
import { MessageCircle } from "lucide-react";

export default function TeacherChatPage() {
  const router = useRouter();
  const { config, loading: loadingConfig } = usePlatformConfig();

  // Mismo criterio que /dashboard/chat: el backend ya bloquea REST/WS
  // (core/chat.py::assert_chat_enabled), esto es solo para no dejar ver
  // la pantalla vacía si alguien entra directo por URL con el toggle apagado.
  useEffect(() => {
    if (!loadingConfig && config && !config.chat_enabled) {
      router.replace("/unauthorized");
    }
  }, [loadingConfig, config, router]);

  const { conversations, loading, isFetching, refetch } = useChatConversations(true);
  const [active, setActive] = useState<ChatConversation | null>(null);
  const searchParams = useSearchParams();
  const threadRefetchRef = useRef<(() => void) | null>(null);
  const [threadFetching, setThreadFetching] = useState(false);

  const registerThreadRefetch = useCallback((fn: () => void) => {
    threadRefetchRef.current = fn;
  }, []);

  const handleRefresh = useCallback(async () => {
    setThreadFetching(true);
    await Promise.resolve(refetch());
    threadRefetchRef.current?.();
    setThreadFetching(false);
  }, [refetch]);

  // Deep-link desde el email de "nuevo mensaje" (ver core/email.py::
  // send_new_chat_message_teacher_email) o desde el botón "Chat" en
  // /teacher/students — abre directo la conversación.
  useEffect(() => {
    const conversationId = searchParams.get("conversation");
    if (!conversationId || loading || conversations.length === 0) return;
    const found = conversations.find((c) => c.id === Number(conversationId));
    if (!found) return;
    Promise.resolve().then(() => setActive(found));
  }, [searchParams, conversations, loading]);

  if (loadingConfig || (config && !config.chat_enabled)) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-pink-200 border-t-pink-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-800">Chat</h1>
          <p className="text-slate-400 text-sm font-medium">Hablá directamente con tus estudiantes o tus grupos.</p>
        </div>
        <RefreshButton onRefresh={handleRefresh} isFetching={isFetching || threadFetching} />
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
              <ChatThreadView
                conversation={active}
                onBack={() => setActive(null)}
                onRegisterRefetch={registerThreadRefetch}
              />
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center gap-2 text-slate-300">
                <MessageCircle size={40} />
                <p className="text-sm font-semibold">Elegí una conversación</p>
              </div>
            )}
          </div>
        </div>
      </Card>

      <ChipiWidget screenName="chat_teacher" />
    </div>
  );
}
