"use client";

import { useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Upload, FileText, Image, Trash2,
  Users, Plus, BookOpen, Search, X, Check,
  Volume2, ChevronDown, FolderOpen, Sparkles,
  Edit2, AlertTriangle, Loader2, RefreshCw
} from "lucide-react";
import api from "@/lib/api";
import ChipiWidget from "@/components/chipi/ChipiWidget";
// in teacher onboarding StepSpecialties, teacher/profile, teacher/packages, etc.
import { useSystemCatalogs } from "@/hooks/useSystemCatalogs";
import { SUBJECTS as FALLBACK_SUBJECTS, LANGUAGES as FALLBACK_LANGUAGES, SKILL_SUGGESTIONS as FALLBACK_SKILLS, TOPICS as FALLBACK_TOPICS, LEVELS as FALLBACK_LEVELS } from "@/lib/teacherOptions";
import { useTeacherMaterials, useTeacherStudentsBasic, type TeacherMaterial as Material } from "@/hooks/useTeacherData";
import Skeleton from "@/components/ui/Skeleton";
import RefreshButton from "@/components/ui/RefreshButton";
import DesktopOnly from "@/components/ui/DesktopOnly";
import { usePageTopBar } from "@/lib/mobileTopBar";

interface ExpandableDescriptionProps {
  text: string;
  limitLines?: number;
}

