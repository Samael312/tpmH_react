// app/student/materials/page.tsx

"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  FileText, Search, BookOpen,
  Volume2, ExternalLink, Clock,
  Play, Pause, Loader2, Headphones,
  CheckCircle2, CircleDashed, Sparkles, BarChart3, ChevronDown
} from "lucide-react";
import api from "@/lib/api";
import ChipiWidget from "@/components/chipi/ChipiWidget";
import { useSystemCatalogs } from "@/hooks/useSystemCatalogs";
import { SUBJECTS as FALLBACK_SUBJECTS, LANGUAGES as FALLBACK_LANGUAGES, SKILL_SUGGESTIONS as FALLBACK_SKILLS } from "@/lib/teacherOptions";

interface Material {
  id: number;
  title: string;
  description?: string;
  category: string;
  level?: string;
  file_url?: string;
  vocabulary_words?: string[];
}

interface MaterialAssignment {
  id: number;
  material_id: number;
  student_id: number;
  progress: string;
  assigned_at: string;
  completed_at?: string;
  material: Material;
}

const CATEGORIES = ["all", "Grammar", "Reading", "Exercises", "Vocabulary"];

function LevelBadge({ level }: { level?: string }) {
  if (!level) return null;
  const styles: Record<string, string> = {
    A1: "bg-emerald-100 text-emerald-700 border-emerald-200",
    A2: "bg-emerald-100 text-emerald-700 border-emerald-200",
    B1: "bg-sky-100 text-sky-700 border-sky-200",
    B2: "bg-sky-100 text-sky-700 border-sky-200",
    C1: "bg-indigo-100 text-indigo-700 border-indigo-200",
    C2: "bg-indigo-100 text-indigo-700 border-indigo-200",
  };
  return (
    <span className={`text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-full border ${styles[level] ?? "bg-slate-100 text-slate-600 border-slate-200"}`}>
      {level}
    </span>
  );
}

const isVocab = (m?: Material) =>
  !!m && m.category?.toLowerCase() === "vocabulary" && !!m.vocabulary_words?.length;

function ExpandableDescription({ text }: { text: string }) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="mb-3">
      <p
        className={`text-xs text-slate-500 leading-relaxed whitespace-pre-wrap break-words ${
          !isExpanded ? 'line-clamp-2' : ''
        }`}
      >
        {text}
      </p>
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="text-[11px] font-bold text-pink-600 hover:text-pink-700 mt-1 focus:outline-none inline-block"
      >
        {isExpanded ? 'Ver menos' : 'Ver más'}
      </button>
    </div>
  );
}

