/**
 * ClassCard: tarjeta de clase. Verifica la MATRIZ de permisos (qué acciones ve cada rol según estado, tipo y momento)
 * y que cada acción llame al endpoint correcto. Son las reglas de cancelar / reagendar / marcar asistencia.
 */
import { describe, expect, it, vi } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { screen, waitFor } from "@testing-library/react";
import ClassCard, { type ClassCardData } from "@/components/classes/ClassCard";
import { renderScreen } from "./render";
import { mockApiError, callsTo, apiCalls } from "./fakeApi";

type CardRole = "student" | "teacher";
const HOUR = 3600_000;

/** Clase que empieza dentro de `startHours` (negativo = ya empezó) y dura 1 h. */
function cls(status: string, startHours: number, over: Partial<ClassCardData> = {}): ClassCardData {
  const start = Date.now() + startHours * HOUR;
  return {
    id: 21, class_type: "regular", subject: "Español", status, start_time_utc: new Date(start).toISOString(),
    end_time_utc: new Date(start + HOUR).toISOString(), duration_minutes: 60, meet_link: null,
    teacher_name: "Profe Uno", student_name: "Alumno Uno", teacher_timezone: "America/Caracas", student_timezone: "America/Caracas",
    teacher_phone: "+58 414-0000001", student_phone: "+58 412-0000002", ...over,
  };
}

const ACTIONS = ["Pedir corrección", "Completar", "No asistió", "Sin resolver", "Reagendar", "Cancelar", "Salir del grupo", "Salir de esta clase"];

/** Abre el menú "Acciones" si existe y devuelve cuáles de las acciones de gestión están disponibles. */
async function actionsAvailable(user: ReturnType<typeof userEvent.setup>) {
  const menu = screen.queryByRole("button", { name: /Acciones/ });
  if (menu) await user.click(menu);
  const names = screen.queryAllByRole("button").map((b) => (b.textContent ?? "").trim());
  return ACTIONS.filter((a) => names.some((n) => n === a));
}

function setup(data: ClassCardData, role: CardRole, props: Partial<React.ComponentProps<typeof ClassCard>> = {}) {
  const onUpdate = vi.fn();
  const utils = renderScreen(<ClassCard class_={data} role={role} onUpdate={onUpdate} {...props} />, { role });
  return { onUpdate, user: userEvent.setup(), ...utils };
}

