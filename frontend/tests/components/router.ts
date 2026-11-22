import { vi } from "vitest";

/** Estado del router simulado. Cada test lo ajusta con `setRoute` y mira `routerState.router.push/replace`. */
export const routerState = {
  pathname: "/",
  params: {} as Record<string, string>,
  searchParams: new URLSearchParams(),
  router: {
    push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(),
  },
};

export function setRoute(pathname: string, opts: { params?: Record<string, string>; search?: string } = {}) {
  routerState.pathname = pathname;
  routerState.params = opts.params ?? {};
  routerState.searchParams = new URLSearchParams(opts.search ?? "");
}

export function resetRouter() {
  routerState.pathname = "/";
  routerState.params = {};
  routerState.searchParams = new URLSearchParams();
  for (const fn of Object.values(routerState.router)) (fn as ReturnType<typeof vi.fn>).mockClear();
}
