/**
 * Chipi (asistente IA flotante): abrir/cerrar, enviar mensajes (la pantalla actual se manda como contexto), sugerencias,
 * reinicio, error de conexión, burbuja de inactividad y el enlace a soporte humano según el rol.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { act, screen, waitFor } from "@testing-library/react";
import ChipiWidget from "@/components/chipi/ChipiWidget";
import { renderScreen } from "./render";
import { mockApi, mockApiError, callsTo, fakeApi } from "./fakeApi";

const PLACEHOLDER = "Pregúntale algo a Chipi...";

function setup(props: React.ComponentProps<typeof ChipiWidget> = {}, role: "student" | "teacher" | "superadmin" | "anon" = "student", route = "/dashboard") {
  mockApi("post", "/chipi/chat", { response: "Respuesta de Chipi" });
  const view = renderScreen(<ChipiWidget {...props} />, { role, route });
  return { ...view, user: userEvent.setup() };
}
const input = () => screen.getByPlaceholderText(PLACEHOLDER) as HTMLInputElement;
const sendBtn = () => input().parentElement!.querySelector("button") as HTMLButtonElement;

beforeEach(() => { Element.prototype.scrollIntoView = vi.fn(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("Chipi · conversación", () => {
  it("arranca con el saludo y las tres sugerencias rápidas", () => {
    setup();
    expect(screen.getByText(/Soy Chipi, tu asistente IA/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "¿Cómo puedo agendar una clase?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ver métodos de pago disponibles" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tengo un problema técnico" })).toBeInTheDocument();
  });

  it("enviar manda el mensaje con la pantalla actual y pinta la respuesta", async () => {
    const { user } = setup({}, "student", "/dashboard/schedule");
    await user.type(input(), "Hola Chipi");
    await user.click(sendBtn());
    expect(await screen.findByText("Respuesta de Chipi")).toBeInTheDocument();
    expect(screen.getByText("Hola Chipi")).toBeInTheDocument();
    expect(callsTo("post", "/chipi/chat")[0].body).toEqual({ message: "Hola Chipi", screen: "schedule_student", stream: false });
    expect(input()).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Tengo un problema técnico" })).not.toBeInTheDocument();
  });

  it("el prop screenName tiene prioridad sobre la ruta", async () => {
    const { user } = setup({ screenName: "mi_pantalla" });
    await user.type(input(), "x");
    await user.click(sendBtn());
    await screen.findByText("Respuesta de Chipi");
    expect(callsTo("post", "/chipi/chat")[0].body).toMatchObject({ screen: "mi_pantalla" });
  });

  it("Enter envía y Shift+Enter no", async () => {
    const { user } = setup();
    await user.type(input(), "uno{Shift>}{Enter}{/Shift}");
    expect(callsTo("post", "/chipi/chat")).toHaveLength(0);
    await user.type(input(), "{Enter}");
    await waitFor(() => expect(callsTo("post", "/chipi/chat")).toHaveLength(1));
  });

  it("un texto en blanco no se envía y el botón está desactivado", async () => {
    const { user } = setup();
    expect(sendBtn()).toBeDisabled();
    await user.type(input(), "   {Enter}");
    expect(callsTo("post", "/chipi/chat")).toHaveLength(0);
  });

  it("una sugerencia rápida se envía tal cual", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Tengo un problema técnico" }));
    expect(await screen.findByText("Respuesta de Chipi")).toBeInTheDocument();
    expect(callsTo("post", "/chipi/chat")[0].body).toMatchObject({ message: "Tengo un problema técnico" });
  });

  it("mientras responde muestra «escribiendo» y bloquea el campo", async () => {
    let release!: (v: unknown) => void;
    const { user } = setup();
    vi.spyOn(fakeApi, "post").mockImplementationOnce(() => new Promise((r) => { release = r as never; }) as never);
    await user.type(input(), "Hola");
    await user.click(sendBtn());
    expect(await screen.findByText("Chipi está escribiendo")).toBeInTheDocument();
    expect(input()).toBeDisabled();
    await act(async () => { release({ data: { response: "Listo" } }); });
    expect(await screen.findByText("Listo")).toBeInTheDocument();
    expect(input()).toBeEnabled();
  });

  it("si falla la conexión lo dice con amabilidad y deja reintentar", async () => {
    const { user } = setup();
    mockApiError("post", "/chipi/chat", 500, "x");
    await user.type(input(), "Hola");
    await user.click(sendBtn());
    expect(await screen.findByText(/Tuve un pequeño inconveniente de conexión/)).toBeInTheDocument();
    expect(input()).toBeEnabled();
  });

  it("«Reiniciar chat» deja solo el mensaje de reinicio y vuelven las sugerencias", async () => {
    const { user } = setup();
    await user.type(input(), "Hola");
    await user.click(sendBtn());
    await screen.findByText("Respuesta de Chipi");
    await user.click(screen.getByTitle("Reiniciar chat"));
    expect(screen.getByText(/Chat reiniciado/)).toBeInTheDocument();
    expect(screen.queryByText("Respuesta de Chipi")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tengo un problema técnico" })).toBeInTheDocument();
  });
});

describe("Chipi · ventana y burbuja", () => {
  it("el botón flotante abre y cierra la ventana", async () => {
    const { user } = setup();
    const dialog = () => input().closest("div[class*='pointer-events']") as HTMLElement;
    expect(dialog().className).toMatch(/pointer-events-none/);
    await user.click(screen.getByLabelText("Abrir asistente Chipi"));
    expect(dialog().className).toMatch(/pointer-events-auto/);
    await user.click(screen.getByTitle("Reiniciar chat").nextElementSibling as HTMLElement);
    expect(dialog().className).toMatch(/pointer-events-none/);
  });

  it("tras 12 s sin actividad aparece la burbuja y se puede descartar; un clic reinicia la espera", async () => {
    vi.useFakeTimers();
    setup();
    const bubble = () => screen.getByText("¿Tienes alguna duda sobre esta sección?").closest("div[class*='fixed']") as HTMLElement;
    expect(bubble().className).toMatch(/opacity-0/);
    act(() => { vi.advanceTimersByTime(12_100); });
    expect(bubble().className).toMatch(/opacity-100/);
    act(() => { window.dispatchEvent(new Event("click")); });
    expect(bubble().className).toMatch(/opacity-0/);
    act(() => { vi.advanceTimersByTime(12_100); });
    expect(bubble().className).toMatch(/opacity-100/);
    act(() => { (bubble().querySelector("button") as HTMLButtonElement).click(); });
    expect(bubble().className).toMatch(/opacity-0/);
  });

  it("si el chat interno está montado, Chipi flota más arriba salvo que se indique lo contrario", () => {
    const a = setup({ raised: true });
    expect(a.getByLabelText("Abrir asistente Chipi").className).toMatch(/8\.75rem/);
    a.unmount();
    const b = setup({ raised: false });
    expect(b.getByLabelText("Abrir asistente Chipi").className).toMatch(/4\.75rem/);
  });
});

describe("Chipi · soporte humano", () => {
  it.each(["student", "teacher"] as const)("el %s ve el enlace a soporte y abre el formulario", async (role) => {
    const { user } = setup({}, role);
    await user.click(screen.getByRole("button", { name: /Habla con soporte/ }));
    expect((await screen.findAllByText(/soporte|ticket/i)).length).toBeGreaterThan(1);
  });

  it("el superadmin y el visitante no lo ven", () => {
    const a = setup({}, "superadmin");
    expect(screen.queryByRole("button", { name: /Habla con soporte/ })).not.toBeInTheDocument();
    a.unmount();
    setup({}, "anon");
    expect(screen.queryByRole("button", { name: /Habla con soporte/ })).not.toBeInTheDocument();
  });
});

describe("Chipi · pantalla según la ruta", () => {
  it.each([
    ["/", "main"],
    ["/dashboard/teachers", "choose_teacher"],
    ["/dashboard/teachers/maria", "teacher_browse"],
    ["/admin/students/banned", undefined],
    ["/ruta/desconocida", "main"],
  ])("%s → %s", async (route, expected) => {
    const { user } = setup({}, "student", route);
    await user.type(input(), "x");
    await user.click(sendBtn());
    await screen.findByText("Respuesta de Chipi");
    const sent = (callsTo("post", "/chipi/chat")[0].body as { screen: string }).screen;
    if (expected) expect(sent).toBe(expected);
    else expect(sent).toMatch(/banned/);
  });
});
