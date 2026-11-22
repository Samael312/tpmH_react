/**
 * Registro en dos pasos (datos → contraseña y términos), con rol elegible solo en modo multi-profesor.
 */
import { describe, expect, it, vi } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { screen, waitFor } from "@testing-library/react";
import RegisterPage from "@/app/(public)/register/page";
import { renderScreen } from "./render";
import { routerState } from "./router";
import { mockApi, mockApiError, callsTo, FIXTURE } from "./fakeApi";

vi.mock("@/components/auth/GoogleSignInButton", () => ({
  default: () => <button type="button">Google de prueba</button>,
}));

const submit = (c: HTMLElement) => c.querySelector('button[type="submit"]') as HTMLButtonElement;

function setup(singleTenant = false) {
  mockApi("get", "/admin/platform-config", { ...FIXTURE.platformConfig, is_single_tenant: singleTenant });
  const view = renderScreen(<RegisterPage />, { role: "anon" });
  return { ...view, user: userEvent.setup() };
}

async function fillStep1(user: ReturnType<typeof userEvent.setup>, over: Partial<Record<"name" | "surname" | "username" | "email", string>> = {}) {
  const v = { name: "Maria", surname: "Farias", username: "maria_f", email: "maria@example.com", ...over };
  await user.type(await screen.findByPlaceholderText("Maria"), v.name);
  await user.type(screen.getByPlaceholderText("Farias"), v.surname);
  await user.type(screen.getByPlaceholderText("tu_usuario"), v.username);
  await user.type(screen.getByPlaceholderText("correo@ejemplo.com"), v.email);
}

async function goStep2(user: ReturnType<typeof userEvent.setup>, container: HTMLElement) {
  await fillStep1(user);
  await user.click(submit(container));
  await screen.findByPlaceholderText("Mínimo 8 caracteres");
}

