"use client";

import { RefreshCw } from "lucide-react";

interface RefreshButtonProps {
  onRefresh: () => void | Promise<unknown>;
  isFetching?: boolean;
  className?: string;
}

export default function RefreshButton({
  onRefresh,
  isFetching = false,
  className = "",
}: RefreshButtonProps) {
  return (
    <button
      onClick={() => onRefresh()}
      disabled={isFetching}
      title="Actualizar"
      aria-label="Actualizar datos"
      className={`w-9 h-9 rounded-xl bg-white border border-slate-200 flex items-center justify-center
                  shadow-sm hover:bg-slate-50 hover:border-pink-200 transition-colors
                  disabled:opacity-60 disabled:cursor-not-allowed flex-shrink-0 ${className}`}
    >
      <RefreshCw className={`w-4 h-4 text-slate-600 ${isFetching ? "animate-spin" : ""}`} />
    </button>
  );
}