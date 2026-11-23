/**
 * Modo Dios · ejecutor · cierra huecos: crear clase (enrollment, créditos, duración, selector de horario, casillas),
 * fecha de grupo, créditos ilimitados y clase con enrollment asociado.
 */
import { describe, expect, it } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import GodModeActionRunner from "@/components/god-mode/GodModeActionRunner";
import { GOD_MODE_ACTIONS } from "@/lib/godModeActions";
import { renderScreen } from "./render";
import { mockApi, callsTo } from "./fakeApi";

const byId = (id: string) => GOD_MODE_ACTIONS.find((a) => a.id === id)!;
const ENR = (over: Record<string, unknown> = {}) => ({
  id: 11, package_name: "Pack 8", subject: "Español", teacher_id: 7, classes_used: 2, classes_total: 8, status: "active",
  is_group: false, is_unlimited: false, unlocked_credits: 6, prepaid_unlimited_credits: 0, ...over,
});

function seed(enrollments: unknown[] = [ENR()]) {
  mockApi("get", "/god-mode/lookup/teachers", [{ id: 7, username: "profe", name: "Profe Uno" }]);
  mockApi("get", /^\/god-mode\/lookup\/teachers\/7\/students(\?.*)?$/, [{ id: 1, username: "alumno", name: "Alumno Uno" }]);
  mockApi("get", /^\/god-mode\/lookup\/students\/1\/enrollments/, enrollments);
  mockApi("get", /^\/god-mode\/lookup\/teachers\/7\/students\/1\/classes/, [
    { id: 21, start_time_utc: "2026-11-25T15:00:00Z", duration: 50, class_type: "regular", status: "confirmed", enrollment_id: 11, subject: null },
  ]);
  mockApi("get", /^\/god-mode\/lookup\/teachers\/7\/cohorts/, [{ id: 4, package_name: "Grupo A", subject: null, current_students: 2, max_students: 6, status: "open" }]);
  mockApi("get", /^\/god-mode\/lookup\/class-durations/, { allowed_class_durations: [30, 50], trial_duration_minutes: 25 });
}
function setup(id: string, enrollments?: unknown[]) {
  seed(enrollments);
  renderScreen(<GodModeActionRunner action={byId(id)} />, { role: "superadmin" });
  return userEvent.setup();
}
const control = async (label: string, tag = "select") => {
  let found: HTMLElement | undefined;
  await waitFor(() => {
    const l = Array.from(document.querySelectorAll("label")).find((n) => (n.textContent ?? "").replace(/\s*\*\s*$/, "").trim() === label);
    if (!l) throw new Error(`no hay etiqueta «${label}»`);
    found = l.parentElement!.querySelector(tag) as HTMLElement;
  });
  return found as HTMLElement;
};
async function pickPair(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole("option", { name: /Profe Uno/ });
  await user.selectOptions(await control("Profesor"), "7");
  await screen.findByRole("option", { name: /Alumno Uno/ });
  await user.selectOptions(await control("Alumno"), "1");
}

