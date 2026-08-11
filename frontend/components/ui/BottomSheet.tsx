"use client";

import { X } from "lucide-react";
import { useEffect } from "react";

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}

export default function BottomSheet({ open, onClose, title, children }: BottomSheetProps) {
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center">
      <div
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-200"
        onClick={onClose}
      />
      <div
        className="relative w-full sm:max-w-lg bg-white rounded-t-[2rem] sm:rounded-[2rem] shadow-2xl
                   animate-in slide-in-from-bottom duration-300 max-h-[85vh] overflow-y-auto"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="sticky top-0 bg-white/95 backdrop-blur-md flex items-center justify-between px-5 py-4 border-b border-slate-100 rounded-t-[2rem] z-10">
          <div className="w-9 h-1 bg-slate-200 rounded-full absolute left-1/2 -translate-x-1/2 top-2 sm:hidden" />
          {title ? <h2 className="text-sm font-black text-slate-800 mt-2">{title}</h2> : <span />}
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors mt-2"
          >
            <X className="w-4 h-4 text-slate-500" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}