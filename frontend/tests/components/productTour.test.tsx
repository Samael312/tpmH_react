import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import ProductTour from "@/components/tour/ProductTour";
import { useTourStore } from "@/components/tour/tourStore";
import type { TourStep } from "@/components/tour/tourSteps";

/** jsdom no maqueta: se simula visibilidad y caja por elemento. */
function el(tour: string, visible = true, box = { top: 100, left: 50, width: 80, height: 40 }): HTMLElement {
  const e = document.createElement("button");
  e.setAttribute("data-tour", tour);
  e.getClientRects = (() => (visible ? [{}] : [])) as unknown as () => DOMRectList;
  e.getBoundingClientRect = () => ({ ...box, right: box.left + box.width, bottom: box.top + box.height, x: box.left, y: box.top, toJSON() {} }) as DOMRect;
  document.body.appendChild(e);
  return e;
}
const sel = (t: string) => `[data-tour="${t}"]`;
const STEPS: TourStep[] = [
  { id: "w", target: null, title: "Bienvenida", body: "Hola" },
  { id: "a", target: sel("a"), title: "Opción A", body: "Sirve para A" },
  { id: "b", target: sel("b"), title: "Opción B", body: "Sirve para B" },
  { id: "e", target: null, title: "Cierre", body: "Fin" },
];
const setup = (steps = STEPS, open = true) => {
  const onFinish = vi.fn(), onSkip = vi.fn();
  const ui = (o: boolean) => <ProductTour steps={steps} open={o} onFinish={onFinish} onSkip={onSkip} />;
  const r = render(ui(open));
  return { ...r, onFinish, onSkip, user: userEvent.setup(), reopen: (o: boolean) => r.rerender(ui(o)) };
};

const originalMatchMedia = window.matchMedia;
/** El setup de jsdom simula escritorio (matches:false); estos tests ejercitan el diseño móvil, donde existe «Más». */
const asMobile = () => {
  window.matchMedia = ((q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} })) as never;
};

beforeEach(() => { el("a"); el("b"); });
afterEach(() => {
  window.matchMedia = originalMatchMedia;
  document.querySelectorAll("[data-tour], [data-opener]").forEach((n) => n.remove());   // no vaciar body: RTL aún desmonta
  useTourStore.setState({ forceMoreOpen: false });
});

