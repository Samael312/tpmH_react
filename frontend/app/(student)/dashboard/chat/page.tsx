"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Card from "@/components/ui/Card";
import ConversationList from "@/components/chat/ConversationList";
import ChatThreadView from "@/components/chat/ChatThreadView";
import RefreshButton from "@/components/ui/RefreshButton";
import { useChatConversations, ChatConversation } from "@/hooks/useChat";
import { usePlatformConfig } from "@/hooks/useStudentData";
import { MessageCircle } from "lucide-react";

export default function StudentChatPage() {
  const router = useRouter();
  const { config, loading: loadingConfig } = usePlatformConfig();

  // El backend ya bloquea REST/WS cuando chat_enabled está apagado (ver
  // core/chat.py::assert_chat_enabled) — esto solo evita que alguien
  // vea la pantalla de chat vacía/rota si pega la URL directamente,
  // mandándolo al mismo /unauthorized que usan el resto de rutas
  // protegidas por rol (ver proxy.ts).
  useEffect(() => {
    if (!loadingConfig && config && !config.chat_enabled) {
      router.replace("/unauthorized");
    }
  }, [loadingConfig, config, router]);

  const { conversations, loading, isFetching, refetch } = useChatConversations(true);
  const [active, setActive] = useState<ChatConversation | null>(null);
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
          <p className="text-slate-400 text-sm font-medium">Hablá directamente con tu profesor o tu grupo.</p>
        </div>
        <RefreshButton onRefresh={handleRefresh} isFetching={isFetching || threadFetching} />
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
    </div>
  );
}
