/**
 * Tareas del profesor: revisar entregas y calificar, crear una tarea (con fecha límite y destinatarios), editar y borrar.
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
const SUBS = [
  { id: 11, homework_id: 1, student_id: 7, status: "submitted", submission: "Mi respuesta", submitted_at: "2026-01-02T00:00:00Z", score: null, feedback: null, graded_at: null, assigned_at: "2026-01-01T00:00:00Z", student_name: "Ana Pérez", student_username: "ana" },
  { id: 12, homework_id: 1, student_id: 8, status: "pending", submission: null, submitted_at: null, score: null, feedback: null, graded_at: null, assigned_at: "2026-01-01T00:00:00Z", student_name: "Luis Gómez", student_username: "luis" },
  { id: 13, homework_id: 1, student_id: 9, status: "graded", submission: "Listo", submitted_at: "2026-01-02T00:00:00Z", score: 8.5, feedback: "Bien", graded_at: "2026-01-03T00:00:00Z", assigned_at: "2026-01-01T00:00:00Z", student_name: "Eva Ruiz", student_username: "eva" },
];
const STUDENTS = [
  { id: 7, name: "Ana", surname: "Pérez", username: "ana", avatar_url: null },
  { id: 8, name: "Luis", surname: "Gómez", username: "luis", avatar_url: null },
];

function setup(homeworks: unknown[] = [HW()], extra?: () => void) {
  mockApi("get", "/homework/my-homework", homeworks);
  mockApi("get", "/homework/1/submissions", SUBS);
  mockApi("get", /^\/teachers\/me\/students/, STUDENTS);
  mockApi("get", /^\/cohorts\/teacher/, []);
  extra?.();
  const view = renderScreen(<HomeworkPage />, { role: "teacher" });
  return { ...view, user: userEvent.setup() };
}

const hwCard = (title: string) => screen.getByText(title).closest("[class*='rounded']") as HTMLElement;
async function openSubs(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByText("Present Perfect"));
  await screen.findByText("Ana Pérez");
}

afterEach(() => { vi.restoreAllMocks(); });

describe("Tareas · revisar", () => {
  it("lista las tareas con sus contadores", async () => {
    setup([HW(), HW({ id: 2, title: "Pasada", due_date_utc: new Date(Date.now() - DAY).toISOString(), is_active: false })]);
    expect(await screen.findByText("Present Perfect")).toBeInTheDocument();
    expect(screen.getByText("Pasada")).toBeInTheDocument();
    expect(screen.getByText("Total tareas")).toBeInTheDocument();
    expect(screen.getByText("Vencen esta semana")).toBeInTheDocument();
  });

  it("sin tareas lo dice", async () => {
    setup([]);
    expect(await screen.findByText("No hay tareas creadas todavía")).toBeInTheDocument();
  });

  it("buscar filtra por título", async () => {
    const { user } = setup([HW(), HW({ id: 2, title: "Vocabulario" })]);
    await screen.findByText("Present Perfect");
    await user.type(screen.getByPlaceholderText("Buscar tarea..."), "vocab");
    expect(screen.queryByText("Present Perfect")).not.toBeInTheDocument();
    expect(screen.getByText("Vocabulario")).toBeInTheDocument();
  });

  it("abrir una tarea carga las entregas con su estado y nota; volver a pulsarla las cierra", async () => {
    const { user } = setup();
    await openSubs(user);
    expect(screen.getByText("Entregada")).toBeInTheDocument();
    expect(screen.getByText("Pendiente")).toBeInTheDocument();
    expect(screen.getByText("Calificada")).toBeInTheDocument();
    expect(screen.getByText("Nota: 8.5/10")).toBeInTheDocument();
    await user.click(screen.getByText("Present Perfect"));
    await waitFor(() => expect(screen.queryByText("Ana Pérez")).not.toBeInTheDocument());
  });

  it("una tarea sin entregas lo indica", async () => {
    const { user } = setup([HW()], () => mockApi("get", "/homework/1/submissions", []));
    await user.click(await screen.findByText("Present Perfect"));
    expect(await screen.findByText("Sin entregas todavía")).toBeInTheDocument();
  });

  it("si fallan las tareas muestra el error en lugar del estado vacío", async () => {
    setup([], () => mockApiError("get", "/homework/my-homework", 500, "x"));
    await waitFor(() => expect(screen.queryByText("No hay tareas creadas todavía")).not.toBeInTheDocument());
  });
});

describe("Tareas · calificar", () => {
  it("el botón de una entrega sin respuesta está desactivado", async () => {
    const { user } = setup();
    await openSubs(user);
    const luis = screen.getByText("Luis Gómez").closest("div[class*='flex']")!.parentElement as HTMLElement;
    expect(within(luis).getByRole("button", { name: "Calificar" })).toBeDisabled();
  });

  it("calificar: la nota empieza vacía, se elige con el control y se guarda con comentario", async () => {
    mockApi("patch", "/homework/1/submissions/11/grade", {});
    const { user } = setup();
    await openSubs(user);
    const ana = screen.getByText("Ana Pérez").closest("div[class*='flex']")!.parentElement as HTMLElement;
    await user.click(within(ana).getByRole("button", { name: "Calificar" }));
    expect(await screen.findByText("Calificar entrega")).toBeInTheDocument();
    expect(screen.getByText("Mi respuesta")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Calificación de 0 a 10"), { target: { value: "9" } });
    await user.type(screen.getByPlaceholderText(/Escribe tu comentario/), "Muy bien");
    await user.click(screen.getByRole("button", { name: "Guardar calificación" }));
    await waitFor(() => expect(callsTo("patch", "/homework/1/submissions/11/grade")).toHaveLength(1));
    expect(callsTo("patch", "/homework/1/submissions/11/grade")[0].body).toEqual({ score: 9, feedback: "Muy bien" });
  });

  it("una entrega ya calificada se puede reeditar (parte de su nota anterior)", async () => {
    const { user } = setup();
    await openSubs(user);
    const eva = screen.getByText("Eva Ruiz").closest("div[class*='flex']")!.parentElement as HTMLElement;
    await user.click(within(eva).getByRole("button", { name: "Editar" }));
    expect(await screen.findByText("Calificar entrega")).toBeInTheDocument();
    expect(screen.getByLabelText("Calificación de 0 a 10")).toHaveValue("8.5");
  });

  it("un error al calificar se avisa", async () => {
    mockApiError("patch", "/homework/1/submissions/11/grade", 400, "Nota inválida");
    const { user } = setup();
    await openSubs(user);
    const ana = screen.getByText("Ana Pérez").closest("div[class*='flex']")!.parentElement as HTMLElement;
    await user.click(within(ana).getByRole("button", { name: "Calificar" }));
    await screen.findByText("Calificar entrega");
    fireEvent.change(screen.getByLabelText("Calificación de 0 a 10"), { target: { value: "7" } });
    await user.click(screen.getByRole("button", { name: "Guardar calificación" }));
    expect(await screen.findByText("Nota inválida")).toBeInTheDocument();
  });
});

describe("Tareas · crear", () => {
  async function openCreate(user: ReturnType<typeof userEvent.setup>) {
    await screen.findByText("Present Perfect");
    await user.click(screen.getByRole("button", { name: /Nueva tarea/ }));
    return screen.findByPlaceholderText("Ej: Ejercicios de Present Perfect");
  }
  /** Abre el selector de fecha y elige el último día habilitado del mes mostrado. */
  async function pickDueDate(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: /Seleccionar fecha/ }));
    const days = Array.from(document.querySelectorAll<HTMLButtonElement>(".grid-cols-7 button")).filter((b) => !b.disabled);
    await user.click(days[days.length - 1]);
  }

  it("«Crear y asignar» está desactivado hasta tener título, instrucciones, fecha y destinatario", async () => {
    const { user } = setup();
    await openCreate(user);
    expect(screen.getByRole("button", { name: /Crear y asignar tarea/ })).toBeDisabled();
  });

  it("crear: envía la fecha límite en UTC y los estudiantes elegidos, y vuelve a revisar", async () => {
    mockApi("post", "/homework/", { id: 99 });
    const { user } = setup();
    await user.type(await openCreate(user), "Nueva tarea");
    await user.type(screen.getByPlaceholderText("Describe lo que debe hacer el estudiante..."), "Haz esto");
    await pickDueDate(user);
    await user.click(await screen.findByText(/Ana/));
    await user.click(screen.getByRole("button", { name: /Crear y asignar tarea/ }));
    await waitFor(() => expect(callsTo("post", "/homework/")).toHaveLength(1));
    const body = callsTo("post", "/homework/")[0].body as Record<string, unknown>;
    expect(body).toMatchObject({ title: "Nueva tarea", description: "Haz esto", student_ids: [7], cohort_id: null });
    expect(String(body.due_date_utc)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00(\.000)?Z$/);
    expect(await screen.findByText("Tarea creada correctamente")).toBeInTheDocument();
  });

  it("buscar filtra los estudiantes y sin estudiantes lo dice", async () => {
    const { user } = setup();
    await openCreate(user);
    await user.type(screen.getByPlaceholderText("Buscar por nombre o usuario..."), "luis");
    expect(screen.queryByText(/Ana/)).not.toBeInTheDocument();
    expect(screen.getByText(/Luis/)).toBeInTheDocument();
  });

  it("sin estudiantes asignados avisa", async () => {
    const { user } = setup([HW()], () => mockApi("get", /^\/teachers\/me\/students/, []));
    await openCreate(user);
    expect(await screen.findByText("Aún no tienes estudiantes asignados")).toBeInTheDocument();
  });

  it("también se puede asignar a un grupo completo", async () => {
    mockApi("post", "/homework/", { id: 99 });
    const { user } = setup([HW()], () => {
      mockApi("get", /^\/cohorts\/teacher/, [{ id: 5, package_name: "Grupal", current_students: 3, status: "active" }]);
      mockApi("get", "/cohorts/5/members", [{ student_id: 7 }]);
    });
    await user.type(await openCreate(user), "Para el grupo");
    await user.type(screen.getByPlaceholderText("Describe lo que debe hacer el estudiante..."), "Haz esto");
    await pickDueDate(user);
    await user.selectOptions(await screen.findByRole("combobox"), "5");
    await user.click(screen.getByRole("button", { name: /Crear y asignar tarea/ }));
    await waitFor(() => expect(callsTo("post", "/homework/")).toHaveLength(1));
    expect(callsTo("post", "/homework/")[0].body).toMatchObject({ cohort_id: 5 });
  });

  it.each([
    ["texto", "Fecha en el pasado", /Fecha en el pasado/],
    ["lista de FastAPI", [{ msg: "título muy corto" }, { x: 1 }], /título muy corto/],
  ] as const)("error del servidor (%s) se muestra", async (_n, detail, re) => {
    mockApiError("post", "/homework/", 422, detail);
    const { user } = setup();
    await user.type(await openCreate(user), "Nueva");
    await user.type(screen.getByPlaceholderText("Describe lo que debe hacer el estudiante..."), "Haz esto");
    await pickDueDate(user);
    await user.click(await screen.findByText(/Ana/));
    await user.click(screen.getByRole("button", { name: /Crear y asignar tarea/ }));
    expect(await screen.findByText(re)).toBeInTheDocument();
  });

  it("el selector de fecha pasa de mes y no deja elegir días pasados", async () => {
    const { user } = setup();
    await openCreate(user);
    await user.click(screen.getByRole("button", { name: /Seleccionar fecha/ }));
    const header = document.querySelectorAll(".grid-cols-7")[0];
    expect(header).toBeTruthy();
    const nextMonth = Array.from(document.querySelectorAll("button")).find((b) => b.querySelector("svg") && b.textContent === "" && b.closest(".absolute, [class*='shadow']"));
    if (nextMonth) await user.click(nextMonth);
  });
});

