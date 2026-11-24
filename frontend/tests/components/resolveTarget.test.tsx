import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveVisibleTarget, waitForVisibleTarget } from "@/components/tour/resolveTarget";

/** jsdom no maqueta: devuelve siempre [] en getClientRects. Se simula por elemento. */
function el(visible: boolean, tour = "x"): HTMLElement {
  const e = document.createElement("div");
  e.setAttribute("data-tour", tour);
  e.getClientRects = (() => (visible ? [{}] : [])) as unknown as () => DOMRectList;
  document.body.appendChild(e);
  return e;
}

afterEach(() => { document.body.innerHTML = ""; vi.useRealTimers(); });

describe("resolveVisibleTarget", () => {
  it("elige el visible aunque el oculto aparezca primero (sidebar y pestañas comparten data-tour)", () => {
    el(false); const shown = el(true);
    expect(resolveVisibleTarget('[data-tour="x"]')).toBe(shown);
  });
  it("sin visibles devuelve null", () => {
    el(false);
    expect(resolveVisibleTarget('[data-tour="x"]')).toBeNull();
    expect(resolveVisibleTarget('[data-tour="nada"]')).toBeNull();
  });
});

describe("waitForVisibleTarget", () => {
  it("resuelve cuando el elemento aparece a mitad de la espera", async () => {
    vi.useFakeTimers();
    const p = waitForVisibleTarget('[data-tour="x"]', 600);
    setTimeout(() => el(true), 100);
    await vi.advanceTimersByTimeAsync(300);
    expect(await p).not.toBeNull();
  });
  it("devuelve null si nunca aparece", async () => {
    vi.useFakeTimers();
    const p = waitForVisibleTarget('[data-tour="x"]', 600);
    await vi.advanceTimersByTimeAsync(800);
    expect(await p).toBeNull();
  });
});