describe("ProductTour", () => {
  it("open=false no renderiza nada", () => {
    setup(STEPS, false);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("avanza y retrocede, con contador «n de N»", async () => {
    const { user } = setup();
    expect(await screen.findByText("Bienvenida")).toBeInTheDocument();
    expect(screen.getByText("1 de 4")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Siguiente" }));
    expect(await screen.findByText("Opción A")).toBeInTheDocument();
    expect(screen.getByText("2 de 4")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Atrás" }));
    expect(await screen.findByText("Bienvenida")).toBeInTheDocument();
  });

  it("«Saltar guía» y Esc llaman onSkip", async () => {
    const a = setup();
    await a.user.click(await screen.findByRole("button", { name: "Saltar guía" }));
    expect(a.onSkip).toHaveBeenCalledTimes(1);
    a.unmount();
    const b = setup();
    await screen.findByText("Bienvenida");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(b.onSkip).toHaveBeenCalledTimes(1);
  });

  it("las flechas navegan", async () => {
    setup();
    await screen.findByText("Bienvenida");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(await screen.findByText("Opción A")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(await screen.findByText("Bienvenida")).toBeInTheDocument();
  });

  it("en el último paso el botón es «Terminar» y llama onFinish", async () => {
    const { user, onFinish } = setup();
    for (let i = 0; i < 3; i++) await user.click(await screen.findByRole("button", { name: "Siguiente" }));
    await user.click(await screen.findByRole("button", { name: "Terminar" }));
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("omite un paso cuyo elemento no existe", async () => {
    document.querySelector(sel("a"))!.remove();
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: "Siguiente" }));
    expect(await screen.findByText("Opción B")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Atrás" }));   // al volver también salta la A ausente
    expect(await screen.findByText("Bienvenida")).toBeInTheDocument();
  });

  it("si faltan todos los targets solo quedan bienvenida y cierre, y termina sin lanzar", async () => {
    document.querySelectorAll("[data-tour]").forEach((n) => n.remove());
    const { user, onFinish } = setup();
    expect(await screen.findByText("1 de 2")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Siguiente" }));
    await user.click(await screen.findByRole("button", { name: "Terminar" }));
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("elige el elemento visible entre dos con el mismo data-tour", async () => {
    document.querySelectorAll("[data-tour]").forEach((n) => n.remove());
    el("a", false, { top: 900, left: 900, width: 10, height: 10 });
    el("a", true, { top: 100, left: 50, width: 80, height: 40 });
    const { user } = setup(STEPS.slice(0, 2));
    await user.click(await screen.findByRole("button", { name: "Siguiente" }));
    const spot = await screen.findByTestId("tour-spotlight");
    await waitFor(() => expect(spot.style.top).toBe("92px"));   // 100 - 8 de margen: el visible, no el oculto
    expect(spot.style.left).toBe("42px");
  });

  it("paso «Más»: abre el panel, no lo omite y lo cierra al salir", async () => {
    asMobile();
    document.querySelectorAll("[data-tour]").forEach((n) => n.remove());
    const steps: TourStep[] = [STEPS[0], { id: "m", target: sel("m"), title: "En Más", body: "x", more: true }, STEPS[3]];
    const unsub = useTourStore.subscribe((s) => {
      if (s.forceMoreOpen && !document.querySelector(sel("m"))) el("m");
    });
    const { user } = setup(steps);
    await user.click(await screen.findByRole("button", { name: "Siguiente" }));
    expect(await screen.findByText("En Más")).toBeInTheDocument();
    expect(useTourStore.getState().forceMoreOpen).toBe(true);
    await user.click(screen.getByRole("button", { name: "Siguiente" }));
    await screen.findByText("Cierre");
    expect(useTourStore.getState().forceMoreOpen).toBe(false);
    unsub();
  });

  it("cerrar la guía deja «Más» cerrado", async () => {
    asMobile();
    document.querySelectorAll("[data-tour]").forEach((n) => n.remove());
    const steps: TourStep[] = [STEPS[0], { id: "m", target: sel("m"), title: "En Más", body: "x", more: true }, STEPS[3]];
    const unsub = useTourStore.subscribe((s) => { if (s.forceMoreOpen && !document.querySelector(sel("m"))) el("m"); });
    const { user, reopen } = setup(steps);
    await user.click(await screen.findByRole("button", { name: "Siguiente" }));
    await screen.findByText("En Más");
    act(() => reopen(false));
    expect(useTourStore.getState().forceMoreOpen).toBe(false);
    unsub();
  });

  it("accesibilidad: diálogo modal, foco inicial en «Siguiente» y Tab cicla dentro de la tarjeta", async () => {
    const { user } = setup();
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    const next = screen.getByRole("button", { name: "Siguiente" });
    await waitFor(() => expect(next).toHaveFocus());
    await user.tab();                       // de «Siguiente» (último botón) vuelve al primero de la tarjeta
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.tab(); await user.tab(); await user.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("al cerrar devuelve el foco al elemento previo", async () => {
    const opener = document.createElement("button");
    opener.setAttribute("data-opener", "1");
    document.body.appendChild(opener);
    opener.focus();
    const { reopen } = setup();
    await screen.findByRole("dialog");
    act(() => reopen(false));
    expect(opener).toHaveFocus();
  });

  it("escritorio: un paso «Más» sin elemento NO abre el panel móvil y se omite", async () => {
    document.querySelectorAll("[data-tour]").forEach((n) => n.remove());
    const mm = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never;
    const opened: boolean[] = [];
    const unsub = useTourStore.subscribe((st) => opened.push(st.forceMoreOpen));
    const steps: TourStep[] = [STEPS[0], { id: "m", target: sel("m"), title: "En Más", body: "x", more: true }, STEPS[3]];
    const { user } = setup(steps);
    await user.click(await screen.findByRole("button", { name: "Siguiente" }));
    await screen.findByText("Cierre");
    expect(opened).not.toContain(true);
    unsub();
    window.matchMedia = mm;
  });

  it("saltar a mitad de la espera de un paso «Más» no deja el panel abierto", async () => {
    asMobile();
    document.querySelectorAll("[data-tour]").forEach((n) => n.remove());
    const steps: TourStep[] = [
      STEPS[0],
      { id: "m1", target: sel("m1"), title: "M1", body: "x", more: true },
      { id: "m2", target: sel("m2"), title: "M2", body: "x", more: true },
      STEPS[3],
    ];
    const { reopen } = setup(steps);
    await screen.findByText("Bienvenida");
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));      // empieza a esperar m1 (no existe)
    await waitFor(() => expect(useTourStore.getState().forceMoreOpen).toBe(true));
    act(() => reopen(false));                                                 // el anfitrión cierra al saltar
    await new Promise((r) => setTimeout(r, 900));                             // m1 terminó de esperar: sin el arreglo seguiría con m2 y reabriría «Más»
    expect(useTourStore.getState().forceMoreOpen).toBe(false);
  });

  it("el contador se corrige cuando un paso «Más» resulta no existir", async () => {
    asMobile();
    document.querySelectorAll("[data-tour]").forEach((n) => n.remove());
    const steps: TourStep[] = [STEPS[0], { id: "m", target: sel("m"), title: "M", body: "x", more: true }, STEPS[3]];
    const { user } = setup(steps);
    expect(await screen.findByText("1 de 3")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Siguiente" }));
    expect(await screen.findByText("2 de 2")).toBeInTheDocument();           // el paso ausente ya no cuenta
  });
});
