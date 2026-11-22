/**
 * Asistente de alta del profesor: 7 pasos (bienvenida, perfil, especialidades, idiomas, disponibilidad, redes, video)
 * y pantalla de éxito. Se prueba recorriéndolo como lo haría una persona y mirando qué se envía al servidor.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import TeacherOnboardingPage from "@/app/(teacher)/teacher/onboarding/page";
import { renderScreen } from "./render";
import { routerState } from "./router";
import { mockApi, mockApiError, callsTo, makeUser } from "./fakeApi";
import { useAuthStore } from "@/store/authStore";

const CATALOG = { subjects: [], languages: [], spoken_languages: ["Español", "Inglés"], skill_suggestions: [], student_goals: {} };

type U = ReturnType<typeof userEvent.setup>;
const next = (u: U) => u.click(screen.getByRole("button", { name: /Continuar|Saltar por ahora/ }));

function setup(avatar: string | null = "https://img.example.com/yo.png") {
  mockApi("get", "/users/me", { ...makeUser("teacher"), avatar });
  mockApi("get", "/system-catalogs/", CATALOG);
  const view = renderScreen(<TeacherOnboardingPage />, { role: "teacher" });
  return { ...view, user: userEvent.setup() };
}

async function fillProfile(user: U, container: HTMLElement, over: { title?: string; bio?: string; phone?: string } = {}) {
  await user.type(await screen.findByPlaceholderText(/Profesora certificada de inglés/), over.title ?? "Profe de español");
  await user.type(screen.getByPlaceholderText(/Cuéntales a los estudiantes/), over.bio ?? "Diez años enseñando.");
  const selects = container.querySelectorAll("select");
  await user.selectOptions(selects[0] as HTMLSelectElement, "Venezuela");
  await user.type(screen.getByPlaceholderText("412 000 0000"), over.phone ?? "414 111 2222");
}

async function toStep(n: number, user: U, container: HTMLElement) {
  await user.click(await screen.findByRole("button", { name: /Configurar mi perfil/ })); // 1 → 2
  if (n === 2) return;
  await fillProfile(user, container);
  await next(user); // → 3
  if (n === 3) return;
  await user.click(await screen.findByRole("button", { name: "Español" }));
  await next(user); // → 4
  if (n === 4) return;
  await user.click(await screen.findByRole("button", { name: "Inglés" }));
  await user.click(screen.getByRole("radio", { name: "Inglés: Fluido" }));
  await next(user); // → 5
  if (n === 5) return;
  await next(user); // → 6
  if (n === 6) return;
  await next(user); // → 7
}

beforeEach(() => { vi.useRealTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("Onboarding del profesor · bienvenida y perfil", () => {
  it("arranca en la bienvenida con el nombre del profesor", async () => {
    setup();
    expect(await screen.findAllByText(/Hola, /)).not.toHaveLength(0);
  });

  it("«Cerrar sesión y continuar después» sale al login", async () => {
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: /Cerrar sesión y continuar después/ }));
    await waitFor(() => expect(routerState.router.push).toHaveBeenCalledWith("/login"));
  });

  it("sin foto, título, bio, nacionalidad y teléfono el botón Continuar está desactivado", async () => {
    const { user, container } = setup(null);
    await user.click(await screen.findByRole("button", { name: /Configurar mi perfil/ }));
    const btn = await screen.findByRole("button", { name: /Continuar/ });
    expect(btn).toBeDisabled();
    await fillProfile(user, container);
    expect(btn).toBeDisabled(); // falta la foto
  });

  it("con todo completo habilita Continuar y avanza a especialidades", async () => {
    const { user, container } = setup();
    await toStep(3, user, container);
    expect(await screen.findByRole("heading", { name: "Tus especialidades" })).toBeInTheDocument();
  });

  it("la bio muestra su contador de caracteres", async () => {
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: /Configurar mi perfil/ }));
    await user.type(await screen.findByPlaceholderText(/Cuéntales a los estudiantes/), "hola");
    expect(screen.getByText("4 caracteres")).toBeInTheDocument();
  });

  it("«Atrás» desde el perfil vuelve a la bienvenida", async () => {
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: /Configurar mi perfil/ }));
    await user.click(await screen.findByRole("button", { name: /Volver/ }));
    expect(await screen.findAllByText(/Hola, /)).not.toHaveLength(0);
  });

  it("subir una foto muestra su vista previa y se puede quitar", async () => {
    URL.createObjectURL = vi.fn(() => "blob:foto");
    URL.revokeObjectURL = vi.fn();
    class FR { result = "data:image/png;base64,AAA"; onloadend: null | (() => void) = null;
      readAsDataURL() { setTimeout(() => this.onloadend?.(), 0); } }
    vi.stubGlobal("FileReader", FR as unknown as typeof FileReader);
    const { user, container } = setup(null);
    await user.click(await screen.findByRole("button", { name: /Configurar mi perfil/ }));
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "yo.png", { type: "image/png" })] } });
    await waitFor(() => expect(container.querySelector("img[src^='data:'], img[src^='blob:']")).not.toBeNull());
    vi.unstubAllGlobals();
  });
});

describe("Onboarding del profesor · especialidades", () => {
  it("sin idioma ni materia no se puede continuar", async () => {
    const { user, container } = setup();
    await toStep(3, user, container);
    expect(await screen.findByRole("button", { name: /Continuar/ })).toBeDisabled();
  });

  it("elegir y des-elegir un idioma; añadir y quitar habilidades y certificaciones", async () => {
    const { user, container } = setup();
    await toStep(3, user, container);
    const lang = await screen.findByRole("button", { name: "Español" });
    await user.click(lang);
    expect(screen.getByRole("button", { name: /Continuar/ })).toBeEnabled();
    await user.click(lang);
    expect(screen.getByRole("button", { name: /Continuar/ })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Matematica" }));
    const skill = screen.getByPlaceholderText("Añadir habilidad personalizada...");
    await user.type(skill, "Gramática");
    await user.click(skill.nextElementSibling as HTMLElement);
    expect(screen.getByText("Gramática")).toBeInTheDocument();
    await user.type(skill, "Gramática");
    await user.click(skill.nextElementSibling as HTMLElement); // repetida: no se duplica
    expect(screen.getAllByText("Gramática")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: /Añadir certificación/ }));
    await user.type(screen.getByPlaceholderText("Nombre del certificado"), "CELTA");
    await user.type(screen.getByPlaceholderText("Año (ej: 2022)"), "2020");
    expect((screen.getByPlaceholderText("Nombre del certificado") as HTMLInputElement).value).toBe("CELTA");
    const row = screen.getByPlaceholderText("Nombre del certificado").parentElement as HTMLElement;
    await user.click(within(row.parentElement as HTMLElement).getAllByRole("button").at(-1) as HTMLElement);
    expect(screen.queryByPlaceholderText("Nombre del certificado")).not.toBeInTheDocument();
  });

  it("«Atrás» vuelve al perfil conservando lo escrito", async () => {
    const { user, container } = setup();
    await toStep(3, user, container);
    await user.click(await screen.findByRole("button", { name: /Volver/ }));
    expect(await screen.findByPlaceholderText(/Profesora certificada de inglés/)).toHaveValue("Profe de español");
  });
});

describe("Onboarding del profesor · idiomas, disponibilidad, redes y video", () => {
  it("idiomas que habla: exige al menos uno con nivel", async () => {
    const { user, container } = setup();
    await toStep(4, user, container);
    expect(await screen.findByRole("button", { name: /Continuar/ })).toBeDisabled();
  });

  it("disponibilidad: sin bloques ofrece «Saltar por ahora»; con horas cambia a «Continuar», se puede quitar y limpiar", async () => {
    const { user, container } = setup();
    await toStep(5, user, container);
    expect(await screen.findByRole("heading", { name: "Tu disponibilidad" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Saltar por ahora/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "09:00" }));
    await user.click(screen.getByRole("button", { name: "10:00" }));
    expect(screen.getByRole("button", { name: /^Continuar/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Limpiar" }));
    expect(screen.getByRole("button", { name: /Saltar por ahora/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Mar" }));
    await user.click(screen.getByRole("button", { name: "09:00" }));
    const chip = screen.getAllByText("Mar").find((e) => e.tagName === "SPAN") as HTMLElement;
    await user.click(chip.parentElement!.querySelector("button") as HTMLElement);
    expect(screen.getByRole("button", { name: /Saltar por ahora/ })).toBeInTheDocument();
  });

  it("redes sociales: cada campo se puede rellenar", async () => {
    const { user, container } = setup();
    await toStep(6, user, container);
    await user.type(await screen.findByPlaceholderText("https://www.instagram.com/tu_usuario/"), "https://ig.example/yo");
    expect(screen.getByPlaceholderText("https://www.instagram.com/tu_usuario/")).toHaveValue("https://ig.example/yo");
    await user.type(screen.getByPlaceholderText("@tuprofe"), "@yo");
    expect(screen.getByPlaceholderText("@tuprofe")).toHaveValue("@yo");
  });

  it("video: elegir un archivo muestra el reproductor y se puede quitar", async () => {
    URL.createObjectURL = vi.fn(() => "blob:video");
    URL.revokeObjectURL = vi.fn();
    const { user, container } = setup();
    await toStep(7, user, container);
    expect(await screen.findByRole("button", { name: /Saltar y finalizar/ })).toBeInTheDocument();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["v"], "yo.mp4", { type: "video/mp4" })] } });
    expect(await screen.findByRole("button", { name: /Finalizar y acceder/ })).toBeInTheDocument();
    expect(container.querySelector("video")).not.toBeNull();
    await user.click(screen.getByRole("button", { name: /Quitar video/ }));
    expect(await screen.findByRole("button", { name: /Saltar y finalizar/ })).toBeInTheDocument();
  });
});

describe("Onboarding del profesor · finalizar", () => {
  async function finishFlow(withAvailability: boolean) {
    const ctx = setup();
    const { user, container } = ctx;
    await toStep(5, user, container);
    if (withAvailability) {
      await user.click(await screen.findByRole("button", { name: "09:00" }));
    }
    await next(user); // → 6
    await next(user); // → 7
    await user.click(await screen.findByRole("button", { name: /Saltar y finalizar/ }));
    return ctx;
  }

  it("envía foto/teléfono, perfil, disponibilidad y marca el onboarding como completado", async () => {
    useAuthStore.getState().setUser({ ...makeUser("teacher") } as never);
    await finishFlow(true);
    await waitFor(() => expect(callsTo("patch", "/teachers/me/profile")).toHaveLength(1));
    const profile = callsTo("patch", "/teachers/me/profile")[0].body as Record<string, unknown>;
    expect(profile).toMatchObject({ title: "Profe de español", bio: "Diez años enseñando.", languages: ["Español"] });
    expect((profile.social_links as Record<string, string>).whatsapp).toMatch(/414 111 2222$/);
    expect(callsTo("put", "/availability/me/weekly")).toHaveLength(1);
    await waitFor(() => expect(callsTo("patch", "/users/me").length).toBeGreaterThanOrEqual(2));
    const last = callsTo("patch", "/users/me").at(-1)!.body as Record<string, unknown>;
    expect(last).toMatchObject({ onboarding_completed: true, spoken_languages: [{ language: "Inglés", level: "fluent" }] });
    expect(await screen.findByText(/Perfil listo/)).toBeInTheDocument();
    expect(useAuthStore.getState().user?.onboarding_completed).toBe(true);
  });

  it("sin bloques de horario no llama a la API de disponibilidad", async () => {
    await finishFlow(false);
    await waitFor(() => expect(callsTo("patch", "/teachers/me/profile")).toHaveLength(1));
    expect(callsTo("put", "/availability/me/weekly")).toHaveLength(0);
  });

  it("tras el éxito «Ir a mi dashboard» navega", async () => {
    const { user } = await finishFlow(false);
    await user.click(await screen.findByRole("button", { name: /Ir a mi dashboard/ }));
    expect(routerState.router.push).toHaveBeenCalledWith("/teacher/dashboard");
  });

  it("redirige solo al dashboard a los 3 segundos", async () => {
    await finishFlow(false);
    await screen.findByText(/Perfil listo/);
    await waitFor(() => expect(routerState.router.push).toHaveBeenCalledWith("/teacher/dashboard"), { timeout: 4500 });
  }, 8000);

  it("un error del servidor (texto) se muestra y se puede cerrar; no pasa a la pantalla de éxito", async () => {
    mockApiError("patch", "/teachers/me/profile", 400, "Título demasiado largo");
    const { user } = await finishFlow(false);
    expect(await screen.findByText("Título demasiado largo")).toBeInTheDocument();
    expect(screen.queryByText(/Perfil listo/)).not.toBeInTheDocument();
    const alert = screen.getByText("Título demasiado largo").parentElement as HTMLElement;
    await user.click(within(alert).getAllByRole("button").at(-1) as HTMLElement);
    expect(screen.queryByText("Título demasiado largo")).not.toBeInTheDocument();
  });

  it("un error de validación de FastAPI (lista) se muestra campo: mensaje", async () => {
    mockApiError("patch", "/teachers/me/profile", 422, [{ loc: ["body", "bio"], msg: "demasiado corta" }, { foo: 1 }]);
    await finishFlow(false);
    expect(await screen.findByText(/bio: demasiado corta/)).toBeInTheDocument();
  });

  it("un error sin detalle usa el mensaje genérico", async () => {
    mockApi("patch", "/teachers/me/profile", () => { throw new Error("red caída"); });
    await finishFlow(false);
    expect(await screen.findByText(/Error guardando el perfil/)).toBeInTheDocument();
  });

  it("sube la foto elegida y el video antes de marcar el onboarding como completo", async () => {
    mockApi("post", "/users/me/photo", { url: "https://cdn.example.com/foto.png" });
    mockApi("post", "/teachers/me/video", { ok: true });
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    class FR { result = "data:image/png;base64,AAA"; onloadend: null | (() => void) = null;
      readAsDataURL() { setTimeout(() => this.onloadend?.(), 0); } }
    vi.stubGlobal("FileReader", FR as unknown as typeof FileReader);
    const { user, container } = setup(null);
    await user.click(await screen.findByRole("button", { name: /Configurar mi perfil/ }));
    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [new File(["x"], "yo.png", { type: "image/png" })] } });
    await fillProfile(user, container);
    await next(user);
    await user.click(await screen.findByRole("button", { name: "Español" }));
    await next(user);
    await user.click(await screen.findByRole("button", { name: "Inglés" }));
    await user.click(screen.getByRole("radio", { name: "Inglés: Fluido" }));
    await next(user); await next(user); await next(user);
    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [new File(["v"], "yo.mp4", { type: "video/mp4" })] } });
    await user.click(await screen.findByRole("button", { name: /Finalizar y acceder/ }));
    await waitFor(() => expect(callsTo("post", "/teachers/me/video")).toHaveLength(1));
    expect(callsTo("post", "/users/me/photo")).toHaveLength(1);
    expect((callsTo("patch", "/teachers/me/profile")[0].body as Record<string, unknown>).photo_url).toBe("https://cdn.example.com/foto.png");
    vi.unstubAllGlobals();
  });
});
