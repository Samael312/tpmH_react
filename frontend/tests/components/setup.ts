/* eslint-disable @typescript-eslint/no-unused-vars -- stubs de mocks: conservan la firma de los componentes reales */
import "@testing-library/jest-dom/vitest";
import React from "react";
import { afterEach, beforeEach, vi } from "vitest";
import { cleanup, configure } from "@testing-library/react";
import { fakeApi, resetApi, FIXTURE } from "./fakeApi";
import { LANDING_CONTENT_DEFAULTS } from "@/hooks/useLandingData";
import { routerState, resetRouter } from "./router";
import { useToastStore } from "@/store/toastStore";

// Con ~1000 tests en paralelo, la espera por defecto (1 s) de findBy*/waitFor dejaba tests intermitentes.
configure({ asyncUtilTimeout: 4000 });

// ── Sin red: todo `api` sale del arnés ───────────────────────────────────────
vi.mock("@/lib/api", () => ({
  default: fakeApi,
  refreshSession: () => Promise.resolve(),
}));

// ── Router de Next (app router) ──────────────────────────────────────────────
vi.mock("next/navigation", () => ({
  useRouter: () => routerState.router,
  usePathname: () => routerState.pathname,
  useSearchParams: () => routerState.searchParams,
  useParams: () => routerState.params,
  redirect: (to: string) => { routerState.router.replace(to); },
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
}));

// next/link e image necesitan el runtime de Next: se sustituyen por <a>/<img> equivalentes.
vi.mock("next/link", () => ({
  default: ({ href, children, prefetch: _p, replace: _r, scroll: _s, ...rest }: Record<string, unknown> & { href: unknown; children?: React.ReactNode }) =>
    React.createElement("a", { href: typeof href === "string" ? href : String((href as { pathname?: string })?.pathname ?? ""), ...rest }, children),
}));
vi.mock("next/image", () => ({
  default: ({ src, alt, fill: _f, priority: _p, unoptimized: _u, loader: _l, quality: _q, placeholder: _ph, blurDataURL: _b, ...rest }: Record<string, unknown>) =>
    React.createElement("img", { src: typeof src === "string" ? src : (src as { src?: string })?.src ?? "", alt: (alt as string) ?? "", ...rest }),
}));
vi.mock("next/dynamic", () => ({
  default: () => () => null,
}));

// La configuración de la plataforma incluye el contenido de la landing, con los mismos valores por defecto de la app.
FIXTURE.platformConfig.landing_content = { ...LANDING_CONTENT_DEFAULTS };

// ── APIs del navegador que jsdom no trae ─────────────────────────────────────
class NoopObserver { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }
Object.assign(globalThis, { ResizeObserver: NoopObserver, IntersectionObserver: NoopObserver });
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (q: string) => ({
    matches: false, media: q, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
  }),
});
window.scrollTo = () => {};
Element.prototype.scrollTo = () => {};
Element.prototype.scrollIntoView = () => {};
URL.createObjectURL = () => "blob:test";
URL.revokeObjectURL = () => {};
HTMLMediaElement.prototype.play = () => Promise.resolve();
HTMLMediaElement.prototype.pause = () => {};
window.confirm = () => true;
window.prompt = () => "";
window.open = () => null;
// WebSocket del chat: un cliente inerte.
class FakeWS {
  static OPEN = 1; readyState = 0; onopen = null; onclose = null; onmessage = null; onerror = null;
  constructor(public url: string) {}
  send() {} close() {} addEventListener() {} removeEventListener() {}
}
Object.assign(globalThis, { WebSocket: FakeWS });

beforeEach(() => {
  resetApi();
  resetRouter();
  useToastStore.getState().clear(); // los toasts viven en un store global: no deben filtrarse al test siguiente
  try { localStorage.clear(); sessionStorage.clear(); } catch { /* sin storage */ }
});
afterEach(() => { cleanup(); vi.clearAllTimers(); });
