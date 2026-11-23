/**
 * Edición masiva de usuarios · cierra huecos: página anterior, aviso de búsqueda con varias páginas, limpiar la búsqueda
 * con la X, nacionalidad editable y en lote, cerrar el cambio en lote, descartar el aviso de error y reintentar.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { screen, waitFor, within } from "@testing-library/react";
import UsersPage from "@/app/(superadmin)/admin/users/page";
import { renderScreen } from "./render";
import { mockApi, mockApiError, callsTo } from "./fakeApi";

const U = (id: number, over: Record<string, unknown> = {}) => ({
  id, username: `user${id}`, name: `Nombre${id}`, surname: `Apellido${id}`, email: `u${id}@x.com`, role: "student", is_active: true,
  phone_number: "", nationality: "", classes_used: 1, classes_total: 8, ...over,
});
function setup(users: unknown[] = [U(1), U(2, { role: "teacher", nationality: "Chile" })], total?: number) {
  mockApi("get", /^\/admin\/users/, { total: total ?? users.length, users });
  const view = renderScreen(<UsersPage />, { role: "superadmin" });
  return { ...view, user: userEvent.setup() };
}
const rowOf = (name: string) => screen.getByText(name).closest("tr") as HTMLElement;
const SEARCH = "Buscar usuario, email, teléfono o país...";

afterEach(() => { vi.restoreAllMocks(); });

describe("Admin · usuarios · paginación y búsqueda", () => {
  it("«Anterior» vuelve a la página previa", async () => {
    const { user } = setup([U(1)], 250);
    await screen.findByText("Nombre1 Apellido1");
    await user.click(await screen.findByRole("button", { name: "Siguiente" }));
    await waitFor(() => expect(callsTo("get", /^\/admin\/users/).some((c) => String(c.url).includes("skip=100"))).toBe(true));
    await user.click(await screen.findByRole("button", { name: "Anterior" }));
    await waitFor(() => expect(callsTo("get", /^\/admin\/users/).filter((c) => String(c.url).includes("skip=0")).length).toBeGreaterThan(1));
  });

  it("con varias páginas, buscar avisa que solo filtra la página actual", async () => {
    const { user } = setup([U(1)], 250);
    await screen.findByText("Nombre1 Apellido1");
    await user.type(screen.getByPlaceholderText(SEARCH), "nombre");
    expect(await screen.findByText(/La búsqueda solo filtra dentro de la página actual/)).toBeInTheDocument();
  });

  it("la X del buscador lo vacía", async () => {
    const { user } = setup();
    await screen.findByText("Nombre1 Apellido1");
    const input = screen.getByPlaceholderText(SEARCH) as HTMLInputElement;
    await user.type(input, "chile");
    await user.click(input.parentElement!.querySelector("button") as HTMLElement);
    expect(input.value).toBe("");
  });

  it("Reintentar vuelve a pedir la lista", async () => {
    mockApiError("get", /^\/admin\/users/, 500, "x");
    const view = renderScreen(<UsersPage />, { role: "superadmin" });
    const user = userEvent.setup();
    const retry = await screen.findByRole("button", { name: /Reintentar/ });
    mockApi("get", /^\/admin\/users/, { total: 1, users: [U(1)] });
    await user.click(retry);
    expect(await screen.findByText("Nombre1 Apellido1")).toBeInTheDocument();
    view.unmount();
  });
});

describe("Admin · usuarios · nacionalidad y cambio en lote", () => {
  it("editar la nacionalidad de una fila la marca como modificada y se envía", async () => {
    mockApi("patch", "/admin/users/1", {});
    const { user } = setup();
    await screen.findByText("Nombre1 Apellido1");
    await user.type(within(rowOf("Nombre1 Apellido1")).getByPlaceholderText("España"), "Perú");
    await user.click(screen.getAllByRole("button", { name: /Guardar Todo/ }).at(-1)!);
    await waitFor(() => expect(callsTo("patch", "/admin/users/1")).toHaveLength(1));
    expect(callsTo("patch", "/admin/users/1")[0].body).toMatchObject({ nationality: "Perú" });
  });

  it("el lote de nacionalidad usa el texto libre y la X cierra el panel", async () => {
    const { user } = setup();
    await screen.findByText("Nombre1 Apellido1");
    await user.click(within(rowOf("Nombre1 Apellido1")).getByRole("checkbox"));
    await user.click(await screen.findByRole("button", { name: /Cambiar valor en lote/ }));
    await user.selectOptions(screen.getByRole("option", { name: "Seleccionar campo..." }).closest("select")!, "nationality");
    const box = screen.getAllByPlaceholderText("España")[0] as HTMLInputElement;
    await user.type(box, "Ecuador");
    await user.click(screen.getByRole("button", { name: "Aplicar" }));
    expect(await screen.findByDisplayValue("Ecuador")).toBeInTheDocument();
  });

  it("la X del panel de cambio en lote lo cierra sin aplicar nada", async () => {
    const { user } = setup();
    await screen.findByText("Nombre1 Apellido1");
    await user.click(within(rowOf("Nombre1 Apellido1")).getByRole("checkbox"));
    await user.click(await screen.findByRole("button", { name: /Cambiar valor en lote/ }));
    const apply = await screen.findByRole("button", { name: "Aplicar" });
    await user.click(apply.parentElement!.querySelector("button:last-of-type") as HTMLElement);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Aplicar" })).not.toBeInTheDocument());
  });
});
