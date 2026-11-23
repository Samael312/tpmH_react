/**
 * Tareas del profesor · cierra huecos: avatares, nombres ausentes, selector de fecha (meses y año), hora límite,
 * selección múltiple de alumnos, grupos, búsquedas sin resultado y errores.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import HomeworkPage from "@/app/(teacher)/teacher/homework/page";
import { renderScreen } from "./render";
import { mockApi, mockApiError, callsTo } from "./fakeApi";

const DAY = 86_400_000;
const HW = (over: Record<string, unknown> = {}) => ({
  id: 1, teacher_id: 3, title: "Present Perfect", description: "Haz los ejercicios 1 a 5",
  due_date_utc: new Date(Date.now() + 3 * DAY).toISOString(), is_active: true, created_at: "2026-01-01T00:00:00Z", ...over,
});
const SUB = (over: Record<string, unknown> = {}) => ({
  id: 11, homework_id: 1, student_id: 7, status: "submitted", submission: "Mi respuesta", submitted_at: "2026-01-02T00:00:00Z", score: null,
  feedback: null, graded_at: null, assigned_at: "2026-01-01T00:00:00Z", student_name: "Ana Pérez", student_username: "ana", ...over,
});
const STUDENTS = [
  { id: 7, name: "Ana", surname: "Pérez", username: "ana", avatar: "https://img.example.com/ana.png" },
  { id: 8, name: "Luis", surname: "Gómez", username: "luis", avatar: null },
];

function setup(homeworks: unknown[] = [HW()], subs: unknown[] = [SUB()], extra?: () => void) {
  mockApi("get", "/homework/my-homework", homeworks);
  mockApi("get", "/homework/1/submissions", subs);
  mockApi("get", /^\/teachers\/me\/students/, STUDENTS);
  mockApi("get", /^\/cohorts\/teacher/, []);
  extra?.();
  const view = renderScreen(<HomeworkPage />, { role: "teacher" });
  return { ...view, user: userEvent.setup() };
}
type U = ReturnType<typeof userEvent.setup>;
async function openCreate(user: U) {
  await screen.findByText("Present Perfect");
  await user.click(screen.getByRole("button", { name: /Nueva tarea/ }));
  return screen.findByPlaceholderText("Ej: Ejercicios de Present Perfect");
}
afterEach(() => { vi.restoreAllMocks(); });

describe("Tareas · presentación", () => {
  it("las entregas muestran el avatar del alumno o su inicial, y «Estudiante» si falta el nombre", async () => {
    const { user } = setup([HW()], [
      SUB({ student_avatar: "https://img.example.com/ana.png" }),
      SUB({ id: 12, student_id: 8, student_name: null, status: "pending", submission: null }),
    ]);
    await user.click(await screen.findByText("Present Perfect"));
    await screen.findByText("Ana Pérez");
    expect(screen.getByText("Estudiante")).toBeInTheDocument();
    expect(screen.getByText("?")).toBeInTheDocument();
    expect(document.querySelector("img[alt='Ana Pérez']")).not.toBeNull();
  });

  it("calificar una entrega sin nombre usa «Estudiante» en el modal", async () => {
    const { user } = setup([HW()], [SUB({ student_name: null })]);
    await user.click(await screen.findByText("Present Perfect"));
    await user.click(await screen.findByRole("button", { name: "Calificar" }));
    expect(await screen.findByText("Calificar entrega")).toBeInTheDocument();
    expect(screen.getAllByText("Estudiante").length).toBeGreaterThan(0);
  });

  it("buscar algo que no existe dice que ninguna tarea coincide", async () => {
    const { user } = setup();
    await screen.findByText("Present Perfect");
    await user.type(screen.getByPlaceholderText("Buscar tarea..."), "zzz");
    expect(await screen.findByText("Ninguna tarea coincide con tu búsqueda")).toBeInTheDocument();
  });

  it("si falla la carga lo dice y no se queda sin avisar", async () => {
    mockApiError("get", "/homework/my-homework", 500, "x");
    mockApi("get", /^\/teachers\/me\/students/, STUDENTS);
    mockApi("get", /^\/cohorts\/teacher/, []);
    renderScreen(<HomeworkPage />, { role: "teacher" });
    expect(await screen.findByText(/No se pudieron cargar tus tareas/)).toBeInTheDocument();
  });
});

describe("Tareas · crear", () => {
  async function pickDate(user: U, nav?: (u: U) => Promise<void>) {
    await user.click(screen.getByRole("button", { name: /Seleccionar fecha/ }));
    if (nav) await nav(user);
    const days = Array.from(document.querySelectorAll<HTMLButtonElement>(".grid-cols-7 button")).filter((b) => !b.disabled);
    await user.click(days[days.length - 1]);
  }

  it("el selector de fecha cambia de mes hacia atrás y adelante, también cruzando el año", async () => {
    const { user } = setup();
    await openCreate(user);
    await user.click(screen.getByRole("button", { name: /Seleccionar fecha/ }));
    const header = () => screen.getByText(/^(Ene|Feb|Mar|Abr|May|Jun|Jul|Ago|Sep|Oct|Nov|Dic) \d{4}$/);
    const first = header().textContent;
    const [prev, nextB] = header().parentElement!.querySelectorAll("button");
    for (let i = 0; i < 12; i++) await user.click(nextB as HTMLElement);
    expect(header().textContent).not.toBe(first);
    expect(header().textContent!.split(" ")[0]).toBe(first!.split(" ")[0]);
    for (let i = 0; i < 12; i++) await user.click(prev as HTMLElement);
    expect(header().textContent).toBe(first);
    for (let i = 0; i < 12; i++) await user.click(prev as HTMLElement);
    expect(header().textContent!.split(" ")[0]).toBe(first!.split(" ")[0]);
  });

  it("la fecha elegida se queda marcada al reabrir el selector; la hora límite se envía", async () => {
    mockApi("post", "/homework/", { id: 99 });
    const { user } = setup();
    await user.type(await openCreate(user), "Con hora");
    await user.type(screen.getByPlaceholderText("Describe lo que debe hacer el estudiante..."), "Haz esto");
    await pickDate(user);
    await user.click(screen.getByRole("button", { name: /Seleccionar fecha|\d{4}/ }));
    expect(document.querySelector(".grid-cols-7 button[class*='from-pink-500']")).not.toBeNull();
    fireEvent.change(document.querySelector('input[type="time"]') as HTMLInputElement, { target: { value: "08:30" } });
    await user.click(await screen.findByText(/Ana/));
    await user.click(screen.getByRole("button", { name: /Crear y asignar tarea/ }));
    await waitFor(() => expect(callsTo("post", "/homework/")).toHaveLength(1));
  });

  it("se pueden marcar y desmarcar alumnos y el contador usa singular y plural", async () => {
    const { user } = setup();
    await openCreate(user);
    await user.click(await screen.findByText(/Ana/));
    expect(screen.getByText("1 seleccionado")).toBeInTheDocument();
    await user.click(screen.getByText(/Luis/));
    expect(screen.getByText("2 seleccionados")).toBeInTheDocument();
    await user.click(screen.getByText(/Luis/));
    expect(screen.getByText("1 seleccionado")).toBeInTheDocument();
  });

  it("buscar un alumno que no existe lo dice", async () => {
    const { user } = setup();
    await openCreate(user);
    await user.type(screen.getByPlaceholderText("Buscar por nombre o usuario..."), "zzz");
    expect(await screen.findByText(/Sin resultados para/)).toBeInTheDocument();
  });

  it("un grupo en formación con un solo alumno se describe en singular; quitar el grupo vuelve a alumnos", async () => {
    const { user } = setup([HW()], [SUB()], () => {
      mockApi("get", /^\/cohorts\/teacher/, [{ id: 5, package_name: null, current_students: 1, status: "filling" }]);
      mockApi("get", "/cohorts/5/members", [{ student_id: 7 }]);
    });
    await openCreate(user);
    const select = await screen.findByRole("combobox");
    expect(within(select).getByRole("option", { name: /Grupo — 1 alumno \(/ })).toBeInTheDocument();
    await user.selectOptions(select, "5");
    await user.selectOptions(select, "");
    expect(select).toHaveValue("");
  });

  it("un error sin detalle usa el mensaje genérico", async () => {
    mockApi("post", "/homework/", () => { throw new Error("red"); });
    const { user } = setup();
    await user.type(await openCreate(user), "Nueva");
    await user.type(screen.getByPlaceholderText("Describe lo que debe hacer el estudiante..."), "Haz esto");
    await pickDate(user);
    await user.click(await screen.findByText(/Ana/));
    await user.click(screen.getByRole("button", { name: /Crear y asignar tarea/ }));
    expect(await screen.findByText("Error creando tarea")).toBeInTheDocument();
  });
});

describe("Tareas · editar", () => {
  it("cambiar la hora límite y las instrucciones envía también la fecha en UTC", async () => {
    mockApi("patch", "/homework/1", {});
    const { user } = setup();
    await screen.findByText("Present Perfect");
    await user.click(screen.getAllByText("Editar")[0]);
    const text = await screen.findByDisplayValue("Haz los ejercicios 1 a 5");
    fireEvent.change(text, { target: { value: "Nuevas instrucciones" } });
    const time = document.querySelector('input[type="time"]') as HTMLInputElement;
    fireEvent.change(time, { target: { value: time.value === "05:15" ? "06:45" : "05:15" } });
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(callsTo("patch", "/homework/1")).toHaveLength(1));
    const body = callsTo("patch", "/homework/1")[0].body as Record<string, string>;
    expect(body.description).toBe("Nuevas instrucciones");
    expect(body.due_date_utc).toMatch(/Z$/);
  });
});
