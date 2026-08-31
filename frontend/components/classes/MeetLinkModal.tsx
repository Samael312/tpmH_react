"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Video, X, Check, AlertCircle, Link2 } from "lucide-react";
import api from "@/lib/api";
import { useBusinessRules } from "@/hooks/useBusinessRules";
import { useToast } from "@/hooks/useToast";
import { getErrorMessage } from "@/lib/errorMessage";

export interface MeetLinkModalClassItem {
  id: number;
  subject?: string | null;
  meet_link?: string | null;
  counterpart_name?: string | null;
}

interface MeetLinkModalProps {
  classItem: MeetLinkModalClassItem;
  onClose: () => void;
  onSaved: () => void;
}

// ─── Modal: el profesor carga/edita el link de la videollamada ──────────────
// Campo 100% opcional — la clase funciona igual sin él. Solo aplica a
// clases 'confirmed' (ver PATCH /classes/{id}/meet-link en el backend).
export function MeetLinkModal({ classItem, onClose, onSaved }: MeetLinkModalProps) {
  const [link, setLink] = useState(classItem.meet_link ?? "");
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");
  const [mounted, setMounted] = useState(false);
  const { rules } = useBusinessRules();
  const toast = useToast();

  // El modal se monta vía portal directamente en <body>: ClassCard usa
  // backdrop-blur/transform, que crean un "containing block" para elementos
  // `fixed`, y eso hacía que el modal quedara atrapado dentro del recuadro
  // de la card en vez de cubrir toda la pantalla. Con createPortal se
  // renderiza fuera de ese árbol, evitando el problema sin importar desde
  // dónde se invoque.
  useEffect(() => {
    setMounted(true);
  }, []);

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      await api.patch(`/classes/${classItem.id}/meet-link`, {
        meet_link: link.trim() || null,
      });
      setSuccess(true);
      toast.success("Link de la clase guardado correctamente");
      setTimeout(() => { onSaved(); onClose(); }, 900);
    } catch (e) {
      setError(getErrorMessage(e, "Error guardando el link"));
    } finally {
      setSaving(false);
    }
  };

  if (!classItem || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-md transition-opacity"
        onClick={onClose}
      />

      <div className="relative w-full max-w-md bg-white/95 backdrop-blur-2xl
                      rounded-[2.5rem] shadow-2xl shadow-slate-300/50
                      border border-white p-6 sm:p-7
                      animate-in fade-in zoom-in-95 duration-300
                      overflow-hidden">

        <div className="absolute top-0 right-0 w-40 h-40 bg-pink-300/20
                        rounded-full blur-[80px] pointer-events-none" />

        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-pink-100 text-pink-600 flex items-center justify-center shadow-inner">
              <Video className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-black text-slate-800 tracking-tight">
                Link de la clase
              </h2>
              <p className="text-xs text-slate-500 font-medium">
                {classItem.meet_link
                  ? "Puedes editarlo cuando quieras"
                  : `Si no cargas uno, se genera automáticamente ${rules.meet_link_autogen_minutes} min antes de la clase`}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200
                       flex items-center justify-center transition-colors text-slate-500"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Cuerpo */}
        <div className="py-5 space-y-4">
          {success ? (
            <div className="flex flex-col items-center py-6 gap-3">
              <div className="w-14 h-14 rounded-full bg-emerald-100
                              flex items-center justify-center shadow-lg shadow-emerald-100 animate-bounce">
                <Check className="w-7 h-7 text-emerald-600" />
              </div>
              <p className="text-sm font-black text-slate-800">¡Link guardado!</p>
            </div>
          ) : (
            <>
              <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4">
                <p className="text-xs text-slate-500 font-medium">
                  {classItem.subject || "Clase"}
                  {classItem.counterpart_name && <> · {classItem.counterpart_name}</>}
                </p>
              </div>

              <div>
                <label className="block text-[10px] font-black text-slate-400
                                  uppercase tracking-widest mb-2">
                  URL de la videollamada
                </label>
                <div className="flex items-center gap-2 bg-white border border-slate-200
                                rounded-xl px-3 py-2.5 focus-within:border-pink-300 transition-colors">
                  <Link2 className="w-4 h-4 text-slate-400 flex-shrink-0" />
                  <input
                    type="url"
                    value={link}
                    onChange={(e) => setLink(e.target.value)}
                    placeholder="https://meet.google.com/xxx-xxxx-xxx"
                    className="flex-1 text-sm font-medium text-slate-700 outline-none placeholder:text-slate-300"
                  />
                </div>
                <p className="text-[11px] text-slate-400 mt-1.5">
                  Déjalo vacío y guarda para quitar el link.
                </p>
              </div>

              {error && (
                <div className="bg-rose-50 border border-rose-100 text-rose-600
                                px-4 py-3 rounded-xl text-xs font-bold
                                flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  {error}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {!success && (
          <div className="pt-2 flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 py-3 text-sm font-bold text-slate-600
                         bg-slate-100 hover:bg-slate-200 rounded-xl
                         transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="flex-1 py-3 text-sm font-bold text-white
                         rounded-xl bg-gradient-to-r from-pink-500 to-rose-400
                         hover:from-pink-600 hover:to-rose-500
                         shadow-lg shadow-pink-200 active:scale-[0.98]
                         transition-all duration-300 disabled:opacity-50
                         disabled:cursor-not-allowed flex items-center
                         justify-center gap-2"
            >
              {saving ? (
                <div className="w-4 h-4 border-2 border-white/40
                                border-t-white rounded-full animate-spin" />
              ) : (
                <><Video className="w-4 h-4" /> Guardar link</>
              )}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}