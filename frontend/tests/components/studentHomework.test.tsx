/**
 * Mis tareas (alumno): pendientes / entregadas / calificadas, entregar y editar una entrega, y ver la nota.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { screen, waitFor } from "@testing-library/react";
import HomeworkPage from "@/app/(student)/dashboard/homework/page";
import { renderScreen } from "./render";
import { mockApi, mockApiError, callsTo } from "./fakeApi";

const DAY = 86_400_000;
const HW = (id: number, status: string, dueDays: number, over: Record<string, unknown> = {}) => ({
  id, homework_id: id * 10, student_id: 1, status, submission: null, submitted_at: null, score: null, feedback: null, graded_at: null,
  assigned_at: "2026-01-01T00:00:00Z",
  homework: { id: id * 10, teacher_id: 3, title: `Tarea ${id}`, description: `Instrucciones ${id}`, due_date_utc: new Date(Date.now() + dueDays * DAY).toISOString(), is_active: true, created_at: "2026-01-01T00:00:00Z" },
  ...over,
});

function setup(list: unknown[], extra?: () => void) {
  mockApi("get", "/homework/student/my-homework", list);
  extra?.();
  const view = renderScreen(<HomeworkPage />, { role: "student" });
  return { ...view, user: userEvent.setup() };
}

afterEach(() => { vi.restoreAllMocks(); });

describe("Mis tareas (alumno) · lista", () => {
  it("cuenta por estado y separa pendientes de calificadas", async () => {
    const { user } = setup([HW(1, "pending", 3), HW(2, "submitted", 3, { submission: "Mi respuesta" }), HW(3, "graded", -2, { score: 9, feedback: "Muy bien", submission: "Listo" })]);
    expect(await screen.findByText("Tarea 1")).toBeInTheDocument();
    expect(screen.getByText("Pendientes (2)")).toBeInTheDocument();
    expect(screen.getByText("Calificadas (1)")).toBeInTheDocument();
    expect(screen.queryByText("Tarea 3")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Calificadas \(1\)/ }));
    expect(await screen.findByText("Tarea 3")).toBeInTheDocument();
  });

  it("sin tareas lo dice y si falla no engaña", async () => {
    setup([]);
    await screen.findByText("Mis Tareas");
    expect(screen.getByText("Pendientes (0)")).toBeInTheDocument();
  });

  it("una tarea vencida y sin entregar se marca como vencida", async () => {
    setup([HW(1, "pending", -2)]);
    expect(await screen.findByText("Tarea 1")).toBeInTheDocument();
    expect(screen.getByText(/vencid|Vencid/)).toBeInTheDocument();
  });

  it("una tarea calificada muestra la nota y, al abrirla, la retroalimentación", async () => {
    const { user } = setup([HW(3, "graded", -2, { score: 9, feedback: "Muy bien hecho", submission: "Mi trabajo" })]);
    await user.click(await screen.findByRole("button", { name: /Calificadas \(1\)/ }));
    await user.click(await screen.findByText("Tarea 3"));
    expect(await screen.findByText("Muy bien hecho")).toBeInTheDocument();
    expect(screen.getByText("Mi trabajo")).toBeInTheDocument();
  });

  it("una nota sin comentarios lo indica", async () => {
    const { user } = setup([HW(3, "graded", -2, { score: 5, feedback: null, submission: "x" })]);
    await user.click(await screen.findByRole("button", { name: /Calificadas \(1\)/ }));
    await user.click(await screen.findByText("Tarea 3"));
    expect(await screen.findByText("Sin comentarios adicionales")).toBeInTheDocument();
  });
});

describe("Mis tareas (alumno) · entregar", () => {
  it("entregar manda la respuesta y avisa", async () => {
    mockApi("post", "/homework/student/10/submit", {});
    const { user } = setup([HW(1, "pending", 3)]);
    await user.click(await screen.findByRole("button", { name: "Entregar" }));
    expect((await screen.findAllByText("Instrucciones 1")).length).toBeGreaterThan(0);
    await user.type(screen.getByPlaceholderText("Escribe tu respuesta aquí..."), "Mi respuesta");
    await user.click(screen.getByRole("button", { name: "Enviar tarea" }));
    await waitFor(() => expect(callsTo("post", "/homework/student/10/submit")).toHaveLength(1));
    expect(callsTo("post", "/homework/student/10/submit")[0].body).toEqual({ submission: "Mi respuesta" });
    expect(await screen.findByText("Tarea entregada correctamente")).toBeInTheDocument();
  });

  it("sin texto el botón no envía", async () => {
    const { user } = setup([HW(1, "pending", 3)]);
    await user.click(await screen.findByRole("button", { name: "Entregar" }));
    await screen.findByPlaceholderText("Escribe tu respuesta aquí...");
    await user.click(screen.getByRole("button", { name: "Enviar tarea" }));
    expect(callsTo("post", /submit/)).toHaveLength(0);
  });

  it("editar una entrega precarga el texto anterior", async () => {
    mockApi("post", "/homework/student/20/submit", {});
    const { user } = setup([HW(2, "submitted", 3, { submission: "Primera versión" })]);
    await user.click(await screen.findByRole("button", { name: "Editar entrega" }));
    const box = await screen.findByDisplayValue("Primera versión");
    await user.clear(box);
    await user.type(box, "Segunda versión");
    await user.click(screen.getByRole("button", { name: "Actualizar entrega" }));
    await waitFor(() => expect(callsTo("post", "/homework/student/20/submit")).toHaveLength(1));
    expect(callsTo("post", "/homework/student/20/submit")[0].body).toEqual({ submission: "Segunda versión" });
  });

  it("un error del servidor se muestra", async () => {
    mockApiError("post", "/homework/student/10/submit", 400, "La tarea ya no acepta entregas");
    const { user } = setup([HW(1, "pending", 3)]);
    await user.click(await screen.findByRole("button", { name: "Entregar" }));
    await user.type(await screen.findByPlaceholderText("Escribe tu respuesta aquí..."), "Algo");
    await user.click(screen.getByRole("button", { name: "Enviar tarea" }));
    expect(await screen.findByText("La tarea ya no acepta entregas")).toBeInTheDocument();
  });

  it("una tarea vencida nunca entregada no se puede entregar", async () => {
    const { user } = setup([HW(1, "pending", -2)]);
    await user.click(await screen.findByRole("button", { name: "Entregar" }));
    const box = await screen.findByPlaceholderText("Escribe tu respuesta aquí...");
    expect(box).toBeDisabled();
    expect(screen.getByRole("button", { name: "Contacta a tu profesor" })).toBeDisabled();
    expect(callsTo("post", /submit/)).toHaveLength(0);
  });
});
