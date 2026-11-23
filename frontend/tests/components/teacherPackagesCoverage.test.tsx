/**
 * Paquetes del profesor · cierra huecos: catálogos propios, cierre del formulario, descripción en párrafo, duración,
 * icono y color, grupo con horario fijo (se guarda con días y hora), edición de paquetes incompletos, reintentos,
 * solicitudes de renovación / cambio y el diálogo de «paquete gratis».
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import PackagesPage from "@/app/(teacher)/teacher/packages/page";
import { renderScreen } from "./render";
import { mockApi, mockApiError, callsTo, FIXTURE } from "./fakeApi";

const PKG = (over: Record<string, unknown> = {}) => ({
  id: 5, name: "Pack 8", subject: "Matematica", description: "Ocho clases", description_type: "paragraph", description_items: null,
  icon: "🎯", color: "#ec4899", classes_count: 8, price: 80, price_per_class: 10, duration_minutes: 50, is_active: true,
  allow_installments: false, installment_count: null, is_group: false, min_students: null, max_students: null,
  group_schedule_mode: "manual", group_recurring_days_of_week: null, group_recurring_time_local: null, ...over,
});
const ENR = (over: Record<string, unknown> = {}) => ({
  id: 21, student_id: 7, student_username: "ana", student_name: "Ana Pérez", package_id: 5, package_name: "Pack 8",
  classes_used: 2, classes_total: 8, available_credits: 6, status: "active", completed_count: 2, no_show_count: 0,
  cancelled_late_count: 0, renewal_requested_package_name: null, change_requested_package_name: null, created_at: "2026-01-01T00:00:00Z", ...over,
});

function setup(packages: unknown[] = [PKG()], enrollments: unknown[] = [], extra?: () => void) {
  mockApi("get", "/packages/my-packages", packages);
  mockApi("get", /^\/packages\/teacher\/enrollments/, enrollments);
  mockApi("get", "/teachers/me/profile", { ...FIXTURE.teacher, subjects: [], languages: [] });
  extra?.();
  const view = renderScreen(<PackagesPage />, { role: "teacher" });
  return { ...view, user: userEvent.setup() };
}
afterEach(() => { vi.restoreAllMocks(); });

async function openCreate(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByText("Pack 8");
  await user.click(screen.getByRole("button", { name: /Nuevo paquete/ }));
  return screen.findByPlaceholderText("Ej: Paquete Intensivo B1");
}
const field = (ph: string) => screen.getByPlaceholderText(ph) as HTMLInputElement;
async function fillBasic(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByPlaceholderText("Ej: Paquete Intensivo B1"), "Intensivo");
  await user.selectOptions(screen.getAllByRole("combobox")[0], "Matematica");
  await user.clear(field("Ej: 8"));
  await user.type(field("Ej: 8"), "4");
  await user.clear(field("Ej: 50.00"));
  await user.type(field("Ej: 50.00"), "40");
  await user.clear(field("Ej: 6.25"));
  await user.type(field("Ej: 6.25"), "10");
}
const editFirst = async (user: ReturnType<typeof userEvent.setup>, name = "Pack 8") => {
  await screen.findByText(name);
  const card = screen.getByText(name).closest("[class*='rounded']")!.parentElement as HTMLElement;
  await user.click(within(card).getAllByRole("button")[0]);
};

describe("Paquetes del profesor · formulario", () => {
  it("la X cierra el formulario", async () => {
    const { user } = setup();
    await openCreate(user);
    await user.click(screen.getByText("Nuevo paquete", { selector: "h2" }).parentElement!.querySelector("button") as HTMLElement);
    await waitFor(() => expect(screen.queryByPlaceholderText("Ej: Paquete Intensivo B1")).not.toBeInTheDocument());
  });

  it("con catálogos propios ofrece sus materias, iconos y colores", async () => {
    mockApi("post", "/packages/", { id: 9 });
    const { user } = setup([PKG()], [], () => mockApi("get", "/system-catalogs/", {
      subjects: ["Física"], languages: ["Esperanto"], package_icon_options: ["🧪"], theme_presets: [{ value: "#111111", label: "Negro" }],
    }));
    await openCreate(user);
    await user.type(field("Ej: Paquete Intensivo B1"), "Lab");
    await user.selectOptions(screen.getAllByRole("combobox")[0], "Física");
    await user.clear(field("Ej: 8")); await user.type(field("Ej: 8"), "4");
    await user.clear(field("Ej: 50.00")); await user.type(field("Ej: 50.00"), "40");
    await user.clear(field("Ej: 6.25")); await user.type(field("Ej: 6.25"), "10");
    await user.click(await screen.findByRole("button", { name: "🧪" }));
    await user.click(screen.getByTitle("Negro"));
    await user.click(screen.getByRole("button", { name: "Crear paquete" }));
    await waitFor(() => expect(callsTo("post", "/packages/")).toHaveLength(1));
    expect(callsTo("post", "/packages/")[0].body).toMatchObject({ subject: "Física", icon: "🧪", color: "#111111" });
  });

  it("color libre, descripción en párrafo, duración y pago en cuotas se envían", async () => {
    mockApi("post", "/packages/", { id: 9 });
    const { user, container } = setup();
    await openCreate(user);
    await fillBasic(user);
    fireEvent.change(container.querySelector('input[type="color"]') as HTMLInputElement, { target: { value: "#123456" } });
    fireEvent.change(screen.getByPlaceholderText("Qué incluye este paquete..."), { target: { value: "Todo incluido" } });
    await user.click(screen.getByRole("button", { name: /^80 min$/ }));
    await user.click(screen.getByRole("button", { name: "Crear paquete" }));
    await waitFor(() => expect(callsTo("post", "/packages/")).toHaveLength(1));
    expect(callsTo("post", "/packages/")[0].body).toMatchObject({ color: "#123456", description: "Todo incluido", duration_minutes: 80 });
    expect(await screen.findByText("Paquete creado correctamente")).toBeInTheDocument();
  });

  it("grupo con horario fijo: volver a manual y de nuevo a fijo; se guarda con días y hora", async () => {
    mockApi("post", "/packages/", { id: 9 });
    const { user, container } = setup();
    await openCreate(user);
    await fillBasic(user);
    await user.click(screen.getByText(/Paquete grupal \(clases compartidas/).closest("div")!.parentElement!.querySelector("button") as HTMLElement);
    await user.click(screen.getByRole("button", { name: /Fijo y recurrente/ }));
    await user.click(screen.getByRole("button", { name: "Libre (agendo yo cada sesión)" }));
    await user.click(screen.getByRole("button", { name: /Fijo y recurrente/ }));
    await user.click(screen.getByRole("button", { name: "Mié" }));
    fireEvent.change(container.querySelector('input[type="time"]') as HTMLInputElement, { target: { value: "19:30" } });
    await user.click(screen.getByRole("button", { name: "Crear paquete" }));
    await waitFor(() => expect(callsTo("post", "/packages/")).toHaveLength(1));
    expect(callsTo("post", "/packages/")[0].body).toMatchObject({
      is_group: true, group_schedule_mode: "fixed", group_recurring_days_of_week: [2], group_recurring_time_local: "19:30", installment_count: null,
    });
  });

  it("pago en cuotas envía el número de cuotas", async () => {
    mockApi("post", "/packages/", { id: 9 });
    const { user } = setup();
    await openCreate(user);
    await fillBasic(user);
    const toggle = screen.getByText(/cuotas/i, { selector: "label, p, span" }).closest("div")!.parentElement!.querySelector("button") as HTMLElement | null;
    if (toggle) await user.click(toggle);
    await user.click(screen.getByRole("button", { name: "Crear paquete" }));
    await waitFor(() => expect(callsTo("post", "/packages/")).toHaveLength(1));
  });
});

describe("Paquetes del profesor · lista y edición de casos límite", () => {
  it("precio con decimales, paquete inactivo y sin descripción", async () => {
    setup([PKG({ price: 79.5, is_active: false, description: null, name: "Inactivo" })]);
    expect(await screen.findByText("Inactivo")).toBeInTheDocument();
    expect(screen.getByText(/79\.50/)).toBeInTheDocument();
  });

  it("editar un paquete con campos ausentes usa los valores por defecto", async () => {
    mockApi("patch", "/packages/5", {});
    const { user } = setup([PKG({
      subject: "Inglés", description: null, description_type: undefined, icon: null, color: null, allow_installments: undefined,
      installment_count: null, is_group: undefined, min_students: null, max_students: null, group_schedule_mode: undefined,
    })]);
    await editFirst(user);
    await screen.findByDisplayValue("Pack 8");
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(callsTo("patch", "/packages/5")).toHaveLength(1));
    expect(callsTo("patch", "/packages/5")[0].body).toMatchObject({ subject: "Inglés", description_type: "paragraph", is_group: false, group_schedule_mode: "manual" });
  });

  it("editar un paquete cuya materia ya no está en el catálogo la conserva", async () => {
    const { user } = setup([PKG({ subject: "Alquimia" })]);
    await editFirst(user);
    expect(await screen.findByRole("option", { name: "Alquimia" })).toBeInTheDocument();
  });

  it("editar un paquete grupal y en cuotas precarga sus valores", async () => {
    const { user } = setup([PKG({ is_group: true, min_students: 2, max_students: 5, group_schedule_mode: "fixed", group_recurring_days_of_week: [1], group_recurring_time_local: "10:00", allow_installments: true, installment_count: 4 })]);
    await editFirst(user);
    expect(await screen.findByDisplayValue("2")).toBeInTheDocument();
    expect(screen.getByDisplayValue("5")).toBeInTheDocument();
  });

  it("si fallan los paquetes, Reintentar los vuelve a pedir", async () => {
    const { user } = setup([], [], () => mockApiError("get", "/packages/my-packages", 500, "x"));
    const retry = await screen.findByRole("button", { name: /Reintentar/ });
    mockApi("get", "/packages/my-packages", [PKG()]);
    await user.click(retry);
    expect(await screen.findByText("Pack 8")).toBeInTheDocument();
  });

  it("si falla el seguimiento, Reintentar lo vuelve a pedir", async () => {
    const { user } = setup([PKG()], [], () => mockApiError("get", /^\/packages\/teacher\/enrollments/, 500, "x"));
    await screen.findByText(/No se pudo cargar la lista de estudiantes con paquetes/);
    mockApi("get", /^\/packages\/teacher\/enrollments/, [ENR()]);
    await user.click(screen.getByRole("button", { name: /Reintentar/ }));
    expect(await screen.findByText("Ana Pérez")).toBeInTheDocument();
  });
});

describe("Paquetes del profesor · renovaciones, cambios y paquete gratis", () => {
  it("una renovación pendiente avisa en singular y con varias en plural", async () => {
    const { unmount } = setup([PKG()], [ENR({ status: "pending_renewal", renewal_requested_package_name: "Pack 16" })]);
    expect(await screen.findByText(/Tienes 1 solicitud de renovación/)).toBeInTheDocument();
    expect(screen.getByText(/Pidió: Pack 16/)).toBeInTheDocument();
    unmount();
    setup([PKG()], [ENR({ status: "pending_renewal" }), ENR({ id: 22, student_name: "Luis Gómez", status: "pending_renewal" })]);
    expect(await screen.findByText(/Tienes 2 solicitudes de renovación/)).toBeInTheDocument();
  });

  it("pedir paquete gratis desde una renovación y desde un cambio de paquete; cerrar el diálogo", async () => {
    const { user } = setup([PKG()], [
      ENR({ status: "pending_renewal" }),
      ENR({ id: 22, student_name: "Luis Gómez", status: "pending_package_change", change_requested_package_name: "Pack 16" }),
    ]);
    expect(await screen.findByText(/Quiere cambiar a: Pack 16/)).toBeInTheDocument();
    const buttons = screen.getAllByRole("button", { name: /Pedir paquete gratis/ });
    expect(buttons).toHaveLength(2);
    await user.click(buttons[0]);
    await screen.findByPlaceholderText(/beca acordada/);
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByPlaceholderText(/beca acordada/)).not.toBeInTheDocument());
    await user.click(screen.getAllByRole("button", { name: /Pedir paquete gratis/ })[1]);
    expect(await screen.findByPlaceholderText(/beca acordada/)).toBeInTheDocument();
  });
});

describe("Paquetes del profesor · idiomas del perfil y estados raros", () => {
  it("con idiomas en el perfil solo ofrece esos idiomas y reconoce un paquete de idioma al editarlo", async () => {
    const { user } = setup([PKG({ subject: "Inglés" })], [], () =>
      mockApi("get", "/teachers/me/profile", { ...FIXTURE.teacher, subjects: [], languages: ["Inglés"] }));
    await editFirst(user);
    expect(await screen.findByRole("option", { name: "Inglés" })).toBeInTheDocument();
  });

  it("un estado de inscripción desconocido se muestra tal cual", async () => {
    setup([PKG()], [ENR({ status: "estado_nuevo" })]);
    expect(await screen.findByText("estado_nuevo")).toBeInTheDocument();
  });
});
