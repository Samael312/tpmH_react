/**
 * Disponibilidad semanal del profesor: editor por día y hora, resumen de bloques contiguos, quitar un bloque,
 * limpiar un día y guardar (con la zona horaria del perfil).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { screen, waitFor, within } from "@testing-library/react";
import AvailabilityPage from "@/app/(teacher)/teacher/availability/page";
import { renderScreen } from "./render";
import { mockApi, mockApiError, callsTo } from "./fakeApi";

const SLOT = (id: number, day: number, start: string, end: string, over: Record<string, unknown> = {}) => ({
  id, teacher_id: 3, day_of_week: day, start_time_local: start, end_time_local: end, is_available: true, timezone: "America/Bogota", ...over,
});

function setup(slots: unknown[] = [], extra?: () => void) {
  mockApi("get", "/availability/me/weekly", slots);
  mockApi("get", "/availability/me/exceptions", []);
  extra?.();
  const view = renderScreen(<AvailabilityPage />, { role: "teacher" });
  return { ...view, user: userEvent.setup() };
}
const hour = (h: string) => screen.getByRole("button", { name: h });
const save = () => screen.getByRole("button", { name: /Guardar Disponibilidad/ });
const dayTab = (short: string) => screen.getByRole("button", { name: new RegExp(`^${short}`) });
const summary = () => screen.getByText("Resumen de Bloques").parentElement!.parentElement as HTMLElement;

afterEach(() => { vi.restoreAllMocks(); });

describe("Disponibilidad semanal · editor", () => {
  it("sin horario guardado dice que no hay bloques", async () => {
    setup();
    expect(await screen.findByText("Sin bloques seleccionados")).toBeInTheDocument();
    expect(screen.getByText("0 bloques")).toBeInTheDocument();
  });

  it("carga el horario del servidor y lo pinta en el resumen", async () => {
    setup([SLOT(1, 0, "09:00", "12:00"), SLOT(2, 2, "18:00", "20:00"), SLOT(3, 1, "08:00", "10:00", { is_available: false })]);
    expect(await screen.findByText("2 bloques")).toBeInTheDocument();
    expect(screen.getByText(/09:00 – 12:00/)).toBeInTheDocument();
    expect(screen.getByText(/18:00 – 20:00/)).toBeInTheDocument();
  });

  it("horas contiguas se funden en un bloque y las separadas hacen dos", async () => {
    const { user } = setup();
    await screen.findByText("Sin bloques seleccionados");
    for (const h of ["09:00", "10:00", "11:00", "14:00"]) await user.click(hour(h));
    expect(await screen.findByText("2 bloques")).toBeInTheDocument();
    expect(screen.getByText(/09:00 – 12:00/)).toBeInTheDocument();
    expect(screen.getByText(/14:00 – 15:00/)).toBeInTheDocument();
    await user.click(hour("10:00")); // al quitarla se parte en dos
    expect(await screen.findByText("3 bloques")).toBeInTheDocument();
  });

  it("cada día tiene su propia selección", async () => {
    const { user } = setup();
    await screen.findByText("Sin bloques seleccionados");
    await user.click(hour("09:00"));
    await user.click(dayTab("Mar"));
    await user.click(hour("15:00"));
    expect(await screen.findByText("2 bloques")).toBeInTheDocument();
    await user.click(dayTab("Lun"));
    expect(hour("09:00").className).toMatch(/purple-400/);
    expect(hour("15:00").className).not.toMatch(/purple-400/);
  });

  it("«Limpiar día» borra solo el día elegido", async () => {
    const { user } = setup([SLOT(1, 0, "09:00", "11:00"), SLOT(2, 1, "09:00", "11:00")]);
    await screen.findByText("2 bloques");
    await user.click(screen.getByRole("button", { name: "Limpiar día" }));
    expect(await screen.findByText("1 bloque")).toBeInTheDocument();
  });

  it("el botón de eliminar bloque quita sus horas", async () => {
    const { user } = setup([SLOT(1, 0, "09:00", "12:00"), SLOT(2, 2, "18:00", "20:00")]);
    await screen.findByText("2 bloques");
    await user.click(within(summary()).getAllByTitle("Eliminar bloque")[0]);
    expect(await screen.findByText("1 bloque")).toBeInTheDocument();
    expect(screen.queryByText(/09:00 – 12:00/)).not.toBeInTheDocument();
  });

  it("un bloque que llega hasta las 23:59 se maneja como fin de día y se puede quitar", async () => {
    const { user } = setup([SLOT(1, 0, "22:00", "23:59")]);
    expect(await screen.findByText(/22:00 – 23:59/)).toBeInTheDocument();
    await user.click(within(summary()).getByTitle("Eliminar bloque"));
    expect(await screen.findByText("Sin bloques seleccionados")).toBeInTheDocument();
  });

  it("un horario que cruza la medianoche se reparte entre los dos días", async () => {
    setup([SLOT(1, 0, "22:00", "02:00")]);
    expect(await screen.findByText("2 bloques")).toBeInTheDocument();
  });
});

describe("Disponibilidad semanal · guardar", () => {
  it("manda los bloques con la zona del horario existente y avisa", async () => {
    mockApi("put", "/availability/me/weekly", {});
    const { user } = setup([SLOT(1, 0, "09:00", "11:00")]);
    await screen.findByText("1 bloque");
    await user.click(hour("12:00"));
    await user.click(save());
    await waitFor(() => expect(callsTo("put", "/availability/me/weekly")).toHaveLength(1));
    expect(callsTo("put", "/availability/me/weekly")[0].body).toEqual({
      timezone: "America/Bogota",
      slots: [{ day_of_week: 0, start_time_local: "09:00", end_time_local: "11:00", is_available: true }, { day_of_week: 0, start_time_local: "12:00", end_time_local: "13:00", is_available: true }],
    });
    expect(await screen.findByText("¡Disponibilidad semanal actualizada con éxito!")).toBeInTheDocument();
  });

  it("sin horario previo usa la zona de la cuenta", async () => {
    mockApi("put", "/availability/me/weekly", {});
    const { user } = setup();
    await screen.findByText("Sin bloques seleccionados");
    await user.click(hour("09:00"));
    await user.click(save());
    await waitFor(() => expect(callsTo("put", "/availability/me/weekly")).toHaveLength(1));
    expect(typeof (callsTo("put", "/availability/me/weekly")[0].body as { timezone: string }).timezone).toBe("string");
  });

  it("el último bloque del día cierra a las 23:59", async () => {
    mockApi("put", "/availability/me/weekly", {});
    const { user } = setup();
    await screen.findByText("Sin bloques seleccionados");
    await user.click(hour("23:00"));
    await user.click(save());
    await waitFor(() => expect(callsTo("put", "/availability/me/weekly")).toHaveLength(1));
    expect((callsTo("put", "/availability/me/weekly")[0].body as { slots: { end_time_local: string }[] }).slots[0].end_time_local).toBe("23:59");
  });

  it("un error del servidor se muestra", async () => {
    const { user } = setup([], () => mockApiError("put", "/availability/me/weekly", 409, "Hay clases en ese horario"));
    await screen.findByText("Sin bloques seleccionados");
    await user.click(hour("09:00"));
    await user.click(save());
    expect((await screen.findAllByText("Hay clases en ese horario")).length).toBeGreaterThan(0);
  });
});

describe("Disponibilidad semanal · carga", () => {
  it("si falla la carga ofrece reintentar y vuelve a pedirla", async () => {
    const { user } = setup([], () => mockApiError("get", "/availability/me/weekly", 500, "x"));
    expect(await screen.findByText("No se pudo cargar tu disponibilidad")).toBeInTheDocument();
    const before = callsTo("get", "/availability/me/weekly").length;
    await user.click(screen.getByRole("button", { name: /Reintentar/ }));
    await waitFor(() => expect(callsTo("get", "/availability/me/weekly").length).toBeGreaterThan(before));
  });
});
