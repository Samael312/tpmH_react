/**
 * Clases (admin): listado de cualquier profesor/alumno con filtros, y las dos acciones del superadmin: reagendar
 * (en la zona del profesor) y cancelar con reembolso. Solo se pueden tocar las clases abiertas y futuras.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import AdminClassesPage from "@/app/(superadmin)/admin/classes/page";
import { renderScreen } from "./render";
import { mockApi, mockApiError, callsTo } from "./fakeApi";

const HOUR = 3600_000;
const CL = (id: number, over: Record<string, unknown> = {}) => ({
  id, teacher_id: 7, student_id: 1, teacher_name: "Ana Prof", teacher_username: "ana", student_name: "Luis Alumno", class_type: "regular", subject: "Español",
  start_time_utc: new Date(Date.now() + 48 * HOUR).toISOString(), end_time_utc: new Date(Date.now() + 49 * HOUR).toISOString(), duration_minutes: 60,
  status: "confirmed", teacher_timezone: "America/Bogota", student_timezone: "America/Caracas", external_source: null, ...over,
});

function setup(list: unknown[] = [CL(1)], extra?: () => void) {
  mockApi("get", /^\/classes\/admin\/list/, { classes: list, total: list.length });
  mockApi("get", /^\/god-mode\/lookup\/teachers/, [{ id: 7, username: "ana", name: "Ana Prof" }]);
  extra?.();
  const view = renderScreen(<AdminClassesPage />, { role: "superadmin" });
  return { ...view, user: userEvent.setup() };
}
const lastParams = () => callsTo("get", /^\/classes\/admin\/list/).at(-1)!.params as Record<string, unknown>;

afterEach(() => { vi.restoreAllMocks(); });

describe("Admin · clases · lista y filtros", () => {
  it("lista la clase con profesor, alumno, materia y estado en español", async () => {
    setup();
    expect(await screen.findByText(/Profesor: Ana Prof · Alumno: Luis Alumno · Español · #1/)).toBeInTheDocument();
    expect(screen.getAllByText("Confirmada").length).toBeGreaterThan(1); // badge + opción del filtro
  });

  it("sin clases lo dice y sin datos usa valores por defecto", async () => {
    setup([]);
    expect(await screen.findByText("No hay clases con esos filtros.")).toBeInTheDocument();
  });

  it("campos vacíos caen a «—», «Sin materia» y al id del profesor", async () => {
    setup([CL(2, { teacher_name: null, teacher_username: null, student_name: null, subject: null, status: "rara", teacher_timezone: null })]);
    expect(await screen.findByText(/Profesor: 7 · Alumno: — · Sin materia · #2/)).toBeInTheDocument();
    expect(screen.getByText("rara")).toBeInTheDocument();
  });

  it("los filtros se mandan al servidor", async () => {
    const { user } = setup();
    await screen.findByText(/#1/);
    await user.selectOptions(screen.getByLabelText("Profesor"), "7");
    await user.selectOptions(screen.getByLabelText("Estado"), "cancelled");
    fireEvent.change(screen.getByLabelText("Desde (UTC)"), { target: { value: "2026-03-01" } });
    fireEvent.change(screen.getByLabelText("Hasta (UTC)"), { target: { value: "2026-03-31" } });
    await user.type(screen.getByPlaceholderText("Alumno (nombre o usuario)"), "luis");
    await waitFor(() => expect(lastParams()).toMatchObject({ teacher_id: 7, status: "cancelled", date_from: "2026-03-01", date_to: "2026-03-31", student_q: "luis" }), { timeout: 3000 });
    await user.selectOptions(screen.getByLabelText("Profesor"), "");
    await waitFor(() => expect(lastParams().teacher_id).toBeUndefined());
  });

  it("si falla la carga ofrece reintentar", async () => {
    const { user } = setup([], () => mockApiError("get", /^\/classes\/admin\/list/, 500, "x"));
    const retry = await screen.findByRole("button", { name: /Reintentar/ });
    const before = callsTo("get", /^\/classes\/admin\/list/).length;
    await user.click(retry);
    await waitFor(() => expect(callsTo("get", /^\/classes\/admin\/list/).length).toBeGreaterThan(before));
  });

  it("«Cargar más» pide el siguiente bloque", async () => {
    mockApi("get", /^\/classes\/admin\/list/, { classes: [CL(1)], total: 200 });
    const { user } = setup([CL(1)], () => mockApi("get", /^\/classes\/admin\/list/, { classes: [CL(1)], total: 200 }));
    await screen.findByText(/#1/);
    await user.click(await screen.findByRole("button", { name: "Cargar más" }));
    await waitFor(() => expect(callsTo("get", /^\/classes\/admin\/list/).length).toBeGreaterThan(1));
  });
});

describe("Admin · clases · qué se puede tocar", () => {
  const btn = (name: RegExp) => screen.getByRole("button", { name });

  it("una clase abierta y futura se puede reagendar y cancelar", async () => {
    setup();
    await screen.findByText(/#1/);
    expect(btn(/Reagendar/)).toBeEnabled();
    expect(btn(/Cancelar clase/)).toBeEnabled();
  });

  it("una clase ya pasada explica por qué no", async () => {
    setup([CL(1, { start_time_utc: new Date(Date.now() - 5 * HOUR).toISOString() })]);
    expect(await screen.findByText(/La clase ya pasó/)).toBeInTheDocument();
    expect(btn(/Reagendar/)).toBeDisabled();
    expect(btn(/Cancelar clase/)).toBeDisabled();
  });

  it("una clase en otro estado lo indica", async () => {
    setup([CL(1, { status: "completed" })]);
    expect(await screen.findByText(/está «Completada»/)).toBeInTheDocument();
    expect(btn(/Reagendar/)).toBeDisabled();
  });

  it("una clase externa se gestiona desde el calendario del profesor", async () => {
    setup([CL(1, { class_type: "external", external_source: "google" })]);
    expect(await screen.findByText(/Clase externa \(Calendar\)/)).toBeInTheDocument();
    expect(screen.getByText("externa")).toBeInTheDocument();
    expect(btn(/Reagendar/)).toBeDisabled();
  });
});

describe("Admin · clases · reagendar", () => {
  const open = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(await screen.findByRole("button", { name: /Reagendar/ }));
    return screen.findByText(/Nueva fecha y hora/);
  };
  const dtInput = () => document.querySelector('input[type="datetime-local"]') as HTMLInputElement;

  it("muestra la hora actual en la zona del profesor", async () => {
    const { user } = setup();
    await open(user);
    expect(screen.getAllByText(/America\/Bogota/).length).toBeGreaterThan(0);
  });

  it("sin fecha avisa y no llama al servidor", async () => {
    const { user } = setup();
    await open(user);
    await user.click(screen.getByRole("button", { name: "Confirmar reagendado" }));
    expect(await screen.findByText("Elige una fecha y hora válidas")).toBeInTheDocument();
    expect(callsTo("patch", /reschedule/)).toHaveLength(0);
  });

  it("manda inicio y fin (duración de la clase) en UTC según la zona del profesor", async () => {
    mockApi("patch", "/classes/admin/1/reschedule", {});
    const { user } = setup();
    await open(user);
    fireEvent.change(dtInput(), { target: { value: "2026-12-10T10:00" } });
    await user.click(screen.getByRole("button", { name: "Confirmar reagendado" }));
    await waitFor(() => expect(callsTo("patch", "/classes/admin/1/reschedule")).toHaveLength(1));
    const body = callsTo("patch", "/classes/admin/1/reschedule")[0].body as { start_time_utc: string; end_time_utc: string };
    expect(body.start_time_utc).toBe("2026-12-10T15:00:00.000Z"); // Bogotá = UTC-5
    expect(body.end_time_utc).toBe("2026-12-10T16:00:00.000Z");
    expect(await screen.findByText("Clase reagendada")).toBeInTheDocument();
  });

  it("un error del servidor se avisa", async () => {
    const { user } = setup([CL(1)], () => mockApiError("patch", "/classes/admin/1/reschedule", 409, "El profesor ya tiene una clase a esa hora"));
    await open(user);
    fireEvent.change(dtInput(), { target: { value: "2026-12-10T10:00" } });
    await user.click(screen.getByRole("button", { name: "Confirmar reagendado" }));
    expect(await screen.findByText("El profesor ya tiene una clase a esa hora")).toBeInTheDocument();
  });
});

describe("Admin · clases · cancelar", () => {
  const open = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(await screen.findByRole("button", { name: /Cancelar clase/ }));
    return screen.findByRole("button", { name: "Sí, cancelar la clase" });
  };

  it("pide confirmación, cancela y avisa del reembolso", async () => {
    mockApi("delete", "/classes/admin/1", {});
    const { user } = setup();
    await user.click(await open(user));
    await waitFor(() => expect(callsTo("delete", "/classes/admin/1")).toHaveLength(1));
    expect(await screen.findByText("Clase cancelada y crédito reembolsado")).toBeInTheDocument();
  });

  it("«Volver» cierra sin cancelar", async () => {
    const { user } = setup();
    await open(user);
    await user.click(screen.getByRole("button", { name: "Volver" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Sí, cancelar la clase" })).not.toBeInTheDocument());
    expect(callsTo("delete", /classes\/admin/)).toHaveLength(0);
  });

  it("un error del servidor se avisa", async () => {
    const { user } = setup([CL(1)], () => mockApiError("delete", "/classes/admin/1", 400, "No se pudo reembolsar"));
    await user.click(await open(user));
    expect(await screen.findByText("No se pudo reembolsar")).toBeInTheDocument();
  });
});
