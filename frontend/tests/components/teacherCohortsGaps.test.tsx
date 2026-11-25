/**
 * Grupos del profesor · ramas que las otras pruebas no recorren: fecha de inicio, chat apagado, avatar de los integrantes,
 * tasas de asistencia en sus tres tramos, errores silenciosos y modales que se cierran sin hacer nada.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { screen, waitFor, within } from "@testing-library/react";
import CohortsPage from "@/app/(teacher)/teacher/cohorts/page";
import { renderScreen } from "./render";
import { mockApi, mockApiError, callsTo, FIXTURE } from "./fakeApi";

const COHORT = (over: Record<string, unknown> = {}) => ({
  id: 1, package_id: 5, package_name: "Grupal B1", teacher_id: 3, start_date: null, status: "filling",
  min_students: 3, max_students: 6, current_students: 2, created_at: "2026-01-01T00:00:00Z", closed_at: null, ...over,
});
const GROUP_PKG = { id: 5, name: "Grupal B1", subject: "Inglés", is_group: true, min_students: 3, max_students: 6, classes_count: 8, price: 80, duration_minutes: 50, is_active: true, group_schedule_mode: "manual" };
const PAST = new Date(Date.now() - 5 * 86_400_000).toISOString();
const SESSION = { id: 31, cohort_id: 1, start_time_utc: PAST, end_time_utc: PAST, duration: 50, status: "scheduled", participant_count: 2 };
const member = (id: number, name: string, over: Record<string, unknown> = {}) =>
  ({ enrollment_id: id, student_id: id, student_name: name, student_avatar: null, payment_status: "paid", joined_at: "2026-01-02T00:00:00Z", ...over });

function setup(cohorts: unknown[] = [COHORT()], extra?: () => void) {
  mockApi("get", /^\/cohorts\/teacher/, cohorts);
  mockApi("get", "/packages/my-packages", [GROUP_PKG]);
  mockApi("get", "/cohorts/1/members", [member(1, "Ana Pérez")]);
  mockApi("get", "/cohorts/1/sessions", [SESSION]);
  extra?.();
  const view = renderScreen(<CohortsPage />, { role: "teacher" });
  return { ...view, user: userEvent.setup() };
}
async function expand(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByText("Grupal B1");
  const card = screen.getByText("Grupal B1").closest("div[class*='rounded']") as HTMLElement;
  const toggle = within(card.parentElement as HTMLElement).getAllByRole("button").find((b) => b.querySelector("svg") && !b.textContent?.trim() && b.title !== "Chat grupal")!;
  await user.click(toggle);
}

afterEach(() => { vi.restoreAllMocks(); });

describe("Grupos · tarjeta", () => {
  it("con fecha de inicio la muestra", async () => {
    setup([COHORT({ start_date: "2026-03-10T15:00:00Z" })]);
    expect(await screen.findByText(/Inicia el/)).toBeInTheDocument();
  });

  it("sin fecha de inicio no hay línea de inicio", async () => {
    setup();
    await screen.findByText("Grupal B1");
    expect(screen.queryByText(/Inicia el/)).not.toBeInTheDocument();
  });

  it("con el chat apagado no hay botón de chat grupal", async () => {
    setup([COHORT()], () => mockApi("get", /^\/platform\/config|^\/public\/config|^\/payments\/config|^\/admin\/platform-config/, { ...FIXTURE.platformConfig, chat_enabled: false }));
    await screen.findByText("Grupal B1");
    await waitFor(() => expect(screen.queryByTitle("Chat grupal")).not.toBeInTheDocument());
  });

  it("completo o confirmado no avisa del mínimo", async () => {
    setup([COHORT({ current_students: 4 })]);
    await screen.findByText("Grupal B1");
    expect(screen.queryByText(/debajo del mínimo sugerido/)).not.toBeInTheDocument();
  });

  it("si solo hay grupos de otro estado, la pestaña activa lo dice", async () => {
    setup([COHORT({ status: "completed" })]);
    expect(await screen.findByText(/Activos \(0\)/)).toBeInTheDocument();
  });
});

describe("Grupos · integrantes y sesiones", () => {
  it("un integrante con avatar muestra la imagen y uno sin avatar, su inicial", async () => {
    const { user } = setup([COHORT()], () => mockApi("get", "/cohorts/1/members", [
      member(1, "Ana Pérez", { student_avatar: "https://cdn.test/ana.png" }), member(2, "luis gómez"),
    ]));
    await expand(user);
    await screen.findByText("Ana Pérez");
    expect(document.querySelector("img[src='https://cdn.test/ana.png']")).not.toBeNull();
    expect(screen.getByText("L")).toBeInTheDocument();
  });

  it("si falla la carga de sesiones, la sección queda sin romper y se puede volver a plegar", async () => {
    const { user } = setup([COHORT()], () => mockApiError("get", "/cohorts/1/sessions", 500, "x"));
    await expand(user);
    expect(await screen.findByText("Ana Pérez")).toBeInTheDocument();
    expect(screen.getByText("Cargando sesiones…")).toBeInTheDocument();
    await expand(user);
    await waitFor(() => expect(screen.queryByText("Ana Pérez")).not.toBeInTheDocument());
  });

  it("un grupo no «filling» sin sesiones dice que todavía no hay agendadas", async () => {
    const { user } = setup([COHORT({ status: "confirmed", current_students: 3 })], () => mockApi("get", "/cohorts/1/sessions", []));
    await expand(user);
    expect(await screen.findByText("Todavía no hay sesiones agendadas.")).toBeInTheDocument();
  });
});

describe("Grupos · historial de asistencia", () => {
  const open = async (user: ReturnType<typeof userEvent.setup>) => {
    await expand(user);
    await user.click(await screen.findByRole("button", { name: /Ver historial de asistencia/ }));
  };

  it("tramos de asistencia: ≥80 %, ≥50 %, menos, y alumno sin sesiones", async () => {
    mockApi("get", "/cohorts/1/attendance-summary", [
      { student_id: 1, student_name: "Alta", sessions_total: 5, sessions_confirmed: 5, sessions_no_show: 0 },
      { student_id: 2, student_name: "Media", sessions_total: 4, sessions_confirmed: 2, sessions_no_show: 2 },
      { student_id: 3, student_name: "Baja", sessions_total: 4, sessions_confirmed: 1, sessions_no_show: 3 },
      { student_id: 4, student_name: "Nueva", sessions_total: 0, sessions_confirmed: 0, sessions_no_show: 0 },
    ]);
    const { user } = setup();
    await open(user);
    expect(await screen.findByText("5/5 (100%)")).toHaveClass("text-emerald-600");
    expect(screen.getByText("2/4 (50%)")).toHaveClass("text-amber-600");
    expect(screen.getByText("1/4 (25%)")).toHaveClass("text-rose-600");
    expect(screen.getByText("0/0 (0%)")).toHaveClass("text-rose-600");
    expect(screen.getByText("3 inasistencias")).toBeInTheDocument();
  });

  it("sin datos dice que todavía no hay sesiones pasadas", async () => {
    mockApi("get", "/cohorts/1/attendance-summary", []);
    const { user } = setup();
    await open(user);
    expect(await screen.findByText(/Todavía no hay sesiones pasadas/)).toBeInTheDocument();
  });

  it("si falla la carga muestra el motivo", async () => {
    mockApiError("get", "/cohorts/1/attendance-summary", 500, "Historial no disponible");
    const { user } = setup();
    await open(user);
    expect(await screen.findByText("Historial no disponible")).toBeInTheDocument();
  });
});

describe("Grupos · acciones sin datos", () => {
  it("crear sin elegir paquete no llama al servidor", async () => {
    mockApi("post", "/cohorts/", {});
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: /Nuevo grupo|Crear grupo/ }));
    const submit = (await screen.findAllByRole("button", { name: /^Crear/ })).pop()!;
    await user.click(submit);
    expect(callsTo("post", "/cohorts/")).toHaveLength(0);
  });
});

describe("Grupos · finalizar, horarios y asistencia", () => {
  const SLOT_START = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const slot = (over: Record<string, unknown>) => ({ start_time_utc: SLOT_START, end_time_utc: SLOT_START, duration_minutes: 50, is_preferred: false, is_available: true, is_past: false, too_soon: false, ...over });
  const pickDay = async (user: ReturnType<typeof userEvent.setup>) => {
    const days = Array.from(document.querySelectorAll<HTMLButtonElement>(".grid-cols-7 button")).filter((b) => !b.disabled);
    await user.click(days[days.length - 1]);
  };
  const openScheduler = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(await screen.findByRole("button", { name: /Agendar sesión/ }));
    await screen.findByText("Agendar sesión grupal");
    await pickDay(user);
  };
  const confirmed = () => COHORT({ status: "confirmed", current_students: 3 });

  it("finalizar un grupo bajo el mínimo avisa de que se cancelan las inscripciones y usa el estilo de peligro", async () => {
    const { user } = setup([COHORT({ status: "in_progress", current_students: 2 })]);
    await user.click(await screen.findByRole("button", { name: /Finalizar grupo/ }));
    expect(await screen.findByText(/NO llegó al mínimo \(2 de 3 alumnos\)/)).toBeInTheDocument();
  });

  it("finalizar un grupo que sí llegó al mínimo lo dice", async () => {
    const { user } = setup([COHORT({ status: "in_progress", current_students: 3 })]);
    await user.click(await screen.findByRole("button", { name: /Finalizar grupo/ }));
    expect(await screen.findByText(/alcanzó el mínimo de alumnos/)).toBeInTheDocument();
  });

  it("un día sin huecos libres muestra «Sin disponibilidad»", async () => {
    mockApi("get", /^\/availability\/.*\/slots/, []);
    const { user } = setup([confirmed()]);
    await openScheduler(user);
    expect(await screen.findByText("Sin disponibilidad")).toBeInTheDocument();
  });

  it("los horarios no disponibles salen bloqueados con su motivo", async () => {
    const t = (h: number) => new Date(Date.now() + 7 * 86_400_000 + h * 3_600_000).toISOString();
    mockApi("get", /^\/availability\/.*\/slots/, [
      slot({ start_time_utc: t(0), is_past: true }), slot({ start_time_utc: t(1), too_soon: true }),
      slot({ start_time_utc: t(2), is_available: false }), slot({ start_time_utc: t(3) }),
    ]);
    const { user } = setup([confirmed()]);
    await openScheduler(user);
    expect(await screen.findByText("Pasado")).toBeInTheDocument();
    expect(screen.getByText("Muy pronto")).toBeInTheDocument();
    expect(screen.getByText("Ocupado")).toBeInTheDocument();
    const blocked = screen.getByText("Pasado").closest("button")!;
    expect(blocked).toBeDisabled();
  });

  it("elegir un horario lo marca como seleccionado", async () => {
    mockApi("get", /^\/availability\/.*\/slots/, [slot({})]);
    const { user } = setup([confirmed()]);
    await openScheduler(user);
    const btn = await waitFor(() => {
      const b = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((x) => /\d{1,2}:\d{2}/.test(x.textContent ?? "") && !x.disabled && x.className.includes("border-2"));
      if (!b) throw new Error("sin horario");
      return b;
    });
    await user.click(btn);
    expect(btn.className).toContain("border-pink-500");
  });

  it("una sesión sin integrantes activos lo dice", async () => {
    mockApi("get", "/cohorts/sessions/31/participants", []);
    const { user } = setup();
    await expand(user);
    await user.click(await screen.findByText(/2 alumno\(s\)/));
    expect(await screen.findByText("No hay integrantes activos en esta sesión.")).toBeInTheDocument();
  });

  it("elegir un paquete sin cupos propios conserva los del formulario", async () => {
    mockApi("get", "/packages/my-packages", [{ ...GROUP_PKG, min_students: null, max_students: null }]);
    const { user } = setup([COHORT()], () => mockApi("get", "/packages/my-packages", [{ ...GROUP_PKG, min_students: null, max_students: null }]));
    await user.click(await screen.findByRole("button", { name: /Nuevo grupo|Crear grupo/ }));
    const select = (await screen.findAllByRole("combobox")).find((c) => within(c).queryByText("Selecciona un paquete…"))!;
    const before = Array.from(document.querySelectorAll<HTMLInputElement>("input[type=number]")).map((i) => i.value);
    await user.selectOptions(select, "5");
    const after = Array.from(document.querySelectorAll<HTMLInputElement>("input[type=number]")).map((i) => i.value);
    expect(after).toEqual(before);
  });
});
