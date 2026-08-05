"use client";

import { useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface CarouselProps {
  children: React.ReactNode;
  ariaLabel?: string;
}

export default function Carousel({ children, ariaLabel }: CarouselProps) {
  const trackRef = useRef<HTMLDivElement>(null);

  const scroll = (dir: 1 | -1) => {
    const el = trackRef.current;
    if (!el) return;
    const amount = Math.min(el.clientWidth * 0.85, 420);
    el.scrollBy({ left: dir * amount, behavior: "smooth" });
  };

  return (
    <div className="relative group/carousel">
      <div
        ref={trackRef}
        role="list"
        aria-label={ariaLabel}
        className="flex gap-5 overflow-x-auto scroll-smooth snap-x snap-mandatory pb-2 -mx-4 px-4 sm:mx-0 sm:px-1 [&::-webkit-scrollbar]:hidden"
        style={{ scrollbarWidth: "none" }}
      >
        {children}
      </div>

      <button
        type="button"
        onClick={() => scroll(-1)}
        aria-label="Anterior"
        className="hidden sm:flex absolute -left-4 top-1/2 -translate-y-1/2 w-10 h-10 items-center justify-center rounded-full bg-white shadow-lg shadow-slate-200/70 border border-slate-100 text-slate-600 hover:text-pink-600 hover:border-pink-200 transition-all opacity-0 group-hover/carousel:opacity-100 z-10"
      >
        <ChevronLeft className="w-5 h-5" />
      </button>
      <button
        type="button"
        onClick={() => scroll(1)}
        aria-label="Siguiente"
        className="hidden sm:flex absolute -right-4 top-1/2 -translate-y-1/2 w-10 h-10 items-center justify-center rounded-full bg-white shadow-lg shadow-slate-200/70 border border-slate-100 text-slate-600 hover:text-pink-600 hover:border-pink-200 transition-all opacity-0 group-hover/carousel:opacity-100 z-10"
      >
        <ChevronRight className="w-5 h-5" />
      </button>
    </div>
  );
}