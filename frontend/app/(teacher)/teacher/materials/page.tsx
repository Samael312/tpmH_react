"use client";

import { useState, useRef, useCallback } from "react";
import {
  Upload, FileText, Image, Music, Trash2,
  Users, Plus, BookOpen, Search, X, Check,
  Volume2, ChevronDown
} from "lucide-react";
import api from "@/lib/api";

interface Material {
  id: number;
  title: string;
  category: string;
  level: string;
  content: string;
  date_up: string;
  tags: { words?: string[] } | null;
}

interface Student {
  id: number;
  username: string;
  name: string;
  surname: string;
}

const CATEGORIES = ["Grammar", "Reading", "Exercises", "Vocabulary"];
const LEVELS     = ["A1", "A2", "B1", "B2", "C1", "C2"];

// ─── Helpers ─────────────────────────────────────────────────────────────────
function getFileIcon(filename: string, category: string) {
  if (category === "Vocabulary")
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

// ─── Modal Asignar ────────────────────────────────────────────────────────────
function AssignModal({
  material,
  onClose,
}: {
  material: Material;
  onClose: () => void;
}) {
  const [students, setStudents]   = useState<Student[]>([]);
  const [selected, setSelected]   = useState<number[]>([]);
  const [loading, setLoading]     = useState(false);
  const [fetched, setFetched]     = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [success, setSuccess]     = useState(false);

  const fetchStudents = useCallback(async () => {
    if (fetched) return;
    setLoading(true);
    try {
      const res = await api.get("/admin/users?role=student");
      setStudents(res.data);
      setFetched(true);
    } catch { }
    finally { setLoading(false); }
  }, [fetched]);

  // Cargar al montar
  useState(() => { fetchStudents(); });

  const toggle = (id: number) =>
    setSelected(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);

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
      {/* Backdrop */}
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
           onClick={onClose} />

      {/* Panel */}
      <div className="relative w-full max-w-md bg-white/90 backdrop-blur-2xl
                      rounded-[2.5rem] shadow-2xl shadow-slate-200/60
                      border border-white p-8 animate-in fade-in zoom-in-95
                      duration-200">

        {/* Blob */}
        <div className="absolute top-0 right-0 w-48 h-48 bg-pink-300/20
                        rounded-full blur-[80px] pointer-events-none" />

        <div className="flex items-start justify-between mb-6">
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
        ) : loading ? (
          <div className="flex justify-center py-8">
            <div className="w-8 h-8 border-4 border-pink-200
                            border-t-pink-500 rounded-full animate-spin" />
          </div>
        ) : (
          <>
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1 mb-6">
              {students.map(s => (
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
                  <div className={`w-8 h-8 rounded-xl flex items-center
                    justify-center text-sm font-black flex-shrink-0
                    ${selected.includes(s.id)
                      ? "bg-pink-500 text-white"
                      : "bg-slate-100 text-slate-500"
                    }`}>
                    {s.name[0]}{s.surname[0]}
                  </div>
                  <div className="min-w-0">
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
  const words = material.tags?.words ?? [];
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
            Editar vocabulario
          </h2>
          <button onClick={onClose}
            className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200
                       flex items-center justify-center transition-colors">
            <X className="w-4 h-4 text-slate-500" />
          </button>
        </div>

        {/* Añadir palabra */}
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

        {/* Lista */}
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

// ─── Página principal ─────────────────────────────────────────────────────────
export default function MaterialsPage() {
  const [materials, setMaterials]   = useState<Material[]>([]);
  const [loading, setLoading]       = useState(true);
  const [search, setSearch]         = useState("");
  const [tab, setTab]               = useState<"files" | "vocab">("files");
  const [uploading, setUploading]   = useState(false);
  const [assignTarget, setAssignTarget] = useState<Material | null>(null);
  const [vocabTarget, setVocabTarget]   = useState<Material | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Form nuevo material
  const [title, setTitle]       = useState("");
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [level, setLevel]       = useState(LEVELS[0]);
  const [file, setFile]         = useState<File | null>(null);

  // Form nuevo vocabulario
  const [vocabTitle, setVocabTitle] = useState("");
  const [vocabLevel, setVocabLevel] = useState(LEVELS[0]);
  const [vocabWords, setVocabWords] = useState("");

  const fetchMaterials = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get("/materials/my-materials");
      setMaterials(res.data);
    } catch { }
    finally { setLoading(false); }
  }, []);

  // Cargar al montar
  useState(() => { fetchMaterials(); });

  const uploadFile = async () => {
    if (!title || !file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("title", title);
      form.append("category", category);
      form.append("level", level);
      form.append("file", file);
      await api.post("/materials/", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setTitle(""); setFile(null); setCategory(CATEGORIES[0]);
      if (fileRef.current) fileRef.current.value = "";
      fetchMaterials();
    } catch (e: any) {
      alert(e.response?.data?.detail || "Error subiendo");
    } finally { setUploading(false); }
  };

  const createVocab = async () => {
    if (!vocabTitle || !vocabWords.trim()) return;
    setUploading(true);
    try {
      // Primero creamos el material base
      const res = await api.post("/materials/", new FormData(), {
        headers: { "Content-Type": "multipart/form-data" },
        params: { title: vocabTitle, category: "Vocabulary", level: vocabLevel }
      });
      const words = vocabWords
        .split(/[\n,]+/)
        .map(w => w.trim())
        .filter(Boolean)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1));

      await api.post(`/materials/${res.data.id}/vocabulary`, { words });
      setVocabTitle(""); setVocabWords("");
      fetchMaterials();
    } catch (e: any) {
      alert(e.response?.data?.detail || "Error creando vocabulario");
    } finally { setUploading(false); }
  };

  const deleteMaterial = async (id: number) => {
    if (!confirm("¿Eliminar este material?")) return;
    try {
      await api.delete(`/materials/${id}`);
      fetchMaterials();
    } catch { }
  };

  const filtered = materials.filter(m => {
    const inSearch = m.title.toLowerCase().includes(search.toLowerCase());
    const inTab = tab === "vocab"
      ? m.category === "Vocabulary"
      : m.category !== "Vocabulary";
    return inSearch && inTab;
  });

  return (
    <div className="min-h-screen bg-slate-50 relative overflow-hidden">

      {/* Blobs fondo */}
      <div className="fixed top-[-100px] right-[-100px] w-[500px] h-[500px]
                      bg-pink-300/20 rounded-full blur-[100px] pointer-events-none" />
      <div className="fixed bottom-[-100px] left-[-100px] w-[400px] h-[400px]
                      bg-purple-300/15 rounded-full blur-[100px] pointer-events-none" />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-8">

        {/* Header */}
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
          <h1 className="text-3xl font-black text-slate-800 tracking-tight">
            Materiales
          </h1>
          <p className="text-slate-500 mt-1">
            Sube recursos y crea sets de vocabulario interactivo
          </p>
        </div>

        {/* Formulario de carga */}
        <div className="bg-white/80 backdrop-blur-xl rounded-[2rem]
                        border border-white shadow-2xl shadow-slate-200/50 p-6 sm:p-8
                        animate-in fade-in slide-in-from-bottom-4 duration-500
                        delay-100">

          {/* Tabs Subir / Vocabulario */}
          <div className="flex gap-1 bg-slate-100 rounded-xl p-1 w-fit mb-6">
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Título */}
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

              {/* Categoría */}
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

              {/* Nivel */}
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

              {/* File drop zone */}
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
                  onChange={e => setFile(e.target.files?.[0] ?? null)}
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
                        {(file.size / 1024).toFixed(0)} KB
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
                      PDF, DOC, DOCX, JPG, PNG
                    </p>
                  </>
                )}
              </div>

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
            /* ─── Form Vocabulario ─── */
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                  Palabras (separadas por coma o salto de línea)
                </label>
                <textarea
                  value={vocabWords}
                  onChange={e => setVocabWords(e.target.value)}
                  rows={4}
                  placeholder="apple, banana, car&#10;dog, elephant..."
                  className="w-full bg-slate-50 border-2 border-transparent
                             rounded-xl text-sm font-bold text-slate-800
                             placeholder:text-slate-400 px-4 py-3.5
                             focus:outline-none focus:bg-white
                             focus:border-pink-500 focus:ring-4 focus:ring-pink-50
                             transition-all duration-300 resize-none"
                />
              </div>

              <button
                onClick={createVocab}
                disabled={!vocabTitle || !vocabWords || uploading}
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

        {/* Buscador y lista */}
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500
                        delay-200 space-y-4">

          {/* Buscador */}
          <div className="group relative max-w-sm">
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

          {/* Filtros tab */}
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

          {/* Grid de materiales */}
          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1,2,3].map(i => (
                <div key={i} className="h-32 bg-white rounded-2xl animate-pulse" />
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
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filtered.map(m => (
                <div key={m.id}
                  className="bg-white/80 backdrop-blur-xl rounded-2xl
                             border border-white shadow-lg shadow-slate-100
                             hover:shadow-xl hover:-translate-y-0.5
                             transition-all duration-300 p-5">

                  <div className="flex items-start gap-3 mb-4">
                    <div className="w-11 h-11 bg-slate-50 rounded-xl
                                    flex items-center justify-center flex-shrink-0">
                      {getFileIcon(m.content, m.category)}
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

                  {m.category === "Vocabulary" && (
                    <p className="text-xs text-slate-500 mb-3">
                      {m.tags?.words?.length ?? 0} palabras
                    </p>
                  )}

                  <div className="flex gap-2">
                    <button
                      onClick={() => setAssignTarget(m)}
                      className="flex-1 flex items-center justify-center gap-1.5
                                 bg-pink-50 text-pink-600 hover:bg-pink-100
                                 text-xs font-bold py-2.5 rounded-xl
                                 transition-colors"
                    >
                      <Users className="w-3.5 h-3.5" />
                      Asignar
                    </button>

                    {m.category === "Vocabulary" && (
                      <button
                        onClick={() => setVocabTarget(m)}
                        className="flex-1 flex items-center justify-center gap-1.5
                                   bg-purple-50 text-purple-600 hover:bg-purple-100
                                   text-xs font-bold py-2.5 rounded-xl
                                   transition-colors"
                      >
                        <Volume2 className="w-3.5 h-3.5" />
                        Editar
                      </button>
                    )}

                    <button
                      onClick={() => deleteMaterial(m.id)}
                      className="w-10 flex items-center justify-center
                                 bg-red-50 text-red-400 hover:bg-red-100
                                 rounded-xl transition-colors flex-shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
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
          onSaved={fetchMaterials}
        />
      )}
    </div>
  );
}