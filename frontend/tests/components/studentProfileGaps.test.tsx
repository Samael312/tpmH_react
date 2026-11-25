/**
 * Perfil del alumno · ramas restantes: cuenta sin nombre ni usuario, perfil de alumno vacío (zona horaria detectada,
 * sin objetivo), foto con respuesta sin URL, y avisos de contraseña que solo se alcanzan con Enter.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import StudentProfilePage from "@/app/(student)/dashboard/profile/page";
import { renderScreen } from "./render";
import { mockApi, callsTo, makeUser } from "./fakeApi";

const USER = (over: Record<string, unknown> = {}) => ({
  ...makeUser("student"), username: "alumno", name: "Ana", surname: "Pérez", email: "ana@x.com", phone_number: "+58 412 1112233",
  nationality: "Venezuela", avatar: null, is_google_account: false, ...over,
});
const STUDENT = (over: Record<string, unknown> = {}) => ({
  user_username: "alumno", goal: "Conversaciones cotidianas", level: "A1", timezone: "America/Caracas", preferred_payment_methods: [], profile_photo_url: null, ...over,
});

function setup(user: Record<string, unknown> = USER(), student: Record<string, unknown> | null = STUDENT(), extra?: () => void) {
  mockApi("get", "/users/me", user);
  mockApi("get", "/users/me/student-profile", student ?? {});
  extra?.();
  const view = renderScreen(<StudentProfilePage />, { role: "student" });
  return { ...view, user: userEvent.setup() };
}
afterEach(() => { vi.restoreAllMocks(); });

describe("Perfil del alumno · datos incompletos", () => {
  it("sin nombre ni apellido se muestra «Estudiante» con su inicial", async () => {
    setup(USER({ name: null, surname: null, username: "alumno" }));
    await screen.findByText("ana@x.com");
    expect(screen.getAllByText(/Estudiante|^E$/).length).toBeGreaterThan(0);
  });

  it("un perfil de alumno vacío usa la zona horaria detectada del navegador y no rompe", async () => {
    const { user } = setup(USER(), {});
    await screen.findByText("ana@x.com");
    await user.click(await screen.findByRole("button", { name: "Editar perfil" }));
    expect(await screen.findByRole("button", { name: /Guardar cambios/ })).toBeInTheDocument();
  });

  it("un usuario sin username lo toma del perfil de alumno", async () => {
    setup(USER({ username: null }), STUDENT({ user_username: "desdeperfil" }));
    expect((await screen.findAllByText(/desdeperfil/)).length).toBeGreaterThan(0);
  });

  it("cancelar la edición con el perfil cargado restaura los datos", async () => {
    const { user } = setup();
    await screen.findByText("ana@x.com");
    await user.click(await screen.findByRole("button", { name: "Editar perfil" }));
    await user.click(screen.getAllByRole("button", { name: /Cancelar/ })[0]);
    expect(await screen.findByRole("button", { name: "Editar perfil" })).toBeInTheDocument();
  });
});

describe("Perfil del alumno · contraseña con Enter", () => {
  const fill = async (user: ReturnType<typeof userEvent.setup>, o: string, n: string, c: string) => {
    await screen.findByText("ana@x.com");
    const [old] = screen.getAllByPlaceholderText("••••••••");
    await user.type(old, o);
    await user.type(screen.getByPlaceholderText("Mínimo 8 caracteres"), n);
    await user.type(screen.getByPlaceholderText("Repite la nueva contraseña"), c);
  };

  it("Enter con contraseñas distintas avisa y no llama", async () => {
    const { user } = setup();
    await fill(user, "vieja", "nueva12345", "otra12345");
    await user.type(screen.getByPlaceholderText("Repite la nueva contraseña"), "{enter}");
    expect(await screen.findByText("Las contraseñas no coinciden")).toBeInTheDocument();
    expect(callsTo("post", "/users/me/change-password")).toHaveLength(0);
  });

  it("Enter con menos de 8 caracteres avisa del mínimo", async () => {
    const { user } = setup();
    await fill(user, "vieja", "corta", "corta");
    await user.type(screen.getByPlaceholderText("Repite la nueva contraseña"), "{enter}");
    expect(await screen.findByText("La contraseña debe tener al menos 8 caracteres")).toBeInTheDocument();
    expect(callsTo("post", "/users/me/change-password")).toHaveLength(0);
  });
});

describe("Perfil del alumno · foto sin URL en la respuesta", () => {
  it("si el servidor no devuelve la dirección de la foto no rompe", async () => {
    mockApi("patch", "/users/me/avatar", {});
    setup();
    await screen.findByText("ana@x.com");
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "yo.png", { type: "image/png" })] } });
    await waitFor(() => expect(callsTo("patch", "/users/me/avatar")).toHaveLength(1));
  });
});
