// frontend/app/(superadmin)/admin/users/page.tsx
"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Save,
  Search,
  ChevronDown,
  Check,
  X,
  AlertTriangle,
  AlertCircle,
  RefreshCw,
  Users,
  Filter,
  RotateCcw,
  CheckCircle2,
  XCircle,
  Globe,
  Phone,
  ShieldCheck,
  UserCheck,
  Sparkles,
} from "lucide-react";
import ChipiWidget from "@/components/chipi/ChipiWidget";
import api from "@/lib/api";

import { useAdminUsersList } from "@/hooks/useAdminData";
import Skeleton from "@/components/ui/Skeleton";
import RefreshButton from "@/components/ui/RefreshButton";
import DesktopOnly from "@/components/ui/DesktopOnly";
import { usePageTopBar } from "@/lib/mobileTopBar";

// ─── Tipos ────────────────────────────────────────────────────────────────────
interface StudentRow {
  id: number;
  username: string;
  name: string;
  surname: string;
  email: string;
  role: string;
  is_active: boolean;
  phone_number: string;
  nationality: string;
  classes_used: number;
  classes_total: number;
  _dirty: boolean;
  _original: {
    role: string;
    is_active: boolean;
    phone_number: string;
    nationality: string;
  };
}

const ROLES = ["student", "teacher", "superadmin"];

// ─── Badge de Rol ─────────────────────────────────────────────────────────────
function RoleBadge({ role }: { role: string }) {
  const styles: Record<string, string> = {
    superadmin: "bg-purple-100 text-purple-700 border-purple-200",
    teacher: "bg-blue-100 text-blue-700 border-blue-200",
    student: "bg-slate-100 text-slate-700 border-slate-200",
  };

  return (
    <span
      className={`px-2 py-0.5 text-[10px] font-black uppercase tracking-wider rounded-md border ${
        styles[role] || styles.student
      }`}
    >
      {role}
    </span>
  );
}

// ─── Celda editable de texto (Teléfono / Nacionalidad) ────────────────────────
function TextCell({
  value,
  dirty,
  onChange,
  placeholder,
  icon: Icon,
}: {
  value: string;
  dirty: boolean;
  onChange: (v: string) => void;
  placeholder?: string;
  icon?: React.ElementType;
}) {
  return (
    <div className="relative flex items-center">
      {Icon && (
        <Icon className="w-3.5 h-3.5 absolute left-2.5 text-slate-400 pointer-events-none" />
      )}
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`
          w-full text-xs font-bold py-1.5 rounded-lg border-2 transition-all duration-200
          focus:outline-none focus:ring-2 focus:ring-pink-200
          ${Icon ? "pl-8 pr-2.5" : "px-2.5"}
          ${
            dirty
              ? "border-amber-400 bg-amber-50/80 text-amber-900 shadow-sm"
              : "border-transparent bg-slate-100/80 text-slate-700 hover:bg-slate-200/70 focus:bg-white focus:border-pink-400"
          }
        `}
      />
    </div>
  );
}

// ─── Celda editable con select ────────────────────────────────────────────────
function SelectCell({
  value,
  options,
  dirty,
  onChange,
}: {
  value: string;
  options: string[];
  dirty: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`
          w-full appearance-none text-xs font-bold px-2.5 py-1.5 pr-7
          rounded-lg border-2 cursor-pointer transition-all duration-200
          focus:outline-none focus:ring-2 focus:ring-pink-200
          ${
            dirty
              ? "border-amber-400 bg-amber-50/80 text-amber-900 shadow-sm"
              : "border-transparent bg-slate-100/80 text-slate-700 hover:bg-slate-200/70 focus:bg-white focus:border-pink-400"
          }
        `}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
    </div>
  );
}

// ─── Celda toggle para is_active ──────────────────────────────────────────────
function ActiveToggleCell({
  value,
  dirty,
  onChange,
}: {
  value: boolean;
  dirty: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={`
        w-full flex items-center justify-center gap-1.5 text-xs font-bold px-2.5 py-1.5
        rounded-lg border-2 transition-all duration-200 active:scale-95
        ${
          dirty
            ? "border-amber-400 bg-amber-50 text-amber-900"
            : value
            ? "border-transparent bg-emerald-100/80 text-emerald-700 hover:bg-emerald-200"
            : "border-transparent bg-slate-100 text-slate-500 hover:bg-slate-200"
        }
      `}
    >
      <span
        className={`w-2 h-2 rounded-full ${
          value ? "bg-emerald-500 animate-pulse" : "bg-slate-400"
        }`}
      />
      {value ? "Activo" : "Inactivo"}
    </button>
  );
}

