/**
 * Una prueba de montaje por CADA `app/**\/page.tsx` y escenario (se descubren solas: una pantalla nueva queda cubierta
 * sin tocar nada). Cada pantalla se monta con el rol de su grupo de rutas y debe, en los tres escenarios:
 *   1. renderizar sin lanzar,
 *   2. dejar contenido visible (o redirigir), nunca una página en blanco,
 *   3. no caer en el ErrorBoundary.
 * Escenarios: "sin datos" (todo vacío), "con datos" (listas pobladas, ver seedRichData) y "API caída" (todo GET da 500).
 * Los flujos concretos (clic, formulario, error de una acción) viven en los demás archivos de esta carpeta.
 */
import { describe, expect, it, vi } from "vitest";
import React from "react";
import { waitFor } from "@testing-library/react";
import { renderScreen, settle, type Role } from "./render";
import { routerState } from "./router";
import { mockApiError } from "./fakeApi";
import { seedRichData } from "./richData";

type PageModule = { default: React.ComponentType<Record<string, unknown>> };
const modules = import.meta.glob<PageModule>("../../app/**/page.tsx");

function roleOf(file: string): Role {
  if (file.includes("/(student)/")) return "student";
  if (file.includes("/(teacher)/")) return "teacher";
  if (file.includes("/(superadmin)/")) return "superadmin";
  return "anon";
}

function routeOf(file: string) {
  const path = file
    .replace("../../app", "")
    .replace(/\/page\.tsx$/, "")
    .replace(/\/\([^)]+\)/g, "");
  return path === "" ? "/" : path;
}

function paramsOf(route: string) {
  const params: Record<string, string> = {};
  for (const m of route.matchAll(/\[([^\]]+)\]/g)) params[m[1]] = "profe";
  return params;
}

/**
 * Pantallas que NO se pueden montar hoy por un bug real (el test se cuelga). Cada una cita el motivo; al corregir el
 * bug, se quita de aquí y el test normal pasa a vigilarla.
 */
const KNOWN_BUGS: Record<string, string> = {}; // ruta → motivo; las rutas aquí se saltan (hoy ninguna: F12 corregido)

type Scenario = { name: string; setup: () => void };
const SCENARIOS: Scenario[] = [
  { name: "sin datos", setup: () => {} },
  { name: "con datos", setup: () => seedRichData() },
  { name: "API caída (500)", setup: () => mockApiError("get", /.*/, 500, "Fallo simulado del servidor") },
];

async function mountAndCheck(Page: PageModule["default"], route: string, role: Role) {
  const errors: string[] = [];
  const spy = vi.spyOn(console, "error").mockImplementation((...a) => {
    errors.push(a.map((x) => (x instanceof Error ? x.message : String(x))).join(" "));
  });

  const props = { params: Promise.resolve(paramsOf(route)), searchParams: Promise.resolve({}) };
  // Las pantallas de servidor (`async function Page`) se ejecutan antes de montar su resultado.
  const isAsync = (Page as unknown as { constructor: { name: string } }).constructor.name === "AsyncFunction";
  const element = isAsync ? await (Page as unknown as (p: typeof props) => Promise<React.ReactElement>)(props) : <Page {...props} />;
  const { container } = renderScreen(element, { role, route, params: paramsOf(route) });

  // Una pantalla puede pintar al instante, tras cargar datos o redirigiendo: damos hasta 2 s a cualquiera de las tres.
  const redirected = () => routerState.router.replace.mock.calls.length + routerState.router.push.mock.calls.length > 0;
  const hasText = () => (container.textContent?.trim().length ?? 0) > 0;
  await waitFor(() => expect(hasText() || redirected()).toBe(true), { timeout: 2000 }).catch(() => undefined);
  await settle();

  spy.mockRestore();
  const fatal = errors.filter((e) => e.includes("The above error occurred") || e.includes("Uncaught"));
  expect(fatal.length, `error al renderizar: ${fatal.map((e) => e.slice(0, 500)).join(" || ")}`).toBe(0);
  expect(hasText() || redirected(), "pantalla en blanco y sin redirección").toBe(true);
  const why = errors.map((e) => e.split("\n")[0]).slice(0, 3).join(" | ");
  expect(container.textContent, `cayó en el ErrorBoundary: ${why}`).not.toMatch(/Algo salió mal|Something went wrong/i);
}

const entries = Object.entries(modules).sort(([a], [b]) => a.localeCompare(b));

describe("pantallas", () => {
  it("encuentra las pantallas del proyecto", () => {
    expect(entries.length).toBeGreaterThanOrEqual(52);
  });

  describe.each(entries)("%s", (file, load) => {
    const route = routeOf(file);
    const role = roleOf(file);
    const known = KNOWN_BUGS[route];
    const run = known ? it.skip : it;

    for (const sc of SCENARIOS) {
      run(`${route} (${role}) · ${sc.name}${known ? ` — BUG CONOCIDO: ${known}` : ""}`, async () => {
        const Page = (await load()).default;
        sc.setup();
        await mountAndCheck(Page, route, role);
      });
    }
  });
});