describe("Registro · paso 1 (datos)", () => {
  it("multi-profesor: se puede elegir entre Estudiante y Profesor", async () => {
    setup(false);
    expect(await screen.findByRole("button", { name: /Estudiante/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Profesor/ })).toBeInTheDocument();
  });

  it("un solo profesor: no hay selector de rol (siempre alumno)", async () => {
    setup(true);
    await screen.findByPlaceholderText("Maria");
    expect(screen.queryByRole("button", { name: /^Profesor$/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Soy...")).not.toBeInTheDocument();
  });

  it("nombre con números o símbolos se rechaza al salir del campo", async () => {
    const { user } = setup();
    const name = await screen.findByPlaceholderText("Maria");
    await user.type(name, "Mar1a");
    await user.tab();
    expect(await screen.findByText(/Solo letras, espacios, guiones y apóstrofes/)).toBeInTheDocument();
  });

  it("acepta nombres con tildes, apóstrofes y guiones", async () => {
    const { user, container } = setup();
    await fillStep1(user, { name: "María José", surname: "O'Brien-Pérez" });
    await user.click(submit(container));
    expect(await screen.findByPlaceholderText("Mínimo 8 caracteres")).toBeInTheDocument();
  });

  it("usuario fuera de formato (mayúsculas, espacios, muy corto) no avanza", async () => {
    const { user, container } = setup();
    await fillStep1(user, { username: "Ma" });
    await user.click(submit(container));
    expect(await screen.findAllByText(/De 3 a 30 caracteres/)).not.toHaveLength(0);
    expect(screen.queryByPlaceholderText("Mínimo 8 caracteres")).not.toBeInTheDocument();
  });

  it("correo sin @ no avanza", async () => {
    const { user, container } = setup();
    await fillStep1(user, { email: "sin-arroba" });
    await user.click(submit(container));
    expect(await screen.findByText(/Escribe un email válido|completa todos los campos/)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Mínimo 8 caracteres")).not.toBeInTheDocument();
  });

  it("campos vacíos: avisa y no avanza", async () => {
    const { user, container } = setup();
    await screen.findByPlaceholderText("Maria");
    await user.click(submit(container));
    expect(await screen.findAllByRole("alert")).not.toHaveLength(0);
    expect(screen.queryByPlaceholderText("Mínimo 8 caracteres")).not.toBeInTheDocument();
  });
});

describe("Registro · paso 2 (contraseña y términos)", () => {
  const terms = () => screen.getByRole("checkbox");

  it("contraseña corta se rechaza", async () => {
    const { user, container } = setup();
    await goStep2(user, container);
    await user.type(screen.getByPlaceholderText("Mínimo 8 caracteres"), "corta");
    await user.type(screen.getByPlaceholderText("Repetir contraseña"), "corta");
    await user.click(terms());
    await user.click(submit(container));
    expect(await screen.findAllByText(/al menos 8 caracteres|Mínimo 8 caracteres/)).not.toHaveLength(0);
    expect(callsTo("post", "/auth/register")).toHaveLength(0);
  });

  it("contraseñas distintas se rechazan", async () => {
    const { user, container } = setup();
    await goStep2(user, container);
    await user.type(screen.getByPlaceholderText("Mínimo 8 caracteres"), "LargaYSegura1");
    await user.type(screen.getByPlaceholderText("Repetir contraseña"), "OtraDistinta1");
    await user.click(terms());
    await user.click(submit(container));
    expect(await screen.findAllByText(/Las contraseñas no coinciden/)).not.toHaveLength(0);
    expect(callsTo("post", "/auth/register")).toHaveLength(0);
  });

  it("sin aceptar los términos «Crear cuenta» está desactivado y no se registra; al aceptarlos se habilita", async () => {
    const { user, container } = setup();
    await goStep2(user, container);
    await user.type(screen.getByPlaceholderText("Mínimo 8 caracteres"), "LargaYSegura1");
    await user.type(screen.getByPlaceholderText("Repetir contraseña"), "LargaYSegura1");
    expect(submit(container)).toBeDisabled();
    await user.click(submit(container));
    expect(callsTo("post", "/auth/register")).toHaveLength(0);
    await user.click(terms());
    expect(submit(container)).toBeEnabled();
  });

  it("registro correcto: envía los datos con el rol elegido, confirma y lleva al login recordando que se acaba de registrar", async () => {
    const { user, container } = setup();
    await user.click(await screen.findByRole("button", { name: /Profesor/ }));
    await goStep2(user, container);
    await user.type(screen.getByPlaceholderText("Mínimo 8 caracteres"), "LargaYSegura1");
    await user.type(screen.getByPlaceholderText("Repetir contraseña"), "LargaYSegura1");
    await user.click(terms());
    await user.click(submit(container));
    await waitFor(() => expect(callsTo("post", "/auth/register")).toHaveLength(1));
    expect(callsTo("post", "/auth/register")[0].body).toEqual({
      name: "Maria", surname: "Farias", username: "maria_f", email: "maria@example.com", password: "LargaYSegura1", role: "teacher",
    });
    expect(sessionStorage.getItem("tpm_just_registered")).toBe("1");
    await waitFor(() => expect(routerState.router.push).toHaveBeenCalledWith("/login"), { timeout: 4000 });
  });

  it("en modo un-solo-profesor el rol enviado es siempre student", async () => {
    const { user, container } = setup(true);
    await goStep2(user, container);
    await user.type(screen.getByPlaceholderText("Mínimo 8 caracteres"), "LargaYSegura1");
    await user.type(screen.getByPlaceholderText("Repetir contraseña"), "LargaYSegura1");
    await user.click(terms());
    await user.click(submit(container));
    await waitFor(() => expect(callsTo("post", "/auth/register")).toHaveLength(1));
    expect(callsTo("post", "/auth/register")[0].body).toMatchObject({ role: "student" });
  });

  it("si el correo o usuario ya existen vuelve al paso 1 con el motivo", async () => {
    mockApiError("post", "/auth/register", 400, "El email ya está registrado");
    const { user, container } = setup();
    await goStep2(user, container);
    await user.type(screen.getByPlaceholderText("Mínimo 8 caracteres"), "LargaYSegura1");
    await user.type(screen.getByPlaceholderText("Repetir contraseña"), "LargaYSegura1");
    await user.click(terms());
    await user.click(submit(container));
    expect(await screen.findByText(/El email ya está registrado/)).toBeInTheDocument();
    expect(await screen.findByPlaceholderText("correo@ejemplo.com")).toBeInTheDocument(); // de vuelta en el paso 1
  });

  it("otro error del servidor se muestra y se queda en el paso 2", async () => {
    mockApiError("post", "/auth/register", 500, "Error interno");
    const { user, container } = setup();
    await goStep2(user, container);
    await user.type(screen.getByPlaceholderText("Mínimo 8 caracteres"), "LargaYSegura1");
    await user.type(screen.getByPlaceholderText("Repetir contraseña"), "LargaYSegura1");
    await user.click(terms());
    await user.click(submit(container));
    expect(await screen.findByText(/Error interno|Error creando la cuenta/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Mínimo 8 caracteres")).toBeInTheDocument();
  });

  it("pulsar dos veces seguidas no duplica la cuenta", async () => {
    let resolve!: () => void;
    mockApi("post", "/auth/register", () => new Promise((r) => { resolve = () => r({}); }));
    const { user, container } = setup();
    await goStep2(user, container);
    await user.type(screen.getByPlaceholderText("Mínimo 8 caracteres"), "LargaYSegura1");
    await user.type(screen.getByPlaceholderText("Repetir contraseña"), "LargaYSegura1");
    await user.click(terms());
    await user.click(submit(container));
    await user.click(submit(container));
    await waitFor(() => expect(callsTo("post", "/auth/register").length).toBeGreaterThan(0));
    expect(callsTo("post", "/auth/register")).toHaveLength(1);
    resolve();
  });

  it("los ojos de contraseña funcionan por separado", async () => {
    const { user, container } = setup();
    await goStep2(user, container);
    await user.click(screen.getByRole("button", { name: "Mostrar contraseña" }));
    expect(screen.getByPlaceholderText("Mínimo 8 caracteres")).toHaveAttribute("type", "text");
    expect(screen.getByPlaceholderText("Repetir contraseña")).toHaveAttribute("type", "password");
  });
});
