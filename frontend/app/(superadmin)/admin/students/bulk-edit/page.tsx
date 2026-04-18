"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Save, Search, ChevronDown,
  Check, X, AlertTriangle, RefreshCw,
  Users, Filter
} from "lucide-react";
import api from "@/lib/api";

// ─── Tipos ────────────────────────────────────────────────────────────────────
interface StudentRow {
  id: number;
  username: string;
  name: string;
  surname: string;
  email: string;
  role: string;
  status: string;
  package_name: string | null;
  price_per_class: number;
  classes_used: number;
  classes_total: number;
  // Estado local de edición
  _dirty: boolean;
  _original: {
    role: string;
    status: string;
    package_name: string | null;
    price_per_class: number;
  };
}

const ROLES    = ["student", "teacher", "superadmin"];
const STATUSES = ["active", "inactive", "suspended"];
const PACKAGES = ["Básico", "Personalizado", "Intensivo", "Flexible", "Trial"];

const STATUS_BADGE: Record<string, string> = {
  active:    "bg-emerald-100 text-emerald-700",
  inactive:  "bg-slate-100 text-slate-500",
  suspended: "bg-red-100 text-red-600",
};

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
          w-full appearance-none text-xs font-bold px-2.5 py-1.5
          rounded-lg border-2 cursor-pointer transition-all duration-200
          focus:outline-none focus:ring-2 focus:ring-pink-200
          ${dirty
            ? "border-amber-300 bg-amber-50 text-amber-800"
            : "border-transparent bg-slate-100 text-slate-700 hover:bg-slate-200"
          }
        `}
      >
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
      <ChevronDown
        className="absolute right-1.5 top-1/2 -translate-y-1/2
                     w-3 h-3 text-slate-400 pointer-events-none"
      />
    </div>
  );
}

// ─── Celda editable numérica ──────────────────────────────────────────────────
function NumberCell({
  value,
  dirty,
  onChange,
}: {
  value: number;
  dirty: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <input
      type="number"
      min={0}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className={`
        w-20 text-xs font-bold px-2.5 py-1.5 rounded-lg border-2
        text-right transition-all duration-200
        focus:outline-none focus:ring-2 focus:ring-pink-200
        ${dirty
          ? "border-amber-300 bg-amber-50 text-amber-800"
          : "border-transparent bg-slate-100 text-slate-700 hover:bg-slate-200"
        }
      `}
    />
  );
}

// ─── Página ───────────────────────────────────────────────────────────────────
export default function BulkEditStudentsPage() {
  const router = useRouter();

  const [rows, setRows]           = useState<StudentRow[]>([]);
  const [filtered, setFiltered]   = useState<StudentRow[]>([]);
  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState(false);
  const [saved, setSaved]         = useState(false);
  const [error, setError]         = useState("");

  const [search, setSearch]       = useState("");
  const [filterRole, setFilterRole]     = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [selectedIds, setSelectedIds]   = useState<Set<number>>(new Set());

  // ── Carga inicial ──
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.get("/admin/users?limit=500");
      const data: StudentRow[] = (res.data.users ?? res.data).map(
        (u: any) => ({
          id:             u.id,
          username:       u.username,
          name:           u.name,
          surname:        u.surname,
          email:          u.email,
          role:           u.role,
          status:         u.status ?? "active",
          package_name:   u.package_name ?? null,
          price_per_class: u.price_per_class ?? 0,
          classes_used:   u.classes_used ?? 0,
          classes_total:  u.classes_total ?? 0,
          _dirty: false,
          _original: {
            role:           u.role,
            status:         u.status ?? "active",
            package_name:   u.package_name ?? null,
            price_per_class: u.price_per_class ?? 0,
          },
        })
      );
      setRows(data);
    } catch {
      setError("Error cargando usuarios");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Filtrado ──
  useEffect(() => {
    let result = rows;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.surname.toLowerCase().includes(q) ||
          r.username.toLowerCase().includes(q) ||
          r.email.toLowerCase().includes(q)
      );
    }
    if (filterRole !== "all") {
      result = result.filter((r) => r.role === filterRole);
    }
    if (filterStatus !== "all") {
      result = result.filter((r) => r.status === filterStatus);
    }
    setFiltered(result);
  }, [rows, search, filterRole, filterStatus]);

  // ── Editar celda ──
  const updateRow = (
    id: number,
    field: keyof Pick<
      StudentRow,
      "role" | "status" | "package_name" | "price_per_class"
    >,
    value: string | number | null
  ) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const updated = { ...r, [field]: value };
        const dirty =
          updated.role            !== r._original.role ||
          updated.status          !== r._original.status ||
          updated.package_name    !== r._original.package_name ||
          updated.price_per_class !== r._original.price_per_class;
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

  // ── Aplicar cambio masivo a seleccionados ──
  const [bulkField, setBulkField]   = useState<string>("");
  const [bulkValue, setBulkValue]   = useState<string>("");
  const [showBulk, setShowBulk]     = useState(false);

  const applyBulk = () => {
    if (!bulkField || !bulkValue || selectedIds.size === 0) return;
    setRows((prev) =>
      prev.map((r) => {
        if (!selectedIds.has(r.id)) return r;
        const field = bulkField as
          "role" | "status" | "package_name" | "price_per_class";
        const value =
          field === "price_per_class" ? Number(bulkValue) : bulkValue;
        const updated = { ...r, [field]: value };
        const dirty =
          updated.role            !== r._original.role ||
          updated.status          !== r._original.status ||
          updated.package_name    !== r._original.package_name ||
          updated.price_per_class !== r._original.price_per_class;
        return { ...updated, _dirty: dirty };
      })
    );
    setShowBulk(false);
    setBulkField("");
    setBulkValue("");
  };

  // ── Revertir fila ──
  const revertRow = (id: number) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        return {
          ...r,
          role:            r._original.role,
          status:          r._original.status,
          package_name:    r._original.package_name,
          price_per_class: r._original.price_per_class,
          _dirty: false,
        };
      })
    );
  };

  // ── Guardar cambios ──
  const dirtyRows = rows.filter((r) => r._dirty);

  const saveAll = async () => {
    if (dirtyRows.length === 0) return;
    setSaving(true);
    setError("");
    try {
      await Promise.all(
        dirtyRows.map((r) =>
          api.patch(`/admin/users/${r.id}`, {
            role:            r.role,
            status:          r.status,
            package_name:    r.package_name,
            price_per_class: r.price_per_class,
          })
        )
      );
      // Limpiar dirty flags
      setRows((prev) =>
        prev.map((r) =>
          r._dirty
            ? {
                ...r,
                _dirty: false,
                _original: {
                  role:            r.role,
                  status:          r.status,
                  package_name:    r.package_name,
                  price_per_class: r.price_per_class,
                },
              }
            : r
        )
      );
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setError("Error guardando algunos cambios");
    } finally {
      setSaving(false);
    }
  };

  const allSelected =
    filtered.length > 0 && selectedIds.size === filtered.length;

  return (
    <div className="min-h-screen bg-slate-50 relative overflow-hidden">
      {/* Blobs */}
      <div
        className="fixed top-[-80px] right-[-80px] w-[400px] h-[400px]
                      bg-pink-300/15 rounded-full blur-[100px] pointer-events-none"
      />

      <div className="relative space-y-5">

        {/* ─── Header ─── */}
        <div
          className="flex flex-col sm:flex-row sm:items-center justify-between
                        gap-4 animate-in fade-in slide-in-from-bottom-4 duration-500"
        >
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push("/admin/students")}
              className="w-9 h-9 rounded-xl bg-white border border-slate-200
                           flex items-center justify-center shadow-sm
                           hover:bg-slate-50 transition-colors"
            >
              <ArrowLeft className="w-4 h-4 text-slate-600" />
            </button>
            <div>
              <h1 className="text-2xl font-black text-slate-800 tracking-tight">
                Edición masiva
              </h1>
              <p className="text-slate-500 text-sm mt-0.5">
                {rows.length} usuarios · {dirtyRows.length} cambios pendientes
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={load}
              disabled={loading}
              className="w-9 h-9 rounded-xl bg-white border border-slate-200
                           flex items-center justify-center shadow-sm
                           hover:bg-slate-50 transition-colors disabled:opacity-50"
            >
              <RefreshCw
                className={`w-4 h-4 text-slate-600 ${loading ? "animate-spin" : ""}`}
              />
            </button>

            {/* Guardar */}
            <button
              onClick={saveAll}
              disabled={dirtyRows.length === 0 || saving}
              className={`
                flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm
                font-bold shadow-md transition-all duration-300
                disabled:opacity-40 disabled:cursor-not-allowed
                active:scale-[0.97]
                ${saved
                  ? "bg-emerald-500 text-white shadow-emerald-100"
                  : "bg-gradient-to-r from-pink-500 to-rose-400 text-white shadow-pink-200"
                }
              `}
            >
              {saving ? (
                <div
                  className="w-4 h-4 border-2 border-white/40
                                border-t-white rounded-full animate-spin"
                />
              ) : saved ? (
                <><Check className="w-4 h-4" /> Guardado</>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  Guardar {dirtyRows.length > 0 && `(${dirtyRows.length})`}
                </>
              )}
            </button>
          </div>
        </div>

        {/* ─── Error global ─── */}
        {error && (
          <div
            className="bg-rose-50 border border-rose-100 text-rose-600
                          px-4 py-3 rounded-xl text-sm font-bold
                          flex items-center gap-2"
          >
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            {error}
            <button
              onClick={() => setError("")}
              className="ml-auto text-rose-400 hover:text-rose-600"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* ─── Filtros + Acciones masivas ─── */}
        <div
          className="bg-white/80 backdrop-blur-xl rounded-2xl border
                        border-white shadow-lg p-4 space-y-3
                        animate-in fade-in duration-500 delay-100"
        >
          <div className="flex flex-wrap gap-3 items-center">
            {/* Buscador */}
            <div className="relative flex-1 min-w-[200px]">
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2
                               w-4 h-4 text-slate-400 pointer-events-none"
              />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nombre, usuario o email..."
                className="w-full bg-slate-50 border-2 border-transparent
                             rounded-xl text-sm font-bold text-slate-800
                             placeholder:text-slate-400 pl-9 pr-4 py-2.5
                             focus:outline-none focus:bg-white
                             focus:border-pink-500 focus:ring-4 focus:ring-pink-50
                             transition-all duration-300"
              />
            </div>

            {/* Filtro rol */}
            <div className="relative">
              <select
                value={filterRole}
                onChange={(e) => setFilterRole(e.target.value)}
                className="appearance-none bg-slate-100 border-2 border-transparent
                             rounded-xl text-sm font-bold text-slate-700
                             pl-3 pr-8 py-2.5 cursor-pointer
                             focus:outline-none hover:bg-slate-200
                             transition-colors"
              >
                <option value="all">Todos los roles</option>
                {ROLES.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
              <ChevronDown
                className="absolute right-2.5 top-1/2 -translate-y-1/2
                               w-3.5 h-3.5 text-slate-400 pointer-events-none"
              />
            </div>

            {/* Filtro estado */}
            <div className="relative">
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="appearance-none bg-slate-100 border-2 border-transparent
                             rounded-xl text-sm font-bold text-slate-700
                             pl-3 pr-8 py-2.5 cursor-pointer
                             focus:outline-none hover:bg-slate-200
                             transition-colors"
              >
                <option value="all">Todos los estados</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <ChevronDown
                className="absolute right-2.5 top-1/2 -translate-y-1/2
                               w-3.5 h-3.5 text-slate-400 pointer-events-none"
              />
            </div>
          </div>

          {/* Acciones sobre seleccionados */}
          {selectedIds.size > 0 && (
            <div
              className="flex items-center gap-3 pt-2 border-t border-slate-100
                            flex-wrap animate-in fade-in duration-200"
            >
              <span className="text-xs font-black text-pink-600 bg-pink-50
                               px-3 py-1.5 rounded-full border border-pink-100">
                {selectedIds.size} seleccionados
              </span>

              {!showBulk ? (
                <button
                  onClick={() => setShowBulk(true)}
                  className="flex items-center gap-1.5 text-xs font-bold
                               text-slate-600 bg-slate-100 hover:bg-slate-200
                               px-3 py-1.5 rounded-full transition-colors"
                >
                  <Filter className="w-3.5 h-3.5" />
                  Cambiar campo masivamente
                </button>
              ) : (
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Qué campo */}
                  <div className="relative">
                    <select
                      value={bulkField}
                      onChange={(e) => setBulkField(e.target.value)}
                      className="appearance-none bg-white border-2
                                   border-slate-200 rounded-xl text-xs
                                   font-bold text-slate-700 pl-2.5 pr-7 py-2
                                   cursor-pointer focus:outline-none
                                   focus:border-pink-400"
                    >
                      <option value="">Seleccionar campo...</option>
                      <option value="role">Rol</option>
                      <option value="status">Estado</option>
                      <option value="package_name">Paquete</option>
                      <option value="price_per_class">Precio/clase</option>
                    </select>
                    <ChevronDown
                      className="absolute right-2 top-1/2 -translate-y-1/2
                                     w-3 h-3 text-slate-400 pointer-events-none"
                    />
                  </div>

                  {/* Valor */}
                  {bulkField === "role" && (
                    <div className="relative">
                      <select
                        value={bulkValue}
                        onChange={(e) => setBulkValue(e.target.value)}
                        className="appearance-none bg-white border-2
                                     border-slate-200 rounded-xl text-xs
                                     font-bold text-slate-700 pl-2.5 pr-7 py-2
                                     cursor-pointer focus:outline-none
                                     focus:border-pink-400"
                      >
                        <option value="">Valor...</option>
                        {ROLES.map((r) => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                      <ChevronDown
                        className="absolute right-2 top-1/2 -translate-y-1/2
                                       w-3 h-3 text-slate-400 pointer-events-none"
                      />
                    </div>
                  )}

                  {bulkField === "status" && (
                    <div className="relative">
                      <select
                        value={bulkValue}
                        onChange={(e) => setBulkValue(e.target.value)}
                        className="appearance-none bg-white border-2
                                     border-slate-200 rounded-xl text-xs
                                     font-bold text-slate-700 pl-2.5 pr-7 py-2
                                     cursor-pointer focus:outline-none
                                     focus:border-pink-400"
                      >
                        <option value="">Valor...</option>
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                      <ChevronDown
                        className="absolute right-2 top-1/2 -translate-y-1/2
                                       w-3 h-3 text-slate-400 pointer-events-none"
                      />
                    </div>
                  )}

                  {bulkField === "package_name" && (
                    <div className="relative">
                      <select
                        value={bulkValue}
                        onChange={(e) => setBulkValue(e.target.value)}
                        className="appearance-none bg-white border-2
                                     border-slate-200 rounded-xl text-xs
                                     font-bold text-slate-700 pl-2.5 pr-7 py-2
                                     cursor-pointer focus:outline-none
                                     focus:border-pink-400"
                      >
                        <option value="">Paquete...</option>
                        {PACKAGES.map((p) => (
                          <option key={p} value={p}>{p}</option>
                        ))}
                      </select>
                      <ChevronDown
                        className="absolute right-2 top-1/2 -translate-y-1/2
                                       w-3 h-3 text-slate-400 pointer-events-none"
                      />
                    </div>
                  )}

                  {bulkField === "price_per_class" && (
                    <input
                      type="number"
                      min={0}
                      value={bulkValue}
                      onChange={(e) => setBulkValue(e.target.value)}
                      placeholder="0"
                      className="w-20 bg-white border-2 border-slate-200
                                   rounded-xl text-xs font-bold text-slate-700
                                   px-2.5 py-2 focus:outline-none
                                   focus:border-pink-400"
                    />
                  )}

                  <button
                    onClick={applyBulk}
                    disabled={!bulkField || !bulkValue}
                    className="px-3 py-2 bg-pink-500 text-white text-xs
                                 font-bold rounded-xl disabled:opacity-40
                                 hover:bg-pink-600 transition-colors"
                  >
                    Aplicar
                  </button>
                  <button
                    onClick={() => {
                      setShowBulk(false);
                      setBulkField("");
                      setBulkValue("");
                    }}
                    className="text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ─── Tabla ─── */}
        <div
          className="bg-white/80 backdrop-blur-xl rounded-[2rem] border
                        border-white shadow-lg overflow-hidden
                        animate-in fade-in duration-500 delay-150"
        >
          {loading ? (
            <div className="flex items-center justify-center py-24">
              <div
                className="w-10 h-10 border-4 border-pink-200
                              border-t-pink-500 rounded-full animate-spin"
              />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center py-24">
              <Users className="w-12 h-12 text-slate-200 mb-3" />
              <p className="text-slate-400 font-bold">
                No se encontraron usuarios
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[900px]">
                {/* Cabecera */}
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/60">
                    {/* Checkbox todo */}
                    <th className="w-10 px-4 py-3.5">
                      <button
                        onClick={toggleAll}
                        className={`
                          w-5 h-5 rounded-md border-2 flex items-center
                          justify-center transition-all duration-200
                          ${allSelected
                            ? "border-pink-500 bg-pink-500"
                            : "border-slate-300 bg-white hover:border-pink-300"
                          }
                        `}
                      >
                        {allSelected && (
                          <Check className="w-3 h-3 text-white" />
                        )}
                      </button>
                    </th>
                    {[
                      "Usuario",
                      "Nombre",
                      "Email",
                      "Rol",
                      "Estado",
                      "Paquete",
                      "Precio/clase",
                      "Clases",
                      "",
                    ].map((h) => (
                      <th
                        key={h}
                        className="text-left text-[10px] font-black
                                     text-slate-400 uppercase tracking-widest
                                     px-3 py-3.5 whitespace-nowrap"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>

                {/* Filas */}
                <tbody className="divide-y divide-slate-50">
                  {filtered.map((row) => (
                    <tr
                      key={row.id}
                      className={`
                        transition-colors duration-150 group
                        ${selectedIds.has(row.id)
                          ? "bg-pink-50/60"
                          : "hover:bg-slate-50/60"
                        }
                        ${row._dirty ? "bg-amber-50/40" : ""}
                      `}
                    >
                      {/* Checkbox */}
                      <td className="px-4 py-2.5">
                        <button
                          onClick={() => toggleSelect(row.id)}
                          className={`
                            w-5 h-5 rounded-md border-2 flex items-center
                            justify-center transition-all duration-200
                            ${selectedIds.has(row.id)
                              ? "border-pink-500 bg-pink-500"
                              : "border-slate-300 bg-white hover:border-pink-300"
                            }
                          `}
                        >
                          {selectedIds.has(row.id) && (
                            <Check className="w-3 h-3 text-white" />
                          )}
                        </button>
                      </td>

                      {/* Username */}
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          {row._dirty && (
                            <div
                              className="w-1.5 h-1.5 bg-amber-400
                                           rounded-full flex-shrink-0"
                            />
                          )}
                          <div>
                            <p className="text-xs font-black text-slate-800">
                              @{row.username}
                            </p>
                            <p className="text-[10px] text-slate-400">
                              ID {row.id}
                            </p>
                          </div>
                        </div>
                      </td>

                      {/* Nombre */}
                      <td className="px-3 py-2.5">
                        <p className="text-xs font-bold text-slate-700">
                          {row.name} {row.surname}
                        </p>
                      </td>

                      {/* Email */}
                      <td className="px-3 py-2.5">
                        <p className="text-xs text-slate-500 truncate max-w-[180px]">
                          {row.email}
                        </p>
                      </td>

                      {/* Rol editable */}
                      <td className="px-3 py-2.5">
                        <SelectCell
                          value={row.role}
                          options={ROLES}
                          dirty={row._dirty && row.role !== row._original.role}
                          onChange={(v) => updateRow(row.id, "role", v)}
                        />
                      </td>

                      {/* Estado editable */}
                      <td className="px-3 py-2.5">
                        <SelectCell
                          value={row.status}
                          options={STATUSES}
                          dirty={
                            row._dirty && row.status !== row._original.status
                          }
                          onChange={(v) => updateRow(row.id, "status", v)}
                        />
                      </td>

                      {/* Paquete editable */}
                      <td className="px-3 py-2.5">
                        <SelectCell
                          value={row.package_name ?? ""}
                          options={["", ...PACKAGES]}
                          dirty={
                            row._dirty &&
                            row.package_name !== row._original.package_name
                          }
                          onChange={(v) =>
                            updateRow(row.id, "package_name", v || null)
                          }
                        />
                      </td>

                      {/* Precio editable */}
                      <td className="px-3 py-2.5">
                        <NumberCell
                          value={row.price_per_class}
                          dirty={
                            row._dirty &&
                            row.price_per_class !==
                              row._original.price_per_class
                          }
                          onChange={(v) =>
                            updateRow(row.id, "price_per_class", v)
                          }
                        />
                      </td>

                      {/* Clases (solo lectura) */}
                      <td className="px-3 py-2.5">
                        <p className="text-xs font-black text-slate-700">
                          {row.classes_used}
                          <span className="text-slate-400 font-bold">
                            /{row.classes_total}
                          </span>
                        </p>
                      </td>

                      {/* Revertir */}
                      <td className="px-3 py-2.5 text-right">
                        {row._dirty && (
                          <button
                            onClick={() => revertRow(row.id)}
                            className="text-xs font-bold text-amber-500
                                         hover:text-amber-700 transition-colors
                                         opacity-0 group-hover:opacity-100"
                          >
                            Revertir
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Footer con resumen */}
          {!loading && filtered.length > 0 && (
            <div
              className="border-t border-slate-100 px-6 py-3 flex items-center
                            justify-between text-xs text-slate-400 font-bold"
            >
              <span>
                {filtered.length} de {rows.length} usuarios
              </span>
              {dirtyRows.length > 0 && (
                <span className="text-amber-500">
                  {dirtyRows.length} cambio
                  {dirtyRows.length !== 1 ? "s" : ""} sin guardar
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}