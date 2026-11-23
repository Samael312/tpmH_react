/**
 * ClassCard · cierra huecos: cierre del menú (clic fuera, scroll), «Sin resolver», salir del grupo / de una sesión
 * (cancelar, errores), enlace de la videollamada, clase externa, datos ausentes y WhatsApp.
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
const GROUP = (over: Partial<ClassCardData> = {}) => cls("confirmed", 26, { class_type: "group", cohort_id: 4, participant_count: 3, ...over });

describe("ClassCard · menú de acciones", () => {
  it("el menú se cierra al pulsar fuera y al hacer scroll", async () => {
    const { user } = setup(cls("confirmed", 2), "teacher");
    await user.click(screen.getByRole("button", { name: /Acciones/ }));
    expect(await screen.findByRole("button", { name: "Sin resolver" })).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Sin resolver" })).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Acciones/ }));
    await screen.findByRole("button", { name: "Sin resolver" });
    fireEvent.scroll(window);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Sin resolver" })).not.toBeInTheDocument());
  });

  it("«Sin resolver» marca la clase como finalizada", async () => {
    mockApi("patch", "/classes/21/status", {});
    const { user, onUpdate } = setup(cls("confirmed", 2), "teacher");
    await user.click(screen.getByRole("button", { name: /Acciones/ }));
    await user.click(await screen.findByRole("button", { name: "Sin resolver" }));
    await waitFor(() => expect(callsTo("patch", "/classes/21/status")[0]?.body).toEqual({ status: "finalized" }));
    expect(await screen.findByText("Estado de la clase actualizado")).toBeInTheDocument();
    expect(onUpdate).toHaveBeenCalled();
  });

  it("«No asistió» avisa con su mensaje propio", async () => {
    mockApi("patch", "/classes/21/status", {});
    const { user } = setup(cls("confirmed", -0.5), "teacher");
    await user.click(screen.getByRole("button", { name: /Acciones/ }));
    await user.click(await screen.findByRole("button", { name: "No asistió" }));
    expect(await screen.findByText("Clase marcada como no asistida")).toBeInTheDocument();
  });
});

describe("ClassCard · grupos", () => {
  it("salir del grupo pide confirmación; «Cancelar» la cierra sin llamar", async () => {
    const { user } = setup(GROUP(), "student");
    await user.click(screen.getByRole("button", { name: /Acciones/ }));
    await user.click(await screen.findByRole("button", { name: "Salir del grupo" }));
    await screen.findByText("¿Salir del grupo?");
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByText("¿Salir del grupo?")).not.toBeInTheDocument());
    expect(callsTo("post", /leave/)).toHaveLength(0);
  });

  it("sin grupo asociado, salir del grupo falla con un aviso", async () => {
    const { user } = setup(GROUP({ cohort_id: null }), "student");
    await user.click(screen.getByRole("button", { name: /Acciones/ }));
    await user.click(await screen.findByRole("button", { name: "Salir del grupo" }));
    await screen.findByText("¿Salir del grupo?");
    await user.click(screen.getAllByRole("button", { name: "Salir del grupo" }).at(-1)!);
    expect(await screen.findAllByText("Esta clase grupal no tiene grupo asociado")).not.toHaveLength(0);
  });

  it("salir de una sola sesión: «Cancelar» cierra, confirmar llama y un error se avisa", async () => {
    mockApiError("delete", "/classes/21/leave", 409, "Ya no puedes salir");
    const { user } = setup(GROUP(), "student");
    const open = async () => {
      await user.click(screen.getByRole("button", { name: /Acciones/ }));
      await user.click(await screen.findByRole("button", { name: "Salir de esta clase" }));
      await screen.findByText("¿Salir de esta clase?");
    };
    await open();
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByText("¿Salir de esta clase?")).not.toBeInTheDocument());
    await open();
    await user.click(screen.getAllByRole("button", { name: "Salir de esta clase" }).at(-1)!);
    expect(await screen.findAllByText("Ya no puedes salir")).not.toHaveLength(0);
  });

  it("el profesor ve cuántos alumnos hay inscritos aunque falte el recuento", () => {
    setup(GROUP({ participant_count: undefined, participant_names: undefined }), "teacher");
    expect(screen.getByText("0 alumno(s)")).toBeInTheDocument();
  });
});

describe("ClassCard · enlace, externas y datos ausentes", () => {
  it("el profesor abre el modal del enlace de la videollamada y lo cierra", async () => {
    const { user } = setup(cls("confirmed", 26), "teacher");
    await user.click(await screen.findByRole("button", { name: /Cargar link/ }));
    const cancel = await screen.findByRole("button", { name: /Cancelar/ });
    await user.click(cancel);
    await waitFor(() => expect(screen.queryByRole("button", { name: /Cancelar/ })).not.toBeInTheDocument());
  });

  it("una clase externa sin origen se llama «Externa»; con origen lo muestra capitalizado", () => {
    const { unmount } = setup(cls("confirmed", 26, { class_type: "external" }), "teacher");
    expect(screen.getByText("Externa")).toBeInTheDocument();
    unmount();
    setup(cls("confirmed", 26, { class_type: "external", external_source: "preply" }), "teacher");
    expect(screen.getByText("Preply")).toBeInTheDocument();
  });

  it("sin asignatura, sin hora de fin y sin nombre de la otra persona sigue pintando", () => {
    setup(cls("confirmed", 26, { subject: null, end_time_utc: null, teacher_name: null }), "student");
    expect(screen.getByText("Clase sin asignatura")).toBeInTheDocument();
    expect(screen.queryByText(/Prof\./)).not.toBeInTheDocument();
  });

  it("el avatar usa la inicial del nombre", () => {
    setup(cls("confirmed", 26, { teacher_name: "ana" }), "student");
    expect(screen.getByText("A")).toBeInTheDocument();
  });

  it("pulsar el WhatsApp no activa el clic de la tarjeta", async () => {
    const parent = vi.fn();
    renderScreen(<div onClick={parent}><ClassCard class_={cls("confirmed", 26)} role="teacher" /></div>, { role: "teacher" });
    const link = document.querySelector("a[href^='https://wa.me/']") as HTMLAnchorElement;
    link.addEventListener("click", (e) => e.preventDefault());
    await userEvent.setup().click(link);
    expect(parent).not.toHaveBeenCalled();
  });

  it("el botón «Unirse» aparece con link aunque el estado no permita gestionarlo", () => {
    setup(cls("completed", -48, { meet_link: "https://meet.example.com/x" }), "student");
    expect(screen.getByRole("link", { name: /Unirse a la clase/ })).toHaveAttribute("href", "https://meet.example.com/x");
  });

  it("la corrección de una clase no asistida se cierra pulsando el fondo", async () => {
    const { user } = setup(cls("no_show", -100), "teacher");
    const menu = screen.queryByRole("button", { name: /Acciones/ });
    if (menu) await user.click(menu);
    await user.click(screen.getByRole("button", { name: "Pedir corrección" }));
    await screen.findByText("Pedir corrección de clase");
    await user.click(document.querySelector("div[class*='bg-slate-900/50']") as HTMLElement);
    await waitFor(() => expect(screen.queryByText("Pedir corrección de clase")).not.toBeInTheDocument());
  });
});
