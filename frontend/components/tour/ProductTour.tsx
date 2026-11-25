"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { TourStep } from "./tourSteps";
import { resolveVisibleTarget, waitForVisibleTarget } from "./resolveTarget";
import { useTourStore } from "./tourStore";

interface Props {
  steps: TourStep[];
  open: boolean;
  onFinish: () => void;
  onSkip: () => void;
}

interface Box { top: number; left: number; width: number; height: number }

const PAD = 8;            // margen del recorte alrededor del elemento
const CARD_W = 352;       // 22rem
const GAP = 14;

const FOCUSABLE = "button:not([disabled])";

/** El panel «Más» solo existe en el diseño móvil (< md = 768px). Sin matchMedia (jsdom) se asume móvil. */
const isMobileLayout = () =>
  typeof window.matchMedia !== "function" || window.matchMedia("(max-width: 767.98px)").matches;

/** Guía del menú: fondo oscuro con recorte sobre el elemento y una tarjeta con «Siguiente / Atrás / Saltar guía». */
export default function ProductTour({ steps, open, onFinish, onSkip }: Props) {
  const setMore = useTourStore((s) => s.setForceMoreOpen);
  const moreOpen = useTourStore((s) => s.forceMoreOpen);
  const [index, setIndex] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [playable, setPlayable] = useState<Set<string>>(new Set());
  const targetRef = useRef<HTMLElement | null>(null);
  const busy = useRef(false);
  const runRef = useRef(0);   // cada recorrido de pasos tiene su id; cerrar la guía lo invalida
  const rootRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const stepsRef = useRef(steps);
  stepsRef.current = steps;

  const measure = useCallback(() => {
    const el = targetRef.current;
    if (!el || !el.isConnected) { setBox(null); return; }
    const r = el.getBoundingClientRect();
    setBox({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, []);

  /** Coloca la guía en el primer paso utilizable desde `from` en la dirección `dir`; null si no hay ninguno. */
  const settle = useCallback(async (from: number, dir: 1 | -1, run: number): Promise<number | null | "cancelled"> => {
    const list = stepsRef.current;
    for (let i = from; i >= 0 && i < list.length; i += dir) {
      const st = list[i];
      if (!st.target) {
        setMore(false);
        targetRef.current = null;
        setBox(null);
        setIndex(i);
        return i;
      }
      // Un ítem de «Más» puede estar ya visible (escritorio, o panel abierto por el paso anterior): no se toca el panel.
      if (!st.more || !isMobileLayout()) setMore(false);
      let el = resolveVisibleTarget(st.target);
      if (!el && st.more && isMobileLayout()) {
        setMore(true);
        el = await waitForVisibleTarget(st.target);
        if (run !== runRef.current) return "cancelled";   // se cerró la guía mientras esperaba: no tocar «Más»
      }
      if (el) {
        targetRef.current = el;
        el.scrollIntoView?.({ block: "nearest", inline: "nearest" });
        setIndex(i);
        measure();
        return i;
      }
      setPlayable((p) => {   // el paso no existe en este menú (p. ej. chat desactivado): deja de contar en «n de N»
        if (!p.has(st.id)) return p;
        const n = new Set(p); n.delete(st.id); return n;
      });
    }
    return null;
  }, [measure, setMore]);

  const go = useCallback(async (from: number, dir: 1 | -1) => {
    if (busy.current) return;
    busy.current = true;
    const run = ++runRef.current;
    try {
      const placed = await settle(from, dir, run);
      if (placed === "cancelled") return;
      if (placed === null && dir === 1) onFinish();
    } finally {
      busy.current = false;
    }
  }, [settle, onFinish]);

  // Foco previo: se captura ANTES de que la tarjeta tome el foco (este efecto va antes que el de «Siguiente»).
  // Mientras la guía está abierta el resto de la página queda `inert`: con un clic en el fondo, Tab ya no entra en el
  // menú. El orden importa: primero se guarda el foco (inert lo sacaría) y al cerrar se quita inert antes de devolverlo.
  useLayoutEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement as HTMLElement | null;
    const root = rootRef.current;
    const inerted: Element[] = [];
    if (root) {
      for (const el of Array.from(document.body.children)) {
        if (el === root || el.contains(root) || el.hasAttribute("inert")) continue;
        el.setAttribute("inert", "");
        inerted.push(el);
      }
    }
    return () => {
      inerted.forEach((el) => el.removeAttribute("inert"));
      previousFocus.current?.focus?.();
    };
  }, [open]);

  // Apertura: cuántos pasos son utilizables (para «n de N») y primer paso.
  useEffect(() => {
    if (!open) return;
    const list = stepsRef.current;
    setPlayable(new Set(list.filter((s) => !s.target || s.more || resolveVisibleTarget(s.target)).map((s) => s.id)));
    const run = runRef;
    void go(0, 1);
    return () => {
      run.current++;             // invalida un recorrido en espera
      busy.current = false;
      setMore(false);
      targetRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Re-mide mientras el panel «Más» termina de animarse y al cambiar el tamaño o el scroll.
  useEffect(() => {
    if (!open) return;
    let raf = 0;
    const until = Date.now() + 450;
    const loop = () => { measure(); if (Date.now() < until) raf = requestAnimationFrame(loop); };
    loop();
    // Al cruzar el corte `md` (girar el móvil) el elemento medido pasa a display:none y el equivalente del otro
    // diseño es otro nodo: se vuelve a resolver el paso en vez de medir un elemento oculto (recorte en -8,-8).
    const relayout = () => {
      const st = stepsRef.current[index];
      const el = targetRef.current;
      if (st?.target && (!el || !el.isConnected || el.getClientRects().length === 0)) { void go(index, 1); return; }
      measure();
    };
    window.addEventListener("resize", relayout);
    window.addEventListener("scroll", measure, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", relayout);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, index, measure, go]);

  useLayoutEffect(() => {
    if (open) nextRef.current?.focus();
  }, [open, index]);

  const next = useCallback(() => void go(index + 1, 1), [go, index]);
  const prev = useCallback(() => void go(index - 1, -1), [go, index]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onSkip(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); next(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); prev(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, next, prev, onSkip]);

  if (!open || typeof document === "undefined") return null;

  const step = steps[index];
  if (!step) return null;
  const isLast = index === steps.length - 1;
  const position = steps.slice(0, index + 1).filter((s) => playable.has(s.id)).length || 1;
  const total = Math.max(playable.size, position);

  // Tarjeta: centrada sin recorte; con «Más» abierto va arriba (el panel ocupa la parte baja); si no, junto al elemento.
  const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
  const vh = typeof window !== "undefined" ? window.innerHeight : 768;
  const cardStyle: React.CSSProperties = { width: `min(92vw, ${CARD_W}px)` };
  if (!box) {
    Object.assign(cardStyle, { top: "50%", left: "50%", transform: "translate(-50%, -50%)" });
  } else if (moreOpen) {
    Object.assign(cardStyle, { top: 16, left: "50%", transform: "translateX(-50%)" });
  } else if (box.top + box.height / 2 > vh / 2) {
    Object.assign(cardStyle, { bottom: vh - box.top + PAD + GAP, left: Math.min(Math.max(12, box.left), vw - CARD_W - 12) });
  } else if (box.left + box.width + GAP + CARD_W < vw) {
    Object.assign(cardStyle, { top: Math.max(12, box.top), left: box.left + box.width + PAD + GAP });
  } else {
    Object.assign(cardStyle, { top: box.top + box.height + PAD + GAP, left: Math.min(Math.max(12, box.left), vw - CARD_W - 12) });
  }

  const trap = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab" || !cardRef.current) return;
    const items = Array.from(cardRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  return createPortal(
    <div ref={rootRef} className="fixed inset-0 z-[80]" data-testid="product-tour">
      {/* Absorbe los clics: durante la guía el menú resaltado no navega. */}
      <div className={`absolute inset-0 ${box ? "" : "bg-slate-900/60"}`} />
      {box && (
        <div
          data-testid="tour-spotlight"
          className="absolute rounded-2xl pointer-events-none ring-2 ring-pink-400 transition-all duration-200 motion-reduce:transition-none"
          style={{
            top: box.top - PAD, left: box.left - PAD, width: box.width + PAD * 2, height: box.height + PAD * 2,
            boxShadow: "0 0 0 9999px rgba(15, 23, 42, 0.6)",
          }}
        />
      )}
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        onKeyDown={trap}
        style={cardStyle}
        className="absolute rounded-2xl bg-white p-5 shadow-2xl shadow-slate-900/30 border border-pink-100"
      >
        <div aria-live="polite">
          <h2 id="tour-title" className="text-base font-black text-slate-800 tracking-tight">{step.title}</h2>
          <p className="mt-1.5 text-sm text-slate-500 leading-relaxed">{step.body}</p>
        </div>
        <div className="mt-4 flex items-center justify-between gap-2">
          <span className="text-[11px] font-bold text-slate-400">{position} de {total}</span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onSkip}
              className="px-3 py-2 text-xs font-bold text-slate-400 hover:text-slate-600 rounded-xl">
              Saltar guía
            </button>
            {index > 0 && (
              <button type="button" onClick={prev}
                className="px-3 py-2 text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl">
                Atrás
              </button>
            )}
            <button ref={nextRef} type="button" onClick={isLast ? onFinish : next}
              className="px-4 py-2 text-xs font-bold text-white rounded-xl bg-gradient-to-r from-pink-500 to-rose-400 hover:from-pink-600 hover:to-rose-500">
              {isLast ? "Terminar" : "Siguiente"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
