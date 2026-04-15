"use client";

import { useState, useCallback } from "react";
import {
  BookOpen, Volume2, FileText, Image as ImageIcon,
  CheckCircle, Circle, Headphones, X, Check,
  ChevronRight, Play
} from "lucide-react";
import { useStudentMaterials } from "@/hooks/useStudentData";
import api from "@/lib/api";
import ChipiWidget from "@/components/chipi/ChipiWidget";

const LEVEL_COLORS: Record<string, string> = {
  A1: "bg-emerald-100 text-emerald-700",
  A2: "bg-emerald-100 text-emerald-700",
  B1: "bg-blue-100 text-blue-700",
  B2: "bg-blue-100 text-blue-700",
  C1: "bg-purple-100 text-purple-700",
  C2: "bg-purple-100 text-purple-700",
};

// ─── Modal audio vocabulario ──────────────────────────────────────────────────
function VocabAudioModal({
  title,
  words,
  onClose,
}: {
  title: string;
  words: string[];
  onClose: () => void;
}) {
  const [loading, setLoading]   = useState(false);
  const [progress, setProgress] = useState(0);
  const [audioUrls, setAudioUrls] = useState<Record<string, string>>({});
  const [playing, setPlaying]   = useState<string | null>(null);
  const [ready, setReady]       = useState(false);

  const loadAudios = useCallback(async () => {
    if (ready || loading) return;
    setLoading(true);
    try {
      const urls: Record<string, string> = {};
      for (let i = 0; i < words.length; i++) {
        const res = await api.post("/tts/word", { word: words[i], voice: "en-US" });
        urls[words[i]] = res.data.url;
        setProgress(Math.round(((i + 1) / words.length) * 100));
      }
      setAudioUrls(urls);
      setReady(true);
    } catch { }
    finally { setLoading(false); }
  }, [words, ready, loading]);

  // Cargar al montar
  useState(() => { loadAudios(); });

  const playWord = (word: string) => {
    const url = audioUrls[word];
    if (!url) return;
    const audio = new Audio(url);
    setPlaying(word);
    audio.play();
    audio.onended = () => setPlaying(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
           onClick={onClose} />

      <div className="relative w-full max-w-lg bg-white/95 backdrop-blur-2xl
                      rounded-[2.5rem] shadow-2xl shadow-slate-200/60
                      border border-white p-8
                      animate-in fade-in zoom-in-95 duration-200">

        {/* Blob */}
        <div className="absolute top-0 right-0 w-48 h-48 bg-purple-300/20
                        rounded-full blur-[80px] pointer-events-none" />

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-black text-slate-800 tracking-tight">
              {title}
            </h2>
            <p className="text-sm text-slate-500 mt-0.5">
              {words.length} palabras · Toca para escuchar
            </p>
          </div>
          <button onClick={onClose}
            className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200
                       flex items-center justify-center transition-colors">
            <X className="w-4 h-4 text-slate-500" />
          </button>
        </div>

        {/* Loading progress */}
        {loading && (
          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-slate-500">
                Cargando audios...
              </span>
              <span className="text-xs font-black text-pink-600">
                {progress}%
              </span>
            </div>
            <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-pink-500 to-rose-400
                           rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {/* Grid de palabras */}
        <div className="flex flex-wrap gap-2 max-h-72 overflow-y-auto">
          {words.map(word => (
            <button
              key={word}
              onClick={() => playWord(word)}
              disabled={!ready}
              className={`
                inline-flex items-center gap-2 px-4 py-2.5 rounded-xl
                border-2 font-bold text-sm transition-all duration-200
                ${playing === word
                  ? "border-purple-400 bg-purple-500 text-white shadow-md shadow-purple-100 scale-105"
                  : ready
                    ? "border-slate-200 bg-white text-slate-700 hover:border-purple-300 hover:bg-purple-50 hover:text-purple-600"
                    : "border-slate-100 bg-slate-50 text-slate-400 cursor-not-allowed"
                }
              `}
            >
              {playing === word ? (
                <div className="flex gap-0.5 items-end h-4">
                  {[1,2,3].map(i => (
                    <div key={i}
                      className="w-0.5 bg-white rounded-full animate-bounce"
                      style={{
                        height: `${[60, 100, 70][i-1]}%`,
                        animationDelay: `${(i-1) * 100}ms`,
                      }}
                    />
                  ))}
                </div>
              ) : (
                <Volume2 className="w-3.5 h-3.5" />
              )}
              {word}
            </button>
          ))}
        </div>

        {/* Play all */}
        {ready && (
          <button
            onClick={async () => {
              for (const word of words) {
                await new Promise<void>(resolve => {
                  const audio = new Audio(audioUrls[word]);
                  setPlaying(word);
                  audio.play();
                  audio.onended = () => { setPlaying(null); resolve(); };
                });
                await new Promise(r => setTimeout(r, 400));
              }
            }}
            className="mt-5 w-full py-3 flex items-center justify-center gap-2
                       bg-gradient-to-r from-purple-500 to-pink-500 text-white
                       text-sm font-bold rounded-xl shadow-md shadow-purple-100
                       hover:shadow-purple-200 active:scale-[0.98]
                       transition-all duration-200"
          >
            <Play className="w-4 h-4" />
            Reproducir todo
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────
export default function StudentMaterialsPage() {
  const { materials, loading, refetch } = useStudentMaterials();
  const [vocabTarget, setVocabTarget] = useState<{
    title: string; words: string[];
  } | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [updating, setUpdating] = useState<number | null>(null);

  const toggleProgress = async (linkId: number, current: string) => {
    setUpdating(linkId);
    try {
      const next = current === "Completed" ? "Not Started" : "Completed";
      await api.patch(`/materials/student/${linkId}/progress`, {
        progress: next,
      });
      refetch();
    } catch { }
    finally { setUpdating(null); }
  };

  const getFileIcon = (filename: string, category: string) => {
    if (category === "Vocabulary")
      return <Volume2 className="w-6 h-6 text-purple-500" />;
    const ext = filename?.split(".").pop()?.toLowerCase();
    if (["jpg","jpeg","png","gif","webp"].includes(ext ?? ""))
      return <ImageIcon className="w-6 h-6 text-blue-500" />;
    return <FileText className="w-6 h-6 text-rose-500" />;
  };

  const categories = ["all", ...new Set(materials.map(m => m.category))];

  const filtered = materials.filter(m => {
    const inSearch = m.title.toLowerCase().includes(search.toLowerCase());
    const inFilter = filter === "all" || m.category === filter;
    return inSearch && inFilter;
  });

  const completed = materials.filter(m => m.progress === "Completed").length;

  return (
    <div className="min-h-screen bg-slate-50 relative overflow-hidden">

      {/* Blobs */}
      <div className="fixed top-[-80px] right-[-80px] w-[500px] h-[500px]
                      bg-purple-300/20 rounded-full blur-[100px]
                      pointer-events-none" />
      <div className="fixed bottom-[-80px] left-[-80px] w-[400px] h-[400px]
                      bg-pink-300/15 rounded-full blur-[100px]
                      pointer-events-none" />

      <div className="relative space-y-6">

        {/* Header */}
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
          <h1 className="text-3xl font-black text-slate-800 tracking-tight">
            Mis Materiales
          </h1>
          <p className="text-slate-500 mt-1">
            Recursos de estudio y vocabulario interactivo
          </p>
        </div>

        {/* Progress banner */}
        {materials.length > 0 && (
          <div className="bg-white/80 backdrop-blur-xl rounded-[2rem]
                          border border-white shadow-xl shadow-slate-200/50 p-5
                          animate-in fade-in duration-500 delay-100">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-black text-slate-700">
                Tu progreso
              </p>
              <p className="text-sm font-black text-pink-600">
                {completed}/{materials.length} completados
              </p>
            </div>
            <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-pink-500 to-rose-400
                           rounded-full transition-all duration-700"
                style={{
                  width: `${materials.length > 0
                    ? (completed / materials.length) * 100
                    : 0}%`,
                }}
              />
            </div>
          </div>
        )}

        {/* Filtros */}
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none
                        animate-in fade-in duration-500 delay-150">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setFilter(cat)}
              className={`
                flex-shrink-0 px-4 py-2 rounded-xl text-sm font-bold
                border-2 transition-all duration-200
                ${filter === cat
                  ? "border-pink-400 bg-pink-50 text-pink-600"
                  : "border-transparent bg-white text-slate-500 shadow-sm hover:border-slate-200"
                }
              `}
            >
              {cat === "all" ? "Todos" : cat}
            </button>
          ))}
        </div>

        {/* Buscador */}
        <div className="group relative max-w-sm animate-in fade-in duration-500 delay-200">
          <BookOpen className="absolute left-3.5 top-1/2 -translate-y-1/2
                               w-5 h-5 text-slate-400 group-focus-within:text-pink-500
                               transition-colors pointer-events-none" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar material..."
            className="w-full bg-white border-2 border-transparent rounded-xl
                       text-sm font-bold text-slate-800 placeholder:text-slate-400
                       pl-11 pr-4 py-3 shadow-sm focus:outline-none
                       focus:border-pink-500 focus:ring-4 focus:ring-pink-50
                       transition-all duration-300"
          />
        </div>

        {/* Grid */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1,2,3,4].map(i => (
              <div key={i}
                className="h-44 bg-white rounded-2xl animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-white/80 backdrop-blur-xl rounded-[2rem]
                          border border-white shadow-lg py-16 text-center">
            <BookOpen className="w-12 h-12 text-slate-200 mx-auto mb-3" />
            <p className="text-slate-500 font-bold">
              No hay materiales disponibles
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4
                          animate-in fade-in duration-500 delay-200">
            {filtered.map(m => {
              const isDone = m.progress === "Completed";
              return (
                <div
                  key={m.link_id}
                  className={`
                    bg-white/80 backdrop-blur-xl rounded-2xl border
                    shadow-lg hover:shadow-xl hover:-translate-y-0.5
                    transition-all duration-300
                    ${isDone
                      ? "border-emerald-200 shadow-emerald-50"
                      : "border-white shadow-slate-100"
                    }
                  `}
                >
                  {/* Top color strip */}
                  <div className={`h-1.5 rounded-t-2xl ${
                    m.category === "Vocabulary"
                      ? "bg-gradient-to-r from-purple-400 to-pink-400"
                      : isDone
                        ? "bg-gradient-to-r from-emerald-400 to-teal-400"
                        : "bg-gradient-to-r from-pink-400 to-rose-400"
                  }`} />

                  <div className="p-5">
                    {/* Icon + info */}
                    <div className="flex items-start gap-3 mb-4">
                      <div className="w-11 h-11 bg-slate-50 rounded-xl
                                      flex items-center justify-center
                                      flex-shrink-0">
                        {getFileIcon(m.content, m.category)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-slate-800
                                      line-clamp-2 leading-snug mb-1">
                          {m.title}
                        </p>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={`text-[10px] font-black uppercase
                            tracking-widest px-2 py-0.5 rounded-full
                            ${LEVEL_COLORS[m.level] ?? "bg-slate-100 text-slate-500"}`}>
                            {m.level}
                          </span>
                          <span className="text-[10px] text-slate-400 font-bold
                                           uppercase tracking-widest">
                            {m.category}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Vocab word count */}
                    {m.category === "Vocabulary" && (
                      <p className="text-xs text-slate-500 mb-3">
                        {m.tags?.words?.length ?? 0} palabras
                      </p>
                    )}

                    {/* Acciones */}
                    <div className="flex gap-2">
                      {m.category === "Vocabulary" ? (
                        <button
                          onClick={() =>
                            setVocabTarget({
                              title: m.title,
                              words: m.tags?.words ?? [],
                            })
                          }
                          className="flex-1 flex items-center justify-center
                                     gap-1.5 bg-purple-50 text-purple-600
                                     hover:bg-purple-100 text-xs font-bold
                                     py-2.5 rounded-xl transition-colors"
                        >
                          <Headphones className="w-3.5 h-3.5" />
                          Escuchar
                        </button>
                      ) : (
                        <a
                          href={m.content}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex-1 flex items-center justify-center
                                     gap-1.5 bg-pink-50 text-pink-600
                                     hover:bg-pink-100 text-xs font-bold
                                     py-2.5 rounded-xl transition-colors"
                        >
                          <ChevronRight className="w-3.5 h-3.5" />
                          Abrir
                        </a>
                      )}

                      {/* Toggle progreso */}
                      <button
                        onClick={() => toggleProgress(m.link_id, m.progress)}
                        disabled={updating === m.link_id}
                        className={`
                          w-10 flex items-center justify-center rounded-xl
                          transition-all duration-200 flex-shrink-0
                          ${isDone
                            ? "bg-emerald-100 text-emerald-600 hover:bg-emerald-200"
                            : "bg-slate-100 text-slate-400 hover:bg-slate-200"
                          }
                        `}
                        title={isDone ? "Marcar sin completar" : "Marcar como completado"}
                      >
                        {updating === m.link_id ? (
                          <div className="w-3.5 h-3.5 border-2 border-current/30
                                          border-t-current rounded-full animate-spin" />
                        ) : isDone ? (
                          <CheckCircle className="w-4 h-4" />
                        ) : (
                          <Circle className="w-4 h-4" />
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
      <ChipiWidget screenName="materials" />

      {/* Modal vocabulario */}
      {vocabTarget && (
        <VocabAudioModal
          title={vocabTarget.title}
          words={vocabTarget.words}
          onClose={() => setVocabTarget(null)}
        />
      )}
    </div>
  );
}