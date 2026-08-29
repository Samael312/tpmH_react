"use client";

import { useState } from "react";
import { CheckCircle, Bug, AlertTriangle, HelpCircle, MoreHorizontal } from "lucide-react";
import FullScreenModal from "@/components/ui/FullScreenModal";
import { createSupportTicket, SupportCategory } from "@/hooks/useSupport";

const CATEGORY_OPTIONS: { key: SupportCategory; label: string; icon: React.ReactNode }[] = [
  { key: "bug", label: "Bug", icon: <Bug className="w-4 h-4" /> },
  { key: "error", label: "Error", icon: <AlertTriangle className="w-4 h-4" /> },
  { key: "question", label: "Duda", icon: <HelpCircle className="w-4 h-4" /> },
  { key: "other", label: "Otro", icon: <MoreHorizontal className="w-4 h-4" /> },
];

export default function SupportTicketModal({
  open,
  onClose,
  onSent,
  screenContext,
  initialMessage = "",
}: {
  open: boolean;
  onClose: () => void;
  onSent?: () => void;
  /** screen_name de Chipi, si el ticket se abre desde el widget (contexto para el staff) */
  screenContext?: string;
  /** Prefill opcional — p.ej. el último mensaje que el usuario le escribió a Chipi */
  initialMessage?: string;
}) {
  const [category, setCategory] = useState<SupportCategory>("question");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState(initialMessage);
  const [sending, setSending] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  const reset = () => {
    setCategory("question");
    setSubject("");
    setMessage("");
    setSuccess(false);
    setError("");
  };

  const handleClose = () => {
    onClose();
    // Pequeño delay para no ver el formulario "vaciarse" durante la animación de salida
    setTimeout(reset, 300);
  };

  const submit = async () => {
    if (!subject.trim() || !message.trim() || sending) return;
    setSending(true);
    setError("");
    try {
      await createSupportTicket({
        category,
        subject: subject.trim(),
        message: message.trim(),
        screen_context: screenContext,
      });
      setSuccess(true);
      onSent?.();
      setTimeout(handleClose, 1400);
    } catch (e: any) {
      setError(e.response?.data?.detail || "No pudimos enviar tu ticket. Inténtalo de nuevo.");
    } finally {
      setSending(false);
    }
  };

  return (
    <FullScreenModal
      open={open}
      onClose={handleClose}
      title="Reportar a soporte"
      footer={
        !success ? (
          <button
            onClick={submit}
            disabled={!subject.trim() || !message.trim() || sending}
            className="w-full py-3.5 text-sm font-bold text-white rounded-xl
                       bg-gradient-to-r from-pink-500 to-rose-400
                       hover:from-pink-600 hover:to-rose-500
                       shadow-lg shadow-pink-200 hover:shadow-pink-300
                       active:scale-[0.98] transition-all duration-300
                       disabled:opacity-50 disabled:cursor-not-allowed
                       flex items-center justify-center gap-2"
          >
            {sending ? (
              <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
            ) : (
              "Enviar a soporte"
            )}
          </button>
        ) : undefined
      }
    >
      {success ? (
        <div className="flex flex-col items-center py-10 gap-3">
          <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center">
            <CheckCircle className="w-7 h-7 text-emerald-600" />
          </div>
          <p className="font-bold text-slate-700">¡Ticket enviado!</p>
          <p className="text-sm text-slate-500 text-center">
            Nuestro equipo lo revisará y te responderá pronto. Puedes ver la respuesta en tu sección de Soporte.
          </p>
        </div>
      ) : (
        <>
          <p className="text-sm text-slate-500 mb-5">
            Cuéntanos qué pasó — un bug, un error, o algo que Chipi no pudo resolver.
            Nuestro equipo te responderá directamente aquí.
          </p>

          <div className="mb-5">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">
              Tipo
            </label>
            <div className="grid grid-cols-4 gap-2">
              {CATEGORY_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => setCategory(opt.key)}
                  className={`flex flex-col items-center gap-1.5 py-3 rounded-xl text-[11px] font-bold transition-colors border-2 ${
                    category === opt.key
                      ? "bg-pink-50 border-pink-400 text-pink-600"
                      : "bg-slate-50 border-transparent text-slate-500 hover:bg-slate-100"
                  }`}
                >
                  {opt.icon}
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mb-5">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">
              Asunto
            </label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={150}
              placeholder="Ej: No puedo agendar una clase de prueba"
              className="w-full bg-slate-50 border-2 border-transparent rounded-xl text-sm font-medium
                         text-slate-800 placeholder:text-slate-400 px-4 py-3 focus:outline-none
                         focus:bg-white focus:border-pink-500 focus:ring-4 focus:ring-pink-50
                         transition-all duration-300"
            />
          </div>

          <div className="mb-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">
              Describe el problema o tu duda
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={6}
              maxLength={2000}
              placeholder="Cuéntanos con el mayor detalle posible qué pasó..."
              className="w-full bg-slate-50 border-2 border-transparent rounded-xl text-sm font-medium
                         text-slate-800 placeholder:text-slate-400 px-4 py-3.5 focus:outline-none
                         focus:bg-white focus:border-pink-500 focus:ring-4 focus:ring-pink-50
                         transition-all duration-300 resize-none"
            />
            <p className="text-xs text-slate-400 text-right mt-1">{message.length}/2000</p>
          </div>

          {error && (
            <div className="mt-2 bg-rose-50 border border-rose-100 text-rose-600 px-4 py-3 rounded-xl text-xs font-bold">
              {error}
            </div>
          )}
        </>
      )}
    </FullScreenModal>
  );
}