describe("ClassCard · acciones del ALUMNO", () => {
  it.each([
    ["confirmed", 26, ["Reagendar", "Cancelar"]],
    ["pending", 26, ["Reagendar", "Cancelar"]],
    ["pending_trial", 26, ["Reagendar", "Cancelar"]],
    ["pending_payment", 26, ["Cancelar"]], // en revisión: puede cancelar, no reagendar
    ["completed", -5, []],
    ["cancelled", -5, []],
    ["no_show", -5, []], // el alumno nunca reagenda su propia falta
    ["finalized", -5, []], // ya pasó: solo el profesor la reagenda
    ["confirmed", -5, []], // pasada sin resolver: nada que hacer
  ])("clase %s (empieza en %sh): ve %j", async (status, hours, expected) => {
    const { user } = setup(cls(status, hours), "student");
    expect(await actionsAvailable(user)).toEqual(expected);
  });

  it("sesión grupal: puede salir del grupo o de esa sesión, pero no reagendar", async () => {
    const { user } = setup(cls("confirmed", 26, { class_type: "group", cohort_id: 4, participant_count: 3, participant_names: ["Ana", "Luis"] }), "student");
    expect(await actionsAvailable(user)).toEqual(["Reagendar".length ? "Salir del grupo" : "", "Salir de esta clase"].filter(Boolean));
  });

  it("no ve controles de profesor (completar, no asistió, link)", async () => {
    const { user } = setup(cls("confirmed", 26, { meet_link: "https://meet.example.com/x" }), "student");
    const a = await actionsAvailable(user);
    expect(a).not.toContain("Completar");
    expect(a).not.toContain("No asistió");
    expect(screen.queryByRole("button", { name: /Cargar link|Editar link/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Unirse a la clase/)).toBeInTheDocument();
  });

  it("cancelar una clase individual llama DELETE /classes/{id} y avisa al padre", async () => {
    const { user, onUpdate } = setup(cls("confirmed", 26), "student");
    await actionsAvailable(user);
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(callsTo("delete", "/classes/21")).toHaveLength(1));
    await waitFor(() => expect(onUpdate).toHaveBeenCalled());
  });

  it("si cancelar falla no avisa al padre y muestra el error", async () => {
    mockApiError("delete", "/classes/21", 400, "Quedan menos de 12 horas");
    const { user, onUpdate } = setup(cls("confirmed", 26), "student");
    await actionsAvailable(user);
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect((await screen.findAllByText(/menos de 12 horas/)).length).toBeGreaterThan(0);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("salir de un grupo pide confirmación y, al aceptar, llama POST /cohorts/{id}/leave", async () => {
    const { user, onUpdate } = setup(cls("confirmed", 26, { class_type: "group", cohort_id: 4 }), "student");
    await actionsAvailable(user);
    await user.click(screen.getByRole("button", { name: "Salir del grupo" }));
    expect(callsTo("post", "/cohorts/4/leave")).toHaveLength(0); // aún no: falta confirmar
    await user.click(await screen.findByRole("button", { name: "Salir del grupo", hidden: false }).catch(() => screen.getAllByRole("button", { name: "Salir del grupo" }).at(-1)!));
    await waitFor(() => expect(callsTo("post", "/cohorts/4/leave")).toHaveLength(1));
    await waitFor(() => expect(onUpdate).toHaveBeenCalled());
  });

  it("salir solo de esta sesión llama DELETE /classes/{id}/leave tras confirmar", async () => {
    const { user } = setup(cls("confirmed", 26, { class_type: "group", cohort_id: 4 }), "student");
    await actionsAvailable(user);
    await user.click(screen.getByRole("button", { name: "Salir de esta clase" }));
    expect(callsTo("delete", "/classes/21/leave")).toHaveLength(0);
    await user.click(screen.getAllByRole("button", { name: "Salir de esta clase" }).at(-1)!);
    await waitFor(() => expect(callsTo("delete", "/classes/21/leave")).toHaveLength(1));
  });

  it("el botón Cancelar delega en onCancel si el padre lo da (sin llamar a la API)", async () => {
    const onCancel = vi.fn();
    const { user } = setup(cls("confirmed", 26), "student", { onCancel });
    await actionsAvailable(user);
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(apiCalls.filter((c) => c.method === "delete")).toHaveLength(0);
  });

  it("showTeacherWhatsapp=false oculta el WhatsApp del profesor al alumno", () => {
    const { container } = setup(cls("confirmed", 26), "student", { showTeacherWhatsapp: false });
    expect(container.querySelector('a[href^="https://wa.me/"]')).toBeNull();
  });

  it("showTeacherWhatsapp=true (por defecto) enseña el WhatsApp del profesor con solo dígitos", () => {
    const { container } = setup(cls("confirmed", 26), "student");
    expect(container.querySelector('a[href="https://wa.me/584140000001"]')).not.toBeNull();
  });
});

describe("ClassCard · acciones del PROFESOR", () => {
  it("clase confirmada EN CURSO (ya empezó): completar, no asistió, sin resolver, reagendar y cancelar", async () => {
    const { user } = setup(cls("confirmed", -0.5), "teacher");
    expect(await actionsAvailable(user)).toEqual(["Completar", "No asistió", "Sin resolver", "Reagendar", "Cancelar"]);
  });

  it("clase confirmada FUTURA: no se puede marcar completada ni no asistida (el backend lo rechaza)", async () => {
    const { user } = setup(cls("confirmed", 26), "teacher");
    expect(await actionsAvailable(user)).toEqual(["Sin resolver", "Reagendar", "Cancelar"]);
  });

  it.each(["cancelled", "expired", "rescheduled"])("estado terminal %s: ninguna acción de estado", async (status) => {
    const { user } = setup(cls(status, -5), "teacher");
    const a = await actionsAvailable(user);
    expect(a).not.toContain("Completar");
    expect(a).not.toContain("No asistió");
    expect(a).not.toContain("Sin resolver");
  });

  it.each(["pending", "pending_trial", "pending_payment"])("estado %s no ofrece «Sin resolver» (el backend no permite finalized desde ahí)", async (status) => {
    const { user } = setup(cls(status, -0.5), "teacher");
    expect(await actionsAvailable(user)).not.toContain("Sin resolver");
  });

  it("clase terminada hace poco (ventana de 72 h): puede cambiar el estado pero no cancelarla", async () => {
    const { user } = setup(cls("completed", -5), "teacher");
    expect(await actionsAvailable(user)).toEqual(["No asistió", "Sin resolver"]);
  });

  it("pasadas las 72 h ya no puede cambiar el estado manualmente", async () => {
    const { user } = setup(cls("completed", -100), "teacher");
    expect(await actionsAvailable(user)).toEqual([]);
  });

  it("un no_show reciente se puede reagendar por cortesía", async () => {
    const { user } = setup(cls("no_show", -5), "teacher");
    expect(await actionsAvailable(user)).toContain("Reagendar");
  });

  it("un no_show automático pasadas las 72 h solo ofrece pedir corrección al soporte", async () => {
    const { user } = setup(cls("no_show", -100), "teacher");
    const a = await actionsAvailable(user);
    expect(a).toContain("Pedir corrección");
    expect(a).not.toContain("Completar");
  });

  // F13 (corregido): el backend no admite ninguna transición desde `cancelled`
  // (core/class_logic.py CLASS_STATUS_TRANSITIONS["cancelled"] = set()), así que la tarjeta no ofrece acciones de estado.
  it("una clase cancelada no ofrece ninguna acción de estado", async () => {
    const { user } = setup(cls("cancelled", 26), "teacher");
    expect(await actionsAvailable(user)).toEqual([]);
  });

  it("readOnly oculta todas las acciones de gestión", async () => {
    const { user } = setup(cls("confirmed", 26), "teacher", { readOnly: true });
    expect(await actionsAvailable(user)).toEqual([]);
  });

  it("clase externa (Google/Preply): sin acciones, solo unirse si trae link", async () => {
    const { user } = setup(cls("confirmed", 26, { class_type: "external", meet_link: "https://meet.example.com/ext" }), "teacher");
    expect(await actionsAvailable(user)).toEqual([]);
    expect(screen.getByText(/Unirse a la clase/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Cargar link|Editar link/ })).not.toBeInTheDocument();
  });

  it("puede cargar el link de la clase confirmada (y editarlo si ya hay uno)", () => {
    const { unmount } = setup(cls("confirmed", 26), "teacher");
    expect(screen.getByRole("button", { name: /Cargar link/ })).toBeInTheDocument();
    unmount();
    setup(cls("confirmed", 26, { meet_link: "https://meet.example.com/x" }), "teacher");
    expect(screen.getByRole("button", { name: /Editar link/ })).toBeInTheDocument();
  });

  it("completar llama PATCH /classes/{id}/status con completed", async () => {
    const { user, onUpdate } = setup(cls("confirmed", -0.5), "teacher");
    await actionsAvailable(user);
    await user.click(screen.getByRole("button", { name: "Completar" }));
    await waitFor(() => expect(callsTo("patch", "/classes/21/status")).toHaveLength(1));
    expect(callsTo("patch", "/classes/21/status")[0].body).toEqual({ status: "completed" });
    await waitFor(() => expect(onUpdate).toHaveBeenCalled());
  });

  it("no asistió llama PATCH con no_show", async () => {
    const { user } = setup(cls("confirmed", -0.5), "teacher");
    await actionsAvailable(user);
    await user.click(screen.getByRole("button", { name: "No asistió" }));
    await waitFor(() => expect(callsTo("patch", "/classes/21/status")).toHaveLength(1));
    expect(callsTo("patch", "/classes/21/status")[0].body).toEqual({ status: "no_show" });
  });

  it("cancelar usa el endpoint del profesor DELETE /classes/teacher/{id}", async () => {
    const { user } = setup(cls("confirmed", 26), "teacher");
    await actionsAvailable(user);
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(callsTo("delete", "/classes/teacher/21")).toHaveLength(1));
    expect(callsTo("delete", "/classes/21")).toHaveLength(0);
  });

  it("el profesor ve el teléfono del alumno aunque showTeacherWhatsapp sea false", () => {
    const { container } = setup(cls("confirmed", 26), "teacher", { showTeacherWhatsapp: false });
    expect(container.querySelector('a[href="https://wa.me/584120000002"]')).not.toBeNull();
  });

  // F14 (corregido): `role` solo admite "student" | "teacher" — un teacher_admin ya no puede caer por error en las reglas
  // de alumno; el compilador lo impide.
  it("el tipo de `role` no admite teacher_admin (F14)", () => {
    // @ts-expect-error teacher_admin no es un rol válido de la tarjeta
    const bad: React.ComponentProps<typeof ClassCard>["role"] = "teacher_admin";
    expect(bad).toBe("teacher_admin");
  });
});

