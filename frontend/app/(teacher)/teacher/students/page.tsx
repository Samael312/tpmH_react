"use client";

import { useState, useMemo } from "react";
import {
  Search, Users, Mail, Phone, ChevronDown, BookOpen,
  GraduationCap, Package as PackageIcon, Filter, X, Sliders,
  AlertTriangle, RefreshCw,
} from "lucide-react";
import { useTeacherStudentsFull, TeacherStudentFull } from "@/hooks/useTeacherData";
import ChipiWidget from "@/components/chipi/ChipiWidget";
import { SUBJECTS, LANGUAGES } from "@/lib/teacherOptions";
import { getFlagForNationality } from "@/lib/nationalities";
import Skeleton from "@/components/ui/Skeleton";
import RefreshButton from "@/components/ui/RefreshButton";
import DesktopOnly from "@/components/ui/DesktopOnly";
import { usePageTopBar } from "@/lib/mobileTopBar";

const STATUS_OPTIONS = [
  { value: "all", label: "Todos los estados" },
  { value: "active", label: "Activo" },
  { value: "completed", label: "Agotado" },
  { value: "pending_renewal", label: "Renovación pendiente" },
  { value: "cancelled", label: "Cancelado" },
];

const STATUS_BADGE: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-700",
  completed: "bg-slate-100 text-slate-500",
  pending_renewal: "bg-amber-100 text-amber-700",
  cancelled: "bg-red-100 text-red-600",
};
const STATUS_LABEL: Record<string, string> = {
  active: "Activo",
  completed: "Agotado",
  pending_renewal: "Renovación pendiente",
  cancelled: "Cancelado",
};

// La materia/idioma vive en package.subject (puede ser una materia o un
// idioma según cómo el profesor haya creado el paquete) — unificamos ambas
// listas como opciones del filtro.
const SUBJECT_LANGUAGE_OPTIONS = Array.from(new Set([...SUBJECTS, ...LANGUAGES]));

function StudentAvatar({ s, className }: { s: TeacherStudentFull; className?: string }) {
  if (s.avatar) {
    return <img src={s.avatar} alt={s.name} className={`${className} object-cover`} />;
  }
  return (
    <div className={`${className} bg-gradient-to-br from-pink-400 to-rose-400 flex items-center justify-center text-white font-black`}>
      {s.name?.[0]?.toUpperCase()}{s.surname?.[0]?.toUpperCase()}
    </div>
  );
}

function getActiveEnrollment(s: TeacherStudentFull) {
  return s.enrollments.find(e => e.status === "active") ?? s.enrollments[0] ?? null;
}

function getProgressPct(e: TeacherStudentFull["enrollments"][number] | null) {
  if (!e || e.classes_total == null || e.classes_total === 0) return null;
  return Math.min((e.classes_used / e.classes_total) * 100, 100);
}

