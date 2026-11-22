/**
 * Completar el registro con Google: sin sesión de Google se vuelve a /register; con ella se elige rol (solo en
 * multi-profesor) y usuario, y se crea la cuenta y se redirige según el rol y el onboarding.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { screen, waitFor } from "@testing-library/react";
import GoogleCompletePage from "@/app/(public)/register/google-complete/page";
import { renderScreen } from "./render";
import { routerState } from "./router";
import { mockApi, mockApiError, callsTo, FIXTURE } from "./fakeApi";

const REG = { access_token: "tok", role: "student", name: "Ana", username: "ana_g", email: "ana@x.com", surname: "Gómez" };

function setup(o: { token?: string | null; prefill?: unknown; single?: boolean; reg?: unknown; me?: unknown | "fail" } = {}) {
  sessionStorage.clear();
  if (o.token !== null) sessionStorage.setItem("google_id_token", o.token ?? "gid-1");
  if (o.prefill !== undefined) sessionStorage.setItem("google_prefill", typeof o.prefill === "string" ? o.prefill : JSON.stringify(o.prefill));
  mockApi("get", "/admin/platform-config", { ...FIXTURE.platformConfig, is_single_tenant: !!o.single });
  mockApi("post", "/auth/google/register", o.reg ?? REG);
  if (o.me === "fail") mockApiError("get", "/users/me", 500, "x");
  else mockApi("get", "/users/me", o.me ?? { email: "ana@x.com", surname: "Gómez", onboarding_completed: false });
  const view = renderScreen(<GoogleCompletePage />, { role: "anon" });
  return { ...view, user: userEvent.setup() };
}
const USER = "tu_usuario";

beforeEach(() => { sessionStorage.clear(); });
afterEach(() => { sessionStorage.clear(); vi.restoreAllMocks(); });

describe("Google · completar registro", () => {
  it("sin token de Google vuelve a /register", async () => {
    setup({ token: null });
    await waitFor(() => expect(routerState.router.replace).toHaveBeenCalledWith("/register"));
  });

  it("saluda con los datos de Google y muestra el correo", async () => {
    setup({ prefill: { name: "Ana", email: "ana@x.com" } });
    expect(await screen.findByText("¡Hola, Ana!")).toBeInTheDocument();
    expect(screen.getByText("ana@x.com")).toBeInTheDocument();
  });

  it("sin datos previos o con datos corruptos usa el saludo genérico", async () => {
    setup({ prefill: "{no-json" });
    expect(await screen.findByText("¡Hola!")).toBeInTheDocument();
  });

  it("con avatar lo muestra y si no carga cae al icono", async () => {
    setup({ prefill: { name: "Ana", avatar: "https://img/a.png" } });
    const img = await screen.findByAltText("Ana");
    expect(img).toBeInTheDocument();
    img.dispatchEvent(new Event("error"));
    await waitFor(() => expect(screen.queryByAltText("Ana")).not.toBeInTheDocument());
  });

  it("el botón queda desactivado sin usuario y el campo limpia espacios y mayúsculas", async () => {
    const { user } = setup();
    const input = await screen.findByPlaceholderText(USER);
    expect(screen.getByRole("button", { name: /Crear cuenta/ })).toBeDisabled();
    await user.type(input, "Ana  G");
    expect(input).toHaveValue("anag");
    expect(screen.getByRole("button", { name: /Crear cuenta/ })).toBeEnabled();
  });

  it("multi-profesor: se puede elegir profesor y se envía ese rol", async () => {
    const { user } = setup({ reg: { ...REG, role: "teacher" }, me: { onboarding_completed: true } });
    await user.click(await screen.findByRole("button", { name: /Profesor/ }));
    await user.type(screen.getByPlaceholderText(USER), "profe_ana");
    await user.click(screen.getByRole("button", { name: /Crear cuenta/ }));
    await waitFor(() => expect(callsTo("post", "/auth/google/register")).toHaveLength(1));
    expect(callsTo("post", "/auth/google/register")[0].body).toEqual({ id_token: "gid-1", username: "profe_ana", role: "teacher" });
    await waitFor(() => expect(routerState.router.push).toHaveBeenCalledWith("/teacher/dashboard"));
    expect(sessionStorage.getItem("google_id_token")).toBeNull();
  });

  it("un-solo-profesor: no pregunta el rol y siempre manda student", async () => {
    const { user } = setup({ single: true });
    await screen.findByPlaceholderText(USER);
    expect(screen.queryByRole("button", { name: /Profesor/ })).not.toBeInTheDocument();
    await user.type(screen.getByPlaceholderText(USER), "ana_g");
    await user.click(screen.getByRole("button", { name: /Crear cuenta/ }));
    await waitFor(() => expect(callsTo("post", "/auth/google/register")).toHaveLength(1));
    expect(callsTo("post", "/auth/google/register")[0].body).toMatchObject({ role: "student" });
  });
});

describe("Google · redirección tras registrarse", () => {
  const submit = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.type(await screen.findByPlaceholderText(USER), "ana_g");
    await user.click(screen.getByRole("button", { name: /Crear cuenta/ }));
  };

  it("alumno sin onboarding → /dashboard/onboarding", async () => {
    const { user } = setup();
    await submit(user);
    await waitFor(() => expect(routerState.router.push).toHaveBeenCalledWith("/dashboard/onboarding"));
  });

  it("alumno con onboarding hecho → /dashboard", async () => {
    const { user } = setup({ me: { onboarding_completed: true } });
    await submit(user);
    await waitFor(() => expect(routerState.router.push).toHaveBeenCalledWith("/dashboard"));
  });

  it("profesor sin onboarding → /teacher/onboarding", async () => {
    const { user } = setup({ reg: { ...REG, role: "teacher" } });
    await submit(user);
    await waitFor(() => expect(routerState.router.push).toHaveBeenCalledWith("/teacher/onboarding"));
  });

  it("si falla leer el perfil igual entra al panel de su rol", async () => {
    const { user } = setup({ me: "fail", reg: { ...REG, role: "teacher" } });
    await submit(user);
    await waitFor(() => expect(routerState.router.push).toHaveBeenCalledWith("/teacher/dashboard"));
  });

  it("alumno con perfil ilegible entra a /dashboard", async () => {
    const { user } = setup({ me: "fail" });
    await submit(user);
    await waitFor(() => expect(routerState.router.push).toHaveBeenCalledWith("/dashboard"));
  });

  it("un error del servidor (usuario ya en uso) se muestra y no redirige", async () => {
    const { user } = setup();
    mockApiError("post", "/auth/google/register", 409, "Ese usuario ya existe");
    await submit(user);
    expect(await screen.findByText("Ese usuario ya existe")).toBeInTheDocument();
    expect(routerState.router.push).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("google_id_token")).toBe("gid-1");
  });
});
