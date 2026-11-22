/**
 * Pantallas de acceso: login, recuperar acceso, restablecer contraseña y verificar correo.
 * Se prueban los flujos (redirección por rol, errores, enlaces caducados), no solo que se pinten.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { screen, waitFor } from "@testing-library/react";
import LoginPage from "@/app/(public)/login/page";
import ForgotPasswordPage from "@/app/(auth)/forgot-password/page";
import ResetPasswordPage from "@/app/(auth)/reset-password/page";
import VerifyEmailPage from "@/app/(auth)/verify-email/page";
import { useAuthStore } from "@/store/authStore";
import { renderScreen } from "./render";
import { routerState } from "./router";
import { mockApi, mockApiError, callsTo } from "./fakeApi";

// El botón real de Google necesita el SDK externo; aquí se sustituye por uno que entrega una credencial de prueba.
vi.mock("@/components/auth/GoogleSignInButton", () => ({
  default: ({ onCredential }: { onCredential: (t: string) => void }) => (
    <button type="button" onClick={() => onCredential("google-token-1")}>Google de prueba</button>
  ),
}));

afterEach(() => { vi.useRealTimers(); });

const submit = (container: HTMLElement) => container.querySelector('button[type="submit"]') as HTMLButtonElement;

describe("Login", () => {
  const loginResponse = (role: string, over: Record<string, unknown> = {}) => ({
    access_token: "tok", role, name: "Test", username: "alumno", email: "a@b.c", surname: "Uno", avatar_url: null, ...over,
  });

  async function fillAndSend(user: ReturnType<typeof userEvent.setup>, container: HTMLElement, login = "alumno", pw = "Secreta123") {
    await user.type(screen.getByPlaceholderText("Tu usuario"), login);
    await user.type(screen.getByPlaceholderText("••••••••"), pw);
    await user.click(submit(container));
  }

  it("con campos vacíos el botón está desactivado y no se llama al servidor", async () => {
    const { container } = renderScreen(<LoginPage />, { role: "anon" });
    expect(submit(container)).toBeDisabled();
    await userEvent.setup().click(submit(container));
    expect(callsTo("post", "/auth/login")).toHaveLength(0);
  });

  it("una contraseña de solo espacios habilita el botón pero se rechaza con aviso, sin llamar al servidor", async () => {
    const { container } = renderScreen(<LoginPage />, { role: "anon" });
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText("Tu usuario"), "alumno");
    await user.type(screen.getByPlaceholderText("••••••••"), "   ");
    await user.click(submit(container));
    expect(await screen.findByText(/Por favor, completa todos los campos/)).toBeInTheDocument();
    expect(callsTo("post", "/auth/login")).toHaveLength(0);
  });

  it("el usuario se normaliza: minúsculas y sin espacios", async () => {
    mockApi("post", "/auth/login", loginResponse("student"));
    mockApi("get", "/users/me", { onboarding_completed: true });
    const { container } = renderScreen(<LoginPage />, { role: "anon" });
    await fillAndSend(userEvent.setup(), container, "  Ana López ");
    await waitFor(() => expect(callsTo("post", "/auth/login")).toHaveLength(1));
    expect(callsTo("post", "/auth/login")[0].body).toEqual({ login: "analópez", password: "Secreta123" });
  });

  it.each([
    ["student", true, "/dashboard"],
    ["student", false, "/dashboard/onboarding"],
    ["teacher", true, "/teacher/dashboard"],
    ["teacher_admin", true, "/teacher/dashboard"],
    ["superadmin", true, "/admin/dashboard"],
  ])("rol %s (onboarding %s) va a %s", async (role, onboarding, dest) => {
    mockApi("post", "/auth/login", loginResponse(role));
    mockApi("get", "/users/me", { onboarding_completed: onboarding, email: "a@b.c", surname: "Uno" });
    const { container } = renderScreen(<LoginPage />, { role: "anon" });
    await fillAndSend(userEvent.setup(), container);
    await waitFor(() => expect(routerState.router.push).toHaveBeenCalledWith(dest));
  });

  it("guarda la sesión del usuario en el store tras entrar", async () => {
    mockApi("post", "/auth/login", loginResponse("student"));
    mockApi("get", "/users/me", { onboarding_completed: true });
    const { container } = renderScreen(<LoginPage />, { role: "anon" });
    await fillAndSend(userEvent.setup(), container);
    await waitFor(() => expect(useAuthStore.getState().user?.username).toBe("alumno"));
    expect(useAuthStore.getState().user?.role).toBe("student");
  });

  it("si /users/me falla igual entra y redirige por rol (sin romperse)", async () => {
    mockApi("post", "/auth/login", loginResponse("teacher"));
    mockApiError("get", "/users/me", 500, "x");
    const { container } = renderScreen(<LoginPage />, { role: "anon" });
    await fillAndSend(userEvent.setup(), container);
    await waitFor(() => expect(routerState.router.push).toHaveBeenCalledWith("/teacher/dashboard"));
  });

  it("credenciales incorrectas: mensaje genérico (no revela si el usuario existe)", async () => {
    mockApiError("post", "/auth/login", 401, "Usuario no encontrado");
    const { container } = renderScreen(<LoginPage />, { role: "anon" });
    await fillAndSend(userEvent.setup(), container);
    expect(await screen.findByText("Usuario o contraseña incorrectos")).toBeInTheDocument();
    expect(screen.queryByText(/Usuario no encontrado/)).not.toBeInTheDocument();
    expect(routerState.router.push).not.toHaveBeenCalled();
  });

  it("cuenta desactivada (403) muestra el motivo del servidor", async () => {
    mockApiError("post", "/auth/login", 403, "Tu cuenta está desactivada");
    const { container } = renderScreen(<LoginPage />, { role: "anon" });
    await fillAndSend(userEvent.setup(), container);
    expect(await screen.findByText(/Tu cuenta está desactivada/)).toBeInTheDocument();
  });

  it("demasiados intentos (429) lo dice", async () => {
    mockApiError("post", "/auth/login", 429, "Demasiados intentos");
    const { container } = renderScreen(<LoginPage />, { role: "anon" });
    await fillAndSend(userEvent.setup(), container);
    expect(await screen.findByText(/Demasiados intentos/)).toBeInTheDocument();
  });

  it("el ojo muestra y oculta la contraseña", async () => {
    renderScreen(<LoginPage />, { role: "anon" });
    const user = userEvent.setup();
    const pw = screen.getByPlaceholderText("••••••••");
    expect(pw).toHaveAttribute("type", "password");
    await user.click(screen.getByRole("button", { name: "Mostrar contraseña" }));
    expect(pw).toHaveAttribute("type", "text");
    await user.click(screen.getByRole("button", { name: "Ocultar contraseña" }));
    expect(pw).toHaveAttribute("type", "password");
  });

  it("tras registrarse muestra el aviso de cuenta creada una sola vez", async () => {
    sessionStorage.setItem("tpm_just_registered", "1");
    renderScreen(<LoginPage />, { role: "anon" });
    expect(await screen.findByText(/Cuenta creada correctamente/)).toBeInTheDocument();
    expect(sessionStorage.getItem("tpm_just_registered")).toBeNull();
  });

  it("enlaces a recuperar acceso y a registrarse", () => {
    renderScreen(<LoginPage />, { role: "anon" });
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(expect.arrayContaining(["/forgot-password", "/register"]));
  });

  it("Google con cuenta ya registrada: entra y redirige por rol", async () => {
    mockApi("post", "/auth/google", { access_token: "tok", role: "student", name: "Ana", username: "ana", email: "a@b.c", surname: "L", avatar: null });
    mockApi("get", "/users/me", { onboarding_completed: true });
    renderScreen(<LoginPage />, { role: "anon" });
    await userEvent.setup().click(screen.getByRole("button", { name: "Google de prueba" }));
    await waitFor(() => expect(callsTo("post", "/auth/google")[0]?.body).toEqual({ id_token: "google-token-1" }));
    await waitFor(() => expect(routerState.router.push).toHaveBeenCalledWith("/dashboard"));
  });

  it("Google con cuenta nueva: guarda el token y los datos y lleva a completar el registro", async () => {
    mockApi("post", "/auth/google", { needs_registration: true, name: "Ana", surname: "L", email: "a@b.c", avatar: "u.png" });
    renderScreen(<LoginPage />, { role: "anon" });
    await userEvent.setup().click(screen.getByRole("button", { name: "Google de prueba" }));
    await waitFor(() => expect(routerState.router.push).toHaveBeenCalledWith("/register/google-complete"));
    expect(sessionStorage.getItem("google_id_token")).toBe("google-token-1");
    expect(JSON.parse(sessionStorage.getItem("google_prefill")!)).toMatchObject({ name: "Ana", email: "a@b.c" });
  });

  it("Google con error del servidor lo muestra", async () => {
    mockApiError("post", "/auth/google", 401, "Token de Google no válido");
    renderScreen(<LoginPage />, { role: "anon" });
    await userEvent.setup().click(screen.getByRole("button", { name: "Google de prueba" }));
    expect(await screen.findByText(/Token de Google no válido/)).toBeInTheDocument();
  });
});

describe("Recuperar acceso", () => {
  it("el botón está desactivado sin correo", () => {
    const { container } = renderScreen(<ForgotPasswordPage />, { role: "anon" });
    expect(submit(container)).toBeDisabled();
  });

  it("contraseña: pide el enlace al endpoint correcto y confirma sin revelar si el correo existe", async () => {
    const { container } = renderScreen(<ForgotPasswordPage />, { role: "anon" });
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText("tu@email.com"), "ana@example.com");
    await user.click(submit(container));
    await waitFor(() => expect(callsTo("post", "/auth/forgot-password")).toHaveLength(1));
    expect(callsTo("post", "/auth/forgot-password")[0].body).toEqual({ email: "ana@example.com" });
    expect(await screen.findByText("¡Revisa tu correo!")).toBeInTheDocument();
    expect(screen.getByText(/Si existe una cuenta con ese email/)).toBeInTheDocument();
  });

  it("«Olvidé mi usuario» usa su propio endpoint", async () => {
    const { container } = renderScreen(<ForgotPasswordPage />, { role: "anon" });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Olvidé mi usuario" }));
    await user.type(screen.getByPlaceholderText("tu@email.com"), "ana@example.com");
    await user.click(submit(container));
    await waitFor(() => expect(callsTo("post", "/auth/forgot-username")).toHaveLength(1));
    expect(callsTo("post", "/auth/forgot-password")).toHaveLength(0);
  });

  it("un 404 (correo inexistente) también confirma, para no permitir averiguar qué correos existen", async () => {
    mockApiError("post", "/auth/forgot-password", 404, "No existe");
    const { container } = renderScreen(<ForgotPasswordPage />, { role: "anon" });
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText("tu@email.com"), "nadie@example.com");
    await user.click(submit(container));
    expect(await screen.findByText("¡Revisa tu correo!")).toBeInTheDocument();
  });

  it("un fallo del servidor (5xx) sí avisa de que no se pudo procesar", async () => {
    mockApiError("post", "/auth/forgot-password", 500, "x");
    const { container } = renderScreen(<ForgotPasswordPage />, { role: "anon" });
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText("tu@email.com"), "ana@example.com");
    await user.click(submit(container));
    expect(await screen.findByText(/No pudimos procesar tu solicitud/)).toBeInTheDocument();
    expect(screen.queryByText("¡Revisa tu correo!")).not.toBeInTheDocument();
  });

  it("cambiar de pestaña limpia el resultado anterior", async () => {
    const { container } = renderScreen(<ForgotPasswordPage />, { role: "anon" });
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText("tu@email.com"), "ana@example.com");
    await user.click(submit(container));
    await screen.findByText("¡Revisa tu correo!");
    await user.click(screen.getByRole("button", { name: "Olvidé mi usuario" }));
    expect(screen.queryByText("¡Revisa tu correo!")).not.toBeInTheDocument();
  });
});

describe("Restablecer contraseña", () => {
  const pw = () => screen.getByPlaceholderText("Mínimo 8 caracteres");
  const confirm = () => screen.getByPlaceholderText("Repite la nueva contraseña");

  it("sin token en el enlace dice que es inválido y ofrece pedir otro", async () => {
    renderScreen(<ResetPasswordPage />, { role: "anon", route: "/reset-password" });
    expect(await screen.findByText("Enlace inválido")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Solicitar nuevo enlace/ })).toHaveAttribute("href", "/forgot-password");
  });

  it("valida longitud mínima y coincidencia antes de permitir enviar", async () => {
    const { container } = renderScreen(<ResetPasswordPage />, { role: "anon", route: "/reset-password", search: "token=abc" });
    const user = userEvent.setup();
    await user.type(await screen.findByPlaceholderText("Mínimo 8 caracteres"), "corta");
    expect(screen.getByText("Mínimo 8 caracteres", { selector: "p" })).toBeInTheDocument();
    await user.type(confirm(), "otra");
    expect(screen.getByText(/Las contraseñas no coinciden/)).toBeInTheDocument();
    expect(submit(container)).toBeDisabled();
    await user.clear(pw()); await user.clear(confirm());
    await user.type(pw(), "LargaYSegura1"); await user.type(confirm(), "LargaYSegura1");
    expect(screen.getByText(/Las contraseñas coinciden/)).toBeInTheDocument();
    expect(submit(container)).toBeEnabled();
  });

  it("envía el token y la nueva contraseña, confirma y vuelve al login tras unos segundos", async () => {
    const { container } = renderScreen(<ResetPasswordPage />, { role: "anon", route: "/reset-password", search: "token=abc123" });
    const user = userEvent.setup();
    await user.type(await screen.findByPlaceholderText("Mínimo 8 caracteres"), "LargaYSegura1");
    await user.type(confirm(), "LargaYSegura1");
    await user.click(submit(container));
    await waitFor(() => expect(callsTo("post", "/auth/reset-password")).toHaveLength(1));
    expect(callsTo("post", "/auth/reset-password")[0].body).toEqual({ token: "abc123", new_password: "LargaYSegura1" });
    expect(await screen.findByText("¡Contraseña actualizada!")).toBeInTheDocument();
    await waitFor(() => expect(routerState.router.push).toHaveBeenCalledWith("/login"), { timeout: 4000 });
  });

  it("enlace caducado o usado: mensaje claro en vez del texto técnico del servidor", async () => {
    mockApiError("post", "/auth/reset-password", 400, "Token expirado");
    const { container } = renderScreen(<ResetPasswordPage />, { role: "anon", route: "/reset-password", search: "token=viejo" });
    const user = userEvent.setup();
    await user.type(await screen.findByPlaceholderText("Mínimo 8 caracteres"), "LargaYSegura1");
    await user.type(confirm(), "LargaYSegura1");
    await user.click(submit(container));
    expect(await screen.findByText(/El enlace ha expirado o ya fue usado/)).toBeInTheDocument();
  });

  it("otros errores del servidor se muestran tal cual", async () => {
    mockApiError("post", "/auth/reset-password", 422, "La contraseña es demasiado común");
    const { container } = renderScreen(<ResetPasswordPage />, { role: "anon", route: "/reset-password", search: "token=abc" });
    const user = userEvent.setup();
    await user.type(await screen.findByPlaceholderText("Mínimo 8 caracteres"), "12345678");
    await user.type(confirm(), "12345678");
    await user.click(submit(container));
    expect(await screen.findByText(/demasiado común/)).toBeInTheDocument();
  });

  it("los dos ojos funcionan por separado", async () => {
    renderScreen(<ResetPasswordPage />, { role: "anon", route: "/reset-password", search: "token=abc" });
    const user = userEvent.setup();
    await screen.findByPlaceholderText("Mínimo 8 caracteres");
    await user.click(screen.getByRole("button", { name: "Mostrar contraseña" }));
    expect(pw()).toHaveAttribute("type", "text");
    expect(confirm()).toHaveAttribute("type", "password");
    await user.click(screen.getByRole("button", { name: "Mostrar confirmación de contraseña" }));
    expect(confirm()).toHaveAttribute("type", "text");
  });
});

describe("Verificar correo", () => {
  it("sin token dice que el enlace no es válido y no llama al servidor", async () => {
    renderScreen(<VerifyEmailPage />, { role: "anon", route: "/verify-email" });
    expect(await screen.findByText("No pudimos verificar tu email")).toBeInTheDocument();
    expect(screen.getByText(/Este enlace no es válido/)).toBeInTheDocument();
    expect(callsTo("post", "/auth/verify-email")).toHaveLength(0);
  });

  it("con token lo verifica UNA sola vez (es de un solo uso) y confirma", async () => {
    renderScreen(<VerifyEmailPage />, { role: "anon", route: "/verify-email", search: "token=xyz" });
    expect(await screen.findByText("¡Email verificado!")).toBeInTheDocument();
    expect(callsTo("post", "/auth/verify-email")).toHaveLength(1);
    expect(callsTo("post", "/auth/verify-email")[0].body).toEqual({ token: "xyz" });
  });

  it("token caducado o usado muestra el motivo del servidor y cómo pedir otro", async () => {
    mockApiError("post", "/auth/verify-email", 400, "El enlace expiró");
    renderScreen(<VerifyEmailPage />, { role: "anon", route: "/verify-email", search: "token=viejo" });
    expect(await screen.findByText("No pudimos verificar tu email")).toBeInTheDocument();
    expect(screen.getByText(/El enlace expiró/)).toBeInTheDocument();
    expect(screen.getByText(/pide un nuevo enlace/)).toBeInTheDocument();
  });
});

