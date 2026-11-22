/**
 * Mis estudiantes (profesor): lista con resumen de paquete, búsqueda, filtros (estado, materia, rango de progreso),
 * detalle expandible (paquetes y materiales) y acceso directo al chat.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { fireEvent, screen } from "@testing-library/react";
import StudentsPage from "@/app/(teacher)/teacher/students/page";
import { renderScreen } from "./render";
import { routerState } from "./router";
import { mockApi, mockApiError, callsTo } from "./fakeApi";

const ENR = (id: number, over: Record<string, unknown> = {}) => ({
  id, package_name: `Pack ${id}`, subject: "Español", classes_used: 2, classes_total: 8, status: "active", created_at: "2026-01-01T00:00:00Z", cohort_id: null, is_group: false, ...over,
});
const ST = (id: number, over: Record<string, unknown> = {}) => ({
  id, user_id: id + 100, username: `alu${id}`, name: `Nombre${id}`, surname: `Apellido${id}`, email: `a${id}@x.com`, phone_number: null, avatar: null,
  timezone: "America/Caracas", nationality: null, spoken_languages: [], goal: null, created_at: "2026-01-01T00:00:00Z",
  enrollments: [ENR(id)], materials: [], total_completed_classes: 0, ...over,
});

function setup(list: unknown[] = [ST(1), ST(2, { nationality: "Chile", phone_number: "+56 9 1234", enrollments: [ENR(2, { status: "completed", subject: "Ingles", classes_used: 8 })] }), ST(3, { enrollments: [] })], extra?: () => void) {
  mockApi("get", /^\/teachers\/me\/students-full/, list);
  extra?.();
  const view = renderScreen(<StudentsPage />, { role: "teacher" });
  return { ...view, user: userEvent.setup() };
}
const SEARCH = "Buscar por nombre, usuario, email o teléfono...";
const openFilters = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await screen.findByRole("button", { name: /Filtros/ }));
};

afterEach(() => { vi.restoreAllMocks(); });

describe("Mis estudiantes · lista", () => {
  it("cuenta los estudiantes y resume el paquete activo", async () => {
    setup();
    expect(await screen.findByText("Nombre1 Apellido1")).toBeInTheDocument();
    expect(screen.getByText("3 estudiantes asignados")).toBeInTheDocument();
    expect(screen.getByText("Sin paquete")).toBeInTheDocument();
    expect(screen.getByText("Agotado")).toBeInTheDocument();
    expect(screen.getByText("2/8 clases")).toBeInTheDocument();
  });

  it("en singular con un solo estudiante", async () => {
    setup([ST(1)]);
    expect(await screen.findByText("1 estudiante asignado")).toBeInTheDocument();
  });

  it("sin estudiantes lo dice", async () => {
    setup([]);
    expect(await screen.findByText("Aún no tienes estudiantes asignados")).toBeInTheDocument();
  });

  it("si falla la carga ofrece reintentar y vuelve a pedir", async () => {
    const { user } = setup([], () => mockApiError("get", /^\/teachers\/me\/students-full/, 500, "x"));
    const retry = await screen.findByRole("button", { name: /Reintentar/ });
    const before = callsTo("get", /students-full/).length;
    await user.click(retry);
    await vi.waitFor(() => expect(callsTo("get", /students-full/).length).toBeGreaterThan(before));
  });

  it("paquete sin tope muestra ∞ y la nacionalidad se ve", async () => {
    setup([ST(1, { nationality: "Chile", enrollments: [ENR(1, { classes_total: null })] })]);
    expect(await screen.findByText("2/∞ clases")).toBeInTheDocument();
    expect(screen.getByText(/Chile/)).toBeInTheDocument();
  });

  it("un estado desconocido se muestra tal cual", async () => {
    setup([ST(1, { enrollments: [ENR(1, { status: "raro" })] })]);
    expect(await screen.findByText("raro")).toBeInTheDocument();
  });

  it("sin foto muestra las iniciales", async () => {
    setup([ST(1)]);
    expect(await screen.findByText("NA")).toBeInTheDocument();
  });

  it("con foto la usa", async () => {
    setup([ST(1, { avatar: "https://img/x.png" })]);
    expect(await screen.findByAltText("Nombre1")).toBeInTheDocument();
  });
});

describe("Mis estudiantes · búsqueda y filtros", () => {
  it("busca por nombre, usuario, correo o teléfono", async () => {
    const { user } = setup();
    await screen.findByText("Nombre1 Apellido1");
    await user.type(screen.getByPlaceholderText(SEARCH), "9 1234");
    expect(screen.queryByText("Nombre1 Apellido1")).not.toBeInTheDocument();
    expect(screen.getByText("Nombre2 Apellido2")).toBeInTheDocument();
    await user.clear(screen.getByPlaceholderText(SEARCH));
    await user.type(screen.getByPlaceholderText(SEARCH), "zzz");
    expect(await screen.findByText("Ningún estudiante coincide con los filtros")).toBeInTheDocument();
  });

  it("filtra por estado del paquete y «Limpiar» lo deshace", async () => {
    const { user } = setup();
    await openFilters(user);
    await user.selectOptions(screen.getAllByRole("combobox")[0], "completed");
    expect(screen.queryByText("Nombre1 Apellido1")).not.toBeInTheDocument();
    expect(screen.getByText("Nombre2 Apellido2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Filtros \(1\)/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Limpiar/ }));
    expect(await screen.findByText("Nombre1 Apellido1")).toBeInTheDocument();
  });

  it("filtra por materia o idioma", async () => {
    const { user } = setup();
    await openFilters(user);
    await user.selectOptions(screen.getAllByRole("combobox")[1], "Ingles");
    expect(screen.queryByText("Nombre1 Apellido1")).not.toBeInTheDocument();
    expect(screen.getByText("Nombre2 Apellido2")).toBeInTheDocument();
  });

  it("filtra por rango de progreso del paquete activo y deja fuera a quien no tiene paquete", async () => {
    const { user } = setup();
    await openFilters(user);
    const [min, max] = screen.getAllByRole("slider");
    fireEvent.change(min, { target: { value: "50" } });
    expect(screen.getByText(/50% – 100%/)).toBeInTheDocument();
    expect(screen.queryByText("Nombre1 Apellido1")).not.toBeInTheDocument(); // 25 %
    expect(screen.queryByText("Nombre3 Apellido3")).not.toBeInTheDocument(); // sin paquete
    expect(screen.getByText("Nombre2 Apellido2")).toBeInTheDocument(); // 100 %
    fireEvent.change(max, { target: { value: "60" } });
    expect(screen.queryByText("Nombre2 Apellido2")).not.toBeInTheDocument();
  });

  it("los dos controles del rango no se cruzan", async () => {
    const { user } = setup();
    await openFilters(user);
    const [min, max] = screen.getAllByRole("slider");
    fireEvent.change(min, { target: { value: "70" } });
    fireEvent.change(max, { target: { value: "30" } });
    expect(screen.getByText(/70% – 70%/)).toBeInTheDocument();
    fireEvent.change(max, { target: { value: "90" } });
    fireEvent.change(min, { target: { value: "95" } });
    expect(screen.getByText(/90% – 90%/)).toBeInTheDocument();
  });
});

describe("Mis estudiantes · detalle", () => {
  it("al abrir una fila muestra paquetes (con grupo) y materiales", async () => {
    const { user } = setup([ST(1, {
      phone_number: "+58 412", enrollments: [ENR(1), ENR(9, { is_group: true, cohort_id: 4, subject: null, classes_total: null, status: "pending_renewal" })],
      materials: [{ id: 1, material_id: 5, title: "Gramática B1", level: "B1", progress: "50%" }, { id: 2, material_id: 6, title: "Vocab", level: null, progress: "0%" }],
    })]);
    await user.click(await screen.findByText("Nombre1 Apellido1"));
    expect(await screen.findByText("Pack 1")).toBeInTheDocument();
    expect(screen.getByText(/Grupo #4/)).toBeInTheDocument();
    expect(screen.getByText(/Sin materia/)).toBeInTheDocument();
    expect(screen.getByText("Renovación pendiente")).toBeInTheDocument();
    expect(screen.getByText(/Materiales asignados \(2\)/)).toBeInTheDocument();
    expect(screen.getByText("Gramática B1")).toBeInTheDocument();
    expect(screen.getByText(/· B1/)).toBeInTheDocument();
    await user.click(screen.getByText("Nombre1 Apellido1"));
    expect(screen.queryByText("Pack 1")).not.toBeInTheDocument();
  });

  it("sin paquetes ni materiales lo dice", async () => {
    const { user } = setup([ST(3, { enrollments: [] })]);
    await user.click(await screen.findByText("Nombre3 Apellido3"));
    expect(await screen.findByText("Sin paquetes asignados")).toBeInTheDocument();
    expect(screen.getByText("Sin materiales asignados")).toBeInTheDocument();
  });

  it("el botón de chat lleva al hilo del alumno sin abrir el detalle", async () => {
    const { user } = setup([ST(1)]);
    await screen.findByText("Nombre1 Apellido1");
    const chat = screen.getByText("Chat").closest("button");
    expect(chat).toBeTruthy();
    await user.click(chat!);
    expect(routerState.router.push).toHaveBeenCalledWith("/teacher/chat?student=alu1");
    expect(screen.queryByText("Sin materiales asignados")).not.toBeInTheDocument();
  });
});
