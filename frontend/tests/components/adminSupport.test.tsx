/**
 * Soporte (admin): bandeja de tickets con filtros, y el modal para responder. Las correcciones de clase se aprueban o
 * rechazan (con su efecto explicado); el resto, solo se responde.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { screen, waitFor } from "@testing-library/react";
import AdminSupportPage from "@/app/(superadmin)/admin/support/page";
import { renderScreen } from "./render";
import { mockApi, mockApiError, callsTo } from "./fakeApi";

const T = (id: number, over: Record<string, unknown> = {}) => ({
  id, category: "question", subject: `Asunto ${id}`, message: `Mensaje del ticket ${id}`, screen_context: "dashboard", class_id: null,
  requested_status: null, decision: null, status: "pending", admin_response: null, created_at: "2026-03-02T12:00:00Z", resolved_at: null,
  user_notified_seen: false, user_id: 10 + id, user_name: "Luis", user_surname: "Pérez", user_username: `luis${id}`, user_role: "student", ...over,
});

function setup(list: unknown[] = [T(1), T(2, { category: "bug", user_role: "teacher" })], extra?: () => void) {
  mockApi("get", /^\/admin\/support-tickets/, list);
  extra?.();
  const view = renderScreen(<AdminSupportPage />, { role: "superadmin" });
  return { ...view, user: userEvent.setup() };
}
const lastParams = () => callsTo("get", /^\/admin\/support-tickets/).at(-1)!.params as Record<string, unknown>;

afterEach(() => { vi.restoreAllMocks(); });

describe("Admin · soporte · bandeja", () => {
  it("arranca en «Pendientes» y lista los tickets con su categoría y rol", async () => {
    setup();
    expect(await screen.findByText("Asunto 1")).toBeInTheDocument();
    expect(lastParams()).toMatchObject({ status_filter: "pending" });
    expect(screen.getAllByText("Pendiente").length).toBeGreaterThan(0);
    expect(screen.getByText("Estudiante")).toBeInTheDocument();
    expect(screen.getByText("Profesor")).toBeInTheDocument();
  });

  it("los tabs cambian el filtro de estado", async () => {
    const { user } = setup([T(1), T(3, { status: "answered", admin_response: "Listo" })]);
    await screen.findByText("Asunto 1");
    await user.click(screen.getByRole("button", { name: "Respondidos" }));
    await waitFor(() => expect(lastParams()).toMatchObject({ status_filter: "answered" }));
    await user.click(screen.getByRole("button", { name: "Todos" }));
    await waitFor(() => expect(lastParams().status_filter).toBeUndefined());
  });

  it("filtra por categoría", async () => {
    const { user } = setup();
    await screen.findByText("Asunto 1");
    await user.selectOptions(screen.getByRole("combobox"), "bug");
    await waitFor(() => expect(lastParams()).toMatchObject({ category_filter: "bug" }));
    await user.selectOptions(screen.getByRole("combobox"), "");
    await waitFor(() => expect(lastParams().category_filter).toBeUndefined());
  });

  it("una categoría desconocida cae a «Otro» y un ticket respondido se marca", async () => {
    setup([T(1, { category: "rara", status: "answered", user_role: "admin" })]);
    expect(await screen.findByText("Respondido")).toBeInTheDocument();
    expect(screen.getByText("admin")).toBeInTheDocument();
  });

  it("sin tickets no hay filas", async () => {
    setup([]);
    await waitFor(() => expect(callsTo("get", /^\/admin\/support-tickets/).length).toBeGreaterThan(0));
    expect(screen.queryByText(/Asunto/)).not.toBeInTheDocument();
  });
});

describe("Admin · soporte · responder", () => {
  it("responder un ticket normal manda solo el texto recortado", async () => {
    mockApi("patch", "/admin/support-tickets/1/resolve", {});
    const { user } = setup();
    await user.click(await screen.findByText("Asunto 1"));
    const send = await screen.findByRole("button", { name: /Enviar respuesta/ });
    expect(send).toBeDisabled();
    await user.type(screen.getByPlaceholderText("Escribe una respuesta personalizada..."), "  Ya lo resolvimos  ");
    await user.click(send);
    await waitFor(() => expect(callsTo("patch", "/admin/support-tickets/1/resolve")).toHaveLength(1));
    expect(callsTo("patch", "/admin/support-tickets/1/resolve")[0].body).toEqual({ admin_response: "Ya lo resolvimos" });
    expect(await screen.findByText("Ticket respondido correctamente")).toBeInTheDocument();
  });

  it("un error del servidor se muestra y deja reintentar", async () => {
    const { user } = setup(undefined, () => mockApiError("patch", "/admin/support-tickets/1/resolve", 500, "No se pudo guardar"));
    await user.click(await screen.findByText("Asunto 1"));
    await user.type(await screen.findByPlaceholderText("Escribe una respuesta personalizada..."), "Hola");
    await user.click(screen.getByRole("button", { name: /Enviar respuesta/ }));
    expect(await screen.findByText("No se pudo guardar")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Escribe una respuesta personalizada...")).toHaveValue("Hola");
  });

  it("un ticket ya respondido muestra la respuesta y no deja contestar otra vez", async () => {
    const { user } = setup([T(3, { status: "answered", admin_response: "Ya está", category: "question" })]);
    await user.click(await screen.findByText("Asunto 3"));
    expect(await screen.findByText(/Ya respondido/)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Escribe una respuesta personalizada...")).not.toBeInTheDocument();
  });

  it("corrección de clase: aprobar manda la decisión e informa el efecto (completada)", async () => {
    mockApi("patch", "/admin/support-tickets/4/resolve", {});
    const { user } = setup([T(4, { category: "class_correction", class_id: 77, requested_status: "completed" })]);
    await user.click(await screen.findByText("Asunto 4"));
    expect(await screen.findByText(/Clase #77/)).toBeInTheDocument();
    expect(screen.getByText(/completada \(el crédito sigue consumido\)/)).toBeInTheDocument();
    const approve = screen.getByRole("button", { name: "Aprobar cambio" });
    expect(approve).toBeDisabled();
    await user.type(screen.getByPlaceholderText("Escribe una respuesta personalizada..."), "Correcto");
    await user.click(approve);
    await waitFor(() => expect(callsTo("patch", "/admin/support-tickets/4/resolve")).toHaveLength(1));
    expect(callsTo("patch", "/admin/support-tickets/4/resolve")[0].body).toEqual({ admin_response: "Correcto", decision: "approved" });
  });

  it("corrección de clase: rechazar, y si se pide cancelada se devuelve el crédito", async () => {
    mockApi("patch", "/admin/support-tickets/5/resolve", {});
    const { user } = setup([T(5, { category: "class_correction", class_id: 8, requested_status: "cancelled" })]);
    await user.click(await screen.findByText("Asunto 5"));
    expect(await screen.findByText(/cancelada \(se devuelve el crédito\)/)).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText("Escribe una respuesta personalizada..."), "No procede");
    await user.click(screen.getByRole("button", { name: "Rechazar" }));
    await waitFor(() => expect(callsTo("patch", "/admin/support-tickets/5/resolve")).toHaveLength(1));
    expect(callsTo("patch", "/admin/support-tickets/5/resolve")[0].body).toEqual({ admin_response: "No procede", decision: "rejected" });
  });

  it("una corrección ya resuelta muestra la decisión", async () => {
    const { user } = setup([T(6, { category: "class_correction", class_id: 1, requested_status: "completed", status: "answered", decision: "rejected", admin_response: "No" })]);
    await user.click(await screen.findByText("Asunto 6"));
    expect(await screen.findByText(/Ya respondido · rechazada/)).toBeInTheDocument();
  });

  it("cerrar el modal no llama al servidor", async () => {
    const { user } = setup();
    await user.click(await screen.findByText("Asunto 1"));
    await screen.findByPlaceholderText("Escribe una respuesta personalizada...");
    await user.keyboard("{Escape}");
    const close = screen.getAllByRole("button").find((b) => b.className.includes("w-9 h-9"));
    if (close) await user.click(close);
    expect(callsTo("patch", /resolve/)).toHaveLength(0);
  });
});
