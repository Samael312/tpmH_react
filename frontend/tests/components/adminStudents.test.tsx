/**
 * Estudiantes (admin): contadores, búsqueda con espera, detalle expandible (paquetes, materiales, errores),
 * expulsión con motivo obligatorio y paginación.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { screen, waitFor, within } from "@testing-library/react";
import StudentsPage from "@/app/(superadmin)/admin/students/page";
import { renderScreen } from "./render";
import { mockApi, mockApiError, callsTo } from "./fakeApi";

const S = (id: number, over: Record<string, unknown> = {}) => ({
  id, username: `alu${id}`, name: `Nombre${id}`, surname: `Apellido${id}`, email: `a${id}@x.com`, role: "student", is_active: true,
  phone_number: null, nationality: null, created_at: "2026-01-05T12:00:00Z", ...over,
});
const DETAIL = {
  created_at: "2026-01-05T12:00:00Z", goal: "Viajar a Chile", timezone: "America/Caracas", total_completed_classes: 12,
  enrollments: [
    { id: 1, package_name: "Pack 8", subject: "Español", teacher_name: "Ana Prof", classes_used: 3, classes_total: 8, status: "active", created_at: "2026-01-06T00:00:00Z" },
    { id: 2, package_name: "Pack ∞", subject: null, teacher_name: null, classes_used: 1, classes_total: null, status: "completed", created_at: "2026-01-07T00:00:00Z" },
  ],
  materials: [{ id: 1, title: "Gramática A1", category: "Idiomas", progress: "40%", assigned_at: "2026-01-08T00:00:00Z" }],
};

function setup(o: { students?: unknown[]; total?: number; active?: number | null } = {}, extra?: () => void) {
  const students = o.students ?? [S(1), S(2, { is_active: false, nationality: "Chile", phone_number: "+56 9 1" })];
  mockApi("get", /^\/admin\/users/, { total: o.total ?? students.length, active_count: o.active === undefined ? 1 : o.active, users: students });
  mockApi("get", /^\/admin\/students\/\d+\/detail/, DETAIL);
  extra?.();
  const view = renderScreen(<StudentsPage />, { role: "superadmin" });
  return { ...view, user: userEvent.setup() };
}
const SEARCH = "Buscar estudiante por nombre, apellido, email o usuario...";
const rowOf = (name: string) => screen.getByText(name).closest("div[class*='border']") as HTMLElement;

afterEach(() => { vi.restoreAllMocks(); });

describe("Admin · estudiantes · lista", () => {
  it("lista a los estudiantes con su estado, teléfono y nacionalidad", async () => {
    setup();
    expect(await screen.findByText("Nombre1 Apellido1")).toBeInTheDocument();
    expect(screen.getByText("@alu1")).toBeInTheDocument();
    expect(screen.getByText("Inactivo")).toBeInTheDocument();
    expect(screen.getByText("+56 9 1")).toBeInTheDocument();
    expect(screen.getByText(/Chile/)).toBeInTheDocument();
  });

  it("los contadores usan el total y los activos del servidor", async () => {
    setup({ total: 40, active: 30 });
    await screen.findByText("Nombre1 Apellido1");
    expect(screen.getByText("40")).toBeInTheDocument();
    expect(screen.getByText("30")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
  });

  it("sin dato de activos del servidor los cuenta de la lista visible", async () => {
    setup({ total: 2, active: null });
    await screen.findByText("Nombre1 Apellido1");
    expect(screen.getAllByText("1").length).toBeGreaterThan(0);
  });

  it("sin estudiantes lo dice", async () => {
    setup({ students: [], total: 0, active: 0 });
    expect(await screen.findByText("Aún no hay estudiantes registrados")).toBeInTheDocument();
  });

  it("si falla la carga ofrece reintentar", async () => {
    const { user } = setup({}, () => mockApiError("get", /^\/admin\/users/, 500, "x"));
    const retry = await screen.findByRole("button", { name: /Reintentar/ });
    const before = callsTo("get", /^\/admin\/users/).length;
    await user.click(retry);
    await waitFor(() => expect(callsTo("get", /^\/admin\/users/).length).toBeGreaterThan(before));
  });

  it("enlaza a la lista de baneados", async () => {
    setup();
    await screen.findByText("Nombre1 Apellido1");
    expect(screen.getAllByRole("link").some((a) => a.getAttribute("href") === "/admin/students/banned")).toBe(true);
  });

  it("con más páginas «Cargar más» pide el siguiente bloque", async () => {
    const { user } = setup({ students: [S(1)], total: 250 });
    await screen.findByText("Nombre1 Apellido1");
    await user.click(await screen.findByRole("button", { name: "Cargar más" }));
    await waitFor(() => expect(callsTo("get", /^\/admin\/users/).some((c) => Number((c.params as { skip?: number } | undefined)?.skip ?? 0) > 0)).toBe(true));
  });
});

describe("Admin · estudiantes · búsqueda", () => {
  it("espera a que pares de escribir y manda el término", async () => {
    const { user } = setup();
    await screen.findByText("Nombre1 Apellido1");
    await user.type(screen.getByPlaceholderText(SEARCH), "ana");
    await waitFor(() => expect(callsTo("get", /^\/admin\/users/).some((c) => JSON.stringify(c.params ?? "") .includes("ana") || String(c.url).includes("search=ana"))).toBe(true), { timeout: 3000 });
  });

  it("sin resultados dice que no hay coincidencias y la X limpia la búsqueda", async () => {
    const { user } = setup({}, () => mockApi("get", /^\/admin\/users/, (r: { params?: Record<string, unknown> }) => {
      const q = String(r.params?.search ?? "");
      return { total: q ? 0 : 1, active_count: 0, users: q ? [] : [S(1)] };
    }));
    await screen.findByText("Nombre1 Apellido1");
    const input = screen.getByPlaceholderText(SEARCH);
    await user.type(input, "zzz");
    expect(await screen.findByText("No se encontraron estudiantes para la búsqueda", {}, { timeout: 3000 })).toBeInTheDocument();
    const box = input.parentElement as HTMLElement;
    await user.click(within(box).getByRole("button"));
    expect(input).toHaveValue("");
  });
});

describe("Admin · estudiantes · detalle", () => {
  it("al abrir una fila muestra registro, objetivo, clases, paquetes y materiales", async () => {
    const { user } = setup();
    await screen.findByText("Nombre1 Apellido1");
    const toggles = screen.getAllByRole("button").filter((b) => b.querySelector("svg") && !/Expulsar/.test(b.textContent ?? ""));
    await user.click(toggles.find((b) => within(rowOf("Nombre1 Apellido1")).queryAllByRole("button").includes(b))!);
    expect(await screen.findByText(/Registrado el/)).toBeInTheDocument();
    expect(screen.getByText("Viajar a Chile")).toBeInTheDocument();
    expect(screen.getByText(/12 clases completadas en total/)).toBeInTheDocument();
    expect(screen.getByText(/Español · con Ana Prof · 3\/8/)).toBeInTheDocument();
    expect(screen.getByText(/Sin materia · con profesor desconocido · 1\//)).toBeInTheDocument();
    expect(screen.getByText(/Materiales asignados \(1\)/)).toBeInTheDocument();
    expect(screen.getByText("Gramática A1")).toBeInTheDocument();
  });

  it("si el detalle falla ofrece reintentar", async () => {
    const { user } = setup({}, () => mockApiError("get", /^\/admin\/students\/\d+\/detail/, 500, "x"));
    await screen.findByText("Nombre1 Apellido1");
    const row = rowOf("Nombre1 Apellido1");
    const buttons = within(row).getAllByRole("button");
    await user.click(buttons[buttons.length - 1]);
    expect(await screen.findAllByRole("button", { name: /Reintentar/ })).not.toHaveLength(0);
  });

  it("un detalle vacío muestra los textos de «sin datos»", async () => {
    const { user } = setup({}, () => mockApi("get", /^\/admin\/students\/\d+\/detail/, { ...DETAIL, goal: null, enrollments: [], materials: [], total_completed_classes: 0 }));
    await screen.findByText("Nombre1 Apellido1");
    const buttons = within(rowOf("Nombre1 Apellido1")).getAllByRole("button");
    await user.click(buttons[buttons.length - 1]);
    expect(await screen.findByText(/0 clases completadas en total/)).toBeInTheDocument();
    expect(screen.getByText(/Materiales asignados \(0\)/)).toBeInTheDocument();
  });
});

describe("Admin · estudiantes · expulsar", () => {
  const openBan = async (user: ReturnType<typeof userEvent.setup>) => {
    await screen.findByText("Nombre1 Apellido1");
    await user.click(within(rowOf("Nombre1 Apellido1")).getByRole("button", { name: /Expulsar/ }));
    return screen.findByPlaceholderText("Describe el motivo...");
  };

  it("sin motivo no expulsa y lo pide", async () => {
    const { user } = setup();
    await openBan(user);
    await user.click(screen.getAllByRole("button", { name: /Expulsar/ }).at(-1)!);
    expect(await screen.findByText("Debes indicar el motivo de la expulsión")).toBeInTheDocument();
    expect(callsTo("post", /ban/)).toHaveLength(0);
  });

  it("con motivo expulsa y avisa", async () => {
    mockApi("post", "/admin/students/1/ban", {});
    const { user } = setup();
    await user.type(await openBan(user), "  Fraude con pagos  ");
    await user.click(screen.getAllByRole("button", { name: /Expulsar/ }).at(-1)!);
    await waitFor(() => expect(callsTo("post", "/admin/students/1/ban")).toHaveLength(1));
    expect(callsTo("post", "/admin/students/1/ban")[0].body).toEqual({ reason: "Fraude con pagos" });
    expect(await screen.findByText("Estudiante expulsado correctamente")).toBeInTheDocument();
  });

  it("un error del servidor se muestra en el modal", async () => {
    mockApiError("post", "/admin/students/1/ban", 400, "Ya está expulsado");
    const { user } = setup();
    await user.type(await openBan(user), "Motivo");
    await user.click(screen.getAllByRole("button", { name: /Expulsar/ }).at(-1)!);
    expect(await screen.findByText("Ya está expulsado")).toBeInTheDocument();
  });

  it("«Cancelar» cierra el modal sin llamar al servidor", async () => {
    const { user } = setup();
    await openBan(user);
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByPlaceholderText("Describe el motivo...")).not.toBeInTheDocument());
    expect(callsTo("post", /ban/)).toHaveLength(0);
  });
});
