import React from "react";
import { render, act, type RenderResult } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore } from "@/store/authStore";
import { MobileTopBarProvider } from "@/lib/mobileTopBar";
import Toaster from "@/components/ui/Toast";
import ErrorBoundary from "@/components/ErrorBoundary";
import { makeUser } from "./fakeApi";
import { setRoute } from "./router";

export type Role = "student" | "teacher" | "teacher_admin" | "superadmin" | "anon";

/** Deja el store de sesión como si `role` hubiera iniciado sesión (o sin sesión con "anon"). */
export function signIn(role: Role) {
  useAuthStore.setState({
    user: role === "anon" ? null : (makeUser(role) as never),
    isLoading: false,
    hasHydrated: true,
  });
}

export function newQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 }, mutations: { retry: false } } });
}

interface Opts {
  role?: Role;
  route?: string;
  params?: Record<string, string>;
  search?: string;
}

/** Monta `ui` con React Query, sesión y ruta simuladas. */
export function renderScreen(ui: React.ReactElement, { role = "student", route = "/", params, search }: Opts = {}): RenderResult {
  signIn(role);
  setRoute(route, { params, search });
  const qc = newQueryClient();
  // Mismo árbol que app/providers.tsx, con un QueryClient sin reintentos ni caché.
  return render(
    <QueryClientProvider client={qc}>
      <ErrorBoundary>
        <MobileTopBarProvider>{ui}</MobileTopBarProvider>
      </ErrorBoundary>
      <Toaster />
    </QueryClientProvider>,
  );
}

/** Espera a que terminen las peticiones y renders pendientes (microtareas + un tick de timers cortos). */
export async function settle(ms = 30) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}
