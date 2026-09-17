"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Card from "@/components/ui/Card";
import ConversationList from "@/components/chat/ConversationList";
import ChatThreadView from "@/components/chat/ChatThreadView";
import RefreshButton from "@/components/ui/RefreshButton";
import { useChatConversations, openDirectConversation, ChatConversation } from "@/hooks/useChat";
import { usePlatformConfig } from "@/hooks/useStudentData";
import { useToast } from "@/hooks/useToast";
import { getErrorMessage } from "@/lib/errorMessage";
import { MessageCircle, Loader2 } from "lucide-react";

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
  const searchParams = useSearchParams();
  const threadRefetchRef = useRef<(() => void) | null>(null);
  const [threadFetching, setThreadFetching] = useState(false);
  const [creatingWith, setCreatingWith] = useState<string | null>(null);
  const toast = useToast();

  const registerThreadRefetch = useCallback((fn: () => void) => {
    threadRefetchRef.current = fn;
  }, []);

  const handleRefresh = useCallback(async () => {
    setThreadFetching(true);
    await Promise.resolve(refetch());
    threadRefetchRef.current?.();
    setThreadFetching(false);
  }, [refetch]);

  // Deep-link desde ?conversation=<id> (email de nuevo mensaje).
  useEffect(() => {
    const conversationId = searchParams.get("conversation");
    if (!conversationId || loading || conversations.length === 0) return;
    const found = conversations.find((c) => c.id === Number(conversationId));
    if (!found) return;
    Promise.resolve().then(() => setActive(found));
  }, [searchParams, conversations, loading]);

  // Deep-link desde ?teacher=<username> (botón "Chat" del perfil público de
  // un profesor — ver teachers/[username]/page.tsx). Ese botón navega de
  // inmediato sin esperar al backend, y acá recién se crea/abre la
  // conversación (mismo patrón que ?student= en teacher/chat/page.tsx).
  // Funciona tanto si ya está vinculado a ese profesor como si no — ver
  // core/chat.py::get_direct_conversation_or_404.
  useEffect(() => {
    const teacherUsername = searchParams.get("teacher");
    if (!teacherUsername) return;
    let cancelled = false;
    setCreatingWith(teacherUsername);
    openDirectConversation(teacherUsername)
      .then((convo) => {
        if (cancelled) return;
        setActive(convo);
        refetch();
        router.replace(`/dashboard/chat?conversation=${convo.id}`);
      })
      .catch((e) => {
        if (cancelled) return;
        toast.error(getErrorMessage(e, "No se pudo abrir el chat con este profesor."));
        router.replace("/dashboard/chat");
      })
      .finally(() => { if (!cancelled) setCreatingWith(null); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

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
            ${active || creatingWith ? "hidden md:flex" : "flex"}`}>
            <ConversationList
              conversations={conversations}
              loading={loading}
              selectedId={active?.id ?? null}
              onSelect={setActive}
            />
          </div>

          {/* Hilo */}
          <div className={`flex-1 min-w-0 ${active || creatingWith ? "flex" : "hidden md:flex"} flex-col`}>
            {active ? (
              <ChatThreadView
                conversation={active}
                onBack={() => setActive(null)}
                onRegisterRefetch={registerThreadRefetch}
              />
            ) : creatingWith ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-2 text-slate-300">
                <Loader2 size={32} className="animate-spin text-pink-400" />
                <p className="text-sm font-semibold text-slate-400">Abriendo conversación...</p>
              </div>
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
