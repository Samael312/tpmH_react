"use client";

import { useState, useEffect, useCallback } from "react";
import {
  FileText, Search, BookOpen, Check,
  Volume2, ExternalLink, Clock, Award
} from "lucide-react";
import api from "@/lib/api";

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
  const colors: Record<string, string> = {
    A1: "bg-emerald-100 text-emerald-700",
    A2: "bg-emerald-100 text-emerald-700",
    B1: "bg-blue-100 text-blue-700",
    B2: "bg-blue-100 text-blue-700",
    C1: "bg-purple-100 text-purple-700",
    C2: "bg-purple-100 text-purple-700",
  };
  return (
    <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${colors[level] ?? "bg-slate-100 text-slate-500"}`}>
      {level}
    </span>
  );
}

export default function StudentMaterialsPage() {
  const [materials, setMaterials] = useState<MaterialAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [updatingId, setUpdatingId] = useState<number | null>(null);

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

  return (
    <div className="min-h-screen bg-slate-50 relative overflow-hidden">
      {/* Background blobs */}
      <div className="fixed top-[-100px] right-[-100px] w-[500px] h-[500px] bg-pink-300/20 rounded-full blur-[100px] pointer-events-none" />
      <div className="fixed bottom-[-100px] left-[-100px] w-[400px] h-[400px] bg-purple-300/15 rounded-full blur-[100px] pointer-events-none" />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-black text-slate-800 tracking-tight">
            Mis Materiales Asignados
          </h1>
          <p className="text-slate-500 mt-1">
            Consulta los recursos, documentos y ejercicios enviados por tus profesores
          </p>
        </div>

        {/* Controls: Search and Filters */}
        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
          {/* Search */}
          <div className="group relative w-full sm:max-w-sm">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 group-focus-within:text-pink-500 transition-colors pointer-events-none" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar material..."
              className="w-full bg-white border-2 border-transparent rounded-xl text-sm font-bold text-slate-800 placeholder:text-slate-400 pl-11 pr-4 py-3 focus:outline-none focus:border-pink-500 focus:ring-4 focus:ring-pink-50 transition-all duration-300 shadow-sm"
            />
          </div>

          {/* Category Filters */}
          <div className="flex gap-2 flex-wrap">
            {CATEGORIES.map(cat => (
              <button
                key={cat}
                onClick={() => setFilter(cat)}
                className={`px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all duration-200 border-2 ${
                  filter === cat
                    ? "border-pink-400 bg-pink-50 text-pink-600 shadow-sm"
                    : "border-transparent bg-white text-slate-500 hover:border-slate-200 shadow-sm"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* List / Grid */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-48 bg-white/60 backdrop-blur-md rounded-2xl animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] border border-white shadow-lg py-16 text-center">
            <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <BookOpen className="w-8 h-8 text-slate-300" />
            </div>
            <p className="text-slate-600 font-bold text-lg">No se encontraron materiales</p>
            <p className="text-slate-400 text-sm mt-1">Prueba con otro término de búsqueda o categoría</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {filtered.map(assignment => {
              const m = assignment.material;
              const isCompleted = assignment.progress === "completed";
              const isUpdating = updatingId === assignment.id;

              return (
                <div
                  key={assignment.id}
                  className="bg-white/80 backdrop-blur-xl rounded-2xl border border-white shadow-lg shadow-slate-100 hover:shadow-xl transition-all duration-300 p-6 flex flex-col justify-between"
                >
                  <div>
                    {/* Top info */}
                    <div className="flex items-start gap-3 mb-4">
                      <div className="w-11 h-11 bg-slate-50 rounded-xl flex items-center justify-center flex-shrink-0">
                        {m?.category?.toLowerCase() === "vocabulary" ? (
                          <Volume2 className="w-6 h-6 text-purple-500" />
                        ) : (
                          <FileText className="w-6 h-6 text-pink-500" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="text-base font-bold text-slate-800 line-clamp-2 leading-snug">
                          {m?.title || "Sin título"}
                        </h3>
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          <LevelBadge level={m?.level} />
                          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">
                            {m?.category}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Description / Vocab words */}
                    {m?.description && (
                      <p className="text-xs text-slate-500 line-clamp-2 mb-4">
                        {m.description}
                      </p>
                    )}

                    {m?.category?.toLowerCase() === "vocabulary" && m?.vocabulary_words && (
                      <div className="mb-4">
                        <p className="text-xs font-bold text-slate-600 mb-1.5">
                          Palabras ({m.vocabulary_words.length}):
                        </p>
                        <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto pr-1">
                          {m.vocabulary_words.map((w, idx) => (
                            <span
                              key={idx}
                              className="bg-purple-50 text-purple-700 text-[11px] font-semibold px-2.5 py-1 rounded-lg"
                            >
                              {w}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Actions & Status */}
                  <div className="space-y-3 pt-4 border-t border-slate-100 mt-4">
                    <div className="flex items-center justify-between text-xs text-slate-400">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" />
                        Asignado
                      </span>
                      <span className="font-semibold text-slate-600">
                        {new Date(assignment.assigned_at).toLocaleDateString()}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      {m?.file_url && (
                        <a
                          href={m.file_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex-1 flex items-center justify-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold py-2.5 rounded-xl transition-colors"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          Ver archivo
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
                        className={`flex-1 flex items-center justify-center gap-1.5 text-xs font-bold py-2.5 rounded-xl transition-all duration-200 ${
                          isCompleted
                            ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                            : "bg-gradient-to-r from-pink-500 to-rose-400 text-white shadow-md shadow-pink-200 hover:shadow-lg"
                        }`}
                      >
                        {isUpdating ? (
                          <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                        ) : isCompleted ? (
                          <>
                            <Check className="w-3.5 h-3.5" />
                            Completado
                          </>
                        ) : (
                          <>
                            <Award className="w-3.5 h-3.5" />
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
  );
}