interface Student {
  id: number;
  user_id?: number;
  username: string;
  name: string;
  surname: string;
  avatar?: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const isVocab = (m: Material) => m.vocabulary_words !== null && m.vocabulary_words.length > 0;

function getFileIcon(filename: string | null, category: string) {
  if (category?.toLowerCase() === "vocabulary")
    return <Volume2 className="w-6 h-6 text-purple-500" />;
  const ext = filename?.split(".").pop()?.toLowerCase();
  if (["jpg","jpeg","png","gif","webp"].includes(ext || ""))
    return <Image className="w-6 h-6 text-blue-500" />;
  if (ext === "pdf")
    return <FileText className="w-6 h-6 text-rose-500" />;
  return <FileText className="w-6 h-6 text-slate-400" />;
}

function LevelBadge({ level }: { level: string }) {
  const colors: Record<string, string> = {
    A1: "bg-emerald-100 text-emerald-700",
    A2: "bg-emerald-100 text-emerald-700",
    B1: "bg-blue-100 text-blue-700",
    B2: "bg-blue-100 text-blue-700",
    C1: "bg-purple-100 text-purple-700",
    C2: "bg-purple-100 text-purple-700",
  };
  return (
    <span className={`text-[10px] font-black uppercase tracking-widest
                      px-2 py-0.5 rounded-full ${colors[level] ?? "bg-slate-100 text-slate-500"}`}>
      {level}
    </span>
  );
}

export function ExpandableDescription({ text, limitLines = 2 }: ExpandableDescriptionProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="mb-3">
      <p
        className={`text-xs text-slate-500 leading-relaxed whitespace-pre-wrap break-words ${
          !isExpanded ? `line-clamp-${limitLines}` : ''
        }`}
      >
        {text}
      </p>

      {/* Botón para alternar */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="text-[11px] font-medium text-indigo-600 hover:text-indigo-800 hover:underline mt-1 block focus:outline-none"
      >
        {isExpanded ? 'Ver menos' : 'Ver más'}
      </button>
    </div>
  );
}

function StudentAvatar({ s, className }: { s: Student; className?: string }) {
  if (s.avatar) {
    return <img src={s.avatar} alt={s.name} className={`${className} object-cover`} />;
  }
  return (
    <div className={`${className} bg-gradient-to-br from-pink-400 to-rose-400
                      flex items-center justify-center text-white font-black`}>
      {s.name?.[0]?.toUpperCase()}{s.surname?.[0]?.toUpperCase()}
    </div>
  );
}

// ─── Modal Asignar ───────────────────────────────────────────────────────────
function AssignModal({
  material,
  onClose,
}: {
  material: Material;
  onClose: () => void;
}) {
  const { students, loading, isError, refetch } = useTeacherStudentsBasic();
  const [selected, setSelected] = useState<number[]>([]);
  const [assigning, setAssigning] = useState(false);
  const [success, setSuccess]   = useState(false);
  const [search, setSearch]     = useState("");

  const toggle = (id: number) =>
    setSelected(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);

  const filtered = students.filter(s => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      s.name?.toLowerCase().includes(q) ||
      s.surname?.toLowerCase().includes(q) ||
      s.username?.toLowerCase().includes(q)
    );
  });

  const assign = async () => {
    if (!selected.length) return;
    setAssigning(true);
    try {
      await api.post(`/materials/${material.id}/assign`, {
        student_ids: selected,
      });
      setSuccess(true);
      setTimeout(onClose, 1200);
    } catch (e: any) {
      alert(e.response?.data?.detail || "Error asignando");
    } finally { setAssigning(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
           onClick={onClose} />

      <div className="relative w-full max-w-md bg-white/90 backdrop-blur-2xl
                      rounded-[2.5rem] shadow-2xl shadow-slate-200/60
                      border border-white p-8 animate-in fade-in zoom-in-95
                      duration-200">

        <div className="absolute top-0 right-0 w-48 h-48 bg-pink-300/20
                        rounded-full blur-[80px] pointer-events-none" />

        <div className="flex items-start justify-between mb-5">
          <div>
            <h2 className="text-xl font-black text-slate-800 tracking-tight">
              Asignar material
            </h2>
            <p className="text-sm text-slate-500 mt-0.5 line-clamp-1">
              {material.title}
            </p>
          </div>
          <button onClick={onClose}
            className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200
                       flex items-center justify-center transition-colors">
            <X className="w-4 h-4 text-slate-500" />
          </button>
        </div>

        {success ? (
          <div className="flex flex-col items-center py-8 gap-3">
            <div className="w-14 h-14 rounded-full bg-emerald-100
                            flex items-center justify-center">
              <Check className="w-7 h-7 text-emerald-600" />
            </div>
            <p className="text-slate-700 font-bold">
              ¡Asignado correctamente!
            </p>
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center py-8 gap-3 text-center">
            <div className="w-14 h-14 rounded-full bg-rose-100 flex items-center justify-center">
              <AlertTriangle className="w-7 h-7 text-rose-500" />
            </div>
            <p className="text-sm font-bold text-slate-700">No se pudo cargar tu lista de estudiantes</p>
            <button
              onClick={() => refetch()}
              className="flex items-center gap-2 px-4 py-2 bg-rose-50 hover:bg-rose-100 text-rose-600 text-xs font-bold rounded-xl transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Reintentar
            </button>
          </div>
        ) : loading ? (
          <div className="flex justify-center py-8">
            <div className="w-8 h-8 border-4 border-pink-200
                            border-t-pink-500 rounded-full animate-spin" />
          </div>
        ) : (
          <>
            <div className="group relative mb-4">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2
                                  w-4 h-4 text-slate-400
                                  group-focus-within:text-pink-500
                                  transition-colors pointer-events-none" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar por nombre o usuario..."
                className="w-full bg-slate-50 border-2 border-transparent
                           rounded-xl text-sm font-bold text-slate-800
                           placeholder:text-slate-400 pl-10 pr-4 py-3
                           focus:outline-none focus:bg-white
                           focus:border-pink-500 focus:ring-4 focus:ring-pink-50
                           transition-all duration-300"
              />
            </div>

            <div className="space-y-2 max-h-64 overflow-y-auto pr-1 mb-6">
              {students.length === 0 ? (
                <div className="text-center py-8">
                  <Users className="w-8 h-8 text-slate-200 mx-auto mb-2" />
                  <p className="text-sm text-slate-400 font-bold">
                    Aún no tienes estudiantes asignados
                  </p>
                </div>
              ) : filtered.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-6">
                  Sin resultados para “{search}”
                </p>
              ) : filtered.map(s => (
                <button
                  key={s.id}
                  onClick={() => toggle(s.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3
                    rounded-2xl border-2 transition-all duration-200 text-left
                    ${selected.includes(s.id)
                      ? "border-pink-400 bg-pink-50"
                      : "border-slate-100 bg-white hover:border-slate-200"
                    }`}
                >
                  <StudentAvatar s={s} className="w-9 h-9 rounded-xl flex-shrink-0 text-xs" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-slate-800 truncate">
                      {s.name} {s.surname}
                    </p>
                    <p className="text-xs text-slate-400">@{s.username}</p>
                  </div>
                  {selected.includes(s.id) && (
                    <Check className="w-4 h-4 text-pink-500 ml-auto flex-shrink-0" />
                  )}
                </button>
              ))}
            </div>

            <button
              onClick={assign}
              disabled={!selected.length || assigning}
              className="w-full py-3.5 text-sm font-bold text-white rounded-xl
                         bg-gradient-to-r from-pink-500 to-rose-400
                         hover:from-pink-600 hover:to-rose-500
                         shadow-lg shadow-pink-200 hover:shadow-pink-300
                         active:scale-[0.98] transition-all duration-300
                         disabled:opacity-50 disabled:cursor-not-allowed
                         flex items-center justify-center gap-2"
            >
              {assigning ? (
                <div className="w-4 h-4 border-2 border-white/40
                                border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <Users className="w-4 h-4" />
                  Asignar a {selected.length} estudiante
                  {selected.length !== 1 ? "s" : ""}
                </>
              )}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Modal Vocabulario ────────────────────────────────────────────────────────
function VocabModal({
  material,
  onClose,
  onSaved,
}: {
  material: Material;
  onClose: () => void;
  onSaved: () => void;
}) {
  const words = material.vocabulary_words ?? [];
  const [list, setList]       = useState<string[]>(words);
  const [input, setInput]     = useState("");
  const [saving, setSaving]   = useState(false);

  const addWord = () => {
    const w = input.trim();
    if (!w || list.includes(w)) return;
    setList(p => [...p, w.charAt(0).toUpperCase() + w.slice(1)]);
    setInput("");
  };

  const removeWord = (w: string) => setList(p => p.filter(x => x !== w));

  const save = async () => {
    setSaving(true);
    try {
      await api.post(`/materials/${material.id}/vocabulary`, { words: list });
      onSaved();
      onClose();
    } catch (e: any) {
      alert(e.response?.data?.detail || "Error guardando");
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
           onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white/90 backdrop-blur-2xl
                      rounded-[2.5rem] shadow-2xl shadow-slate-200/60
                      border border-white p-8 animate-in fade-in zoom-in-95
                      duration-200">
        <div className="absolute top-0 right-0 w-48 h-48 bg-purple-300/20
                        rounded-full blur-[80px] pointer-events-none" />

        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-black text-slate-800 tracking-tight">
            Editar palabras
          </h2>
          <button onClick={onClose}
            className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200
                       flex items-center justify-center transition-colors">
            <X className="w-4 h-4 text-slate-500" />
          </button>
        </div>

        <div className="flex gap-2 mb-4">
          <div className="group relative flex-1">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addWord()}
              placeholder="Nueva palabra..."
              className="w-full bg-slate-50 border-2 border-transparent
                         rounded-xl text-sm font-bold text-slate-800
                         placeholder:text-slate-400 px-4 py-3
                         focus:outline-none focus:bg-white
                         focus:border-pink-500 focus:ring-4 focus:ring-pink-50
                         transition-all duration-300"
            />
          </div>
          <button onClick={addWord}
            className="px-4 py-3 bg-pink-50 text-pink-600 hover:bg-pink-100
                       font-bold rounded-xl transition-colors flex-shrink-0">
            <Plus className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-wrap gap-2 min-h-[80px] bg-slate-50
                        rounded-2xl p-4 mb-6 max-h-48 overflow-y-auto">
          {list.length === 0 ? (
            <p className="text-slate-400 text-sm m-auto">
              Sin palabras todavía
            </p>
          ) : list.map(w => (
            <span key={w}
              className="inline-flex items-center gap-1.5 bg-white
                         border border-slate-200 text-slate-700 text-sm
                         font-bold px-3 py-1.5 rounded-xl shadow-sm">
              {w}
              <button onClick={() => removeWord(w)}
                className="text-slate-300 hover:text-rose-400 transition-colors">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>

        <button onClick={save} disabled={saving}
          className="w-full py-3.5 text-sm font-bold text-white rounded-xl
                     bg-gradient-to-r from-pink-500 to-rose-400
                     hover:from-pink-600 hover:to-rose-500
                     shadow-lg shadow-pink-200 active:scale-[0.98]
                     transition-all duration-300 disabled:opacity-50
                     flex items-center justify-center gap-2">
          {saving ? (
            <div className="w-4 h-4 border-2 border-white/40
                            border-t-white rounded-full animate-spin" />
          ) : (
            <><Check className="w-4 h-4" /> Guardar {list.length} palabras</>
          )}
        </button>
      </div>
    </div>
  );
}

// ─── Modal Editar detalles ───────────────────────────────────────────────────
function EditMaterialModal({
  material,
  onClose,
  onSaved,
}: {
  material: Material;
  onClose: () => void;
  onSaved: (updated: Material) => void;
}) {
  const { catalogs } = useSystemCatalogs();
  const CATEGORIES = catalogs.material_categories.length ? catalogs.material_categories : FALLBACK_TOPICS;
  const LEVELS = catalogs.material_levels.length ? catalogs.material_levels : FALLBACK_LEVELS;
  const [title, setTitle]             = useState(material.title);
  const [description, setDescription] = useState(material.description ?? "");
  const [category, setCategory]       = useState(material.category);
  const [level, setLevel]             = useState(material.level ?? LEVELS[0]);
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState("");

  const materialIsVocab = isVocab(material);

  const save = async () => {
    if (!title.trim()) {
      setError("El título no puede estar vacío");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await api.patch(`/materials/${material.id}`, {
        title,
        description: description.trim() || null,
        category: materialIsVocab ? material.category : category,
        level,
      });
      onSaved(res.data);
      onClose();
    } catch (e: any) {
      setError(e.response?.data?.detail || "Error guardando los cambios");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
           onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white/90 backdrop-blur-2xl
                      rounded-[2.5rem] shadow-2xl shadow-slate-200/60
                      border border-white p-8 animate-in fade-in zoom-in-95
                      duration-200">
        <div className="absolute top-0 right-0 w-48 h-48 bg-blue-300/15
                        rounded-full blur-[80px] pointer-events-none" />

        <div className="flex items-start justify-between mb-6">
          <div>
            <h2 className="text-xl font-black text-slate-800 tracking-tight">
              Editar detalles
            </h2>
            <p className="text-sm text-slate-500 mt-0.5">
              Actualiza la información de este material
            </p>
          </div>
          <button onClick={onClose}
            className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200
                       flex items-center justify-center transition-colors flex-shrink-0">
            <X className="w-4 h-4 text-slate-500" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-[10px] font-black text-slate-400
                              uppercase tracking-widest block mb-1.5">
              Título
            </label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Título del material"
              className="w-full bg-slate-50 border-2 border-transparent
                         rounded-xl text-sm font-bold text-slate-800
                         placeholder:text-slate-400 px-4 py-3
                         focus:outline-none focus:bg-white
                         focus:border-pink-500 focus:ring-4 focus:ring-pink-50
                         transition-all duration-300"
            />
          </div>

          <div>
            <label className="text-[10px] font-black text-slate-400
                              uppercase tracking-widest block mb-1.5">
              Descripción
            </label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
              placeholder="Breve descripción de qué trata este material..."
              className="w-full bg-slate-50 border-2 border-transparent
                         rounded-xl text-sm font-medium text-slate-800
                         placeholder:text-slate-400 px-4 py-3
                         focus:outline-none focus:bg-white
                         focus:border-pink-500 focus:ring-4 focus:ring-pink-50
                         transition-all duration-300 resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-black text-slate-400
                                uppercase tracking-widest block mb-1.5">
                Categoría
              </label>
              {materialIsVocab ? (
                <div className="w-full bg-slate-100 rounded-xl text-sm font-bold
                                text-slate-400 px-4 py-3">
                  Vocabulary
                </div>
              ) : (
                <div className="relative">
                  <select
                    value={category}
                    onChange={e => setCategory(e.target.value)}
                    className="w-full appearance-none bg-slate-50 border-2
                               border-transparent rounded-xl text-sm font-bold
                               text-slate-800 px-4 py-3 focus:outline-none
                               focus:bg-white focus:border-pink-500
                               focus:ring-4 focus:ring-pink-50
                               transition-all duration-300 cursor-pointer"
                  >
                    {CATEGORIES.filter(c => c !== "Vocabulary").map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2
                                          w-4 h-4 text-slate-400 pointer-events-none" />
                </div>
              )}
            </div>

            <div>
              <label className="text-[10px] font-black text-slate-400
                                uppercase tracking-widest block mb-1.5">
                Nivel
              </label>
              <div className="relative">
                <select
                  value={level}
                  onChange={e => setLevel(e.target.value)}
                  className="w-full appearance-none bg-slate-50 border-2
                             border-transparent rounded-xl text-sm font-bold
                             text-slate-800 px-4 py-3 focus:outline-none
                             focus:bg-white focus:border-pink-500
                             focus:ring-4 focus:ring-pink-50
                             transition-all duration-300 cursor-pointer"
                >
                  {LEVELS.map(l => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2
                                        w-4 h-4 text-slate-400 pointer-events-none" />
              </div>
            </div>
          </div>

          {error && (
            <div className="bg-rose-50 border border-rose-100 text-rose-600
                            px-4 py-3 rounded-xl text-xs font-bold
                            flex items-center gap-2">
              <X className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          <button
            onClick={save}
            disabled={saving || !title.trim()}
            className="w-full py-3.5 text-sm font-bold text-white rounded-xl
                       bg-gradient-to-r from-pink-500 to-rose-400
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
              <><Check className="w-4 h-4" /> Guardar cambios</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal Confirmar eliminación ──────────────────────────────────────────────
function DeleteMaterialModal({
  material,
  onClose,
  onDeleted,
}: {
  material: Material;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError]       = useState("");

  const confirmDelete = async () => {
    setDeleting(true);
    setError("");
    try {
      await api.delete(`/materials/${material.id}`);
      onDeleted();
      onClose();
    } catch (e: any) {
      setError(e.response?.data?.detail || "Error eliminando el material");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
           onClick={onClose} />
      <div className="relative w-full max-w-sm bg-white/95 backdrop-blur-2xl
                      rounded-[2.5rem] shadow-2xl shadow-slate-200/60
                      border border-white p-8
                      animate-in fade-in zoom-in-95 duration-200">

        <div className="absolute top-0 right-0 w-40 h-40 bg-red-300/20
                        rounded-full blur-[60px] pointer-events-none" />

        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-14 h-14 bg-red-100 rounded-full flex items-center
                          justify-center mb-4">
            <AlertTriangle className="w-7 h-7 text-red-500" />
          </div>
          <h2 className="text-xl font-black text-slate-800 tracking-tight mb-2">
            ¿Eliminar material?
          </h2>
          <p className="text-sm text-slate-500">
            <span className="font-bold text-slate-700">“{material.title}”</span> se
            eliminará y dejará de estar visible para tus estudiantes. Esta acción no se puede deshacer.
          </p>
        </div>

        {error && (
          <div className="mb-4 bg-rose-50 border border-rose-100 text-rose-600
                          px-4 py-3 rounded-xl text-xs font-bold
                          flex items-center gap-2">
            <X className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={onClose}
            disabled={deleting}
            className="flex-1 py-3 text-sm font-bold text-slate-600
                       bg-slate-100 hover:bg-slate-200 rounded-xl
                       transition-colors disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={confirmDelete}
            disabled={deleting}
            className="flex-1 py-3 text-sm font-bold text-white bg-red-500
                       hover:bg-red-600 rounded-xl shadow-md shadow-red-100
                       active:scale-[0.98] transition-all duration-200
                       disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {deleting ? (
              <div className="w-4 h-4 border-2 border-white/40
                              border-t-white rounded-full animate-spin" />
            ) : (
              <><Trash2 className="w-4 h-4" /> Eliminar</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────
export default function MaterialsPage() {
  const { catalogs } = useSystemCatalogs();
  const SUBJECTS = catalogs.subjects.length ? catalogs.subjects : FALLBACK_SUBJECTS;
  const LANGUAGES = catalogs.languages.length ? catalogs.languages : FALLBACK_LANGUAGES;
  const SKILL_SUGGESTIONS = catalogs.skill_suggestions.length ? catalogs.skill_suggestions : FALLBACK_SKILLS;
  const CATEGORIES = catalogs.material_categories.length ? catalogs.material_categories : FALLBACK_TOPICS;
  const LEVELS = catalogs.material_levels.length ? catalogs.material_levels : FALLBACK_LEVELS;
  
  const { materials, loading, isFetching, isError, refetch } = useTeacherMaterials();
  const queryClient = useQueryClient();
  
  const [search, setSearch]         = useState("");
  const [tab, setTab]               = useState<"files" | "vocab">("files");
  const [uploading, setUploading]   = useState(false);
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [assignTarget, setAssignTarget] = useState<Material | null>(null);
  const [vocabTarget, setVocabTarget]   = useState<Material | null>(null);
  const [editTarget, setEditTarget]     = useState<Material | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Material | null>(null);
  const [justDeleted, setJustDeleted]   = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  
  const [title, setTitle]             = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory]       = useState(CATEGORIES[0]);
  const [level, setLevel]             = useState(LEVELS[0]);
  const [file, setFile]               = useState<File | null>(null);
  const [fileError, setFileError]     = useState<string | null>(null);

  const [vocabTitle, setVocabTitle]             = useState("");
  const [vocabDescription, setVocabDescription] = useState("");
  const [vocabLevel, setVocabLevel]             = useState(LEVELS[0]);
  const [vocabWords, setVocabWords]             = useState<string[]>([]);
  const [vocabWordInput, setVocabWordInput]     = useState("");

  usePageTopBar({
    title: "Materiales",
    onRefresh: refetch,
    isFetching,
  });

  const uploadFile = async () => {
    if (!title || !file) return;
    setUploading(true);
    setFileError(null);
    try {
      const form = new FormData();
      form.append("title", title);
      form.append("category", category);
      form.append("level", level);
      if (description.trim()) form.append("description", description.trim());
      form.append("file", file);
      await api.post("/materials/", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setTitle(""); setDescription(""); setFile(null); setCategory(CATEGORIES[0]);
      if (fileRef.current) fileRef.current.value = "";
      refetch();
    } catch (e: any) {
      const errorMsg = e.response?.data?.detail || "Error subiendo el archivo";
      setFileError(errorMsg);
    } finally { setUploading(false); }
  };

  const addVocabWord = (text?: string) => {
    const raw = (text ?? vocabWordInput).trim();
      if (!raw) return;
      const parts = raw.split(",").map(w => w.trim()).filter(Boolean);
      setVocabWords(prev => {
        const next = [...prev];
        parts.forEach(p => {
          const w = p.charAt(0).toUpperCase() + p.slice(1);
          if (!next.includes(w)) next.push(w);
        });
        return next;
      });
      setVocabWordInput("");
    };

  const removeVocabWord = (w: string) =>
    setVocabWords(prev => prev.filter(x => x !== w));

  const createVocab = async () => {
    if (!vocabTitle || vocabWords.length === 0) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("title", vocabTitle);
      form.append("category", "Vocabulary");
      form.append("level", vocabLevel);
      if (vocabDescription.trim()) form.append("description", vocabDescription.trim());

      const res = await api.post("/materials/", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      await api.post(`/materials/${res.data.id}/vocabulary`, { words: vocabWords });

      setVocabTitle("");
      setVocabDescription("");
      setVocabWords([]);
      setVocabWordInput("");
      refetch();
    } catch (e: any) {
      alert(e.response?.data?.detail || "Error creando vocabulario");
    } finally {
      setUploading(false);
    }
  };

  const handleMaterialSaved = (updated: Material) => {
    queryClient.setQueryData<Material[]>(["teacher", "materials"], (prev) =>
      (prev ?? []).map(m => (m.id === updated.id ? { ...m, ...updated } : m))
    );
  };

  const handleMaterialDeleted = (deletedId: number) => {
    queryClient.setQueryData<Material[]>(["teacher", "materials"], (prev) =>
      (prev ?? []).filter(m => m.id !== deletedId)
    );
    setJustDeleted(true);
    setTimeout(() => setJustDeleted(false), 3000);
  };

  const filtered = (materials ?? []).filter(m => {
    const inSearch = m.title.toLowerCase().includes(search.toLowerCase());
    const inTab = tab === "vocab" ? isVocab(m) : !isVocab(m);
    return inSearch && inTab;
  });

  const docsCount  = (materials ?? []).filter(m => !isVocab(m)).length;
  const vocabCount = (materials ?? []).filter(m => isVocab(m)).length;

  if (isError && !loading) {
    return (
      <>
        <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center gap-4 text-center px-4">
          <div className="w-14 h-14 bg-rose-100 rounded-full flex items-center justify-center">
            <AlertTriangle className="w-7 h-7 text-rose-500" />
          </div>
          <div>
            <p className="text-lg font-black text-slate-800">No se pudieron cargar tus materiales</p>
            <p className="text-sm text-slate-500 mt-1">Revisa tu conexión e inténtalo de nuevo.</p>
          </div>
          <button
            onClick={() => refetch()}
            className="flex items-center gap-2 px-5 py-2.5 bg-pink-500 hover:bg-pink-600 text-white text-sm font-bold rounded-xl shadow-sm transition-colors"
          >
            <RefreshCw className="w-4 h-4" /> Reintentar
          </button>
        </div>
        <ChipiWidget screenName="materials_teacher" />
      </>
    );
  }

  return (
    <>
    <div className="min-h-screen bg-slate-50 relative overflow-hidden">

      <div className="fixed top-[-100px] right-[-100px] w-[500px] h-[500px]
                      bg-pink-300/20 rounded-full blur-[100px] pointer-events-none" />
      <div className="fixed bottom-[-100px] left-[-100px] w-[400px] h-[400px]
                      bg-purple-300/15 rounded-full blur-[100px] pointer-events-none" />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-8">

        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4
                        animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div>
            <h1 className="text-3xl font-black text-slate-800 tracking-tight">
              Materiales
            </h1>
            <p className="text-slate-500 mt-1">
              Organiza tus recursos y sets de vocabulario, y asígnalos a tus estudiantes
            </p>
          </div>
          <div className="flex items-center gap-2 self-start sm:self-auto">
            <DesktopOnly>
              <RefreshButton onRefresh={refetch} isFetching={isFetching} />
            </DesktopOnly>
            <button
              onClick={() => setShowUploadForm(p => !p)}
              className="inline-flex items-center gap-2 px-5 py-3 text-sm font-bold
                         text-white rounded-xl bg-gradient-to-r from-pink-500 to-rose-400
                         shadow-lg shadow-pink-200 hover:shadow-pink-300
                         active:scale-[0.98] transition-all duration-300"
            >
              {showUploadForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
              {showUploadForm ? "Cerrar" : "Nuevo material"}
            </button>
          </div>
        </div>

        {justDeleted && (
          <div className="bg-emerald-50 border border-emerald-100 text-emerald-700
                          px-4 py-3 rounded-xl text-xs font-bold flex items-center gap-2
                          animate-in fade-in slide-in-from-top-2 duration-300">
            <Check className="w-4 h-4 flex-shrink-0" />
            Material eliminado correctamente
          </div>
        )}

        <div className="grid grid-cols-3 gap-4 animate-in fade-in slide-in-from-bottom-4
                        duration-500 delay-75">
          {[
            { label: "Total", value: (materials ?? []).length, icon: <FolderOpen className="w-5 h-5" />, bg: "bg-pink-50 text-pink-500" },
            { label: "Documentos", value: docsCount, icon: <FileText className="w-5 h-5" />, bg: "bg-blue-50 text-blue-500" },
            { label: "Vocabulario", value: vocabCount, icon: <Sparkles className="w-5 h-5" />, bg: "bg-purple-50 text-purple-500" },
          ].map(s => (
            <div key={s.label}
              className="bg-white/85 backdrop-blur-xl rounded-2xl border border-white
                        shadow-lg shadow-slate-100 p-5 flex items-center gap-4">
              <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${s.bg}`}>
                {s.icon}
              </div>
              <div>
                <p className="text-2xl font-black text-slate-800 leading-none">{s.value}</p>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">
                  {s.label}
                </p>
              </div>
            </div>
          ))}
        </div>

        {showUploadForm && (
          <div className="bg-white/80 backdrop-blur-xl rounded-[2rem]
                          border border-white shadow-2xl shadow-slate-200/50 p-6 sm:p-8
                          animate-in fade-in slide-in-from-top-4 duration-300 relative overflow-hidden">

            <div className="absolute top-0 right-0 w-48 h-48 bg-pink-300/10
                            rounded-full blur-[80px] pointer-events-none" />

            <div className="flex gap-1 bg-slate-100 rounded-xl p-1 w-fit mb-6 relative">
              {[
                { key: "files", label: "Subir documento" },
                { key: "vocab", label: "Crear vocabulario" },
              ].map(t => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key as any)}
                  className={`px-5 py-2 rounded-lg text-sm font-bold
                    transition-all duration-200
                    ${tab === t.key
                      ? "bg-white text-slate-800 shadow-sm"
                      : "text-slate-500 hover:text-slate-700"
                    }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {tab === "files" ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 relative">
                <div className="group sm:col-span-2">
                  <label className="text-[10px] font-black text-slate-400
                                    uppercase tracking-widest block mb-1.5">
                    Título del documento
                  </label>
                  <div className="relative">
                    <BookOpen className="absolute left-3.5 top-1/2 -translate-y-1/2
                                         w-5 h-5 text-slate-400
                                         group-focus-within:text-pink-500
                                         transition-colors" />
                    <input
                      value={title}
                      onChange={e => setTitle(e.target.value)}
                      placeholder="Ej: Guía de gramática B1"
                      className="w-full bg-slate-50 border-2 border-transparent
                                 rounded-xl text-sm font-bold text-slate-800
                                 placeholder:text-slate-400 pl-11 pr-4 py-3.5
                                 focus:outline-none focus:bg-white
                                 focus:border-pink-500 focus:ring-4 focus:ring-pink-50
                                 transition-all duration-300"
                    />
                  </div>
                </div>

                <div className="sm:col-span-2">
                  <label className="text-[10px] font-black text-slate-400
                                    uppercase tracking-widest block mb-1.5">
                    Descripción <span className="normal-case text-slate-300 font-bold">(opcional)</span>
                  </label>
                  <textarea
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    rows={2}
                    placeholder="Breve descripción de qué trata este material..."
                    className="w-full bg-slate-50 border-2 border-transparent
                               rounded-xl text-sm font-medium text-slate-800
                               placeholder:text-slate-400 px-4 py-3
                               focus:outline-none focus:bg-white
                               focus:border-pink-500 focus:ring-4 focus:ring-pink-50
                               transition-all duration-300 resize-none"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-black text-slate-400
                                    uppercase tracking-widest block mb-1.5">
                    Categoría
                  </label>
                  <div className="relative">
                    <select
                      value={category}
                      onChange={e => setCategory(e.target.value)}
                      className="w-full appearance-none bg-slate-50 border-2
                                 border-transparent rounded-xl text-sm font-bold
                                 text-slate-800 px-4 py-3.5 focus:outline-none
                                 focus:bg-white focus:border-pink-500
                                 focus:ring-4 focus:ring-pink-50
                                 transition-all duration-300 cursor-pointer"
                    >
                      {CATEGORIES.map(c => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2
                                            w-4 h-4 text-slate-400 pointer-events-none" />
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-black text-slate-400
                                    uppercase tracking-widest block mb-1.5">
                    Nivel
                  </label>
                  <div className="relative">
                    <select
                      value={level}
                      onChange={e => setLevel(e.target.value)}
                      className="w-full appearance-none bg-slate-50 border-2
                                 border-transparent rounded-xl text-sm font-bold
                                 text-slate-800 px-4 py-3.5 focus:outline-none
                                 focus:bg-white focus:border-pink-500
                                 focus:ring-4 focus:ring-pink-50
                                 transition-all duration-300 cursor-pointer"
                    >
                      {LEVELS.map(l => (
                        <option key={l} value={l}>{l}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2
                                            w-4 h-4 text-slate-400 pointer-events-none" />
                  </div>
                </div>

                <div
                  onClick={() => fileRef.current?.click()}
                  className={`sm:col-span-2 border-2 border-dashed rounded-2xl
                    p-8 text-center cursor-pointer transition-all duration-300
                    ${file
                      ? "border-pink-400 bg-pink-50"
                      : "border-slate-200 bg-slate-50 hover:border-pink-300 hover:bg-pink-50/50"
                    }`}
                >
                  <input
                    ref={fileRef}
                    type="file"
                    className="hidden"
                    accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                    onChange={e => {
                      const selectedFile = e.target.files?.[0] ?? null;
                      if (selectedFile) {
                        const MAX_DOCUMENT_SIZE = 10 * 1024 * 1024; // 10MB
                        if (selectedFile.size > MAX_DOCUMENT_SIZE) {
                          setFileError("El archivo supera el límite permitido de 10 MB.");
                          setFile(null);
                          if (fileRef.current) fileRef.current.value = "";
                          return;
                        }
                      }
                      setFileError(null);
                      setFile(selectedFile);
                    }}
                  />
                  {file ? (
                    <div className="flex items-center justify-center gap-3">
                      <div className="w-10 h-10 bg-pink-100 rounded-xl
                                      flex items-center justify-center">
                        <FileText className="w-5 h-5 text-pink-500" />
                      </div>
                      <div className="text-left">
                        <p className="text-sm font-bold text-slate-800">
                          {file.name}
                        </p>
                        <p className="text-xs text-slate-500">
                          {(file.size / (1024 * 1024)).toFixed(2)} MB
                        </p>
                      </div>
                      <button
                        onClick={e => { e.stopPropagation(); setFile(null); }}
                        className="ml-4 text-slate-400 hover:text-rose-500
                                   transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="w-12 h-12 bg-slate-100 rounded-2xl
                                      flex items-center justify-center mx-auto mb-3">
                        <Upload className="w-6 h-6 text-slate-400" />
                      </div>
                      <p className="text-sm font-bold text-slate-600">
                        Arrastra un archivo o haz clic
                      </p>
                      <p className="text-xs text-slate-400 mt-1">
                        PDF, DOC, DOCX, JPG, PNG (Máx. 10 MB)
                      </p>
                    </>
                  )}
                </div>

                {fileError && (
                  <div className="sm:col-span-2 bg-rose-50 border border-rose-100 text-rose-600
                                  px-4 py-3 rounded-xl text-xs font-bold flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 flex-shrink-0 text-rose-500" />
                      <span>{fileError}</span>
                    </div>
                    <button onClick={() => setFileError(null)} className="text-rose-400 hover:text-rose-600">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}

                <button
                  onClick={uploadFile}
                  disabled={!title || !file || uploading}
                  className="sm:col-span-2 py-3.5 text-sm font-bold text-white
                             rounded-xl bg-gradient-to-r from-pink-500 to-rose-400
                             hover:from-pink-600 hover:to-rose-500
                             shadow-lg shadow-pink-200 hover:shadow-pink-300
                             active:scale-[0.98] transition-all duration-300
                             disabled:opacity-50 disabled:cursor-not-allowed
                             flex items-center justify-center gap-2"
                >
                  {uploading ? (
                    <div className="w-4 h-4 border-2 border-white/40
                                    border-t-white rounded-full animate-spin" />
                  ) : (
                    <><Upload className="w-4 h-4" /> Subir material</>
                  )}
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 relative">
                <div className="group sm:col-span-2">
                  <label className="text-[10px] font-black text-slate-400
                                    uppercase tracking-widest block mb-1.5">
                    Nombre del set
                  </label>
                  <div className="relative">
                    <Volume2 className="absolute left-3.5 top-1/2 -translate-y-1/2
                                         w-5 h-5 text-slate-400
                                         group-focus-within:text-pink-500
                                         transition-colors" />
                    <input
                      value={vocabTitle}
                      onChange={e => setVocabTitle(e.target.value)}
                      placeholder="Ej: Vocabulario de viajes"
                      className="w-full bg-slate-50 border-2 border-transparent
                                 rounded-xl text-sm font-bold text-slate-800
                                 placeholder:text-slate-400 pl-11 pr-4 py-3.5
                                 focus:outline-none focus:bg-white
                                 focus:border-pink-500 focus:ring-4 focus:ring-pink-50
                                 transition-all duration-300"
                    />
                  </div>
                </div>

                <div className="sm:col-span-2">
                  <label className="text-[10px] font-black text-slate-400
                                    uppercase tracking-widest block mb-1.5">
                    Descripción <span className="normal-case text-slate-300 font-bold">(opcional)</span>
                  </label>
                  <textarea
                    value={vocabDescription}
                    onChange={e => setVocabDescription(e.target.value)}
                    rows={2}
                    placeholder="Breve descripción de este set de vocabulario..."
                    className="w-full bg-slate-50 border-2 border-transparent
                               rounded-xl text-sm font-medium text-slate-800
                               placeholder:text-slate-400 px-4 py-3
                               focus:outline-none focus:bg-white
                               focus:border-pink-500 focus:ring-4 focus:ring-pink-50
                               transition-all duration-300 resize-none"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="text-[10px] font-black text-slate-400
                                    uppercase tracking-widest block mb-1.5">
                    Nivel
                  </label>
                  <div className="flex gap-2 flex-wrap">
                    {LEVELS.map(l => (
                      <button
                        key={l}
                        onClick={() => setVocabLevel(l)}
                        className={`px-4 py-2 rounded-xl text-sm font-bold
                          transition-all duration-200 border-2
                          ${vocabLevel === l
                            ? "border-pink-400 bg-pink-50 text-pink-600"
                            : "border-transparent bg-slate-100 text-slate-500 hover:border-slate-200"
                          }`}
                      >
                        {l}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="sm:col-span-2">
                  <label className="text-[10px] font-black text-slate-400
                                    uppercase tracking-widest block mb-1.5">
                    Palabras
                  </label>
                  <div className="flex gap-2 mb-3">
                    <input
                      value={vocabWordInput}
                      onChange={e => setVocabWordInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter") { e.preventDefault(); addVocabWord(); }
                      }}
                      placeholder="Escribe una palabra y presiona Enter..."
                      className="flex-1 bg-slate-50 border-2 border-transparent
                                rounded-xl text-sm font-bold text-slate-800
                                placeholder:text-slate-400 px-4 py-3.5
                                focus:outline-none focus:bg-white
                                focus:border-pink-500 focus:ring-4 focus:ring-pink-50
                                transition-all duration-300"
                    />
                    <button
                      type="button"
                      onClick={() => addVocabWord()}
                      className="px-5 bg-pink-50 text-pink-600 hover:bg-pink-100
                                font-bold rounded-xl transition-colors flex-shrink-0"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-2 min-h-[52px] bg-slate-50
                                  rounded-2xl p-4">
                    {vocabWords.length === 0 ? (
                      <p className="text-slate-400 text-sm">Aún no has añadido palabras</p>
                    ) : vocabWords.map(w => (
                      <span key={w}
                        className="inline-flex items-center gap-1.5 bg-white
                                  border border-slate-200 text-slate-700 text-sm
                                  font-bold px-3 py-1.5 rounded-xl shadow-sm">
                        {w}
                        <button
                          type="button"
                          onClick={() => removeVocabWord(w)}
                          className="text-slate-300 hover:text-rose-400 transition-colors"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1.5">
                    También puedes pegar varias palabras separadas por comas y presionar Enter.
                  </p>
                </div>

                <button
                  onClick={createVocab}
                  disabled={!vocabTitle || vocabWords.length === 0 || uploading}
                  className="sm:col-span-2 py-3.5 text-sm font-bold text-white
                            rounded-xl bg-gradient-to-r from-pink-500 to-rose-400
                            hover:from-pink-600 hover:to-rose-500
                            shadow-lg shadow-pink-200 active:scale-[0.98]
                            transition-all duration-300 disabled:opacity-50
                            disabled:cursor-not-allowed
                            flex items-center justify-center gap-2"
                >
                  {uploading ? (
                    <div className="w-4 h-4 border-2 border-white/40
                                    border-t-white rounded-full animate-spin" />
                  ) : (
                    <><Plus className="w-4 h-4" /> Crear set de vocabulario</>
                  )}
                </button>
              </div>
            )}
          </div>
        )}

        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500
                        delay-100 space-y-4">

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="group relative max-w-sm w-full">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2
                                  w-5 h-5 text-slate-400
                                  group-focus-within:text-pink-500
                                  transition-colors pointer-events-none" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar material..."
                className="w-full bg-white border-2 border-transparent rounded-xl
                           text-sm font-bold text-slate-800 placeholder:text-slate-400
                           pl-11 pr-4 py-3 focus:outline-none focus:border-pink-500
                           focus:ring-4 focus:ring-pink-50 transition-all duration-300
                           shadow-sm"
              />
            </div>

            <div className="flex gap-2">
              {[
                { key: "files", label: "Documentos" },
                { key: "vocab", label: "Vocabulario" },
              ].map(t => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key as any)}
                  className={`px-4 py-2 rounded-xl text-sm font-bold
                    transition-all duration-200 border-2
                    ${tab === t.key
                      ? "border-pink-400 bg-pink-50 text-pink-600"
                      : "border-transparent bg-white text-slate-500 shadow-sm"
                    }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {[1,2,3,4].map(i => (
                <Skeleton key={i} className="h-32 w-full rounded-2xl" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="bg-white/80 backdrop-blur-xl rounded-[2rem]
                            border border-white shadow-lg py-16 text-center">
              <div className="w-16 h-16 bg-slate-100 rounded-2xl
                              flex items-center justify-center mx-auto mb-4">
                <BookOpen className="w-8 h-8 text-slate-300" />
              </div>
              <p className="text-slate-500 font-bold">
                No hay materiales todavía
              </p>
              <button
                onClick={() => setShowUploadForm(true)}
                className="mt-4 text-sm font-bold text-pink-600 hover:text-pink-700
                           bg-pink-50 hover:bg-pink-100 px-4 py-2 rounded-xl transition-colors"
              >
                + Crear el primero
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {filtered.map(m => (
                <div key={m.id}
                  className="bg-white/80 backdrop-blur-xl rounded-2xl
                             border border-white shadow-lg shadow-slate-100
                             hover:shadow-xl hover:-translate-y-0.5
                             transition-all duration-300 p-5 flex flex-col">

                  <div className="flex items-start gap-3 mb-3">
                    <div className="w-11 h-11 bg-slate-50 rounded-xl
                                    flex items-center justify-center flex-shrink-0">
                      {getFileIcon(m.file_url || "", m.category)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-slate-800
                                    line-clamp-2 leading-snug">
                        {m.title}
                      </p>
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        <LevelBadge level={m.level} />
                        <span className="text-[10px] text-slate-400 font-bold
                                         uppercase tracking-widest">
                          {m.category}
                        </span>
                      </div>
                    </div>
                  </div>

                  {m.description ? (
                    <ExpandableDescription text={m.description} limitLines={2} />
                  ) : (
                    <p className="text-xs text-slate-300 italic mb-3">Sin descripción</p>
                  )}

                  {isVocab(m) && (
                    <p className="text-xs text-slate-500 mb-3">
                      {m.vocabulary_words?.length ?? 0} palabras
                    </p>
                  )}

                  <div className="grid grid-cols-2 gap-2 mt-auto">
                    <button
                      onClick={() => setAssignTarget(m)}
                      className="flex items-center justify-center gap-1.5
                                 bg-pink-50 text-pink-600 hover:bg-pink-100
                                 text-xs font-bold py-2.5 rounded-xl
                                 transition-colors"
                    >
                      <Users className="w-3.5 h-3.5" />
                      Asignar
                    </button>

                    <button
                      onClick={() => setEditTarget(m)}
                      className="flex items-center justify-center gap-1.5
                                 bg-blue-50 text-blue-600 hover:bg-blue-100
                                 text-xs font-bold py-2.5 rounded-xl
                                 transition-colors"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                      Detalles
                    </button>

                    {isVocab(m) && (
                      <button
                        onClick={() => setVocabTarget(m)}
                        className="flex items-center justify-center gap-1.5
                                   bg-purple-50 text-purple-600 hover:bg-purple-100
                                   text-xs font-bold py-2.5 rounded-xl
                                   transition-colors"
                      >
                        <Volume2 className="w-3.5 h-3.5" />
                        Palabras
                      </button>
                    )}

                    <button
                      onClick={() => setDeleteTarget(m)}
                      className={`flex items-center justify-center gap-1.5
                                 bg-red-50 text-red-500 hover:bg-red-100
                                 text-xs font-bold py-2.5 rounded-xl
                                 transition-colors ${!isVocab(m) ? 'col-span-2' : ''}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Eliminar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {assignTarget && (
        <AssignModal
          material={assignTarget}
          onClose={() => setAssignTarget(null)}
        />
      )}
      {vocabTarget && (
        <VocabModal
          material={vocabTarget}
          onClose={() => setVocabTarget(null)}
          onSaved={refetch}
        />
      )}
      {editTarget && (
        <EditMaterialModal
          material={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={handleMaterialSaved}
        />
      )}
      {deleteTarget && (
        <DeleteMaterialModal
          material={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => handleMaterialDeleted(deleteTarget.id)}
        />
      )}
    </div>
    <ChipiWidget screenName="materials_teacher" /> 
    </>
  );
}