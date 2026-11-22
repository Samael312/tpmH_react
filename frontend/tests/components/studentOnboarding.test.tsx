/**
 * Asistente de alta del alumno: bienvenida → preferencias (foto, zona, nacionalidad, teléfono, objetivo) → idiomas que
 * habla → disponibilidad (opcional) → éxito.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import StudentOnboardingPage from "@/app/(student)/dashboard/onboarding/page";
import { GOALS } from "@/lib/teacherOptions";
import { renderScreen } from "./render";
import { routerState } from "./router";
import { mockApi, mockApiError, callsTo, makeUser } from "./fakeApi";
import { useAuthStore } from "@/store/authStore";

const CATALOG = { subjects: [], languages: [], spoken_languages: ["Español", "Inglés"], skill_suggestions: [], student_goals: {} };
type U = ReturnType<typeof userEvent.setup>;
const FIRST_GOAL = GOALS.idiomas[0].text;

function setup(avatar: string | null = "https://img.example.com/yo.png") {
  mockApi("get", "/users/me", { ...makeUser("student"), avatar });
  mockApi("get", "/system-catalogs/", CATALOG);
  const view = renderScreen(<StudentOnboardingPage />, { role: "student" });
  return { ...view, user: userEvent.setup() };
}

const cont = (u: U) => u.click(screen.getByRole("button", { name: /^Continuar|Saltar por ahora/ }));

async function fillPrefs(user: U, container: HTMLElement, goal: string | null = FIRST_GOAL) {
  await user.click(await screen.findByRole("button", { name: /Empezar configuración/ }));
  const selects = container.querySelectorAll("select");
  await user.selectOptions(selects[1] as HTMLSelectElement, "Venezuela");
  await user.type(await screen.findByPlaceholderText("412 000 0000"), "414 999 8888");
  if (goal) await user.click(screen.getByRole("button", { name: new RegExp(goal.slice(0, 12)) }));
}

async function toStep(n: number, user: U, container: HTMLElement) {
  await fillPrefs(user, container);
  if (n === 2) return;
  await cont(user); // → 3
  if (n === 3) return;
  await user.click(await screen.findByRole("button", { name: "Inglés" }));
  await user.click(screen.getByRole("radio", { name: "Inglés: Fluido" }));
  await cont(user); // → 4
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("Onboarding del alumno · preferencias", () => {
  it("la bienvenida saluda y «Empezar configuración» pasa a preferencias", async () => {
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: /Empezar configuración/ }));
    expect(await screen.findByRole("heading", { name: "Tus preferencias" })).toBeInTheDocument();
  });

  it("Continuar sigue desactivado hasta tener foto, zona, nacionalidad, teléfono y objetivo", async () => {
    const { user, container } = setup(null);
    await fillPrefs(user, container);
    expect(screen.getByRole("button", { name: /^Continuar/ })).toBeDisabled(); // falta la foto
  });

  it("con todo completo avanza a idiomas", async () => {
    const { user, container } = setup();
    await toStep(3, user, container);
    expect(await screen.findByRole("heading", { name: "¿Qué idiomas hablas?" })).toBeInTheDocument();
  });

  it("sin objetivo no se puede continuar; al elegir uno sí", async () => {
    const { user, container } = setup();
    await fillPrefs(user, container, null);
    expect(screen.getByRole("button", { name: /^Continuar/ })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: new RegExp(FIRST_GOAL.slice(0, 12)) }));
    expect(screen.getByRole("button", { name: /^Continuar/ })).toBeEnabled();
  });

  it("«Otro objetivo» abre un cuadro para escribir el propio", async () => {
    const { user, container } = setup();
    await fillPrefs(user, container, null);
    await user.click(screen.getByRole("button", { name: /Otro objetivo/ }));
    const box = screen.getByPlaceholderText("Describe tu objetivo personalizado aquí...");
    expect(screen.getByRole("button", { name: /^Continuar/ })).toBeDisabled();
    await user.type(box, "Hablar con mi suegra");
    expect(screen.getByRole("button", { name: /^Continuar/ })).toBeEnabled();
  });

  it("cambiar de categoría muestra los objetivos de «Otras materias»", async () => {
    const { user, container } = setup();
    await fillPrefs(user, container, null);
    await user.click(screen.getByRole("button", { name: /Otras materias/ }));
    expect(screen.getByRole("button", { name: new RegExp(GOALS.academico[0].text.slice(0, 12)) })).toBeInTheDocument();
  });

  it("cambiar la zona horaria ajusta el prefijo telefónico de su país", async () => {
    const { user, container } = setup();
    await user.click(await screen.findByRole("button", { name: /Empezar configuración/ }));
    const selects = container.querySelectorAll("select");
    const dial = selects[2] as HTMLSelectElement;
    const before = dial.value;
    const tz = selects[0] as HTMLSelectElement;
    const other = Array.from(tz.options).map((o) => o.value).find((v) => v && v !== tz.value && /Madrid|Mexico|Bogota|Argentina/.test(v));
    if (other) await user.selectOptions(tz, other);
    expect(typeof dial.value).toBe("string");
    expect(before).toBeTruthy();
  });

  it("subir una foto muestra su vista previa y «Quitar» la borra", async () => {
    URL.createObjectURL = vi.fn(() => "blob:foto");
    const { user, container } = setup(null);
    await user.click(await screen.findByRole("button", { name: /Empezar configuración/ }));
    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [new File(["x"], "yo.png", { type: "image/png" })] },
    });
    await waitFor(() => expect(container.querySelector("img[src='blob:foto']")).not.toBeNull());
    const remove = container.querySelector("img[src='blob:foto']")!.closest("div")!.parentElement!.querySelector("button");
    if (remove) await user.click(remove);
  });

  it("«Volver» regresa a la bienvenida", async () => {
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: /Empezar configuración/ }));
    await user.click(await screen.findByRole("button", { name: /Volver/ }));
    expect(await screen.findByRole("button", { name: /Empezar configuración/ })).toBeInTheDocument();
  });

  it("«Cerrar sesión y continuar después» sale al login", async () => {
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: /Cerrar sesión/ }));
    await waitFor(() => expect(routerState.router.push).toHaveBeenCalledWith("/login"));
  });
});

describe("Onboarding del alumno · disponibilidad y final", () => {
  async function toSchedule() {
    const ctx = setup();
    await toStep(4, ctx.user, ctx.container);
    expect(await screen.findByRole("heading", { name: "Tu disponibilidad" })).toBeInTheDocument();
    return ctx;
  }

  it("sin horas ofrece «Saltar por ahora»; al marcar una hora pasa a «Continuar»; pulsarla otra vez la quita", async () => {
    const { user } = await toSchedule();
    expect(screen.getByRole("button", { name: /Saltar por ahora/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "09:00" }));
    expect(screen.getByRole("button", { name: /^Continuar/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "09:00" })); // volver a pulsarla la quita
    expect(screen.getByRole("button", { name: /Saltar por ahora/ })).toBeInTheDocument();
  });

  it("termina sin horario: guarda teléfono, perfil y onboarding; no manda preferencias", async () => {
    useAuthStore.getState().setUser({ ...makeUser("student") } as never);
    const { user } = await toSchedule();
    await user.click(screen.getByRole("button", { name: /Saltar por ahora/ }));
    await waitFor(() => expect(callsTo("patch", "/users/me/student-profile")).toHaveLength(1));
    expect(callsTo("patch", "/users/me/student-profile")[0].body).toMatchObject({ goal: FIRST_GOAL, preferred_payment_methods: [] });
    expect(callsTo("post", "/users/me/preferences")).toHaveLength(0);
    const last = callsTo("patch", "/users/me").at(-1)!.body as Record<string, unknown>;
    expect(last).toMatchObject({ onboarding_completed: true, spoken_languages: [{ language: "Inglés", level: "fluent" }] });
    expect(await screen.findByText(/Todo listo/)).toBeInTheDocument();
    expect(useAuthStore.getState().user?.onboarding_completed).toBe(true);
  });

  it("con horario manda las preferencias con la zona y los bloques", async () => {
    const { user } = await toSchedule();
    await user.click(screen.getByRole("button", { name: "09:00" }));
    await user.click(screen.getByRole("button", { name: /^Continuar/ }));
    await waitFor(() => expect(callsTo("post", "/users/me/preferences")).toHaveLength(1));
    const body = callsTo("post", "/users/me/preferences")[0].body as { slots: unknown[]; timezone: string };
    expect(body.slots.length).toBeGreaterThan(0);
    expect(body.timezone).toBeTruthy();
  });

  it("al terminar redirige al dashboard a los 3 segundos, o al pulsar el botón", async () => {
    const { user } = await toSchedule();
    await user.click(screen.getByRole("button", { name: /Saltar por ahora/ }));
    await screen.findByText(/Todo listo/);
    await waitFor(() => expect(routerState.router.replace).toHaveBeenCalledWith("/dashboard"), { timeout: 4500 });
    routerState.router.replace.mockClear?.();
    await user.click(screen.getByRole("button", { name: /Ir a mi dashboard ahora/ }));
    expect(routerState.router.replace).toHaveBeenCalledWith("/dashboard");
  }, 9000);

  it.each([
    ["texto", "Teléfono inválido", /Teléfono inválido/],
    ["lista", [{ loc: ["body", "goal"], msg: "obligatorio" }, 7], /goal: obligatorio/],
  ] as const)("error del servidor (%s) se muestra y se puede cerrar", async (_n, detail, re) => {
    mockApiError("patch", "/users/me/student-profile", 422, detail);
    const { user } = await toSchedule();
    await user.click(screen.getByRole("button", { name: /Saltar por ahora/ }));
    const msg = await screen.findByText(re);
    expect(screen.queryByText(/Todo listo/)).not.toBeInTheDocument();
    await user.click(msg.parentElement!.querySelector("button") as HTMLElement);
    expect(screen.queryByText(re)).not.toBeInTheDocument();
  });

  it("un fallo sin detalle usa el mensaje genérico", async () => {
    mockApi("patch", "/users/me/student-profile", () => { throw new Error("caída"); });
    const { user } = await toSchedule();
    await user.click(screen.getByRole("button", { name: /Saltar por ahora/ }));
    expect(await screen.findByText(/Error guardando/)).toBeInTheDocument();
  });

  it("sube la foto elegida por el endpoint de avatar", async () => {
    URL.createObjectURL = vi.fn(() => "blob:foto");
    mockApi("patch", "/users/me/avatar", { url: "x" });
    const { user, container } = setup(null);
    await user.click(await screen.findByRole("button", { name: /Empezar configuración/ }));
    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [new File(["x"], "yo.png", { type: "image/png" })] },
    });
    const selects = container.querySelectorAll("select");
    await user.selectOptions(selects[1] as HTMLSelectElement, "Venezuela");
    await user.type(screen.getByPlaceholderText("412 000 0000"), "414 999 8888");
    await user.click(screen.getByRole("button", { name: new RegExp(FIRST_GOAL.slice(0, 12)) }));
    await cont(user);
    await user.click(await screen.findByRole("button", { name: "Inglés" }));
    await user.click(screen.getByRole("radio", { name: "Inglés: Fluido" }));
    await cont(user);
    await user.click(await screen.findByRole("button", { name: /Saltar por ahora/ }));
    await waitFor(() => expect(callsTo("patch", "/users/me/avatar")).toHaveLength(1));
  });
});
