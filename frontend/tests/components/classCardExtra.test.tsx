/**
 * ClassCard · flujos secundarios: reagendar en la propia tarjeta, errores de cada acción, solicitud de corrección
 * al soporte (no_show pasadas las 72 h), avatar, notas, teléfono sin enlace y menú que se abre hacia arriba.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import ClassCard, { type ClassCardData } from "@/components/classes/ClassCard";
import { renderScreen } from "./render";
import { mockApi, mockApiError, callsTo } from "./fakeApi";

const HOUR = 3600_000;
function cls(status: string, startHours: number, over: Partial<ClassCardData> = {}): ClassCardData {
  const start = Date.now() + startHours * HOUR;
  return {
    id: 21, class_type: "regular", subject: "Español", status, start_time_utc: new Date(start).toISOString(),
    end_time_utc: new Date(start + HOUR).toISOString(), duration_minutes: 60, meet_link: null,
    teacher_name: "Profe Uno", student_name: "Alumno Uno", teacher_timezone: "America/Caracas", student_timezone: "America/Caracas",
    teacher_phone: "+58 414-0000001", student_phone: "+58 412-0000002", ...over,
  };
}
function setup(data: ClassCardData, role: "student" | "teacher", props: Partial<React.ComponentProps<typeof ClassCard>> = {}) {
  const onUpdate = vi.fn();
  const utils = renderScreen(<ClassCard class_={data} role={role} onUpdate={onUpdate} {...props} />, { role });
  return { onUpdate, user: userEvent.setup(), ...utils };
}
afterEach(() => { vi.restoreAllMocks(); });

/** Pulsa una acción de la tarjeta, abriendo antes el menú «Acciones» si la acción está dentro. */
async function act(user: ReturnType<typeof userEvent.setup>, name: string) {
  if (!screen.queryByRole("button", { name })) await user.click(screen.getByRole("button", { name: /Acciones/ }));
  await user.click(screen.getByRole("button", { name }));
}

describe("ClassCard · reagendar en la tarjeta", () => {
  const open = async (user: ReturnType<typeof userEvent.setup>) => {
    await act(user, "Reagendar");
    const date = document.querySelector('input[type="date"]') as HTMLInputElement;
    const time = document.querySelector('input[type="time"]') as HTMLInputElement;
    return { date, time };
  };

  it("el alumno elige fecha y hora y se llama a su endpoint con inicio y fin en UTC", async () => {
    mockApi("patch", "/classes/21/reschedule", {});
    const { user, onUpdate } = setup(cls("confirmed", 48), "student");
    const { date, time } = await open(user);
    fireEvent.change(date, { target: { value: "2026-12-10" } });
    fireEvent.change(time, { target: { value: "10:00" } });
    await user.click(screen.getByRole("button", { name: "OK" }));
    await waitFor(() => expect(callsTo("patch", "/classes/21/reschedule")).toHaveLength(1));
    const b = callsTo("patch", "/classes/21/reschedule")[0].body as { start_time_utc: string; end_time_utc: string };
    expect(b.start_time_utc).toBe("2026-12-10T14:00:00.000Z"); // Caracas = UTC-4
    expect(b.end_time_utc).toBe("2026-12-10T15:00:00.000Z");
    expect(onUpdate).toHaveBeenCalled();
    expect(await screen.findByText("Clase reagendada correctamente")).toBeInTheDocument();
  });

  it("el profesor usa el endpoint del profesor", async () => {
    mockApi("patch", "/classes/teacher/21/reschedule", {});
    const { user } = setup(cls("confirmed", 48), "teacher");
    const { date, time } = await open(user);
    fireEvent.change(date, { target: { value: "2026-12-10" } });
    fireEvent.change(time, { target: { value: "10:00" } });
    await user.click(screen.getByRole("button", { name: "OK" }));
    await waitFor(() => expect(callsTo("patch", "/classes/teacher/21/reschedule")).toHaveLength(1));
  });

  it("sin fecha y hora «OK» no hace nada y «X» cierra", async () => {
    const { user } = setup(cls("confirmed", 48), "student");
    await open(user);
    await user.click(screen.getByRole("button", { name: "OK" }));
    expect(callsTo("patch", /reschedule/)).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "X" }));
    expect(screen.queryByRole("button", { name: "OK" })).not.toBeInTheDocument();
  });

  it("si el servidor rechaza lo muestra en la tarjeta", async () => {
    mockApiError("patch", "/classes/21/reschedule", 409, "Horario ocupado");
    const { user, onUpdate } = setup(cls("confirmed", 48), "student");
    const { date, time } = await open(user);
    fireEvent.change(date, { target: { value: "2026-12-10" } });
    fireEvent.change(time, { target: { value: "10:00" } });
    await user.click(screen.getByRole("button", { name: "OK" }));
    expect((await screen.findAllByText("Horario ocupado")).length).toBeGreaterThan(0);
    expect(onUpdate).not.toHaveBeenCalled();
  });
});

