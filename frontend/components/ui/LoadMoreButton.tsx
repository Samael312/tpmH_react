import { Loader2 } from "lucide-react";

interface Props {
  hasMore: boolean;
  loading: boolean;
  onClick: () => void;
}

/** Botón «Cargar más» al final de un listado paginado en el servidor. No se pinta si no quedan filas. */
export default function LoadMoreButton({ hasMore, loading, onClick }: Props) {
  if (!hasMore) return null;
  return (
    <div className="p-3 flex justify-center border-t border-slate-100">
      <button
        type="button"
        onClick={onClick}
        disabled={loading}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 disabled:opacity-60 transition-colors"
      >
        {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
        {loading ? "Cargando…" : "Cargar más"}
      </button>
    </div>
  );
}
