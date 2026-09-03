"use client";

import { ElementType, ReactNode } from "react";
import { useRevealOnScroll } from "@/hooks/useRevealOnScroll";

interface RevealProps {
  children: ReactNode;
  /** Retraso en ms antes de reproducir la animación (para escalonar tarjetas de un grid). */
  delay?: number;
  className?: string;
  as?: ElementType;
}

/**
 * Envuelve contenido de la landing page para que aparezca con un
 * "pop-in" (la animación ya definida en tailwind.config.ts) la primera
 * vez que entra en el viewport, en vez de estar ahí desde el primer
 * pintado. Respeta prefers-reduced-motion (ver useRevealOnScroll) y no
 * repite la animación si el usuario vuelve a scrollear sobre la sección.
 */
export default function Reveal({ children, delay = 0, className = "", as: Tag = "div" }: RevealProps) {
  const { ref, isVisible } = useRevealOnScroll<HTMLDivElement>();

  return (
    <Tag
      ref={ref}
      className={`${isVisible ? "animate-pop-in" : "opacity-0"} ${className}`}
      style={isVisible && delay ? { animationDelay: `${delay}ms` } : undefined}
    >
      {children}
    </Tag>
  );
}
