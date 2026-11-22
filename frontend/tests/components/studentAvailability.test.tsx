/**
 * Preferencias de horario del alumno: editor por día y hora, resumen de bloques, quitar/limpiar y guardar.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { screen, waitFor, within } from "@testing-library/react";
import StudentPreferencesPage from "@/app/(student)/dashboard/availability/page";
import { renderScreen } from "./render";
import { mockApi, mockApiError, callsTo } from "./fakeApi";

const PREF = (day: number, s: string, e: string) => ({ day_of_week: day, local_day_of_week: day, start_time_utc: s, end_time_utc: e });

function setup(prefs: unknown[] = [], extra?: () => void) {
  mockApi("get", "/users/me/preferences", prefs);
  extra?.();
  const view = renderScreen(<StudentPreferencesPage />, { role: "student" });
  return { ...view, user: userEvent.setup() };
}
const hour = (h: string) => screen.getByRole("button", { name: h });
const save = () => screen.getByRole("button", { name: /Guardar Preferencias/ });
const dayTab = (s: string) => screen.getByRole("button", { name: new RegExp(`^${s}`) });
const summary = () => screen.getByText("Resumen de Bloques").parentElement!.parentElement as HTMLElement;

afterEach(() => { vi.restoreAllMocks(); });

describe("Preferencias de horario (alumno)", () => {
  it("sin preferencias dice que no hay bloques", async () => {
    setup();
    expect(await screen.findByText("Sin bloques seleccionados")).toBeInTheDocument();
  });

  it("carga las preferencias guardadas como bloques", async () => {
    setup([PREF(0, "13:00", "15:00"), PREF(2, "20:00", "21:00")]);
    await waitFor(() => expect(within(summary()).getAllByTitle("Eliminar bloque")).toHaveLength(2));
  });

  it("horas contiguas hacen un bloque, separadas dos; cada día es independiente", async () => {
    const { user } = setup();
    await screen.findByText("Sin bloques seleccionados");
    for (const h of ["09:00", "10:00", "14:00"]) await user.click(hour(h));
    expect(within(summary()).getByText(/09:00 – 11:00/)).toBeInTheDocument();
    expect(within(summary()).getByText(/14:00 – 15:00/)).toBeInTheDocument();
    await user.click(dayTab("Mar"));
    expect(hour("09:00").className).not.toMatch(/purple-400/);
    await user.click(hour("23:00"));
    expect(within(summary()).getByText(/23:00 – 23:59/)).toBeInTheDocument();
  });

  it("quitar un bloque, incluido el que llega a 23:59, y limpiar el día", async () => {
    const { user } = setup();
    await screen.findByText("Sin bloques seleccionados");
    await user.click(hour("22:00")); await user.click(hour("23:00"));
    await user.click(within(summary()).getByTitle("Eliminar bloque"));
    expect(await screen.findByText("Sin bloques seleccionados")).toBeInTheDocument();
    await user.click(hour("08:00"));
    await user.click(screen.getByRole("button", { name: "Limpiar día" }));
    expect(await screen.findByText("Sin bloques seleccionados")).toBeInTheDocument();
  });

  it("guarda los bloques con la zona y avisa", async () => {
    mockApi("put", "/users/me/preferences", {});
    const { user } = setup();
    await screen.findByText("Sin bloques seleccionados");
    await user.click(hour("09:00"));
    await user.click(save());
    await waitFor(() => expect(callsTo("put", "/users/me/preferences")).toHaveLength(1));
    const body = callsTo("put", "/users/me/preferences")[0].body as { timezone: string; slots: unknown[] };
    expect(typeof body.timezone).toBe("string");
    expect(body.slots).toEqual([{ day_of_week: 0, start_time_local: "09:00", end_time_local: "10:00" }]);
    expect(await screen.findByText("¡Preferencias actualizadas con éxito!")).toBeInTheDocument();
  });

  it("un error del servidor se muestra", async () => {
    const { user } = setup([], () => mockApiError("put", "/users/me/preferences", 400, "Horario inválido"));
    await screen.findByText("Sin bloques seleccionados");
    await user.click(hour("09:00"));
    await user.click(save());
    expect((await screen.findAllByText("Horario inválido")).length).toBeGreaterThan(0);
  });
});
