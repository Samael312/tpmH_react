/**
 * Modo Dios: ejecutor de acciones. Un test guiado por datos cubre TODAS las acciones del registro
 * (se pintan, y no se pueden ejecutar sin campos obligatorios y motivo) y varios flujos de extremo a extremo.
 */
import { describe, expect, it } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import GodModeActionRunner from "@/components/god-mode/GodModeActionRunner";
import { GOD_MODE_ACTIONS } from "@/lib/godModeActions";
import { renderScreen } from "./render";
import { mockApi, mockApiError, callsTo } from "./fakeApi";

const byId = (id: string) => GOD_MODE_ACTIONS.find((a) => a.id === id)!;

function seedLookups() {
  mockApi("get", "/god-mode/lookup/teachers", [{ id: 7, username: "profe", name: "Profe Uno" }]);
  mockApi("get", /^\/god-mode\/lookup\/teachers\/7\/students(\?.*)?$/, [{ id: 1, username: "alumno", name: "Alumno Uno" }]);
  mockApi("get", /^\/god-mode\/lookup\/teachers\/7\/students\/1\/classes/, [
    { id: 21, start_time_utc: "2026-11-25T15:00:00Z", duration: 50, class_type: "regular", status: "confirmed", enrollment_id: 11, subject: "Español" },
  ]);
  mockApi("get", /^\/god-mode\/lookup\/teachers\/7\/cohorts/, [{ id: 4, package_name: "Grupo A", subject: "Inglés", current_students: 2, max_students: 6, status: "cancelled" }]);
  mockApi("get", /^\/god-mode\/lookup\/class-durations/, { allowed_class_durations: [30, 50], trial_duration_minutes: 25 });
}

function setup(actionId: string) {
  seedLookups();
  renderScreen(<GodModeActionRunner action={byId(actionId)} />, { role: "superadmin" });
  return userEvent.setup();
}

/** Devuelve el control (select/textarea/input) que sigue a una etiqueta (se ignora el asterisco de obligatorio). */
const control = async (label: string, tag = "select") => {
  let found: HTMLElement | undefined;
  await waitFor(() => {
    const l = Array.from(document.querySelectorAll("label")).find((n) => (n.textContent ?? "").replace(/\s*\*\s*$/, "").trim() === label);
    if (!l) throw new Error(`no hay etiqueta «${label}»`);
    found = l.parentElement!.querySelector(tag) as HTMLElement;
  });
  return found as HTMLElement;
};
const reason = () => screen.getByPlaceholderText(/queda en el log de auditoría/);
const run = () => screen.getByRole("button", { name: /Ejecutar/ });

