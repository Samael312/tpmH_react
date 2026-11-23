/**
 * Login · cierra huecos: destino por rol (con contraseña y con Google), perfil del profesor, caída de /users/me,
 * rol desconocido, errores que no son de red y aviso tras registrarse.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { screen, waitFor } from "@testing-library/react";
import LoginPage from "@/app/(public)/login/page";
import { useAuthStore } from "@/store/authStore";
import { renderScreen } from "./render";
import { routerState } from "./router";
import { mockApi, mockApiError } from "./fakeApi";

vi.mock("@/components/auth/GoogleSignInButton", () => ({
  default: ({ onCredential }: { onCredential: (t: string) => void }) => (
    <button type="button" onClick={() => onCredential("google-token-1")}>Google de prueba</button>
  ),
}));

afterEach(() => { sessionStorage.clear(); });

const session = (role: string) => ({ access_token: "tok", role, name: "Test", username: "u", email: "a@b.c", surname: "Uno", avatar_url: null, avatar: null });
const pushed = () => routerState.router.push.mock.calls.map((c) => c[0]);

async function loginWith(role: string, me: "ok" | "fail" | { onboarding_completed?: boolean } = "ok") {
  mockApi("post", "/auth/login", session(role));
  if (me === "fail") mockApiError("get", "/users/me", 500, "caída");
  else mockApi("get", "/users/me", { id: 3, email: "m@x.com", surname: "S", avatar: null, ...(me === "ok" ? { onboarding_completed: true } : me) });
  mockApi("get", "/users/me/student-profile", { timezone: "America/Bogota", goal: "Hablar" });
  mockApi("get", "/teachers/me/profile", { timezone: "Europe/Madrid" });
  const { container } = renderScreen(<LoginPage />, { role: "anon" });
  const user = userEvent.setup();
  await user.type(screen.getByPlaceholderText("Tu usuario"), "u");
  await user.type(screen.getByPlaceholderText("••••••••"), "Secreta123");
  await user.click(container.querySelector('button[type="submit"]') as HTMLButtonElement);
}
async function googleWith(role: string, me: "ok" | "fail" | { onboarding_completed?: boolean } = "ok") {
  mockApi("post", "/auth/google", session(role));
  if (me === "fail") mockApiError("get", "/users/me", 500, "caída");
  else mockApi("get", "/users/me", { id: 3, email: "m@x.com", surname: "S", avatar: null, ...(me === "ok" ? { onboarding_completed: true } : me) });
  mockApi("get", "/users/me/student-profile", { timezone: "America/Bogota", goal: "Hablar" });
  mockApi("get", "/teachers/me/profile", { timezone: "Europe/Madrid" });
  renderScreen(<LoginPage />, { role: "anon" });
  await userEvent.setup().click(screen.getByRole("button", { name: "Google de prueba" }));
}

describe("Login con contraseña · destino por rol", () => {
  it.each([
    ["superadmin", "/admin/dashboard"], ["teacher", "/teacher/dashboard"], ["teacher_admin", "/teacher/dashboard"],
    ["student", "/dashboard"], ["rol_raro", "/dashboard"],
  ])("%s entra en %s", async (role, dest) => {
    await loginWith(role);
    await waitFor(() => expect(pushed()).toContain(dest));
  });

  it("el profesor guarda la zona horaria de su perfil", async () => {
    await loginWith("teacher");
    await waitFor(() => expect(useAuthStore.getState().user?.timezone).toBe("Europe/Madrid"));
  });

  it("un alumno sin onboarding va al onboarding", async () => {
    await loginWith("student", { onboarding_completed: false });
    await waitFor(() => expect(pushed()).toContain("/dashboard/onboarding"));
  });

  it.each([
    ["superadmin", "/admin/dashboard"], ["teacher", "/teacher/dashboard"], ["student", "/dashboard"],
  ])("si /users/me falla, %s entra igualmente en %s", async (role, dest) => {
    await loginWith(role, "fail");
    await waitFor(() => expect(pushed()).toContain(dest));
  });

  it("un fallo que no es de red muestra el mensaje genérico de credenciales", async () => {
    mockApi("post", "/auth/login", () => { throw new Error("raro"); });
    const { container } = renderScreen(<LoginPage />, { role: "anon" });
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText("Tu usuario"), "u");
    await user.type(screen.getByPlaceholderText("••••••••"), "Secreta123");
    await user.click(container.querySelector('button[type="submit"]') as HTMLButtonElement);
    expect(await screen.findByText("Usuario o contraseña incorrectos")).toBeInTheDocument();
  });

  it("al volver del registro avisa de que la cuenta está creada, una sola vez", async () => {
    sessionStorage.setItem("tpm_just_registered", "1");
    renderScreen(<LoginPage />, { role: "anon" });
    expect(await screen.findByText(/Cuenta creada correctamente/)).toBeInTheDocument();
    expect(sessionStorage.getItem("tpm_just_registered")).toBeNull();
  });
});

describe("Login con Google · destino por rol", () => {
  it.each([
    ["superadmin", "/admin/dashboard"], ["teacher", "/teacher/dashboard"], ["teacher_admin", "/teacher/dashboard"],
    ["student", "/dashboard"], ["rol_raro", "/dashboard"],
  ])("%s entra en %s", async (role, dest) => {
    await googleWith(role);
    await waitFor(() => expect(pushed()).toContain(dest));
  });

  it("un alumno de Google sin onboarding va al onboarding", async () => {
    await googleWith("student", { onboarding_completed: false });
    await waitFor(() => expect(pushed()).toContain("/dashboard/onboarding"));
  });

  it.each([
    ["superadmin", "/admin/dashboard"], ["teacher", "/teacher/dashboard"], ["student", "/dashboard"],
  ])("si /users/me falla, %s de Google entra igualmente en %s", async (role, dest) => {
    await googleWith(role, "fail");
    await waitFor(() => expect(pushed()).toContain(dest));
  });
});