export default function StudentMaterialsPage() {
  const { catalogs } = useSystemCatalogs();
  
  const [materials, setMaterials] = useState<MaterialAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [updatingId, setUpdatingId] = useState<number | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioCache, setAudioCache] = useState<Record<number, Record<string, string | null>>>({});
  const [loadingVocabAudio, setLoadingVocabAudio] = useState<Record<number, boolean>>({});
  const [nowPlaying, setNowPlaying] = useState<{ materialId: number; word: string } | null>(null);
  const [playingAllId, setPlayingAllId] = useState<number | null>(null);
  
  const sequenceRef = useRef<{
    materialId: number;
    words: string[];
    urls: Record<string, string | null>;
    index: number;
  } | null>(null);

  useEffect(() => {
    return () => { audioRef.current?.pause(); };
  }, []);

  const ensureVocabAudio = useCallback(async (material: Material) => {
    if (audioCache[material.id]) return audioCache[material.id];
    setLoadingVocabAudio(prev => ({ ...prev, [material.id]: true }));
    try {
      const res = await api.post(`/tts/vocabulary/${material.id}`);
      const urls: Record<string, string | null> = res.data?.audio_urls ?? {};
      setAudioCache(prev => ({ ...prev, [material.id]: urls }));
      return urls;
    } catch (e) {
      console.error("Error generando audio de vocabulario", e);
      return {};
    } finally {
      setLoadingVocabAudio(prev => ({ ...prev, [material.id]: false }));
    }
  }, [audioCache]);

  const stopPlayback = useCallback(() => {
    sequenceRef.current = null;
    setPlayingAllId(null);
    setNowPlaying(null);
    if (audioRef.current) {
      audioRef.current.onended = null;
      audioRef.current.pause();
    }
  }, []);

  const handlePlayWord = useCallback(async (material: Material, word: string) => {
    sequenceRef.current = null;
    setPlayingAllId(null);
    const urls = await ensureVocabAudio(material);
    const url = urls[word];
    if (!url || !audioRef.current) return;
    setNowPlaying({ materialId: material.id, word });
    audioRef.current.onended = () => setNowPlaying(null);
    audioRef.current.src = url;
    audioRef.current.play().catch(() => {});
  }, [ensureVocabAudio]);

  const advanceSequence = useCallback(() => {
    const seq = sequenceRef.current;
    if (!seq || !audioRef.current) { stopPlayback(); return; }
    if (seq.index >= seq.words.length) { stopPlayback(); return; }

    const word = seq.words[seq.index];
    const url = seq.urls[word];
    setNowPlaying({ materialId: seq.materialId, word });

    if (url) {
      audioRef.current.onended = () => {
        if (sequenceRef.current) {
          sequenceRef.current.index += 1;
          advanceSequence();
        }
      };
      audioRef.current.src = url;
      audioRef.current.play().catch(() => {});
    } else {
      seq.index += 1;
      advanceSequence();
    }
  }, [stopPlayback]);

  const handlePlayAll = useCallback(async (material: Material) => {
    if (playingAllId === material.id) { stopPlayback(); return; }
    const words = material.vocabulary_words ?? [];
    if (words.length === 0) return;

    const urls = await ensureVocabAudio(material);
    sequenceRef.current = { materialId: material.id, words, urls, index: 0 };
    setPlayingAllId(material.id);
    advanceSequence();
  }, [playingAllId, ensureVocabAudio, advanceSequence, stopPlayback]);

  const fetchMaterials = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get("/materials/student/my-materials");
      setMaterials(res.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMaterials();
  }, [fetchMaterials]);

  const updateProgress = async (assignmentId: number, newProgress: string) => {
    setUpdatingId(assignmentId);
    try {
      const res = await api.patch(`/materials/student/${assignmentId}/progress`, {
        progress: newProgress,
      });
      setMaterials(prev =>
        prev.map(item => (item.id === assignmentId ? res.data : item))
      );
    } catch (e: any) {
      alert(e.response?.data?.detail || "Error actualizando el progreso");
    } finally {
      setUpdatingId(null);
    }
  };

  const filtered = materials.filter(m => {
    const title = m.material?.title ?? "";
    const category = m.material?.category ?? "";
    const inSearch = title.toLowerCase().includes(search.toLowerCase());
    const inFilter = filter === "all" || category.toLowerCase() === filter.toLowerCase();
    return inSearch && inFilter;
  });

  const totalCount = materials.length;
  const completedCount = materials.filter(m => m.progress === "completed").length;
  const progressPercent = totalCount ? Math.round((completedCount / totalCount) * 100) : 0;

  return (
    <>
      <div className="min-h-screen bg-slate-50 relative overflow-hidden pb-16">
        {/* Elementos de fondo difuminados estilo homework */}
        <div className="fixed top-[-80px] right-[-80px] w-[500px] h-[500px] bg-pink-300/20 rounded-full blur-[100px] pointer-events-none" />
        <div className="fixed bottom-[-80px] left-[-80px] w-[400px] h-[400px] bg-blue-300/15 rounded-full blur-[100px] pointer-events-none" />

        <audio ref={audioRef} className="hidden" />

        <div className="relative space-y-6 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6">
          
          {/* Header principal */}
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div>
              <h1 className="text-3xl font-black text-slate-800 tracking-tight">
                Mis Materiales Asignados
              </h1>
              <p className="text-slate-500 mt-1">
                Accede a tus recursos de estudio, documentos y listas de vocabulario interactivo.
              </p>
            </div>

            {!loading && totalCount > 0 && (
              <div className="flex items-center gap-4 bg-white/80 backdrop-blur-xl border border-white px-5 py-3 rounded-2xl shadow-lg shadow-slate-100">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-pink-50 border border-pink-100 flex items-center justify-center text-pink-600">
                    <BarChart3 className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-500">Progreso general</span>
                      <span className="text-xs font-black text-pink-600">{progressPercent}%</span>
                    </div>
                    <div className="w-32 bg-slate-100 h-2 rounded-full mt-1 overflow-hidden">
                      <div 
                        className="bg-gradient-to-r from-pink-500 to-rose-400 h-full rounded-full transition-all duration-500" 
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>
                  </div>
                </div>
                <div className="h-8 w-px bg-slate-200 mx-1 hidden sm:block" />
                <div className="text-xs text-slate-500 hidden sm:block">
                  <span className="font-black text-slate-800">{completedCount}</span> de <span className="font-black text-slate-800">{totalCount}</span> listos
                </div>
              </div>
            )}
          </div>

          {/* Tarjetas de estadísticas / Resumen rápido */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 animate-in fade-in slide-in-from-bottom-4 duration-500 delay-100">
            <div className="bg-amber-50/80 backdrop-blur-xl border border-amber-100 rounded-2xl p-4 text-center shadow-sm">
              <p className="text-2xl font-black text-amber-600">{totalCount - completedCount}</p>
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mt-0.5">Pendientes</p>
            </div>
            <div className="bg-emerald-50/80 backdrop-blur-xl border border-emerald-100 rounded-2xl p-4 text-center shadow-sm">
              <p className="text-2xl font-black text-emerald-600">{completedCount}</p>
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mt-0.5">Completados</p>
            </div>
            <div className="col-span-2 sm:col-span-1 bg-pink-50/80 backdrop-blur-xl border border-pink-100 rounded-2xl p-4 text-center shadow-sm">
              <p className="text-2xl font-black text-pink-600">{totalCount}</p>
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mt-0.5">Total Asignados</p>
            </div>
          </div>

          {/* Barra de búsqueda y Filtros */}
          <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between animate-in fade-in slide-in-from-bottom-4 duration-500 delay-150">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar por título o palabra clave..."
                className="w-full bg-white/80 backdrop-blur-xl hover:bg-white focus:bg-white border border-white rounded-2xl text-sm font-medium text-slate-800 placeholder:text-slate-400 pl-10 pr-4 py-3 shadow-lg shadow-slate-100 focus:outline-none focus:ring-2 focus:ring-pink-500/20 focus:border-pink-500 transition-all duration-200"
              />
            </div>

            <div className="flex gap-1.5 overflow-x-auto pb-1 sm:pb-0 no-scrollbar bg-white/80 backdrop-blur-xl border border-white rounded-2xl p-1 shadow-lg shadow-slate-100">
              {CATEGORIES.map(cat => {
                const isActive = filter === cat;
                return (
                  <button
                    key={cat}
                    onClick={() => setFilter(cat)}
                    className={`px-4 py-2 rounded-xl text-xs font-bold capitalize whitespace-nowrap transition-all duration-200 ${
                      isActive
                        ? "bg-gradient-to-r from-pink-500 to-rose-400 text-white shadow-md"
                        : "text-slate-500 hover:text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    {cat === "all" ? "Todos" : cat}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Contenido de Materiales (Grid de tarjetas) */}
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 delay-200">
            {loading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {[1, 2, 3, 4, 5, 6].map(i => (
                  <div key={i} className="h-56 bg-white/80 backdrop-blur-xl border border-white rounded-2xl animate-pulse p-6 flex flex-col justify-between shadow-lg" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] border border-white shadow-lg py-16 text-center max-w-lg mx-auto my-8">
                <div className="w-12 h-12 bg-slate-100 text-slate-400 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <BookOpen className="w-6 h-6" />
                </div>
                <h3 className="text-base font-bold text-slate-700">No se encontraron materiales</h3>
                <p className="text-xs text-slate-500 mt-1 max-w-xs mx-auto">
                  No hay coincidencias para los criterios de búsqueda o filtros seleccionados.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {filtered.map(assignment => {
                  const m = assignment.material;
                  const isCompleted = assignment.progress === "completed";
                  const isUpdating = updatingId === assignment.id;
                  const vocab = isVocab(m);
                  const isThisPlayingAll = playingAllId === assignment.material_id;
                  const isLoadingAudio = !!loadingVocabAudio[assignment.material_id];

                  return (
                    <div
                      key={assignment.id}
                      className={`group bg-white/80 backdrop-blur-xl rounded-2xl border transition-all duration-300 flex flex-col justify-between shadow-lg ${
                        isCompleted
                          ? "border-emerald-200/80 border-l-4 border-l-emerald-400 bg-emerald-50/10"
                          : "border-white border-l-4 border-l-pink-400 hover:shadow-xl hover:-translate-y-0.5"
                      }`}
                    >
                      <div className="p-5">
                        <div className="flex items-start gap-3.5 mb-3">
                          <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors ${
                            vocab 
                              ? "bg-purple-50 text-purple-600 border border-purple-100" 
                              : "bg-pink-50 text-pink-600 border border-pink-100"
                          }`}>
                            {vocab ? <Headphones className="w-5 h-5" /> : <FileText className="w-5 h-5" />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                              <LevelBadge level={m?.level} />
                              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                                {m?.category}
                              </span>
                            </div>
                            <h3 className="text-sm font-bold text-slate-800 leading-snug line-clamp-2">
                              {m?.title || "Sin título"}
                            </h3>
                          </div>
                        </div>

                        {m?.description && (
                          <ExpandableDescription text={m.description} />
                        )}

                        {vocab && (
                          <div className="mt-3 bg-purple-50/60 border border-purple-100 rounded-2xl p-3">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-[11px] font-bold text-purple-900 flex items-center gap-1">
                                <Sparkles className="w-3 h-3 text-purple-600" />
                                Palabras ({m!.vocabulary_words!.length})
                              </span>
                              <button
                                onClick={() => handlePlayAll(m!)}
                                disabled={isLoadingAudio}
                                className="flex items-center gap-1 text-[11px] font-bold text-purple-700 hover:text-purple-800 bg-white hover:bg-purple-100/50 border border-purple-200/60 px-2.5 py-1 rounded-xl transition-colors shadow-sm disabled:opacity-50"
                              >
                                {isLoadingAudio ? (
                                  <Loader2 className="w-3 h-3 animate-spin text-purple-600" />
                                ) : isThisPlayingAll ? (
                                  <Pause className="w-3 h-3 text-purple-600" />
                                ) : (
                                  <Play className="w-3 h-3 text-purple-600 fill-purple-600" />
                                )}
                                {isThisPlayingAll ? "Detener" : "Escuchar todo"}
                              </button>
                            </div>

                            <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto custom-scrollbar pt-0.5">
                              {m!.vocabulary_words!.map((w, idx) => {
                                const active = nowPlaying?.materialId === m!.id && nowPlaying?.word === w;
                                return (
                                  <button
                                    key={idx}
                                    onClick={() => handlePlayWord(m!, w)}
                                    className={`flex items-center gap-1.5 text-xs font-bold px-2.5 py-1.5 rounded-xl transition-all duration-200 ${
                                      active
                                        ? "bg-purple-600 text-white shadow-md scale-95"
                                        : "bg-white text-purple-900 border border-purple-100 hover:border-purple-300 hover:bg-purple-50 shadow-sm"
                                    }`}
                                  >
                                    <Volume2 className={`w-3 h-3 ${active ? "animate-pulse" : "text-purple-500"}`} />
                                    {w}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="px-5 py-3.5 bg-slate-50/50 border-t border-slate-100 rounded-b-2xl flex flex-col gap-3">
                        <div className="flex items-center justify-between text-[11px] text-slate-500">
                          <span className="flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5 text-slate-400" />
                            Asignado:
                          </span>
                          <span className="font-bold text-slate-700">
                            {new Date(assignment.assigned_at).toLocaleDateString(undefined, {
                              day: "numeric",
                              month: "short"
                            })}
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          {m?.file_url && (
                            <a
                              href={m.file_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex-1 flex items-center justify-center gap-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-bold py-2.5 rounded-xl transition-colors shadow-sm"
                            >
                              <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
                              Documento
                            </a>
                          )}

                          <button
                            onClick={() =>
                              updateProgress(
                                assignment.id,
                                isCompleted ? "pending" : "completed"
                              )
                            }
                            disabled={isUpdating}
                            className={`flex-1 flex items-center justify-center gap-1.5 text-xs font-bold py-2.5 rounded-xl transition-all duration-200 shadow-sm ${
                              isCompleted
                                ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-200 border border-emerald-200"
                                : "bg-gradient-to-r from-pink-500 to-rose-400 text-white hover:from-pink-600 hover:to-rose-500 shadow-pink-200"
                            }`}
                          >
                            {isUpdating ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : isCompleted ? (
                              <>
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                                Completado
                              </>
                            ) : (
                              <>
                                <CircleDashed className="w-3.5 h-3.5 opacity-70" />
                                Marcar listo
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      <ChipiWidget screenName="materials_student" />
    </>
  );
}