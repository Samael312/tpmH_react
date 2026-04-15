"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Image from "next/image";
import { X, Send, Minimize2 } from "lucide-react";
import api from "@/lib/api";
import { useAuthStore } from "@/store/authStore";
import { usePathname } from "next/navigation";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  loading?: boolean;
}

// ─── Mapeo de ruta → screen_name (contexto para Chipi) ────────────────────────
function useScreenName(): string {
  const pathname = usePathname();
  const { user }  = useAuthStore();
  const role      = user?.role ?? "public";

  const MAP: Record<string, string> = {
    "/":                            "main",
    "/login":                       "login",
    "/register":                    "signup",
    "/forgot-password":             "forgot-password",

    // Estudiante
    "/dashboard":                   "student_home",
    "/dashboard/schedule":          "schedule",
    "/dashboard/classes":           "my_classes",
    "/dashboard/materials":         "materials",
    "/dashboard/homework":          "homework",
    "/dashboard/teacher":           "teacher_view",
    "/dashboard/profile":           "profile",

    // Profesor
    "/teacher/dashboard":           "teacher_home",
    "/teacher/availability":        "availability",
    "/teacher/materials":           "materials",
    "/teacher/homework":            "homework",
    "/teacher/profile":             "teacher_profile",
    "/teacher/wallet":              "wallet",

    // Admin
    "/admin":                       "admin_home",
    "/admin/teachers":              "admin_teachers",
    "/admin/students":              "admin_students",
    "/admin/payments":              "admin_payments",
    "/admin/settings":              "admin_settings",
  };

  // Buscar coincidencia exacta primero, luego por prefijo
  if (MAP[pathname]) return MAP[pathname];
  for (const [key, val] of Object.entries(MAP)) {
    if (pathname.startsWith(key) && key !== "/") return val;
  }
  return "main";
}

// ─── Burbuja de mensaje ───────────────────────────────────────────────────────
function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === "user";

  return (
    <div className={`flex gap-2 items-end
      ${isUser ? "flex-row-reverse" : "flex-row"}`}>

      {/* Avatar Chipi */}
      {!isUser && (
        <div className="w-7 h-7 rounded-xl overflow-hidden flex-shrink-0
                        border-2 border-white shadow-sm">
          <Image
            src="/assets/logo.png"
            alt="Chipi"
            width={28}
            height={28}
            className="object-contain w-full h-full"
          />
        </div>
      )}

      <div className={`
        max-w-[80%] px-4 py-3 rounded-2xl text-sm leading-relaxed
        ${isUser
          ? "bg-gradient-to-br from-pink-500 to-rose-400 text-white rounded-br-md shadow-md shadow-pink-100"
          : "bg-white border border-slate-100 text-slate-700 rounded-bl-md shadow-sm"
        }
      `}>
        {msg.loading ? (
          /* Indicador de escritura */
          <div className="flex gap-1 items-center py-0.5 px-1">
            {[0, 1, 2].map(i => (
              <div
                key={i}
                className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce"
                style={{ animationDelay: `${i * 150}ms` }}
              />
            ))}
          </div>
        ) : (
          <p className="whitespace-pre-wrap font-medium">{msg.content}</p>
        )}
      </div>
    </div>
  );
}

// ─── Props del widget ─────────────────────────────────────────────────────────
interface ChipiWidgetProps {
  /**
   * Forzar un screen_name específico.
   * Si no se pasa, se detecta automáticamente por pathname.
   */
  screenName?: string;
}

