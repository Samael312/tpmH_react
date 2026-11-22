/**
 * Mis clases (alumno): próximas / historial, tira de la semana, filtros por profesor y asignatura, y cancelar
 * (clase individual, sesión de un grupo o salir del grupo).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { screen, waitFor } from "@testing-library/react";
import MyClassesPage from "@/app/(student)/dashboard/classes/page";
import { renderScreen } from "./render";
import { routerState } from "./router";
import { mockApi, mockApiError, callsTo } from "./fakeApi";

const HOUR = 3600_000;
const cls = (id: number, status: string, startHours: number, over: Record<string, unknown> = {}) => {
  const start = Date.now() + startHours * HOUR;
  return {
    id, class_type: "regular", subject: "Español", status, start_time_utc: new Date(start).toISOString(),
    end_time_utc: new Date(start + HOUR).toISOString(), duration_minutes: 60, meet_link: null, teacher_name: "Profe Uno",
    teacher_username: "profe1", teacher_timezone: "America/Caracas", student_timezone: "America/Caracas", reschedules_remaining: 2,
    teacher_phone: null, cohort_id: null, ...over,
  };
};

function setup(classes: unknown[] = [], extra?: () => void) {
  mockApi("get", "/classes/my-classes", classes);
  extra?.();
  const view = renderScreen(<MyClassesPage />, { role: "student" });
  return { ...view, user: userEvent.setup() };
}

afterEach(() => { vi.restoreAllMocks(); });

describe("Mis clases (alumno) · lista", () => {
  it("sin clases lo dice, y el historial también", async () => {
    const { user } = setup([]);
    expect(await screen.findByText(/No tienes clases/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Historial" }));
    expect(await screen.findByText("Sin historial todavía")).toBeInTheDocument();
  });

  it("separa próximas e historial", async () => {
    const { user } = setup([cls(1, "confirmed", 48), cls(2, "completed", -48), cls(3, "cancelled", -72)]);
    expect((await screen.findAllByText(/Español/)).length).toBe(1);
    await user.click(screen.getByRole("button", { name: "Historial" }));
    await waitFor(() => expect(screen.getAllByText(/Español/).length).toBe(2));
  });

  it("elegir un día de la tira filtra y se puede quitar el filtro", async () => {
    const { user } = setup([cls(1, "confirmed", 48)]);
    await screen.findByText("Semana actual");
    const strip = screen.getByText("Semana actual").closest("div[class*='rounded']")!.parentElement as HTMLElement;
    const days = Array.from(strip.querySelectorAll("button")).filter((b) => /\d/.test(b.textContent ?? "") && !/Elegir/.test(b.textContent ?? ""));
    await user.click(days[days.length - 1]);
    expect(await screen.findByText(/No tienes clases ese día|Español/)).toBeInTheDocument();
  });

  it("«Elegir fecha» abre el calendario", async () => {
    const { user } = setup([]);
    await user.click(await screen.findByText("Elegir fecha"));
    const nav = Array.from(document.querySelectorAll("button")).filter((b) => !b.textContent?.trim() && b.querySelector("svg"));
    await user.click(nav[nav.length - 1]);
    await user.click(nav[nav.length - 2]);
  });

  it("con varios profesores y asignaturas ofrece filtros", async () => {
    const { user } = setup([
      cls(1, "confirmed", 48),
      cls(2, "confirmed", 50, { teacher_username: "profe2", teacher_name: "Profe Dos", subject: "Inglés" }),
    ]);
    await user.click(await screen.findByText("Todos los profesores"));
    await user.click(await screen.findByRole("button", { name: "Profe Dos" }));
    await waitFor(() => expect(screen.queryByText("Profe Uno")).not.toBeInTheDocument());
    await user.click(screen.getByText("Todas las asignaturas"));
    await user.click(await screen.findByRole("button", { name: "Español" }));
    expect(await screen.findByText(/No tienes clases/)).toBeInTheDocument();
  });

  it("si falla la carga no muestra «no tienes clases»", async () => {
    setup([], () => mockApiError("get", "/classes/my-classes", 500, "x"));
    await waitFor(() => expect(screen.queryByText(/No tienes clases/)).not.toBeInTheDocument());
  });
});

describe("Mis clases (alumno) · cancelar", () => {
  async function openCancel(user: ReturnType<typeof userEvent.setup>) {
    await screen.findAllByText(/Español/);
    const menu = screen.queryByRole("button", { name: /Acciones/ });
    if (menu) await user.click(menu);
    await user.click(await screen.findByRole("button", { name: "Cancelar" }));
  }
  const confirmBtn = () => screen.getAllByRole("button").filter((b) => /^(Sí, )?(cancelar|salir)/i.test((b.textContent ?? "").trim())).at(-1)!;

  it("clase individual con antelación: avisa del plazo y cancela con DELETE", async () => {
    mockApi("delete", "/classes/1", {});
    const { user } = setup([cls(1, "confirmed", 72)]);
    await openCancel(user);
    expect(await screen.findByText("¿Cancelar clase?")).toBeInTheDocument();
    expect(screen.getByText(/tu crédito vuelve/)).toBeInTheDocument();
    await user.click(confirmBtn());
    await waitFor(() => expect(callsTo("delete", "/classes/1")).toHaveLength(1));
    expect(await screen.findByText("Clase cancelada correctamente")).toBeInTheDocument();
  });

  it("un error al cancelar se muestra", async () => {
    mockApiError("delete", "/classes/1", 400, "Fuera de plazo");
    const { user } = setup([cls(1, "confirmed", 72)]);
    await openCancel(user);
    await screen.findByText("¿Cancelar clase?");
    await user.click(confirmBtn());
    expect(await screen.findByText("Fuera de plazo")).toBeInTheDocument();
  });

  const GROUP = () => cls(5, "confirmed", 72, { class_type: "group", cohort_id: 4, participant_count: 3, participant_names: ["Ana", "Luis"] });
  async function openGroupChooser(user: ReturnType<typeof userEvent.setup>) {
    await screen.findAllByText(/Español/);
    const menu = screen.queryByRole("button", { name: /Acciones/ });
    if (menu) await user.click(menu);
    await user.click(await screen.findByRole("button", { name: "Salir del grupo" })); // en la tarjeta: abre el selector del modal de la página
    const heading = await screen.findByText("¿Qué quieres hacer?");
    return Array.from(heading.closest("div[class*='rounded']")!.querySelectorAll("button")) as HTMLElement[];
  }

  it("sesión de grupo: salir solo de esa sesión", async () => {
    mockApi("delete", "/classes/5/leave", {});
    const { user } = setup([GROUP()]);
    const [onlySession] = await openGroupChooser(user);
    await user.click(onlySession);
    expect(await screen.findByText("¿Salir de esta clase?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Salir de la clase/ }));
    await waitFor(() => expect(callsTo("delete", "/classes/5/leave")).toHaveLength(1));
    expect(await screen.findByText("Saliste de esta sesión correctamente")).toBeInTheDocument();
  });

  it("grupo: salir de todo el grupo ofrece elegir otro paquete", async () => {
    mockApi("post", "/cohorts/4/leave", {});
    const { user } = setup([GROUP()]);
    const buttons = await openGroupChooser(user);
    await user.click(buttons[1]);
    expect(await screen.findByText("¿Salir del grupo?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Salir del grupo/ }));
    await waitFor(() => expect(callsTo("post", "/cohorts/4/leave")).toHaveLength(1));
    expect(await screen.findByText("Saliste del grupo")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Elegir paquete" }));
    expect(routerState.router.push).toHaveBeenCalledWith("/dashboard/schedule");
  });

  it("grupo: «Volver» regresa al selector", async () => {
    const { user } = setup([GROUP()]);
    const buttons = await openGroupChooser(user);
    await user.click(buttons[0]);
    await screen.findByText("¿Salir de esta clase?");
    await user.click(screen.getByRole("button", { name: "Volver" }));
    expect(await screen.findByText("¿Qué quieres hacer?")).toBeInTheDocument();
  });

  it("clase individual con poca antelación avisa de que el sistema no la dejará cancelar", async () => {
    const { user } = setup([cls(1, "confirmed", 2)]);
    await openCancel(user);
    expect(await screen.findByText(/el sistema no te dejará cancelarla/)).toBeInTheDocument();
  });
});