function StudentCard({ student }: { student: TeacherStudentFull }) {
  const [expanded, setExpanded] = useState(false);
  const activeEnr = getActiveEnrollment(student);
  const progressPct = getProgressPct(activeEnr);

  return (
    <div className="bg-white/85 backdrop-blur-xl rounded-2xl border border-white
                    shadow-lg shadow-slate-100 overflow-hidden
                    hover:shadow-xl transition-all duration-300">
      <button
        onClick={() => setExpanded(p => !p)}
        className="w-full flex items-center gap-4 p-5 text-left"
      >
        <StudentAvatar s={student} className="w-14 h-14 rounded-2xl flex-shrink-0 text-sm shadow-md" />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <p className="text-sm font-black text-slate-800 truncate">
              {student.name} {student.surname}
            </p>
            <span className="text-xs text-slate-400 font-bold">@{student.username}</span>
            {student.nationality && (
              <span className="inline-flex items-center gap-1 text-[10px] font-black
                               text-pink-600 bg-pink-50 border border-pink-100
                               px-2.5 py-0.5 rounded-full">
                {getFlagForNationality(student.nationality)} {student.nationality}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 flex-wrap text-xs text-slate-500 font-medium">
            <span className="flex items-center gap-1 truncate max-w-[220px]">
              <Mail className="w-3.5 h-3.5 text-slate-400" /> {student.email}
            </span>
            {student.phone_number && (
              <span className="flex items-center gap-1">
                <Phone className="w-3.5 h-3.5 text-slate-400" /> {student.phone_number}
              </span>
            )}
          </div>
        </div>

        {/* Estado + progreso resumen */}
        <div className="hidden sm:flex flex-col items-end gap-1.5 flex-shrink-0">
          {activeEnr ? (
            <>
              <span className={`text-[10px] font-black uppercase tracking-widest px-2.5 py-0.5 rounded-full ${STATUS_BADGE[activeEnr.status] ?? "bg-slate-100 text-slate-500"}`}>
                {STATUS_LABEL[activeEnr.status] ?? activeEnr.status}
              </span>
              <span className="text-xs font-bold text-slate-500">
                {activeEnr.classes_used}/{activeEnr.classes_total ?? "∞"} clases
              </span>
            </>
          ) : (
            <span className="text-[10px] font-black uppercase tracking-widest px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-400">
              Sin paquete
            </span>
          )}
        </div>

        <ChevronDown className={`w-4 h-4 text-slate-400 flex-shrink-0 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} />
      </button>

      {/* Barra de progreso siempre visible si hay enrollment */}
      {activeEnr && progressPct !== null && (
        <div className="px-5 pb-3 -mt-1">
          <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-pink-500 to-rose-400 rounded-full transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}

      {/* Detalle expandido */}
      {expanded && (
        <div className="border-t border-slate-100 px-5 py-5 space-y-5 animate-in fade-in slide-in-from-top-2 duration-200">

          {/* Datos de contacto completos */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="bg-slate-50/80 p-3.5 rounded-xl border border-slate-100">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Zona horaria</p>
              <p className="text-xs font-bold text-slate-700">{student.timezone ?? "No especificada"}</p>
            </div>
            <div className="bg-slate-50/80 p-3.5 rounded-xl border border-slate-100">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Objetivo</p>
              <p className="text-xs font-bold text-slate-700 truncate">{student.goal ?? "No especificado"}</p>
            </div>
          </div>

          {/* Enrollments / paquetes */}
          <div>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
              <PackageIcon className="w-3.5 h-3.5" /> Paquetes ({student.enrollments.length})
            </p>
            {student.enrollments.length === 0 ? (
              <p className="text-xs text-slate-400 font-bold">Sin paquetes asignados</p>
            ) : (
              <div className="space-y-2">
                {student.enrollments.map(e => {
                  const pct = getProgressPct(e);
                  return (
                    <div key={e.id} className="bg-white border border-slate-100 rounded-xl px-4 py-3 shadow-sm">
                      <div className="flex items-center justify-between gap-2 flex-wrap mb-1.5">
                        <p className="text-xs font-black text-slate-800 flex items-center gap-1.5">
                          {e.package_name}
                          {e.is_group && (
                            <span className="inline-flex items-center gap-1 bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest">
                              <Users className="w-2.5 h-2.5" /> Grupo{e.cohort_id ? ` #${e.cohort_id}` : ""}
                            </span>
                          )}
                        </p>
                        <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${STATUS_BADGE[e.status] ?? "bg-slate-100 text-slate-500"}`}>
                          {STATUS_LABEL[e.status] ?? e.status}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 font-bold mb-2">
                        {e.subject ?? "Sin materia"} · {e.classes_used}/{e.classes_total ?? "∞"} clases
                      </p>
                      {pct !== null && (
                        <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div className="h-full bg-gradient-to-r from-pink-500 to-rose-400 rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Materiales asignados */}
          <div>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
              <BookOpen className="w-3.5 h-3.5" /> Materiales asignados ({student.materials.length})
            </p>
            {student.materials.length === 0 ? (
              <p className="text-xs text-slate-400 font-bold">Sin materiales asignados</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {student.materials.map(m => (
                  <span
                    key={m.id}
                    className="inline-flex items-center gap-1.5 bg-purple-50 border border-purple-100
                               text-purple-700 text-xs font-bold px-3 py-1.5 rounded-xl"
                    title={`Progreso: ${m.progress}`}
                  >
                    {m.title}
                    {m.level && <span className="text-[9px] text-purple-400">· {m.level}</span>}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function TeacherStudentsPage() {
  const { students, loading, isFetching, isError, refetch } = useTeacherStudentsFull();

  usePageTopBar({
    title: "Mis Estudiantes",
    onRefresh: refetch,
    isFetching,
  });

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [subjectFilter, setSubjectFilter] = useState("all");
  const [progressMin, setProgressMin] = useState(0);
  const [progressMax, setProgressMax] = useState(100);
  const [showFilters, setShowFilters] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();

    return students.filter(s => {
      // Búsqueda por nombre, usuario, email, teléfono
      if (q) {
        const haystack = `${s.name} ${s.surname} ${s.username} ${s.email} ${s.phone_number ?? ""}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }

      // Filtro por estado de paquete
      if (statusFilter !== "all") {
        const hasStatus = s.enrollments.some(e => e.status === statusFilter);
        if (!hasStatus) return false;
      }

      // Filtro por materia/idioma
      if (subjectFilter !== "all") {
        const hasSubject = s.enrollments.some(e => e.subject === subjectFilter);
        if (!hasSubject) return false;
      }

      // Filtro por rango de progreso (solo si el usuario lo modificó)
      if (progressMin > 0 || progressMax < 100) {
        const activeEnr = getActiveEnrollment(s);
        const pct = getProgressPct(activeEnr);
        if (pct === null) return false;
        if (pct < progressMin || pct > progressMax) return false;
      }

      return true;
    });
  }, [students, search, statusFilter, subjectFilter, progressMin, progressMax]);

  const clearFilters = () => {
    setStatusFilter("all");
    setSubjectFilter("all");
    setProgressMin(0);
    setProgressMax(100);
  };

  const activeFilterCount =
    (statusFilter !== "all" ? 1 : 0) +
    (subjectFilter !== "all" ? 1 : 0) +
    (progressMin > 0 || progressMax < 100 ? 1 : 0);

  if (isError && !loading) {
    return (
      <>
        <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center gap-4 text-center px-4">
          <div className="w-14 h-14 bg-rose-100 rounded-full flex items-center justify-center">
            <AlertTriangle className="w-7 h-7 text-rose-500" />
          </div>
          <div>
            <p className="text-lg font-black text-slate-800">No se pudieron cargar tus estudiantes</p>
            <p className="text-sm text-slate-500 mt-1">Revisa tu conexión e inténtalo de nuevo.</p>
          </div>
          <button
            onClick={() => refetch()}
            className="flex items-center gap-2 px-5 py-2.5 bg-pink-500 hover:bg-pink-600 text-white text-sm font-bold rounded-xl shadow-sm transition-colors"
          >
            <RefreshCw className="w-4 h-4" /> Reintentar
          </button>
        </div>
        <ChipiWidget screenName="teacher_students" />
      </>
    );
  }

  return (
    <>
    <div className="min-h-screen bg-slate-50 relative overflow-hidden">
      <div className="fixed top-[-100px] right-[-100px] w-[500px] h-[500px] bg-pink-300/20 rounded-full blur-[100px] pointer-events-none" />
      <div className="fixed bottom-[-100px] left-[-100px] w-[400px] h-[400px] bg-purple-300/15 rounded-full blur-[100px] pointer-events-none" />

      <div className="relative max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black text-slate-800 tracking-tight">Mis Estudiantes</h1>
            <p className="text-slate-500 mt-1">
              {loading ? "Cargando..." : `${students.length} estudiante${students.length !== 1 ? "s" : ""} asignado${students.length !== 1 ? "s" : ""}`}
            </p>
          </div>
          <DesktopOnly>
            <RefreshButton onRefresh={refetch} isFetching={isFetching} />
          </DesktopOnly>
        </div>

        {/* Buscador + toggle de filtros */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="group relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 group-focus-within:text-pink-500 transition-colors pointer-events-none" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar por nombre, usuario, email o teléfono..."
              className="w-full bg-white border-2 border-transparent rounded-xl text-sm font-bold
                         text-slate-800 placeholder:text-slate-400 pl-11 pr-4 py-3
                         focus:outline-none focus:border-pink-500 focus:ring-4 focus:ring-pink-50
                         transition-all duration-300 shadow-sm"
            />
          </div>

          <button
            onClick={() => setShowFilters(p => !p)}
            className={`flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-bold border-2 transition-all
              ${showFilters || activeFilterCount > 0
                ? "border-pink-400 bg-pink-50 text-pink-600"
                : "border-transparent bg-white text-slate-500 shadow-sm"}`}
          >
            <Filter className="w-4 h-4" />
            Filtros {activeFilterCount > 0 && `(${activeFilterCount})`}
          </button>
        </div>

        {/* Panel de filtros */}
        {showFilters && (
          <div className="bg-white/85 backdrop-blur-xl rounded-2xl border border-white
                          shadow-lg shadow-slate-100 p-5 space-y-4
                          animate-in fade-in slide-in-from-top-2 duration-200">
            <div className="flex items-center justify-between">
              <p className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5" /> Filtros avanzados
              </p>
              {activeFilterCount > 0 && (
                <button
                  onClick={clearFilters}
                  className="text-xs font-bold text-pink-500 hover:text-pink-600 flex items-center gap-1"
                >
                  <X className="w-3.5 h-3.5" /> Limpiar
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Estado de paquete */}
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">
                  Estado del paquete
                </label>
                <div className="relative">
                  <select
                    value={statusFilter}
                    onChange={e => setStatusFilter(e.target.value)}
                    className="w-full appearance-none bg-slate-50 border-2 border-transparent rounded-xl
                               text-sm font-bold text-slate-700 px-4 py-3 focus:outline-none focus:bg-white
                               focus:border-pink-500 focus:ring-4 focus:ring-pink-50 transition-all cursor-pointer"
                  >
                    {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                </div>
              </div>

              {/* Materia / idioma */}
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">
                  Materia / Idioma
                </label>
                <div className="relative">
                  <select
                    value={subjectFilter}
                    onChange={e => setSubjectFilter(e.target.value)}
                    className="w-full appearance-none bg-slate-50 border-2 border-transparent rounded-xl
                               text-sm font-bold text-slate-700 px-4 py-3 focus:outline-none focus:bg-white
                               focus:border-pink-500 focus:ring-4 focus:ring-pink-50 transition-all cursor-pointer"
                  >
                    <option value="all">Todas las materias/idiomas</option>
                    {SUBJECT_LANGUAGE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                </div>
              </div>
            </div>

            {/* Rango de progreso */}
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">
                Progreso del paquete activo: {progressMin}% – {progressMax}%
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="range" min={0} max={100} step={5}
                  value={progressMin}
                  onChange={e => setProgressMin(Math.min(Number(e.target.value), progressMax))}
                  className="flex-1 accent-pink-500"
                />
                <input
                  type="range" min={0} max={100} step={5}
                  value={progressMax}
                  onChange={e => setProgressMax(Math.max(Number(e.target.value), progressMin))}
                  className="flex-1 accent-pink-500"
                />
              </div>
              <p className="text-[10px] text-slate-400 font-bold mt-1">
                Estudiantes sin paquete activo se ocultan si ajustas este rango.
              </p>
            </div>
          </div>
        )}

        {/* Lista de estudiantes */}
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <Skeleton key={i} className="h-24 w-full rounded-2xl" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] border border-white shadow-lg py-16 text-center">
            <Users className="w-10 h-10 text-slate-200 mx-auto mb-3" />
            <p className="text-slate-500 font-bold">
              {students.length === 0
                ? "Aún no tienes estudiantes asignados"
                : "Ningún estudiante coincide con los filtros"}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(s => <StudentCard key={s.id} student={s} />)}
          </div>
        )}
      </div>
    </div>
    <ChipiWidget screenName="teacher_students" />
    </>
  );
}