// ─── Componente principal ─────────────────────────────────────────────────────
export default function ChipiWidget({ screenName }: ChipiWidgetProps) {
  const autoScreen  = useScreenName();
  const screen      = screenName ?? autoScreen;
  const { user }    = useAuthStore();

  const [open, setOpen]         = useState(false);
  const [input, setInput]       = useState("");
  const [messages, setMessages] = useState<Message[]>([
    {
      id:      "welcome",
      role:    "assistant",
      content: "¡Hola! 👋 Soy Chipi, tu asistente. ¿En qué te puedo ayudar?",
    },
  ]);
  const [sending, setSending]   = useState(false);
  const [idleVisible, setIdleVisible] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef       = useRef<HTMLInputElement>(null);
  const idleTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─ Auto-scroll al último mensaje ─
  useEffect(() => {
    if (open) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, open]);

  // ─ Focus en input al abrir ─
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [open]);

  // ─ Burbuja de inactividad (aparece a los 12s sin interacción) ─
  const resetIdleTimer = useCallback(() => {
    setIdleVisible(false);
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    if (!open) {
      idleTimerRef.current = setTimeout(() => {
        setIdleVisible(true);
      }, 12000);
    }
  }, [open]);

  useEffect(() => {
    resetIdleTimer();
    window.addEventListener("click", resetIdleTimer);
    window.addEventListener("keydown", resetIdleTimer);
    return () => {
      window.removeEventListener("click", resetIdleTimer);
      window.removeEventListener("keydown", resetIdleTimer);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [resetIdleTimer]);

  // ─ Ocultar burbuja al abrir el chat ─
  const handleToggle = () => {
    setIdleVisible(false);
    setOpen(p => !p);
  };

  // ─ Enviar mensaje ─
  const sendMessage = async () => {
    const text = input.trim();
    if (!text || sending) return;

    const userMsg: Message = {
      id:      Date.now().toString(),
      role:    "user",
      content: text,
    };
    const loadingMsg: Message = {
      id:      "loading",
      role:    "assistant",
      content: "",
      loading: true,
    };

    setMessages(p => [...p, userMsg, loadingMsg]);
    setInput("");
    setSending(true);

    try {
      const res = await api.post("/chipi/chat", {
        message:     text,
        screen_name: screen,
      });

      setMessages(p =>
        p
          .filter(m => m.id !== "loading")
          .concat({
            id:      Date.now().toString() + "_r",
            role:    "assistant",
            content: res.data.response,
          })
      );
    } catch {
      setMessages(p =>
        p
          .filter(m => m.id !== "loading")
          .concat({
            id:      Date.now().toString() + "_err",
            role:    "assistant",
            content:
              "Tuve un pequeño problema. 🔌 ¿Me repites la pregunta?",
          })
      );
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <>
      {/* ─── Burbuja de inactividad ─── */}
      <div
        className={`
          fixed bottom-24 right-6 z-40 max-w-[220px]
          bg-white/90 backdrop-blur-xl border border-white
          shadow-xl shadow-slate-200/60 rounded-2xl rounded-br-sm
          px-4 py-3 pointer-events-none
          transition-all duration-500
          ${idleVisible && !open
            ? "opacity-100 translate-y-0"
            : "opacity-0 translate-y-3"
          }
        `}
      >
        <p className="text-[10px] font-black text-pink-500 uppercase
                      tracking-widest mb-0.5">
          ¿Necesitas ayuda?
        </p>
        <p className="text-sm font-bold text-slate-700 leading-tight">
          Pregúntale a Chipi AI
        </p>
      </div>

      {/* ─── Ventana de chat ─── */}
      <div
        className={`
          fixed bottom-24 right-6 z-50 w-[340px]
          bg-white/90 backdrop-blur-2xl rounded-[2rem]
          border border-white shadow-2xl shadow-slate-200/60
          flex flex-col overflow-hidden
          transition-all duration-300 origin-bottom-right
          ${open
            ? "opacity-100 scale-100 pointer-events-auto"
            : "opacity-0 scale-90 pointer-events-none"
          }
        `}
        style={{ height: "480px" }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4
                        bg-gradient-to-r from-pink-500 to-rose-400
                        flex-shrink-0">
          <div className="w-9 h-9 rounded-xl overflow-hidden border-2
                          border-white/30 flex-shrink-0 shadow-sm">
            <Image
              src="/assets/logo.png"
              alt="Chipi"
              width={36}
              height={36}
              className="object-contain w-full h-full"
            />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white font-black text-sm leading-none">
              Chipi AI
            </p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full
                              animate-pulse" />
              <p className="text-white/70 text-[10px] font-bold">
                En línea
              </p>
            </div>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="w-7 h-7 rounded-lg bg-white/20 hover:bg-white/30
                       flex items-center justify-center transition-colors"
          >
            <Minimize2 className="w-3.5 h-3.5 text-white" />
          </button>
        </div>

        {/* Mensajes */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3
                        bg-slate-50/50">
          {messages.map(msg => (
            <MessageBubble key={msg.id} msg={msg} />
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="flex items-center gap-2 px-4 py-3
                        bg-white border-t border-slate-100 flex-shrink-0">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Escribe tu pregunta..."
            disabled={sending}
            className="flex-1 bg-slate-50 border-2 border-transparent
                       rounded-xl text-sm font-medium text-slate-800
                       placeholder:text-slate-400 px-3.5 py-2.5
                       focus:outline-none focus:bg-white
                       focus:border-pink-400 focus:ring-4 focus:ring-pink-50
                       transition-all duration-200 disabled:opacity-60"
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || sending}
            className="w-9 h-9 rounded-xl bg-gradient-to-br from-pink-500
                       to-rose-400 flex items-center justify-center
                       shadow-sm shadow-pink-200 hover:shadow-pink-300
                       active:scale-95 transition-all duration-150
                       disabled:opacity-40 disabled:cursor-not-allowed
                       flex-shrink-0"
          >
            {sending ? (
              <div className="w-3.5 h-3.5 border-2 border-white/40
                              border-t-white rounded-full animate-spin" />
            ) : (
              <Send className="w-3.5 h-3.5 text-white" />
            )}
          </button>
        </div>
      </div>

      {/* ─── Botón flotante ─── */}
      <button
        onClick={handleToggle}
        className={`
          fixed bottom-6 right-6 z-50
          w-14 h-14 rounded-[1.25rem] overflow-hidden
          shadow-xl shadow-pink-200 hover:shadow-pink-300
          border-2 border-white
          transition-all duration-300
          hover:scale-110 active:scale-95
          ${open ? "rotate-0" : ""}
        `}
        aria-label="Abrir chat con Chipi"
      >
        <Image
          src="/assets/logo.png"
          alt="Chipi"
          width={56}
          height={56}
          className="object-contain w-full h-full"
        />

        {/* Indicador online */}
        <div className="absolute bottom-1 right-1 w-3 h-3 bg-emerald-400
                        rounded-full border-2 border-white" />
      </button>
    </>
  );
}