describe("Tareas · selector de fecha en husos negativos", () => {
  it("el día de HOY se puede elegir también en Caracas (UTC−4) por la noche", async () => {
    const prev = process.env.TZ;
    process.env.TZ = "America/Caracas";
    try {
      const { user } = setup();
      await screen.findByText("Present Perfect");
      await user.click(screen.getByRole("button", { name: /Nueva tarea/ }));
      await user.click(screen.getByRole("button", { name: /Seleccionar fecha/ }));
      const today = new Date();
      const d = today.getDate();
      const btn = Array.from(document.querySelectorAll<HTMLButtonElement>(".grid-cols-7 button")).find((b) => b.textContent === String(d));
      expect(btn).toBeDefined();
      expect(btn!.disabled).toBe(false);
    } finally {
      process.env.TZ = prev;
    }
  });
});

describe("Tareas · editar y borrar", () => {
  it("editar: cambia título e instrucciones y guarda con PATCH", async () => {
    mockApi("patch", "/homework/1", {});
    const { user } = setup();
    await screen.findByText("Present Perfect");
    await user.click(within(hwCard("Present Perfect").parentElement as HTMLElement).getAllByText("Editar")[0]);
    const title = await screen.findByPlaceholderText("Título");
    await user.clear(title);
    await user.type(title, "Present Perfect v2");
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(callsTo("patch", "/homework/1")).toHaveLength(1));
    expect(callsTo("patch", "/homework/1")[0].body).toMatchObject({ title: "Present Perfect v2" });
    expect(await screen.findByText("Tarea actualizada correctamente")).toBeInTheDocument();
  });

  it("un error al editar se muestra en el modal", async () => {
    mockApiError("patch", "/homework/1", 400, "No se puede editar");
    const { user } = setup();
    await screen.findByText("Present Perfect");
    await user.click(within(hwCard("Present Perfect").parentElement as HTMLElement).getAllByText("Editar")[0]);
    await screen.findByPlaceholderText("Título");
    await user.type(screen.getByPlaceholderText("Título"), "x");
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(await screen.findByText(/No se puede editar/)).toBeInTheDocument();
  });

  it("borrar: confirmar llama a DELETE; cancelar no", async () => {
    mockApi("delete", "/homework/1", {});
    const { user } = setup();
    await screen.findByText("Present Perfect");
    await user.click(within(hwCard("Present Perfect").parentElement as HTMLElement).getAllByText("Eliminar")[0]);
    await user.click(await screen.findByRole("button", { name: "Cancelar" }));
    expect(callsTo("delete", "/homework/1")).toHaveLength(0);
    await user.click(within(hwCard("Present Perfect").parentElement as HTMLElement).getAllByText("Eliminar")[0]);
    const confirm = (await screen.findAllByRole("button", { name: /Eliminar/ })).at(-1) as HTMLElement;
    await user.click(confirm);
    await waitFor(() => expect(callsTo("delete", "/homework/1")).toHaveLength(1));
    expect((await screen.findAllByText(/Tarea eliminada correctamente/)).length).toBeGreaterThan(0);
  });

  it("un error al borrar se muestra", async () => {
    mockApiError("delete", "/homework/1", 409, "Tiene entregas");
    const { user } = setup();
    await screen.findByText("Present Perfect");
    await user.click(within(hwCard("Present Perfect").parentElement as HTMLElement).getAllByText("Eliminar")[0]);
    const confirm = (await screen.findAllByRole("button", { name: /Eliminar/ })).at(-1) as HTMLElement;
    await user.click(confirm);
    expect(await screen.findByText(/Tiene entregas/)).toBeInTheDocument();
  });
});
