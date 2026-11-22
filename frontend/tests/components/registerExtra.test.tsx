/**
 * Registro · casos que completan register.test: registro/entrada con Google desde esta pantalla, volver del paso 2
 * y validación de datos inválidos con usuario correcto.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { screen, waitFor } from "@testing-library/react";
import RegisterPage from "@/app/(public)/register/page";
import { renderScreen } from "./render";
import { routerState } from "./router";
import { mockApi, mockApiError, callsTo, FIXTURE } from "./fakeApi";

// A diferencia de register.test, aquí el botón de Google SÍ entrega su credencial (o su error) a la pantalla.
vi.mock("@/components/auth/GoogleSignInButton", () => ({
  default: ({ onCredential, onError }: { onCredential: (t: string) => Promise<void>; onError: (m: string) => void }) => (
    <>
      <button type="button" onClick={() => onCredential("google-token-9")}>Google de prueba</button>
      <button type="button" onClick={() => onError("Google no disponible")}>Fallo de Google</button>
    </>
  ),
}));

function setup() {
  mockApi("get", "/admin/platform-config", { ...FIXTURE.platformConfig, is_single_tenant: false });
  const view = renderScreen(<RegisterPage />, { role: "anon" });
  return { ...view, user: userEvent.setup() };
}
const submit = (c: HTMLElement) => c.querySelector('button[type="submit"]') as HTMLButtonElement;
afterEach(() => { vi.restoreAllMocks(); sessionStorage.clear(); });

describe("Registro · Google", () => {
  it("cuenta nueva: guarda token y datos y lleva a completar el registro", async () => {
    mockApi("post", "/auth/google", { needs_registration: true, name: "Ana", surname: "L", email: "a@b.c", avatar: "u.png" });
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: "Google de prueba" }));
    await waitFor(() => expect(routerState.router.push).toHaveBeenCalledWith("/register/google-complete"));
    expect(callsTo("post", "/auth/google")[0].body).toEqual({ id_token: "google-token-9" });
    expect(sessionStorage.getItem("google_id_token")).toBe("google-token-9");
    expect(JSON.parse(sessionStorage.getItem("google_prefill")!)).toMatchObject({ name: "Ana", email: "a@b.c" });
  });

  it.each([["student", "/dashboard"], ["teacher", "/teacher/dashboard"]])("cuenta existente (%s): inicia sesión y redirige a %s", async (role, dest) => {
    mockApi("post", "/auth/google", { access_token: "tok", role, name: "Ana", username: "ana", email: "a@b.c", surname: "L" });
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: "Google de prueba" }));
    await waitFor(() => expect(routerState.router.push).toHaveBeenCalledWith(dest));
  });

  it("un error del servidor se muestra", async () => {
    mockApiError("post", "/auth/google", 401, "Token de Google inválido");
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: "Google de prueba" }));
    expect(await screen.findByText("Token de Google inválido")).toBeInTheDocument();
  });

  it("un error del propio botón de Google se muestra", async () => {
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: "Fallo de Google" }));
    expect(await screen.findByText("Google no disponible")).toBeInTheDocument();
  });
});

describe("Registro · validaciones y paso atrás", () => {
  it("con usuario correcto pero un nombre con números avisa de completar los campos", async () => {
    const { user, container } = setup();
    await user.type(await screen.findByPlaceholderText("Maria"), "Mar1a");
    await user.type(screen.getByPlaceholderText("Farias"), "Farias");
    await user.type(screen.getByPlaceholderText("tu_usuario"), "maria_f");
    await user.type(screen.getByPlaceholderText("correo@ejemplo.com"), "maria@example.com");
    await user.click(submit(container));
    expect(await screen.findByText(/completa todos los campos correctamente/)).toBeInTheDocument();
  });

  it("el botón Atrás del paso 2 vuelve a los datos conservándolos", async () => {
    const { user, container } = setup();
    await user.type(await screen.findByPlaceholderText("Maria"), "Maria");
    await user.type(screen.getByPlaceholderText("Farias"), "Farias");
    await user.type(screen.getByPlaceholderText("tu_usuario"), "maria_f");
    await user.type(screen.getByPlaceholderText("correo@ejemplo.com"), "maria@example.com");
    await user.click(submit(container));
    await screen.findByPlaceholderText("Mínimo 8 caracteres");
    await user.click(screen.getByRole("button", { name: /Atrás|Volver/ }));
    expect(await screen.findByPlaceholderText("tu_usuario")).toHaveValue("maria_f");
  });

  it("el ojo de la confirmación alterna sola esa casilla", async () => {
    const { user, container } = setup();
    await user.type(await screen.findByPlaceholderText("Maria"), "Maria");
    await user.type(screen.getByPlaceholderText("Farias"), "Farias");
    await user.type(screen.getByPlaceholderText("tu_usuario"), "maria_f");
    await user.type(screen.getByPlaceholderText("correo@ejemplo.com"), "maria@example.com");
    await user.click(submit(container));
    await screen.findByPlaceholderText("Mínimo 8 caracteres");
    await user.click(screen.getByRole("button", { name: "Mostrar confirmación de contraseña" }));
    expect(screen.getByPlaceholderText("Repetir contraseña")).toHaveAttribute("type", "text");
    expect(screen.getByPlaceholderText("Mínimo 8 caracteres")).toHaveAttribute("type", "password");
  });
});