describe("ClassCard · presentación", () => {
  it.each([
    ["pending", "Pendiente pago"], ["pending_trial", "Prueba pdte"], ["pending_payment", "En revisión"], ["confirmed", "Confirmada"],
    ["completed", "Completada"], ["cancelled", "Cancelada"], ["no_show", "No asistió"], ["rescheduled", "Reagendada"],
    ["finalized", "Finalizada"], ["expired", "Expirada"],
  ])("el estado %s se etiqueta «%s»", (status, label) => {
    setup(cls(status, 26), "student");
    expect(screen.getAllByText(label).length).toBeGreaterThan(0);
  });

  it("un estado desconocido no rompe la tarjeta", () => {
    setup(cls("estado_raro", 26), "student");
    expect(screen.getByText("Profe Uno")).toBeInTheDocument();
  });

  it("el alumno ve el nombre del profesor; el profesor, el del alumno", () => {
    const { unmount } = setup(cls("confirmed", 26), "student");
    expect(screen.getByText("Profe Uno")).toBeInTheDocument();
    unmount();
    setup(cls("confirmed", 26), "teacher");
    expect(screen.getByText("Alumno Uno")).toBeInTheDocument();
  });

  it("sesión grupal: muestra cuántos participantes hay", () => {
    setup(cls("confirmed", 26, { class_type: "group", cohort_id: 4, participant_count: 3, participant_names: ["Ana", "Luis", "Eva"] }), "teacher");
    expect(screen.getAllByText(/3/).length).toBeGreaterThan(0);
  });
});