describe("ClassCard · errores de acciones del profesor", () => {
  it("un error al cambiar el estado se muestra", async () => {
    mockApiError("patch", "/classes/21/status", 400, "Transición no permitida");
    const { user } = setup(cls("confirmed", -0.5), "teacher");
    await user.click(screen.getByRole("button", { name: /Acciones/ }));
    await user.click(screen.getByRole("button", { name: "Completar" }));
    expect((await screen.findAllByText("Transición no permitida")).length).toBeGreaterThan(0);
  });

  it("un error al cancelar se muestra", async () => {
    mockApiError("delete", "/classes/teacher/21", 400, "No se puede cancelar");
    const { user } = setup(cls("confirmed", 48), "teacher");
    await act(user, "Cancelar");
    expect((await screen.findAllByText("No se puede cancelar")).length).toBeGreaterThan(0);
  });

  it("el menú de acciones se abre hacia arriba si no hay sitio debajo", async () => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ top: 700, bottom: window.innerHeight - 4, left: 0, right: 100, width: 100, height: 30, x: 0, y: 700, toJSON: () => ({}) });
    const { user } = setup(cls("confirmed", -0.5), "teacher");
    await user.click(screen.getByRole("button", { name: /Acciones/ }));
    expect(await screen.findByRole("button", { name: "Completar" })).toBeInTheDocument();
  });
});

describe("ClassCard · pedir corrección (no_show tras 72 h)", () => {
  const open = async (user: ReturnType<typeof userEvent.setup>) => {
    const menu = screen.queryByRole("button", { name: /Acciones/ });
    if (menu) await user.click(menu);
    await user.click(screen.getByRole("button", { name: "Pedir corrección" }));
    return screen.findByText("Pedir corrección de clase");
  };
  const reason = () => document.querySelector("textarea") as HTMLTextAreaElement;
  const send = () => screen.getByRole("button", { name: /Enviar a soporte|Enviando/ });

  it("con menos de 10 caracteres el envío está desactivado", async () => {
    const { user } = setup(cls("no_show", -100), "teacher");
    await open(user);
    await user.type(reason(), "corto");
    expect(send()).toBeDisabled();
  });

  it("envía la solicitud con el estado elegido y cierra", async () => {
    mockApi("post", "/support/class-corrections", {});
    const { user, onUpdate } = setup(cls("no_show", -100), "teacher");
    await open(user);
    await user.selectOptions(screen.getByRole("combobox"), "cancelled");
    await user.type(reason(), "El alumno avisó por chat que no vendría");
    await user.click(send());
    await waitFor(() => expect(callsTo("post", "/support/class-corrections")).toHaveLength(1));
    expect(callsTo("post", "/support/class-corrections")[0].body).toEqual({ class_id: 21, requested_status: "cancelled", reason: "El alumno avisó por chat que no vendría" });
    expect(await screen.findByText("Solicitud enviada a soporte")).toBeInTheDocument();
    expect(onUpdate).toHaveBeenCalled();
    expect(screen.queryByText("Pedir corrección de clase")).not.toBeInTheDocument();
  });

  it("un error del servidor se avisa y el modal sigue abierto; «Cancelar» lo cierra", async () => {
    mockApiError("post", "/support/class-corrections", 400, "Ya hay una solicitud");
    const { user } = setup(cls("no_show", -100), "teacher");
    await open(user);
    await user.type(reason(), "Motivo suficientemente largo");
    await user.click(send());
    expect(await screen.findByText("Ya hay una solicitud")).toBeInTheDocument();
    expect(screen.getByText("Pedir corrección de clase")).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "Cancelar" }).at(-1)!);
    expect(screen.queryByText("Pedir corrección de clase")).not.toBeInTheDocument();
  });
});

describe("ClassCard · presentación secundaria", () => {
  it("muestra las notas, el avatar y un teléfono sin dígitos como texto (no enlace)", () => {
    setup(cls("confirmed", 48, { notes: "Traer libro", teacher_avatar: "https://img.example.com/a.png", teacher_phone: "sin número" }), "student");
    expect(screen.getByText(/Traer libro/)).toBeInTheDocument();
    expect(document.querySelector("img")).not.toBeNull();
    expect(screen.getByText("sin número").closest("a")).toBeNull();
  });
});