describe("Modo Dios · crear clase", () => {
  it("sin enrollment la materia se escribe a mano y el crédito dice que no hay", async () => {
    const user = setup("class.create");
    await pickPair(user);
    const subject = await screen.findByPlaceholderText(/sin enrollment asociado/);
    fireEvent.change(subject, { target: { value: "Inglés" } });
    expect(subject).toHaveValue("Inglés");
    expect(screen.getByText(/Sin enrollment asociado — no hay créditos/)).toBeInTheDocument();
  });

  it("con enrollment la materia queda fija y se ve el saldo; los ilimitados muestran créditos prepagados", async () => {
    const user = setup("class.create", [ENR(), ENR({ id: 12, is_unlimited: true, prepaid_unlimited_credits: 5, classes_total: null, subject: null })]);
    await pickPair(user);
    await screen.findByRole("option", { name: /#11/ });
    await user.selectOptions(await control("Enrollment (opcional)"), "11");
    expect(await screen.findByText(/6 créditos disponibles · usadas 2\/8/)).toBeInTheDocument();
    expect(screen.getByDisplayValue("Español")).toBeDisabled();
    await user.selectOptions(await control("Enrollment (opcional)"), "12");
    expect(await screen.findByText(/5 créditos ilimitados prepagados · usadas 2\/∞/)).toBeInTheDocument();
    expect(screen.getByDisplayValue("Español")).toBeDisabled();
  });

  it("el selector de horario se abre con profesor y duración, elige hueco y se envía todo", async () => {
    mockApi("post", "/god-mode/classes", { message: "Clase creada" });
    const user = setup("class.create");
    const start = new Date(Date.now() + 26 * 3600_000);
    mockApi("get", /^\/availability\/profe\/slots/, [{
      start_time_utc: start.toISOString(), end_time_utc: new Date(start.getTime() + 3600_000).toISOString(),
      is_available: true, is_past: false, too_soon: false, is_preferred: false,
    }]);
    await pickPair(user);
    await user.selectOptions(await control("Tipo"), "trial");
    expect((await screen.findByRole("option", { name: "25 minutos" }))).toBeInTheDocument();
    await user.selectOptions(await control("Tipo"), "regular");
    await user.selectOptions(await control("Duración"), "50");
    await user.selectOptions(await control("¿Esta clase resta un crédito del enrollment?"), "false");
    await user.click(screen.getByRole("button", { name: /Elegir horario disponible/ }));
    const t = new Date(); t.setDate(t.getDate() + 1);
    const months = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    const target = new Date(start);
    if (target.getMonth() !== new Date().getMonth()) await user.click(screen.getByRole("button", { name: "Mes siguiente" }));
    await user.click(screen.getByRole("button", { name: `${target.getDate()} de ${months[target.getMonth()]} de ${target.getFullYear()}` }));
    await user.click((await screen.findAllByRole("button", { name: /\d{2}:\d{2}/ }))[0]);
    await user.click(screen.getByRole("button", { name: "Usar este horario" }));
    expect(await screen.findByText(/hora local:/)).toBeInTheDocument();
    await user.click(screen.getByLabelText(/Permitir doble-booking/));
    await user.type(screen.getByPlaceholderText(/queda en el log de auditoría/), "Alta manual autorizada");
    await user.click(screen.getByRole("button", { name: /Ejecutar/ }));
    await user.click(screen.getByRole("button", { name: "Sí, ejecutar" }));
    await waitFor(() => expect(callsTo("post", "/god-mode/classes")).toHaveLength(1));
    expect(callsTo("post", "/god-mode/classes")[0].body).toMatchObject({
      teacher_id: 7, student_id: 1, duration_minutes: 50, consume_credit: false, skip_conflict_check: true, start_time_utc: start.toISOString(),
    });
  });

  it("cerrar el selector de horario lo oculta sin elegir nada", async () => {
    const user = setup("class.create");
    await pickPair(user);
    await user.selectOptions(await control("Duración"), "50");
    await user.click(screen.getByRole("button", { name: /Elegir horario disponible/ }));
    await screen.findByText("Primero selecciona una fecha");
    await user.click(screen.getAllByRole("button").find((b) => !b.textContent?.trim() && b.querySelector("svg") && !b.getAttribute("aria-label"))!);
    await waitFor(() => expect(screen.queryByText("Primero selecciona una fecha")).not.toBeInTheDocument());
  });
});

describe("Modo Dios · grupo, clase y reagendar", () => {
  it("editar grupo: la fecha de inicio se envía en ISO y el grupo sin materia dice «sin materia»", async () => {
    mockApi("patch", "/god-mode/cohorts/4", { message: "Grupo editado" });
    const user = setup("cohort.edit");
    await screen.findByRole("option", { name: /Profe Uno/ });
    await user.selectOptions(await control("Profesor"), "7");
    expect(await screen.findByRole("option", { name: /sin materia/ })).toBeInTheDocument();
    await user.selectOptions(await control("Grupo"), "4");
    fireEvent.change(await control("Fecha de inicio", "input"), { target: { value: "2026-12-01T10:00" } });
    await user.type(screen.getByPlaceholderText(/queda en el log de auditoría/), "Corrección de fecha");
    await user.click(screen.getByRole("button", { name: /Ejecutar/ }));
    await user.click(screen.getByRole("button", { name: "Sí, ejecutar" }));
    await waitFor(() => expect(callsTo("patch", "/god-mode/cohorts/4")).toHaveLength(1));
    expect((callsTo("patch", "/god-mode/cohorts/4")[0].body as { start_date: string }).start_date).toBe(new Date("2026-12-01T10:00").toISOString());
  });

  it("eliminar clase: elegir una con enrollment muestra su saldo y la clase sin materia dice «sin materia»", async () => {
    const user = setup("class.hard_delete");
    await pickPair(user);
    await screen.findByRole("option", { name: /sin materia/ });
    await user.selectOptions(await control("Clase"), "21");
    expect(await screen.findByText(/6 créditos disponibles/)).toBeInTheDocument();
  });

  it("reagendar: al elegir la clase hereda su duración y la lista de duraciones es la de clases regulares", async () => {
    const user = setup("class.reschedule");
    await pickPair(user);
    await screen.findByRole("option", { name: /#21/ });
    await user.selectOptions(await control("Clase"), "21");
    await waitFor(async () => expect(await control("Nueva duración (opcional)")).toHaveValue("50"));
    expect(screen.getByRole("option", { name: "30 minutos" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "25 minutos" })).not.toBeInTheDocument();
  });
});