// ─── Página Principal ─────────────────────────────────────────────────────────
const USERS_PAGE_SIZE = 100;

export default function BulkEditStudentsPage() {
  const router = useRouter();
  // BUG-10 fix: paginación real. El backend ahora devuelve 'total', así que
  // ya no truncamos silenciosamente sobre USERS_PAGE_SIZE usuarios sin que
  // el admin se entere — se muestra el total real y controles de página.
  const [page, setPage] = useState(1);
  const { users, total, totalPages, loading, isFetching, isError, refetch } = useAdminUsersList(page, USERS_PAGE_SIZE);
  
  const [rows, setRows] = useState<StudentRow[]>([]);
  const [filtered, setFiltered] = useState<StudentRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [filterRole, setFilterRole] = useState("all");
  const [filterActive, setFilterActive] = useState("all");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const dirtyRows = useMemo(() => rows.filter((r) => r._dirty), [rows]);

  // Sincroniza la tabla editable con el servidor SOLO si no hay cambios sin
  // guardar — así un refresh (manual o en segundo plano) nunca pisa una
  // edición en curso. Si hay dirtyRows, el admin debe guardar o revertir
  // antes de que la tabla vuelva a reflejar el servidor.
  useEffect(() => {
    if (dirtyRows.length > 0) return;
    const data: StudentRow[] = users.map((u) => ({
      id: u.id,
      username: u.username,
      name: u.name,
      surname: u.surname,
      email: u.email,
      role: u.role,
      is_active: u.is_active ?? true,
      phone_number: u.phone_number ?? "",
      nationality: u.nationality ?? "",
      classes_used: u.classes_used ?? 0,
      classes_total: u.classes_total ?? 0,
      _dirty: false,
      _original: {
        role: u.role,
        is_active: u.is_active ?? true,
        phone_number: u.phone_number ?? "",
        nationality: u.nationality ?? "",
      },
    }));
    setRows(data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [users]);

  usePageTopBar({
    title: "Edición Masiva de Usuarios",
    onRefresh: refetch,
    isFetching,
  });

  // ── Filtrado ──
  useEffect(() => {
    let result = rows;
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      result = result.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.surname.toLowerCase().includes(q) ||
          r.username.toLowerCase().includes(q) ||
          r.email.toLowerCase().includes(q) ||
          r.phone_number.toLowerCase().includes(q) ||
          r.nationality.toLowerCase().includes(q)
      );
    }
    if (filterRole !== "all") {
      result = result.filter((r) => r.role === filterRole);
    }
    if (filterActive !== "all") {
      result = result.filter((r) =>
        filterActive === "active" ? r.is_active : !r.is_active
      );
    }
    setFiltered(result);
  }, [rows, search, filterRole, filterActive]);

  // ── Modificación de celdas ──
  const updateRow = (
    id: number,
    field: keyof Pick<
      StudentRow,
      "role" | "is_active" | "phone_number" | "nationality"
    >,
    value: string | boolean
  ) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const updated = { ...r, [field]: value };
        const dirty =
          updated.role !== r._original.role ||
          updated.is_active !== r._original.is_active ||
          updated.phone_number !== r._original.phone_number ||
          updated.nationality !== r._original.nationality;
        return { ...updated, _dirty: dirty };
      })
    );
  };

  // ── Selección ──
  const toggleSelect = (id: number) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const toggleAll = () => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((r) => r.id)));
    }
  };

  // ── Aplicar cambios masivos a seleccionados ──
  const [bulkField, setBulkField] = useState<string>("");
  const [bulkValue, setBulkValue] = useState<string>("");
  const [showBulk, setShowBulk] = useState(false);

  const applyBulk = () => {
    if (!bulkField || bulkValue === "" || selectedIds.size === 0) return;
    setRows((prev) =>
      prev.map((r) => {
        if (!selectedIds.has(r.id)) return r;
        const field = bulkField as keyof Pick<
          StudentRow,
          "role" | "is_active" | "phone_number" | "nationality"
        >;
        let value: string | boolean = bulkValue;
        if (field === "is_active") {
          value = bulkValue === "true";
        }
        const updated = { ...r, [field]: value };
        const dirty =
          updated.role !== r._original.role ||
          updated.is_active !== r._original.is_active ||
          updated.phone_number !== r._original.phone_number ||
          updated.nationality !== r._original.nationality;
        return { ...updated, _dirty: dirty };
      })
    );
    setShowBulk(false);
    setBulkField("");
    setBulkValue("");
  };

  // ── Revertir filas ──
  const revertRow = (id: number) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        return {
          ...r,
          role: r._original.role,
          is_active: r._original.is_active,
          phone_number: r._original.phone_number,
          nationality: r._original.nationality,
          _dirty: false,
        };
      })
    );
  };

  const revertAll = () => {
    setRows((prev) =>
      prev.map((r) => ({
        ...r,
        role: r._original.role,
        is_active: r._original.is_active,
        phone_number: r._original.phone_number,
        nationality: r._original.nationality,
        _dirty: false,
      }))
    );
  };

  // ── Guardar cambios ──
  const saveAll = async () => {
    if (dirtyRows.length === 0) return;
    setSaving(true);
    setError("");
    try {
      await Promise.all(
        dirtyRows.map((r) =>
          api.patch(`/admin/users/${r.id}`, {
            role: r.role,
            is_active: r.is_active,
            phone_number: r.phone_number || null,
            nationality: r.nationality || null,
          })
        )
      );
      setRows((prev) =>
        prev.map((r) =>
          r._dirty
            ? {
                ...r,
                _dirty: false,
                _original: {
                  role: r.role,
                  is_active: r.is_active,
                  phone_number: r.phone_number,
                  nationality: r.nationality,
                },
              }
            : r
        )
      );
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      refetch();
    } catch {
      setError("Ocurrió un error al guardar algunos registros.");
    } finally {
      setSaving(false);
    }
  };

  const allSelected =
    filtered.length > 0 && selectedIds.size === filtered.length;

  const activeUsersCount = useMemo(
    () => rows.filter((r) => r.is_active).length,
    [rows]
  );

  return (
    <>
      <div className="min-h-screen bg-slate-50/50 pb-28 relative overflow-x-hidden">
        {/* Fondo decorativo */}
        <div className="fixed -top-24 -right-24 w-96 h-96 bg-pink-300/10 rounded-full blur-3xl pointer-events-none" />
        <div className="fixed top-1/2 -left-24 w-96 h-96 bg-purple-300/10 rounded-full blur-3xl pointer-events-none" />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 space-y-6">
          {/* ─── Encabezado ─── */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <button
                onClick={() => router.push("/admin/students")}
                className="w-10 h-10 rounded-2xl bg-white border border-slate-200/80
                           flex items-center justify-center shadow-sm hover:bg-slate-50
                           hover:border-slate-300 transition-all duration-200 active:scale-95"
              >
                <ArrowLeft className="w-5 h-5 text-slate-600" />
              </button>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-2xl font-black text-slate-900 tracking-tight">
                    Edición Masiva de Usuarios
                  </h1>
                  <span className="bg-pink-100 text-pink-700 text-xs font-extrabold px-2.5 py-0.5 rounded-full">
                    Admin
                  </span>
                </div>
                <p className="text-slate-500 text-xs font-semibold mt-0.5">
                  Gestiona roles, información de contacto y permisos globalmente
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2.5 self-end sm:self-auto">
              <DesktopOnly>
                <RefreshButton onRefresh={refetch} isFetching={isFetching} />
              </DesktopOnly>
              <button
                onClick={saveAll}
                disabled={dirtyRows.length === 0 || saving}
                className={`
                  flex items-center gap-2 px-5 py-2.5 rounded-2xl text-xs font-extrabold
                  shadow-md transition-all duration-300 disabled:opacity-40
                  disabled:cursor-not-allowed active:scale-95
                  ${
                    saved
                      ? "bg-emerald-500 text-white shadow-emerald-200"
                      : "bg-gradient-to-r from-pink-500 to-rose-500 text-white shadow-pink-200 hover:brightness-105"
                  }
                `}
              >
                {saving ? (
                  <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                ) : saved ? (
                  <>
                    <Check className="w-4 h-4" /> Guardado
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    Guardar Cambios {dirtyRows.length > 0 && `(${dirtyRows.length})`}
                  </>
                )}
              </button>
            </div>
          </div>

          {/* ─── Tarjetas de Resumen (KPIs) ─── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white/80 backdrop-blur-md rounded-2xl p-3.5 border border-slate-200/60 shadow-sm flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-slate-100 text-slate-600">
                <Users className="w-4 h-4" />
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Total</p>
                <p className="text-base font-black text-slate-800">{rows.length}</p>
              </div>
            </div>

            <div className="bg-white/80 backdrop-blur-md rounded-2xl p-3.5 border border-slate-200/60 shadow-sm flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-emerald-100 text-emerald-600">
                <UserCheck className="w-4 h-4" />
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Activos</p>
                <p className="text-base font-black text-slate-800">{activeUsersCount}</p>
              </div>
            </div>

            <div className="bg-white/80 backdrop-blur-md rounded-2xl p-3.5 border border-slate-200/60 shadow-sm flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-amber-100 text-amber-600">
                <Sparkles className="w-4 h-4" />
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Modificados</p>
                <p className="text-base font-black text-amber-600">{dirtyRows.length}</p>
              </div>
            </div>

            <div className="bg-white/80 backdrop-blur-md rounded-2xl p-3.5 border border-slate-200/60 shadow-sm flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-pink-100 text-pink-600">
                <ShieldCheck className="w-4 h-4" />
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Seleccionados</p>
                <p className="text-base font-black text-pink-600">{selectedIds.size}</p>
              </div>
            </div>
          </div>

          {/* ─── Error global ─── */}
          {(error || isError) && (
            <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-2xl text-xs font-bold flex items-center gap-2.5 animate-in fade-in duration-300 shadow-sm">
              <AlertTriangle className="w-4 h-4 text-rose-500 flex-shrink-0" />
              <span className="flex-1">
                {error || "No se pudo cargar la lista de usuarios. Por favor, reintenta."}
              </span>
              {isError ? (
                <button
                  onClick={() => refetch()}
                  className="flex items-center gap-1.5 text-rose-600 hover:text-rose-800 font-bold px-2 py-1 rounded-lg hover:bg-rose-100 transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Reintentar
                </button>
              ) : (
                <button
                  onClick={() => setError("")}
                  className="text-rose-400 hover:text-rose-600 transition-colors p-1"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          )}

          {/* ─── Controles de Filtros y Búsqueda ─── */}
          <div className="bg-white/80 backdrop-blur-xl rounded-3xl border border-slate-200/80 shadow-sm p-4 space-y-3">
            <div className="flex flex-wrap gap-3 items-center">
              {/* Buscador */}
              <div className="relative flex-1 min-w-[240px]">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar usuario, email, teléfono o país..."
                  className="w-full bg-slate-50 border-2 border-transparent rounded-2xl text-xs font-bold
                             text-slate-800 placeholder:text-slate-400 pl-10 pr-9 py-2.5
                             focus:outline-none focus:bg-white focus:border-pink-500 focus:ring-4 focus:ring-pink-50
                             transition-all duration-200"
                />
                {search && (
                  <button
                    onClick={() => setSearch("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Filtro Rol */}
              <div className="relative">
                <select
                  value={filterRole}
                  onChange={(e) => setFilterRole(e.target.value)}
                  className="appearance-none bg-slate-100/80 border-2 border-transparent rounded-2xl
                             text-xs font-bold text-slate-700 pl-3.5 pr-8 py-2.5 cursor-pointer
                             focus:outline-none focus:bg-white focus:border-pink-500 hover:bg-slate-200/70
                             transition-all"
                >
                  <option value="all">Todos los roles</option>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
              </div>

              {/* Filtro Activo */}
              <div className="relative">
                <select
                  value={filterActive}
                  onChange={(e) => setFilterActive(e.target.value)}
                  className="appearance-none bg-slate-100/80 border-2 border-transparent rounded-2xl
                             text-xs font-bold text-slate-700 pl-3.5 pr-8 py-2.5 cursor-pointer
                             focus:outline-none focus:bg-white focus:border-pink-500 hover:bg-slate-200/70
                             transition-all"
                >
                  <option value="all">Todos los estados</option>
                  <option value="active">Solo Activos</option>
                  <option value="inactive">Solo Inactivos</option>
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
              </div>
            </div>

            {search && totalPages > 1 && (
              // BUG-10 fix: con paginación real, avisar que la búsqueda solo
              // filtra dentro de la página actual, para no dar la falsa
              // impresión de estar buscando entre todos los usuarios.
              <p className="text-[11px] font-bold text-amber-600 flex items-center gap-1.5 px-1">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                La búsqueda solo filtra dentro de la página actual ({page} de {totalPages}). Si no encuentras a alguien, prueba en otra página.
              </p>
            )}

            {/* Acciones Masivas sobre Filas Seleccionadas */}
            {selectedIds.size > 0 && (
              <div className="flex items-center gap-3 pt-3 border-t border-slate-100 flex-wrap animate-in fade-in duration-200">
                <span className="text-xs font-extrabold text-pink-600 bg-pink-50 px-3 py-1.5 rounded-full border border-pink-100 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {selectedIds.size} seleccionados
                </span>

                {!showBulk ? (
                  <button
                    onClick={() => setShowBulk(true)}
                    className="flex items-center gap-1.5 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-full transition-colors active:scale-95"
                  >
                    <Filter className="w-3.5 h-3.5 text-slate-500" />
                    Cambiar valor en lote...
                  </button>
                ) : (
                  <div className="flex items-center gap-2 flex-wrap bg-slate-50 p-2 rounded-2xl border border-slate-200/60">
                    <div className="relative">
                      <select
                        value={bulkField}
                        onChange={(e) => {
                          setBulkField(e.target.value);
                          setBulkValue("");
                        }}
                        className="appearance-none bg-white border-2 border-slate-200 rounded-xl text-xs font-bold text-slate-700 pl-3 pr-8 py-1.5 focus:outline-none focus:border-pink-500"
                      >
                        <option value="">Seleccionar campo...</option>
                        <option value="role">Rol</option>
                        <option value="is_active">Estado</option>
                        <option value="phone_number">Teléfono</option>
                        <option value="nationality">Nacionalidad</option>
                      </select>
                      <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400 pointer-events-none" />
                    </div>

                    {/* Selector o Input dinámico */}
                    {bulkField === "role" && (
                      <div className="relative">
                        <select
                          value={bulkValue}
                          onChange={(e) => setBulkValue(e.target.value)}
                          className="appearance-none bg-white border-2 border-slate-200 rounded-xl text-xs font-bold text-slate-700 pl-3 pr-8 py-1.5 focus:outline-none focus:border-pink-500"
                        >
                          <option value="">Seleccionar rol...</option>
                          {ROLES.map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </select>
                        <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400 pointer-events-none" />
                      </div>
                    )}

                    {bulkField === "is_active" && (
                      <div className="relative">
                        <select
                          value={bulkValue}
                          onChange={(e) => setBulkValue(e.target.value)}
                          className="appearance-none bg-white border-2 border-slate-200 rounded-xl text-xs font-bold text-slate-700 pl-3 pr-8 py-1.5 focus:outline-none focus:border-pink-500"
                        >
                          <option value="">Seleccionar estado...</option>
                          <option value="true">Activo</option>
                          <option value="false">Inactivo</option>
                        </select>
                        <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400 pointer-events-none" />
                      </div>
                    )}

                    {(bulkField === "phone_number" ||
                      bulkField === "nationality") && (
                      <input
                        type="text"
                        value={bulkValue}
                        onChange={(e) => setBulkValue(e.target.value)}
                        placeholder={
                          bulkField === "phone_number"
                            ? "+34 600..."
                            : "España"
                        }
                        className="bg-white border-2 border-slate-200 rounded-xl text-xs font-bold text-slate-700 px-3 py-1.5 focus:outline-none focus:border-pink-500"
                      />
                    )}

                    <button
                      onClick={applyBulk}
                      disabled={!bulkField || bulkValue === ""}
                      className="px-3 py-1.5 bg-pink-500 text-white text-xs font-extrabold rounded-xl disabled:opacity-40 hover:bg-pink-600 transition-colors shadow-sm active:scale-95"
                    >
                      Aplicar
                    </button>
                    <button
                      onClick={() => {
                        setShowBulk(false);
                        setBulkField("");
                        setBulkValue("");
                      }}
                      className="text-slate-400 hover:text-slate-600 p-1"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ─── Tabla de Usuarios ─── */}
          <div className="bg-white/80 backdrop-blur-xl rounded-3xl border border-slate-200/80 shadow-sm overflow-hidden">
            {loading ? (
              <div className="p-6 space-y-2">
                {[1, 2, 3, 4, 5].map(i => (
                  <Skeleton key={i} className="h-12 w-full rounded-xl" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center py-20 px-4 text-center">
                <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400 mb-3">
                  <Users className="w-6 h-6" />
                </div>
                <p className="text-slate-700 font-extrabold text-sm">
                  No se encontraron resultados
                </p>
                <p className="text-slate-400 text-xs mt-1 max-w-sm">
                  Prueba cambiando los términos de búsqueda o eliminando los filtros aplicados.
                </p>
                {(search || filterRole !== "all" || filterActive !== "all") && (
                  <button
                    onClick={() => {
                      setSearch("");
                      setFilterRole("all");
                      setFilterActive("all");
                    }}
                    className="mt-4 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-colors"
                  >
                    Limpiar Filtros
                  </button>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                <table className="w-full text-sm min-w-[1000px] border-collapse">
                  {/* Cabecera Sticky */}
                  <thead className="sticky top-0 z-10 bg-slate-100/90 backdrop-blur-md border-b border-slate-200/80">
                    <tr>
                      <th className="w-10 px-4 py-3.5 text-left">
                        <button
                          onClick={toggleAll}
                          className={`
                            w-4 h-4 rounded-md border-2 flex items-center justify-center transition-all duration-200
                            ${
                              allSelected
                                ? "border-pink-500 bg-pink-500"
                                : "border-slate-300 bg-white hover:border-pink-400"
                            }
                          `}
                        >
                          {allSelected && <Check className="w-3 h-3 text-white" />}
                        </button>
                      </th>
                      {[
                        "Usuario",
                        "Nombre Completo",
                        "Email",
                        "Teléfono",
                        "Nacionalidad",
                        "Rol",
                        "Estado",
                        "Clases",
                        "Acciones",
                      ].map((h) => (
                        <th
                          key={h}
                          className="text-left text-[10px] font-black text-slate-400 uppercase tracking-widest px-3 py-3.5 whitespace-nowrap"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>

                  {/* Filas */}
                  <tbody className="divide-y divide-slate-100">
                    {filtered.map((row) => (
                      <tr
                        key={row.id}
                        className={`
                          transition-colors duration-150 group
                          ${
                            selectedIds.has(row.id)
                              ? "bg-pink-50/50"
                              : "hover:bg-slate-50/80"
                          }
                          ${row._dirty ? "bg-amber-50/30" : ""}
                        `}
                      >
                        {/* Checkbox */}
                        <td className="px-4 py-2.5">
                          <button
                            onClick={() => toggleSelect(row.id)}
                            className={`
                              w-4 h-4 rounded-md border-2 flex items-center justify-center transition-all duration-200
                              ${
                                selectedIds.has(row.id)
                                  ? "border-pink-500 bg-pink-500"
                                  : "border-slate-300 bg-white hover:border-pink-400"
                              }
                            `}
                          >
                            {selectedIds.has(row.id) && (
                              <Check className="w-3 h-3 text-white" />
                            )}
                          </button>
                        </td>

                        {/* Usuario */}
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            {row._dirty && (
                              <div
                                className="w-2 h-2 bg-amber-400 rounded-full flex-shrink-0 animate-ping"
                                title="Cambio no guardado"
                              />
                            )}
                            <div>
                              <p className="text-xs font-black text-slate-800">
                                @{row.username}
                              </p>
                              <p className="text-[10px] text-slate-400 font-semibold">
                                ID #{row.id}
                              </p>
                            </div>
                          </div>
                        </td>

                        {/* Nombre */}
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <p className="text-xs font-bold text-slate-700">
                            {row.name} {row.surname}
                          </p>
                        </td>

                        {/* Email */}
                        <td className="px-3 py-2.5">
                          <p className="text-xs text-slate-500 font-medium truncate max-w-[180px]">
                            {row.email}
                          </p>
                        </td>

                        {/* Teléfono Editable */}
                        <td className="px-3 py-2.5 min-w-[140px]">
                          <TextCell
                            value={row.phone_number}
                            dirty={
                              row._dirty &&
                              row.phone_number !== row._original.phone_number
                            }
                            onChange={(v) =>
                              updateRow(row.id, "phone_number", v)
                            }
                            placeholder="+34 600..."
                            icon={Phone}
                          />
                        </td>

                        {/* Nacionalidad Editable */}
                        <td className="px-3 py-2.5 min-w-[130px]">
                          <TextCell
                            value={row.nationality}
                            dirty={
                              row._dirty &&
                              row.nationality !== row._original.nationality
                            }
                            onChange={(v) =>
                              updateRow(row.id, "nationality", v)
                            }
                            placeholder="España"
                            icon={Globe}
                          />
                        </td>

                        {/* Rol Editable */}
                        <td className="px-3 py-2.5 min-w-[120px]">
                          <div className="space-y-1">
                            <SelectCell
                              value={row.role}
                              options={ROLES}
                              dirty={
                                row._dirty && row.role !== row._original.role
                              }
                              onChange={(v) => updateRow(row.id, "role", v)}
                            />
                          </div>
                        </td>

                        {/* Estado Toggle */}
                        <td className="px-3 py-2.5 min-w-[110px]">
                          <ActiveToggleCell
                            value={row.is_active}
                            dirty={
                              row._dirty &&
                              row.is_active !== row._original.is_active
                            }
                            onChange={(v) => updateRow(row.id, "is_active", v)}
                          />
                        </td>

                        {/* Clases */}
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <div className="flex items-center gap-1 text-xs font-black text-slate-700">
                            <span>{row.classes_used}</span>
                            <span className="text-slate-400 font-bold">
                              /{row.classes_total}
                            </span>
                          </div>
                        </td>

                        {/* Revertir Fila */}
                        <td className="px-3 py-2.5 text-right whitespace-nowrap">
                          {row._dirty ? (
                            <button
                              onClick={() => revertRow(row.id)}
                              className="text-xs font-bold text-amber-600 hover:text-amber-800 bg-amber-50 hover:bg-amber-100 px-2.5 py-1 rounded-lg transition-colors flex items-center gap-1 ml-auto"
                            >
                              <RotateCcw className="w-3 h-3" />
                              Revertir
                            </button>
                          ) : (
                            <RoleBadge role={row.role} />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Resumen inferior + paginación (BUG-10 fix) */}
            {!loading && filtered.length > 0 && (
              <div className="border-t border-slate-100 px-6 py-3.5 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-400 font-bold bg-slate-50/50">
                <span>
                  Mostrando {filtered.length} de {rows.length} usuarios en esta página
                  {total > 0 && <> — {total} en total</>}
                </span>
                <div className="flex items-center gap-3">
                  {dirtyRows.length > 0 ? (
                    <span className="text-amber-600 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                      {dirtyRows.length} cambio
                      {dirtyRows.length !== 1 ? "s" : ""} pendiente
                      {dirtyRows.length !== 1 ? "s" : ""} — guarda o revierte antes de cambiar de página
                    </span>
                  ) : totalPages > 1 && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        disabled={page <= 1}
                        className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-100 transition-colors"
                      >
                        Anterior
                      </button>
                      <span className="text-slate-500">Página {page} de {totalPages}</span>
                      <button
                        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                        disabled={page >= totalPages}
                        className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-100 transition-colors"
                      >
                        Siguiente
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ─── Footer Flotante de Cambios Pendientes ─── */}
        {dirtyRows.length > 0 && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-6 duration-300 w-full max-w-xl px-4">
            <div className="bg-slate-900 text-white rounded-2xl p-4 shadow-2xl border border-slate-800 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center font-black">
                  {dirtyRows.length}
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-200">
                    Cambios sin guardar
                  </p>
                  <p className="text-[10px] text-slate-400">
                    Tienes modificaciones pendientes en la tabla.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={revertAll}
                  disabled={saving}
                  className="px-3 py-2 text-xs font-bold text-slate-400 hover:text-white transition-colors"
                >
                  Descartar todo
                </button>
                <button
                  onClick={saveAll}
                  disabled={saving}
                  className="px-4 py-2 bg-gradient-to-r from-pink-500 to-rose-500 hover:brightness-110 text-white text-xs font-extrabold rounded-xl shadow-md transition-all active:scale-95 flex items-center gap-1.5"
                >
                  {saving ? (
                    <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  ) : (
                    <Save className="w-3.5 h-3.5" />
                  )}
                  Guardar Todo
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <ChipiWidget screenName="admin_edit_students" />
    </>
  );
}