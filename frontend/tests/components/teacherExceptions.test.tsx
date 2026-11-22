/**
 * Excepciones de disponibilidad (profesor): bloquear o abrir horarios puntuales, un día o un rango, todo el día o
 * por horas; lista de las vigentes, borrado y limpieza silenciosa de las ya vencidas.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { screen, waitFor } from "@testing-library/react";
import ExceptionsSection from "@/app/(teacher)/teacher/availability/ExceptionsSection";
import { renderScreen } from "./render";
import { mockApi, mockApiError, callsTo } from "./fakeApi";

const HOUR = 3600_000;
const EXC = (id: number, startH: number, over: Record<string, unknown> = {}) => ({
  id, start_time_utc: new Date(Date.now() + startH * HOUR).toISOString(), end_time_utc: new Date(Date.now() + (startH + 2) * HOUR).toISOString(),
  is_available: false, reason: null, is_full_day: true, ...over,
});

const pad = (n: number) => String(n).padStart(2, "0");
const now = new Date();
const TODAY_DAY = now.getDate();
const TODAY_STR = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const LAST_DAY = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
const LAST_STR = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(LAST_DAY)}`;

function setup(list: unknown[] = [], extra?: () => void) {
  mockApi("get", "/availability/me/exceptions", list);
  extra?.();
  const view = renderScreen(<ExceptionsSection />, { role: "teacher" });
  return { ...view, user: userEvent.setup() };
}
const day = (n: number) => screen.getByRole("button", { name: String(n) });
const save = () => screen.getByRole("button", { name: /Agregar excepción/ });

afterEach(() => { vi.restoreAllMocks(); });

describe("Excepciones · lista", () => {
  it("sin excepciones lo dice", async () => {
    setup();
    expect(await screen.findByText("Sin excepciones configuradas")).toBeInTheDocument();
    expect(screen.getByText(/Excepciones configuradas \(0\)/)).toBeInTheDocument();
  });

  it("muestra bloqueos y horarios extra, con su rango horario o «Todo el día»", async () => {
    setup([EXC(1, 30), EXC(2, 60, { is_available: true, is_full_day: false })]);
    expect(await screen.findByText("Bloqueado")).toBeInTheDocument();
    expect(screen.getByText("Extra")).toBeInTheDocument();
    expect(screen.getAllByText("Todo el día").length).toBeGreaterThan(0);
    expect(screen.getByText(/Excepciones configuradas \(2\)/)).toBeInTheDocument();
  });

  it("las ya vencidas no se muestran y se borran en silencio una sola vez", async () => {
    setup([EXC(1, 30), EXC(7, -50)]);
    expect(await screen.findByText(/Excepciones configuradas \(1\)/)).toBeInTheDocument();
    await waitFor(() => expect(callsTo("delete", "/availability/me/exceptions/7")).toHaveLength(1));
    expect(callsTo("delete", "/availability/me/exceptions/1")).toHaveLength(0);
  });

  it("si falla la limpieza de una vencida no rompe la pantalla", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    setup([EXC(7, -50)], () => mockApiError("delete", "/availability/me/exceptions/7", 500, "x"));
    await waitFor(() => expect(err).toHaveBeenCalled());
    expect(await screen.findByText("Sin excepciones configuradas")).toBeInTheDocument();
  });

  it("si falla la carga avisa", async () => {
    setup([], () => mockApiError("get", "/availability/me/exceptions", 500, "x"));
    await waitFor(() => expect(screen.queryByText("Sin excepciones configuradas")).not.toBeInTheDocument());
  });

  it("eliminar una excepción la borra y avisa", async () => {
    mockApi("delete", "/availability/me/exceptions/1", {});
    const { user } = setup([EXC(1, 30)]);
    await user.click(await screen.findByTitle("Eliminar excepción"));
    await waitFor(() => expect(callsTo("delete", "/availability/me/exceptions/1")).toHaveLength(1));
    expect((await screen.findAllByText("Excepción eliminada correctamente")).length).toBeGreaterThan(0);
  });

  it("un error al eliminar se muestra", async () => {
    const { user } = setup([EXC(1, 30)], () => mockApiError("delete", "/availability/me/exceptions/1", 409, "Hay una clase en ese horario"));
    await user.click(await screen.findByTitle("Eliminar excepción"));
    expect((await screen.findAllByText("Hay una clase en ese horario")).length).toBeGreaterThan(0);
  });
});

describe("Excepciones · crear", () => {
  it("sin fecha pide elegirla", async () => {
    const { user } = setup();
    await screen.findByText("Sin excepciones configuradas");
    await user.click(save());
    expect(await screen.findByText("Selecciona una fecha")).toBeInTheDocument();
    expect(callsTo("post", /exceptions/)).toHaveLength(0);
  });

  it("bloquea un día completo y avisa «1 excepción guardada»", async () => {
    mockApi("post", "/availability/me/exceptions", {});
    const { user } = setup();
    await screen.findByText("Sin excepciones configuradas");
    await user.click(day(TODAY_DAY));
    await user.type(screen.getByPlaceholderText("Ej: Vacaciones, cita médica..."), "  Cita  ");
    await user.click(save());
    await waitFor(() => expect(callsTo("post", "/availability/me/exceptions")).toHaveLength(1));
    expect(callsTo("post", "/availability/me/exceptions")[0].body).toMatchObject({
      date: TODAY_STR, is_full_day: true, start_time_local: null, end_time_local: null, is_available: false, reason: "Cita",
    });
    expect((await screen.findAllByText("1 excepción guardada correctamente")).length).toBeGreaterThan(0);
    expect(screen.getByPlaceholderText("Ej: Vacaciones, cita médica...")).toHaveValue("");
  });

  it("horario extra por horas manda las horas locales y is_available", async () => {
    mockApi("post", "/availability/me/exceptions", {});
    const { user } = setup();
    await screen.findByText("Sin excepciones configuradas");
    await user.click(day(TODAY_DAY));
    await user.click(screen.getByRole("button", { name: /Añadir extra/ }));
    await user.click(screen.getAllByRole("switch")[1]); // quita «Todo el día»
    const times = document.querySelectorAll('input[type="time"]');
    expect(times).toHaveLength(2);
    await user.clear(times[0] as HTMLInputElement);
    await user.type(times[0] as HTMLInputElement, "10:00");
    await user.clear(times[1] as HTMLInputElement);
    await user.type(times[1] as HTMLInputElement, "12:30");
    await user.click(save());
    await waitFor(() => expect(callsTo("post", "/availability/me/exceptions")).toHaveLength(1));
    expect(callsTo("post", "/availability/me/exceptions")[0].body).toMatchObject({ is_full_day: false, start_time_local: "10:00", end_time_local: "12:30", is_available: true, reason: null });
  });

  it("rango: exige la fecha final y luego guarda varias excepciones", async () => {
    mockApi("post", "/availability/me/exceptions", [{}, {}, {}]);
    const { user } = setup();
    await screen.findByText("Sin excepciones configuradas");
    await user.click(screen.getAllByRole("switch")[0]); // rango
    await user.click(save());
    expect(await screen.findByText("Selecciona el rango de fechas")).toBeInTheDocument();
    await user.click(day(TODAY_DAY));
    expect(screen.getByText(/elige la fecha final/)).toBeInTheDocument();
    await user.click(save());
    expect(await screen.findByText("Selecciona también la fecha final del rango")).toBeInTheDocument();
    await user.click(day(LAST_DAY));
    expect(screen.getByText(new RegExp(`${TODAY_STR} → ${LAST_STR}`))).toBeInTheDocument();
    await user.click(save());
    await waitFor(() => expect(callsTo("post", "/availability/me/exceptions")).toHaveLength(1));
    expect(callsTo("post", "/availability/me/exceptions")[0].body).toMatchObject({ date: TODAY_STR, end_date: LAST_STR });
    expect((await screen.findAllByText("3 excepciones guardadas correctamente")).length).toBeGreaterThan(0);
  });

  it("cambiar entre día y rango limpia la fecha elegida", async () => {
    const { user } = setup();
    await screen.findByText("Sin excepciones configuradas");
    await user.click(day(TODAY_DAY));
    await user.click(screen.getAllByRole("switch")[0]);
    await user.click(save());
    expect(await screen.findByText("Selecciona el rango de fechas")).toBeInTheDocument();
  });

  it("un error del servidor se muestra", async () => {
    const { user } = setup([], () => mockApiError("post", "/availability/me/exceptions", 409, "Choca con una clase confirmada"));
    await screen.findByText("Sin excepciones configuradas");
    await user.click(day(TODAY_DAY));
    await user.click(save());
    expect((await screen.findAllByText("Choca con una clase confirmada")).length).toBeGreaterThan(0);
  });
});