describe("GodModeActionRunner · todas las acciones del registro", () => {
  it.each(GOD_MODE_ACTIONS.map((a) => [a.id, a] as const))("%s se pinta, con su motivo, y no se puede ejecutar vacía", (_id, action) => {
    seedLookups();
    renderScreen(<GodModeActionRunner action={action} />, { role: "superadmin" });
    expect(screen.getByText(action.label)).toBeInTheDocument();
    expect(screen.getByText(/Motivo \(obligatorio\)/)).toBeInTheDocument();
    expect(run()).toBeDisabled();
    if (action.destructive) expect(screen.getByText("Irreversible")).toBeInTheDocument();
    else expect(screen.queryByText("Irreversible")).not.toBeInTheDocument();
  });

  it("solo las acciones destructivas se marcan como irreversibles (y existen)", () => {
    const destructive = GOD_MODE_ACTIONS.filter((a) => a.destructive).map((a) => a.id);
    expect(destructive.length).toBeGreaterThan(0);
    expect(destructive).toContain("class.hard_delete");
  });

  it("cada acción tiene método y URL coherentes", () => {
    for (const a of GOD_MODE_ACTIONS) {
      const pathValues = Object.fromEntries(a.fields.filter((f) => f.isPathParam).map((f) => [f.sendAs ?? f.name, "9"]));
      expect(a.buildUrl(pathValues)).toMatch(/^\/god-mode\//);
      expect(["patch", "post", "delete"]).toContain(a.method);
      expect(a.buildUrl(pathValues)).not.toContain("undefined");
    }
  });
});

describe("GodModeActionRunner · cascada profesor → alumno → clase", () => {
  it("los selectores dependientes están bloqueados hasta elegir el anterior", async () => {
    setup("class.force_status");
    expect(await control("Alumno")).toBeDisabled();
    expect(await control("Clase")).toBeDisabled();
    expect(screen.getByText("Elige un profesor primero")).toBeInTheDocument();
  });

  it("elegir profesor habilita alumno; elegir alumno habilita clase", async () => {
    const user = setup("class.force_status");
    await screen.findByRole("option", { name: /Profe Uno/ });
    await user.selectOptions(await control("Profesor"), "7");
    await waitFor(async () => expect(await control("Alumno")).toBeEnabled());
    await screen.findByRole("option", { name: /Alumno Uno/ });
    await user.selectOptions(await control("Alumno"), "1");
    await waitFor(async () => expect(await control("Clase")).toBeEnabled());
  });

  it("cambiar de profesor limpia alumno y clase elegidos", async () => {
    const user = setup("class.force_status");
    await screen.findByRole("option", { name: /Profe Uno/ });
    await user.selectOptions(await control("Profesor"), "7");
    await screen.findByRole("option", { name: /Alumno Uno/ });
    await user.selectOptions(await control("Alumno"), "1");
    await user.selectOptions(await control("Profesor"), "");
    expect(await control("Alumno")).toHaveValue("");
    expect(await control("Alumno")).toBeDisabled();
  });
});

describe("GodModeActionRunner · ejecutar", () => {
  async function fillForceStatus(user: ReturnType<typeof userEvent.setup>, why = "Corrección autorizada por soporte") {
    await screen.findByRole("option", { name: /Profe Uno/ });
    await user.selectOptions(await control("Profesor"), "7");
    await screen.findByRole("option", { name: /Alumno Uno/ });
    await user.selectOptions(await control("Alumno"), "1");
    await waitFor(async () => expect(await control("Clase")).toBeEnabled());
    await screen.findByRole("option", { name: /#21/ });
    await user.selectOptions(await control("Clase"), "21");
    await user.selectOptions(await control("Nuevo estado"), "completed");
    if (why) await user.type(reason(), why);
  }

  it("sin motivo (o con menos de 5 letras) no se habilita Ejecutar", async () => {
    const user = setup("class.force_status");
    await fillForceStatus(user, "");
    expect(run()).toBeDisabled();
    await user.type(reason(), "abc");
    expect(run()).toBeDisabled();
    await user.type(reason(), "de");
    expect(run()).toBeEnabled();
  });

  it("pide confirmación antes de ejecutar y permite cancelar sin tocar nada", async () => {
    const user = setup("class.force_status");
    await fillForceStatus(user);
    await user.click(run());
    expect(screen.getByText(/¿Confirmas\?/)).toBeInTheDocument();
    expect(callsTo("patch", /force-status/)).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByText(/¿Confirmas\?/)).not.toBeInTheDocument();
    expect(callsTo("patch", /force-status/)).toHaveLength(0);
  });

  it("confirmar envía PATCH a la clase elegida con estado y motivo, SIN profesor ni alumno (solo ayudan a filtrar)", async () => {
    mockApi("patch", "/god-mode/classes/21/force-status", { message: "Estado forzado a completed" });
    const user = setup("class.force_status");
    await fillForceStatus(user);
    await user.click(run());
    await user.click(screen.getByRole("button", { name: "Sí, ejecutar" }));
    await waitFor(() => expect(callsTo("patch", "/god-mode/classes/21/force-status")).toHaveLength(1));
    expect(callsTo("patch", "/god-mode/classes/21/force-status")[0].body).toEqual({ reason: "Corrección autorizada por soporte", status: "completed" });
    expect(await screen.findByText("Estado forzado a completed")).toBeInTheDocument();
  });

  it("tras el éxito el formulario queda limpio para la siguiente acción", async () => {
    mockApi("patch", "/god-mode/classes/21/force-status", {});
    const user = setup("class.force_status");
    await fillForceStatus(user);
    await user.click(run());
    await user.click(screen.getByRole("button", { name: "Sí, ejecutar" }));
    expect(await screen.findByText("Acción ejecutada correctamente.")).toBeInTheDocument();
    expect(reason()).toHaveValue("");
    expect(await control("Profesor")).toHaveValue("");
  });

  it("si el servidor rechaza muestra el motivo y conserva lo escrito para reintentar", async () => {
    mockApiError("patch", "/god-mode/classes/21/force-status", 400, "Transición no permitida");
    const user = setup("class.force_status");
    await fillForceStatus(user);
    await user.click(run());
    await user.click(screen.getByRole("button", { name: "Sí, ejecutar" }));
    expect(await screen.findByText(/Transición no permitida/)).toBeInTheDocument();
    expect(reason()).toHaveValue("Corrección autorizada por soporte");
    expect(run()).toBeEnabled();
  });

  it("eliminar clase usa DELETE con el motivo como parámetro de consulta (no en el cuerpo)", async () => {
    mockApi("delete", "/god-mode/classes/21", { message: "Clase eliminada" });
    const user = setup("class.hard_delete");
    await screen.findByRole("option", { name: /Profe Uno/ });
    await user.selectOptions(await control("Profesor"), "7");
    await screen.findByRole("option", { name: /Alumno Uno/ });
    await user.selectOptions(await control("Alumno"), "1");
    await screen.findByRole("option", { name: /#21/ });
    await user.selectOptions(await control("Clase"), "21");
    await user.type(reason(), "Duplicada por error");
    await user.click(run());
    await user.click(screen.getByRole("button", { name: "Sí, ejecutar" }));
    await waitFor(() => expect(callsTo("delete", "/god-mode/classes/21")).toHaveLength(1));
    expect(callsTo("delete", "/god-mode/classes/21")[0].params).toEqual({ reason: "Duplicada por error" });
    expect(await screen.findByText("Clase eliminada")).toBeInTheDocument();
  });

  it("devolver crédito es opcional: casilla sin marcar no se envía; marcada va como true", async () => {
    mockApi("delete", "/god-mode/classes/21", {});
    const user = setup("class.hard_delete");
    await screen.findByRole("option", { name: /Profe Uno/ });
    await user.selectOptions(await control("Profesor"), "7");
    await screen.findByRole("option", { name: /Alumno Uno/ });
    await user.selectOptions(await control("Alumno"), "1");
    await screen.findByRole("option", { name: /#21/ });
    await user.selectOptions(await control("Clase"), "21");
    const box = screen.getByRole("checkbox", { name: /Devolver 1 crédito/ });
    expect(box).not.toBeChecked();
    await user.click(box);
    expect(box).toBeChecked();
  });

  it("reabrir grupo: el estado nuevo es opcional y el grupo va en la URL, no en el cuerpo", async () => {
    mockApi("post", "/god-mode/cohorts/4/reopen", { message: "Grupo reabierto" });
    const user = setup("cohort.reopen");
    await screen.findByRole("option", { name: /Profe Uno/ });
    await user.selectOptions(await control("Profesor"), "7");
    await screen.findByRole("option", { name: /#4 · Grupo A/ });
    await user.selectOptions(await control("Grupo"), "4");
    await user.type(reason(), "El profesor lo pidió");
    await user.click(run());
    await user.click(screen.getByRole("button", { name: "Sí, ejecutar" }));
    await waitFor(() => expect(callsTo("post", "/god-mode/cohorts/4/reopen")).toHaveLength(1));
    expect(callsTo("post", "/god-mode/cohorts/4/reopen")[0].body).toEqual({ reason: "El profesor lo pidió" });
  });

  it("un campo opcional rellenado sí se envía", async () => {
    mockApi("post", "/god-mode/cohorts/4/reopen", {});
    const user = setup("cohort.reopen");
    await screen.findByRole("option", { name: /Profe Uno/ });
    await user.selectOptions(await control("Profesor"), "7");
    await screen.findByRole("option", { name: /#4 · Grupo A/ });
    await user.selectOptions(await control("Grupo"), "4");
    await user.selectOptions(await control("Nuevo estado"), "filling");
    await user.type(reason(), "Reabrir inscripciones");
    await user.click(run());
    await user.click(screen.getByRole("button", { name: "Sí, ejecutar" }));
    await waitFor(() => expect(callsTo("post", "/god-mode/cohorts/4/reopen")).toHaveLength(1));
    expect(callsTo("post", "/god-mode/cohorts/4/reopen")[0].body).toEqual({ reason: "Reabrir inscripciones", new_status: "filling" });
  });

  it("los campos numéricos opcionales vacíos se omiten (ajuste parcial) y los rellenos se envían como número", async () => {
    mockApi("patch", "/god-mode/enrollments/11/adjust", {});
    mockApi("get", /^\/god-mode\/lookup\/students\/1\/enrollments/, [
      { id: 11, package_name: "Pack 8", subject: "Español", classes_used: 2, classes_total: 8, status: "active", unlocked_credits: 6, is_unlimited: false, prepaid_unlimited_credits: 0 },
    ]);
    const user = setup("enrollment.adjust");
    await screen.findByRole("option", { name: /Profe Uno/ });
    await user.selectOptions(await control("Profesor"), "7");
    await screen.findByRole("option", { name: /Alumno Uno/ });
    await user.selectOptions(await control("Alumno"), "1");
    await screen.findByRole("option", { name: /#11/ });
    await user.selectOptions(await control("Enrollment"), "11");
    expect(await screen.findByText(/6 créditos disponibles · usadas 2\/8/)).toBeInTheDocument();
    fireEvent.change(await control("Créditos disponibles", "input"), { target: { value: "10" } });
    await user.type(reason(), "Compensación acordada");
    await user.click(run());
    await user.click(screen.getByRole("button", { name: "Sí, ejecutar" }));
    await waitFor(() => expect(callsTo("patch", "/god-mode/enrollments/11/adjust")).toHaveLength(1));
    expect(callsTo("patch", "/god-mode/enrollments/11/adjust")[0].body).toEqual({ reason: "Compensación acordada", unlocked_credits: 10 });
  });
});
