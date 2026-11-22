/**
 * Edición masiva de usuarios (admin): tabla editable con filtros, selección, cambio en lote, revertir y guardado
 * de solo las filas modificadas.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { screen, waitFor, within } from "@testing-library/react";
import UsersPage from "@/app/(superadmin)/admin/users/page";
import { renderScreen } from "./render";
import { routerState } from "./router";
import { mockApi, mockApiError, callsTo } from "./fakeApi";

const U = (id: number, over: Record<string, unknown> = {}) => ({
  id, username: `user${id}`, name: `Nombre${id}`, surname: `Apellido${id}`, email: `u${id}@x.com`, role: "student", is_active: true,
  phone_number: "", nationality: "", classes_used: 1, classes_total: 8, ...over,
});

function setup(users: unknown[] = [U(1), U(2, { role: "teacher", nationality: "Chile" }), U(3, { is_active: false })], total?: number) {
  mockApi("get", /^\/admin\/users/, { total: total ?? users.length, users });
  const view = renderScreen(<UsersPage />, { role: "superadmin" });
  return { ...view, user: userEvent.setup() };
}
const rowOf = (name: string) => screen.getByText(name).closest("tr") as HTMLElement;
const selectAll = () => within(document.querySelector("thead") as HTMLElement).getAllByRole("button")[0];
const selectRow = (name: string) => within(rowOf(name)).getAllByRole("button")[0];
const selects = () => screen.getAllByRole("combobox") as HTMLSelectElement[];

afterEach(() => { vi.restoreAllMocks(); });

describe("Admin · usuarios · tabla", () => {
  it("lista los usuarios con su rol", async () => {
    setup();
    expect(await screen.findByText("Nombre1 Apellido1")).toBeInTheDocument();
    expect(screen.getByText("Nombre2 Apellido2")).toBeInTheDocument();
  });

  it("buscar filtra por nombre, correo o país y «Limpiar filtros» restablece", async () => {
    const { user } = setup();
    await screen.findByText("Nombre1 Apellido1");
    await user.type(screen.getByPlaceholderText("Buscar usuario, email, teléfono o país..."), "chile");
    expect(screen.queryByText("Nombre1 Apellido1")).not.toBeInTheDocument();
    expect(screen.getByText("Nombre2 Apellido2")).toBeInTheDocument();
    await user.clear(screen.getByPlaceholderText("Buscar usuario, email, teléfono o país..."));
    await user.type(screen.getByPlaceholderText("Buscar usuario, email, teléfono o país..."), "zzzz");
    expect(await screen.findByText("No se encontraron resultados")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Limpiar Filtros/ }));
    expect(await screen.findByText("Nombre1 Apellido1")).toBeInTheDocument();
  });

  it("filtrar por rol y por estado", async () => {
    const { user } = setup();
    await screen.findByText("Nombre1 Apellido1");
    const [role, state] = selects();
    await user.selectOptions(role, "teacher");
    expect(screen.queryByText("Nombre1 Apellido1")).not.toBeInTheDocument();
    await user.selectOptions(role, "all");
    await user.selectOptions(state, "inactive");
    expect(screen.getByText("Nombre3 Apellido3")).toBeInTheDocument();
    expect(screen.queryByText("Nombre1 Apellido1")).not.toBeInTheDocument();
  });

  it("si falla la carga ofrece reintentar", async () => {
    mockApiError("get", /^\/admin\/users/, 500, "Servidor caído");
    renderScreen(<UsersPage />, { role: "superadmin" });
    expect(await screen.findByRole("button", { name: /Reintentar/ })).toBeInTheDocument();
  });

  it("el botón de volver lleva a estudiantes", async () => {
    const { user } = setup();
    await screen.findByText("Nombre1 Apellido1");
    await user.click(screen.getAllByRole("button")[0]);
    expect(routerState.router.push).toHaveBeenCalledWith("/admin/students");
  });

  it("con más de una página muestra la paginación", async () => {
    const { user } = setup([U(1)], 250);
    await screen.findByText("Nombre1 Apellido1");
    await user.click(await screen.findByRole("button", { name: "Siguiente" }));
    await waitFor(() => expect(callsTo("get", /^\/admin\/users/).some((c) => String(c.url).includes("skip=100"))).toBe(true));
  });
});

describe("Admin · usuarios · edición", () => {
  it("cambiar un campo marca la fila, aparece la barra y «Guardar Todo» manda solo las filas modificadas", async () => {
    mockApi("patch", "/admin/users/1", {});
    const { user } = setup();
    await screen.findByText("Nombre1 Apellido1");
    const row = rowOf("Nombre1 Apellido1");
    await user.type(within(row).getByPlaceholderText("+34 600..."), "+58 412 1");
    expect(await screen.findByText("Cambios sin guardar")).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: /Guardar Todo/ }).at(-1)!);
    await waitFor(() => expect(callsTo("patch", "/admin/users/1")).toHaveLength(1));
    expect(callsTo("patch", /^\/admin\/users\/[23]$/)).toHaveLength(0);
    expect(callsTo("patch", "/admin/users/1")[0].body).toMatchObject({ role: "student", is_active: true, phone_number: "+58 412 1", nationality: null });
    await waitFor(() => expect(screen.queryByText("Cambios sin guardar")).not.toBeInTheDocument());
  });

  it("cambiar el rol con el select y revertir la fila", async () => {
    const { user } = setup();
    await screen.findByText("Nombre1 Apellido1");
    const row = rowOf("Nombre1 Apellido1");
    await user.selectOptions(within(row).getByRole("combobox"), "teacher");
    await user.click(await within(row).findByRole("button", { name: "Revertir" }));
    expect(within(row).getByRole("combobox")).toHaveValue("student");
    expect(screen.queryByText("Cambios sin guardar")).not.toBeInTheDocument();
  });

  it("alternar activo/inactivo y «Descartar todo»", async () => {
    const { user } = setup();
    await screen.findByText("Nombre1 Apellido1");
    const row = rowOf("Nombre1 Apellido1");
    const toggle = within(row).getByRole("button", { name: /^Activo$/ });
    await user.click(toggle);
    expect(await screen.findByText("Cambios sin guardar")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Descartar todo" }));
    await waitFor(() => expect(screen.queryByText("Cambios sin guardar")).not.toBeInTheDocument());
  });

  it("un error al guardar se muestra y se puede cerrar", async () => {
    mockApiError("patch", "/admin/users/1", 400, "Rol no permitido");
    const { user } = setup();
    await screen.findByText("Nombre1 Apellido1");
    const row = rowOf("Nombre1 Apellido1");
    await user.selectOptions(within(row).getByRole("combobox"), "superadmin");
    await user.click(screen.getAllByRole("button", { name: /Guardar Todo/ }).at(-1)!);
    expect(await screen.findByText(/Rol no permitido/)).toBeInTheDocument();
  });
});

describe("Admin · usuarios · cambio en lote", () => {
  it("selecciona varias filas y aplica un rol a todas", async () => {
    mockApi("patch", /^\/admin\/users\/\d+$/, {});
    const { user } = setup();
    await screen.findByText("Nombre1 Apellido1");
    await user.click(selectRow("Nombre1 Apellido1"));
    await user.click(selectRow("Nombre2 Apellido2"));
    await user.click(await screen.findByRole("button", { name: /Cambiar valor en lote/ }));
    const bulkField = screen.getByRole("option", { name: "Seleccionar campo..." }).closest("select")!;
    await user.selectOptions(bulkField, "role");
    const roleSel = screen.getByRole("option", { name: "Seleccionar rol..." }).closest("select")!;
    await user.selectOptions(roleSel, "superadmin");
    await user.click(screen.getByRole("button", { name: "Aplicar" }));
    expect(await screen.findByText("Cambios sin guardar")).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: /Guardar Todo/ }).at(-1)!);
    await waitFor(() => expect(callsTo("patch", /^\/admin\/users\/\d+$/)).toHaveLength(2));
    expect(callsTo("patch", /^\/admin\/users\/\d+$/).every((c) => (c.body as { role: string }).role === "superadmin")).toBe(true);
  });

  it("lote de estado, y «seleccionar todo» se deshace al repetirlo", async () => {
    const { user } = setup();
    await screen.findByText("Nombre1 Apellido1");
    await user.click(selectAll());
    await user.click(await screen.findByRole("button", { name: /Cambiar valor en lote/ }));
    await user.selectOptions(screen.getByRole("option", { name: "Seleccionar campo..." }).closest("select")!, "is_active");
    await user.selectOptions(screen.getByRole("option", { name: "Seleccionar estado..." }).closest("select")!, "false");
    await user.click(screen.getByRole("button", { name: "Aplicar" }));
    expect(await screen.findByText("Cambios sin guardar")).toBeInTheDocument();
    await user.click(selectAll()); // ya estaban todas seleccionadas: repetir las deselecciona
    expect(screen.queryByRole("button", { name: /Cambiar valor en lote/ })).not.toBeInTheDocument();
  });

  it("lote de teléfono con texto libre", async () => {
    const { user } = setup();
    await screen.findByText("Nombre1 Apellido1");
    await user.click(selectRow("Nombre1 Apellido1"));
    await user.click(await screen.findByRole("button", { name: /Cambiar valor en lote/ }));
    await user.selectOptions(screen.getByRole("option", { name: "Seleccionar campo..." }).closest("select")!, "phone_number");
    const textInputs = screen.getAllByRole("textbox");
    await user.type(textInputs[textInputs.length - 1], "+1 555");
    await user.click(screen.getByRole("button", { name: "Aplicar" }));
    expect(await screen.findByDisplayValue("+1 555")).toBeInTheDocument();
  });
});
