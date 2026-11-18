import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  /** Qué no se pudo cargar, en minúsculas y con artículo: «tus clases», «los materiales». */
  what: string;
  onRetry: () => void;
  /** true mientras se reintenta (deshabilita el botón y gira el icono). */
  retrying?: boolean;
}

/**
 * Aviso de que un listado no se pudo cargar, con botón «Reintentar». Hay que mostrarlo ANTES del estado vacío:
 * si la API falla y se pinta «No tienes clases», la persona cree que perdió sus datos.
 */
export default function LoadError({ what, onRetry, retrying = false }: Props) {
  return (
    <div role="alert" className="bg-white/80 rounded-[2rem] border border-rose-100 shadow-sm py-12 px-6 text-center flex flex-col items-center gap-3">
      <div className="w-12 h-12 rounded-full bg-rose-100 flex items-center justify-center">
        <AlertTriangle className="w-6 h-6 text-rose-500" />
      </div>
      <p className="text-sm font-bold text-slate-700">No se pudo cargar {what}</p>
      <p className="text-xs text-slate-400 font-medium">Revisa tu conexión e inténtalo de nuevo. Tus datos no se han perdido.</p>
      <button
        type="button"
        onClick={onRetry}
        disabled={retrying}
        className="inline-flex items-center gap-2 px-4 py-2 bg-rose-50 hover:bg-rose-100 text-rose-600 text-xs font-bold rounded-xl transition-colors disabled:opacity-60"
      >
        <RefreshCw className={`w-3.5 h-3.5 ${retrying ? "animate-spin" : ""}`} /> Reintentar
      </button>
    </div>
  );
}
