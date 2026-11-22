/**
 * Grupos (cohortes) del profesor: lista por estado, crear, editar cupo, abortar / finalizar / reabrir,
 * integrantes, sesiones y asistencia.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { screen, waitFor, within } from "@testing-library/react";
import CohortsPage from "@/app/(teacher)/teacher/cohorts/page";
import { renderScreen } from "./render";
import { routerState } from "./router";
import { mockApi, mockApiError, callsTo } from "./fakeApi";

const COHORT = (over: Record<string, unknown> = {}) => ({
  id: 1, package_id: 5, package_name: "Grupal B1", teacher_id: 3, start_date: null, status: "filling",
  min_students: 3, max_students: 6, current_students: 2, created_at: "2026-01-01T00:00:00Z", closed_at: null, ...over,
});
const GROUP_PKG = { id: 5, name: "Grupal B1", subject: "Inglés", is_group: true, min_students: 3, max_students: 6, classes_count: 8, price: 80, duration_minutes: 50, is_active: true, group_schedule_mode: "manual" };
const MEMBERS = [
  { enrollment_id: 1, student_id: 7, student_name: "Ana Pérez", student_avatar: null, payment_status: "paid", joined_at: "2026-01-02T00:00:00Z" },
  { enrollment_id: 2, student_id: 8, student_name: "Luis Gómez", student_avatar: null, payment_status: "pending", joined_at: "2026-01-02T00:00:00Z" },
];
const FUTURE = new Date(Date.now() + 5 * 86_400_000).toISOString();
const PAST = new Date(Date.now() - 5 * 86_400_000).toISOString();
const SESSION = (over: Record<string, unknown> = {}) => ({ id: 31, cohort_id: 1, start_time_utc: PAST, end_time_utc: PAST, duration: 50, status: "scheduled", participant_count: 2, ...over });

function setup(cohorts: unknown[] = [COHORT()], extra?: () => void) {
  mockApi("get", /^\/cohorts\/teacher/, cohorts);
  mockApi("get", "/packages/my-packages", [GROUP_PKG]);
  mockApi("get", "/cohorts/1/members", MEMBERS);
  mockApi("get", "/cohorts/1/sessions", [SESSION()]);
  extra?.();
  const view = renderScreen(<CohortsPage />, { role: "teacher" });
  return { ...view, user: userEvent.setup() };
}

afterEach(() => { vi.restoreAllMocks(); });

describe("Grupos · lista", () => {
  it("separa activos e historial", async () => {
    const { user } = setup([COHORT(), COHORT({ id: 2, status: "completed" }), COHORT({ id: 3, status: "cancelled" })]);
    expect(await screen.findByText(/Activos \(1\)/)).toBeInTheDocument();
    expect(screen.getByText(/Historial \(2\)/)).toBeInTheDocument();
    await user.click(screen.getByText(/Historial \(2\)/));
    expect(await screen.findByText("Completado")).toBeInTheDocument();
    expect(screen.getByText("Cancelado")).toBeInTheDocument();
  });

  it("avisa cuando el grupo no llega al mínimo mientras se llena", async () => {
    setup();
    expect(await screen.findByText("Llenándose")).toBeInTheDocument();
  });

  it("sin grupos muestra el estado vacío (y sin paquetes grupales, el motivo)", async () => {
    setup([], () => mockApi("get", "/packages/my-packages", []));
    expect(await screen.findByText(/Necesitas al menos un paquete marcado como grupal/)).toBeInTheDocument();
  });

  it("si falla la carga ofrece reintentar", async () => {
    setup([], () => mockApiError("get", /^\/cohorts\/teacher/, 500, "x"));
    expect(await screen.findByRole("button", { name: /Reintentar/ })).toBeInTheDocument();
  });

  it("el chat grupal abre la conversación y navega", async () => {
    mockApi("post", /^\/chat\/.*group/, { id: 1 });
    const { user } = setup();
    await user.click(await screen.findByTitle("Chat grupal"));
    await waitFor(() => expect(routerState.router.push).toHaveBeenCalledWith("/teacher/chat"));
  });
});

describe("Grupos · crear", () => {
  it("crear un grupo manda paquete y cupos", async () => {
    mockApi("post", "/cohorts/", { id: 9 });
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: /Nuevo grupo/ }));
    await user.selectOptions(await screen.findByRole("combobox"), "5");
    await user.click(screen.getByRole("button", { name: /Crear Grupo/ }));
    await waitFor(() => expect(callsTo("post", "/cohorts/")).toHaveLength(1));
    expect(callsTo("post", "/cohorts/")[0].body).toMatchObject({ package_id: 5 });
    expect(await screen.findByText("Grupo creado correctamente")).toBeInTheDocument();
  });

  it("un error al crear se avisa", async () => {
    mockApiError("post", "/cohorts/", 400, "Ya tienes un grupo abierto de este paquete");
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: /Nuevo grupo/ }));
    await user.selectOptions(await screen.findByRole("combobox"), "5");
    await user.click(screen.getByRole("button", { name: /Crear Grupo/ }));
    expect(await screen.findByText("Ya tienes un grupo abierto de este paquete")).toBeInTheDocument();
  });
});

describe("Grupos · acciones por estado", () => {
  it("filling: abortar pide confirmación y llama a /cancel", async () => {
    mockApi("post", "/cohorts/1/cancel", {});
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: /Abortar \/ Cancelar/ }));
    await user.click(await screen.findByRole("button", { name: "Abortar grupo" }));
    await waitFor(() => expect(callsTo("post", "/cohorts/1/cancel")).toHaveLength(1));
    expect(await screen.findByText("Grupo cancelado correctamente")).toBeInTheDocument();
  });

  it("un error al abortar se avisa", async () => {
    mockApiError("post", "/cohorts/1/cancel", 409, "Ya arrancó una clase");
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: /Abortar \/ Cancelar/ }));
    await user.click(await screen.findByRole("button", { name: "Abortar grupo" }));
    expect(await screen.findByText("Ya arrancó una clase")).toBeInTheDocument();
  });

  it("«Cerrar con integrantes actuales» está desactivado sin alumnos", async () => {
    setup([COHORT({ current_students: 0 })]);
    expect(await screen.findByRole("button", { name: /Cerrar con integrantes actuales/ })).toBeDisabled();
  });

  it("confirmed: finalizar y reabrir", async () => {
    mockApi("post", "/cohorts/1/complete", {});
    mockApi("post", "/cohorts/1/reopen", {});
    const { user } = setup([COHORT({ status: "confirmed", current_students: 3 })]);
    await user.click(await screen.findByRole("button", { name: /Reabrir/ }));
    await user.click(await screen.findByRole("button", { name: "Reabrir", hidden: false }).catch(() => screen.getAllByRole("button", { name: "Reabrir" }).at(-1)!));
    await waitFor(() => expect(callsTo("post", "/cohorts/1/reopen")).toHaveLength(1));
    expect(await screen.findByText(/Grupo reabierto/)).toBeInTheDocument();
  });

  it("in_progress: finalizar pide confirmación y llama a /complete", async () => {
    mockApi("post", "/cohorts/1/complete", {});
    const { user } = setup([COHORT({ status: "in_progress", current_students: 3 })]);
    await user.click(await screen.findByRole("button", { name: /Finalizar grupo/ }));
    await user.click(await screen.findByRole("button", { name: "Finalizar" }));
    await waitFor(() => expect(callsTo("post", "/cohorts/1/complete")).toHaveLength(1));
    expect(await screen.findByText("Grupo finalizado correctamente")).toBeInTheDocument();
  });

  it("un error al finalizar se avisa", async () => {
    mockApiError("post", "/cohorts/1/complete", 400, "Faltan sesiones por cerrar");
    const { user } = setup([COHORT({ status: "in_progress", current_students: 3 })]);
    await user.click(await screen.findByRole("button", { name: /Finalizar grupo/ }));
    await user.click(await screen.findByRole("button", { name: "Finalizar" }));
    expect(await screen.findByText("Faltan sesiones por cerrar")).toBeInTheDocument();
  });

  it("editar cupo: no admite menos que los inscritos y guarda con PATCH", async () => {
    mockApi("patch", "/cohorts/1", {});
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: /Editar cupo/ }));
    await screen.findByText(/No puede ser menor que los 2 ya inscritos/);
    const inputs = screen.getAllByRole("spinbutton");
    const max = inputs[inputs.length - 1];
    await user.clear(max);
    await user.type(max, "8");
    await user.click(screen.getByRole("button", { name: /Guardar cambios/ }));
    await waitFor(() => expect(callsTo("patch", "/cohorts/1")).toHaveLength(1));
    expect(callsTo("patch", "/cohorts/1")[0].body).toMatchObject({ max_students: 8 });
    expect(await screen.findByText("Cupo del grupo actualizado")).toBeInTheDocument();
  });

  it("un error al editar el cupo se avisa", async () => {
    mockApiError("patch", "/cohorts/1", 400, "Cupo inválido");
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: /Editar cupo/ }));
    await user.click(await screen.findByRole("button", { name: /Guardar cambios/ }));
    expect(await screen.findByText("Cupo inválido")).toBeInTheDocument();
  });
});

describe("Grupos · integrantes, sesiones y asistencia", () => {
  async function expand(user: ReturnType<typeof userEvent.setup>) {
    await screen.findByText("Grupal B1");
    const card = screen.getByText("Grupal B1").closest("div[class*='rounded']") as HTMLElement;
    const buttons = within(card.parentElement as HTMLElement).getAllByRole("button");
    // el chevrón es el último botón de la cabecera, antes de las acciones: se localiza por su posición en la tarjeta
    const toggle = buttons.find(b => b.querySelector("svg") && !b.textContent?.trim() && b.title !== "Chat grupal")!;
    await user.click(toggle);
  }

  it("expandir muestra integrantes (con pago pendiente) y sesiones", async () => {
    const { user } = setup();
    await expand(user);
    expect(await screen.findByText("Ana Pérez")).toBeInTheDocument();
    expect(screen.getByText("Pago pendiente")).toBeInTheDocument();
    expect(screen.getByText(/Integrantes \(2\/6\)/)).toBeInTheDocument();
    expect(await screen.findByText(/2 alumno\(s\)/)).toBeInTheDocument();
  });

  it("filling sin sesiones pide cerrar el grupo", async () => {
    const { user } = setup([COHORT()], () => mockApi("get", "/cohorts/1/sessions", []));
    await expand(user);
    expect(await screen.findByText("Cierra el grupo para poder agendar sesiones.")).toBeInTheDocument();
  });

  it("sin alumnos lo dice", async () => {
    const { user } = setup([COHORT()], () => mockApi("get", "/cohorts/1/members", []));
    await expand(user);
    expect(await screen.findByText("Todavía no hay ningún alumno inscrito en este grupo.")).toBeInTheDocument();
  });

  it("asistencia: lista los alumnos de la sesión y marca presente / ausente", async () => {
    mockApi("get", "/cohorts/sessions/31/participants", [
      { student_id: 7, student_name: "Ana Pérez", attendance_status: "cancelled" },
      { student_id: 8, student_name: "Luis Gómez", attendance_status: "confirmed" },
    ]);
    mockApi("patch", /^\/cohorts\/sessions\/31\/participants\/\d+\/attendance/, {});
    const { user } = setup();
    await expand(user);
    await user.click(await screen.findByText(/2 alumno\(s\)/));
    expect(await screen.findByText("Asistencia de la sesión")).toBeInTheDocument();
    await user.click((await screen.findAllByTitle("Marcar como asistió"))[0]);
    await waitFor(() => expect(callsTo("patch", /attendance/)).toHaveLength(1));
    expect(callsTo("patch", /attendance/)[0].body).toEqual({ attendance_status: "confirmed" });
    expect(await screen.findByText("Asistencia marcada como confirmada")).toBeInTheDocument();
    await user.click(screen.getAllByTitle("Marcar como no asistió")[1]);
    expect(await screen.findByText("Asistencia marcada como ausente")).toBeInTheDocument();
  });

  it("un error al marcar asistencia se muestra", async () => {
    mockApi("get", "/cohorts/sessions/31/participants", [{ student_id: 7, student_name: "Ana Pérez", attendance_status: "cancelled" }]);
    mockApiError("patch", /attendance/, 400, "La sesión ya cerró");
    const { user } = setup();
    await expand(user);
    await user.click(await screen.findByText(/2 alumno\(s\)/));
    await user.click((await screen.findAllByTitle("Marcar como asistió"))[0]);
    expect(await screen.findByText("La sesión ya cerró")).toBeInTheDocument();
  });

  it("si falla la lista de asistencia lo dice", async () => {
    mockApiError("get", "/cohorts/sessions/31/participants", 500, "Sin conexión con el servidor");
    const { user } = setup();
    await expand(user);
    await user.click(await screen.findByText(/2 alumno\(s\)/));
    expect(await screen.findByText("Sin conexión con el servidor")).toBeInTheDocument();
  });

  it("historial de asistencia acumulado por alumno", async () => {
    mockApi("get", "/cohorts/1/attendance-summary", [
      { student_id: 7, student_name: "Ana Pérez", sessions_total: 4, sessions_confirmed: 3, sessions_no_show: 1 },
      { student_id: 8, student_name: "Luis Gómez", sessions_total: 4, sessions_confirmed: 4, sessions_no_show: 0 },
    ]);
    const { user } = setup();
    await expand(user);
    await user.click(await screen.findByRole("button", { name: /Ver historial de asistencia/ }));
    expect(await screen.findByText("3/4 (75%)")).toBeInTheDocument();
    expect(screen.getByText("1 inasistencia")).toBeInTheDocument();
    expect(screen.getByText("4/4 (100%)")).toBeInTheDocument();
  });

  it("sin sesiones ya realizadas no ofrece el historial", async () => {
    const { user } = setup([COHORT()], () => mockApi("get", "/cohorts/1/sessions", [SESSION({ start_time_utc: FUTURE })]));
    await expand(user);
    await screen.findByText(/2 alumno\(s\)/);
    expect(screen.queryByRole("button", { name: /Ver historial de asistencia/ })).not.toBeInTheDocument();
  });
});

describe("Grupos · cerrar y agendar sesión", () => {
  const SLOT_START = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const SLOTS = [{ start_time_utc: SLOT_START, end_time_utc: SLOT_START, duration_minutes: 50, is_preferred: false, is_available: true, is_past: false, too_soon: false }];
  /** Elige el último día habilitado del mes mostrado en el calendario del selector. */
  async function pickDay(user: ReturnType<typeof userEvent.setup>) {
    const days = Array.from(document.querySelectorAll<HTMLButtonElement>(".grid-cols-7 button")).filter((b) => !b.disabled);
    await user.click(days[days.length - 1]);
  }
  const pickSlot = async (user: ReturnType<typeof userEvent.setup>) => {
    const slotBtn = await waitFor(() => {
      const b = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((x) => /\d{1,2}:\d{2}/.test(x.textContent ?? "") && !x.disabled && x.closest("[class*='grid-cols-2'], [class*='grid-cols-3'], [class*='grid-cols-4']"));
      if (!b) throw new Error("sin horarios");
      return b;
    });
    await user.click(slotBtn);
  };

  it("cerrar un grupo con menos del mínimo pide confirmar y manda fecha y duración del horario elegido", async () => {
    mockApi("post", "/cohorts/1/close", {});
    mockApi("get", /^\/availability\/.*\/slots/, SLOTS);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: /Cerrar con integrantes actuales/ }));
    expect(await screen.findByText(/Tienes 2 de los 3 alumnos/)).toBeInTheDocument();
    await pickDay(user);
    await pickSlot(user);
    await user.click(screen.getAllByRole("button", { name: /Confirmar cierre/ }).at(-1)!);
    await waitFor(() => expect(callsTo("post", "/cohorts/1/close")).toHaveLength(1));
    expect(callsTo("post", "/cohorts/1/close")[0].body).toMatchObject({ start_date: SLOT_START, duration_minutes: 50 });
    expect(await screen.findByText("Grupo cerrado e iniciado correctamente")).toBeInTheDocument();
  });

  it("si no confirma el cierre con menos alumnos, no llama", async () => {
    mockApi("get", /^\/availability\/.*\/slots/, SLOTS);
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: /Cerrar con integrantes actuales/ }));
    await pickDay(user);
    await pickSlot(user);
    await user.click(screen.getAllByRole("button", { name: /Confirmar cierre/ }).at(-1)!);
    expect(callsTo("post", "/cohorts/1/close")).toHaveLength(0);
  });

  it("un error al cerrar se avisa", async () => {
    mockApiError("post", "/cohorts/1/close", 409, "Horario ocupado");
    mockApi("get", /^\/availability\/.*\/slots/, SLOTS);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: /Cerrar con integrantes actuales/ }));
    await pickDay(user);
    await pickSlot(user);
    await user.click(screen.getAllByRole("button", { name: /Confirmar cierre/ }).at(-1)!);
    expect(await screen.findByText("Horario ocupado")).toBeInTheDocument();
  });

  it("paquete de horario fijo: ofrece las coincidencias del patrón y agenda toda la serie", async () => {
    mockApi("post", "/cohorts/1/close", {});
    const first = new Date(Date.now() + 6 * 86_400_000);
    const { user } = setup([COHORT({ current_students: 3 })], () => {
      mockApi("get", "/packages/my-packages", [{ ...GROUP_PKG, group_schedule_mode: "fixed", group_recurring_days_of_week: [0], group_recurring_time_local: "18:00" }]);
      mockApi("get", /^\/cohorts\/1\/recurring-candidates/, [
        { start_time_utc: first.toISOString(), available: true, reason: null },
        { start_time_utc: new Date(first.getTime() + 7 * 86_400_000).toISOString(), available: false, reason: "Ocupado" },
      ]);
    });
    await user.click(await screen.findByRole("button", { name: /Cerrar con integrantes actuales/ }));
    expect(await screen.findByText(/Este paquete tiene horario fijo/)).toBeInTheDocument();
    const days = Array.from(document.querySelectorAll<HTMLButtonElement>(".grid-cols-7 button")).filter((b) => !b.disabled);
    await user.click(days[0]);
    await user.click(screen.getAllByRole("button", { name: /Confirmar cierre/ }).at(-1)!);
    await waitFor(() => expect(callsTo("post", "/cohorts/1/close")).toHaveLength(1));
    expect(await screen.findByText(/se agendaron todas las sesiones automáticamente/)).toBeInTheDocument();
  });

  it("agendar sesión: elige día y horario y avisa de los alumnos omitidos por solape", async () => {
    mockApi("post", "/cohorts/1/sessions", { skipped_participants: [{ student_name: "Luis Gómez" }] });
    mockApi("get", /^\/availability\/.*\/slots/, SLOTS);
    const { user } = setup([COHORT({ status: "confirmed", current_students: 3 })]);
    await user.click(await screen.findByRole("button", { name: /Agendar sesión/ }));
    await screen.findByText("Agendar sesión grupal");
    await pickDay(user);
    await pickSlot(user);
    await user.click(screen.getByRole("button", { name: /^Agendar$/ }));
    await waitFor(() => expect(callsTo("post", "/cohorts/1/sessions")).toHaveLength(1));
    expect(callsTo("post", "/cohorts/1/sessions")[0].body).toMatchObject({ start_time_utc: SLOT_START, duration_minutes: 50 });
    expect(await screen.findByText("Sesión agendada correctamente")).toBeInTheDocument();
    expect(await screen.findByText(/solape de horario a: Luis Gómez/)).toBeInTheDocument();
  });

  it("un error al agendar la sesión se avisa", async () => {
    mockApiError("post", "/cohorts/1/sessions", 400, "Fuera de tu disponibilidad");
    mockApi("get", /^\/availability\/.*\/slots/, SLOTS);
    const { user } = setup([COHORT({ status: "confirmed", current_students: 3 })]);
    await user.click(await screen.findByRole("button", { name: /Agendar sesión/ }));
    await screen.findByText("Agendar sesión grupal");
    await pickDay(user);
    await pickSlot(user);
    await user.click(screen.getByRole("button", { name: /^Agendar$/ }));
    expect(await screen.findByText("Fuera de tu disponibilidad")).toBeInTheDocument();
  });
});
