/**
 * Perfil del alumno: datos personales, objetivo, métodos de pago, foto, contraseña y zona de peligro.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import StudentProfilePage from "@/app/(student)/dashboard/profile/page";
import { renderScreen } from "./render";
import { mockApi, mockApiError, callsTo, makeUser } from "./fakeApi";

const USER = (over: Record<string, unknown> = {}) => ({
  ...makeUser("student"), username: "alumno", name: "Ana", surname: "Pérez", email: "ana@x.com", phone_number: "+58 412 1112233",
  nationality: "Venezuela", avatar: null, is_google_account: false, ...over,
});
const STUDENT = (over: Record<string, unknown> = {}) => ({
  user_username: "alumno", goal: "Conversaciones cotidianas", level: "A1", timezone: "America/Caracas", preferred_payment_methods: [], profile_photo_url: null, ...over,
});

function setup(user = USER(), student = STUDENT(), extra?: () => void) {
  mockApi("get", "/users/me", user);
  mockApi("get", "/users/me/student-profile", student);
  extra?.();
  const view = renderScreen(<StudentProfilePage />, { role: "student" });
  return { ...view, user: userEvent.setup() };
}

afterEach(() => { vi.restoreAllMocks(); });

async function edit(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByText("ana@x.com");
  await user.click(await screen.findByRole("button", { name: "Editar perfil" }));
}

describe("Perfil del alumno · datos", () => {
  it("muestra los datos en modo lectura", async () => {
    setup();
    expect(await screen.findByText("ana@x.com")).toBeInTheDocument();
    expect(screen.getAllByText("Ana Pérez").length).toBeGreaterThan(0);
  });

  it("si falla la carga lo dice y permite reintentar", async () => {
    mockApiError("get", "/users/me/student-profile", 500, "x");
    mockApi("get", "/users/me", USER());
    const user = userEvent.setup();
    renderScreen(<StudentProfilePage />, { role: "student" });
    expect(await screen.findByText("No se pudo cargar la información del perfil.")).toBeInTheDocument();
    mockApi("get", "/users/me/student-profile", STUDENT());
    await user.click(screen.getByRole("button", { name: /Reintentar/ }));
    expect(await screen.findByText("ana@x.com")).toBeInTheDocument();
  });

  it("editar y guardar manda datos de usuario y de alumno", async () => {
    mockApi("patch", "/users/me", { username: "alumno", name: "Anita", surname: "Pérez", email: "ana@x.com" });
    mockApi("patch", "/users/me/student-profile", { timezone: "America/Caracas", goal: "Conversaciones cotidianas" });
    const { user } = setup();
    await edit(user);
    const name = await screen.findByDisplayValue("Ana");
    await user.clear(name);
    await user.type(name, "Anita");
    await user.click(screen.getByRole("button", { name: /Guardar cambios/ }));
    await waitFor(() => expect(callsTo("patch", "/users/me")).toHaveLength(1));
    expect(callsTo("patch", "/users/me")[0].body).toMatchObject({ name: "Anita", surname: "Pérez", email: "ana@x.com" });
    expect(callsTo("patch", "/users/me/student-profile")[0].body).toMatchObject({ timezone: "America/Caracas", goal: "Conversaciones cotidianas" });
    expect(await screen.findByText("Perfil actualizado correctamente")).toBeInTheDocument();
  });

  it("un error al guardar se muestra", async () => {
    mockApiError("patch", "/users/me", 409, "Ese correo ya está en uso");
    mockApi("patch", "/users/me/student-profile", {});
    const { user } = setup();
    await edit(user);
    await user.click(await screen.findByRole("button", { name: /Guardar cambios/ }));
    expect(await screen.findByText(/Ese correo ya está en uso/)).toBeInTheDocument();
  });

  it("cancelar descarta los cambios", async () => {
    const { user } = setup();
    await edit(user);
    const name = await screen.findByDisplayValue("Ana");
    await user.clear(name);
    await user.type(name, "Otro");
    await user.click(screen.getAllByRole("button", { name: "Cancelar" })[0]);
    expect(await screen.findByRole("button", { name: "Editar perfil" })).toBeInTheDocument();
    expect(callsTo("patch", "/users/me")).toHaveLength(0);
  });

  it("objetivo: elegir otra opción, cambiar de categoría y escribir uno personalizado", async () => {
    mockApi("patch", "/users/me", {});
    mockApi("patch", "/users/me/student-profile", {});
    const { user } = setup();
    await edit(user);
    await user.click(await screen.findByRole("button", { name: /Mejorar pronunciación/ }));
    await user.click(screen.getByRole("button", { name: /Otras materias/ }));
    await user.click(screen.getByRole("button", { name: /Otro objetivo/ }));
    await user.type(await screen.findByPlaceholderText("Describe tu objetivo personalizado..."), "Aprobar cálculo");
    await user.click(screen.getByRole("button", { name: /Guardar cambios/ }));
    await waitFor(() => expect(callsTo("patch", "/users/me/student-profile")).toHaveLength(1));
    expect(callsTo("patch", "/users/me/student-profile")[0].body).toMatchObject({ goal: "Aprobar cálculo" });
  });

  it("un objetivo guardado que no está en el catálogo se abre como personalizado", async () => {
    const { user } = setup(USER(), STUDENT({ goal: "Algo muy mío" }));
    await edit(user);
    expect(await screen.findByDisplayValue("Algo muy mío")).toBeInTheDocument();
  });

  it("métodos de pago preferidos se marcan y se envían", async () => {
    mockApi("patch", "/users/me", {});
    mockApi("patch", "/users/me/student-profile", {});
    const { user } = setup();
    await edit(user);
    const pay = (await screen.findAllByRole("button")).filter((b) => /Zelle|Pago móvil|Transferencia|PayPal|Binance/i.test(b.textContent ?? ""));
    expect(pay.length).toBeGreaterThan(0);
    await user.click(pay[0]);
    await user.click(screen.getByRole("button", { name: /Guardar cambios/ }));
    await waitFor(() => expect(callsTo("patch", "/users/me/student-profile")).toHaveLength(1));
    expect((callsTo("patch", "/users/me/student-profile")[0].body as { preferred_payment_methods: string[] }).preferred_payment_methods).toHaveLength(1);
  });

  it("cuenta de Google: el correo no se edita", async () => {
    const { user } = setup(USER({ is_google_account: true }));
    await edit(user);
    expect(await screen.findByDisplayValue("ana@x.com")).toBeDisabled();
  });
});

describe("Perfil del alumno · foto", () => {
  it("subir foto la envía y avisa", async () => {
    mockApi("patch", "/users/me/avatar", { avatar_url: "https://cdn/a.png" });
    setup();
    await screen.findByText("ana@x.com");
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "a.png", { type: "image/png" })] } });
    await waitFor(() => expect(callsTo("patch", "/users/me/avatar")).toHaveLength(1));
    expect(await screen.findByText("Foto de perfil actualizada correctamente")).toBeInTheDocument();
  });

  it("un error al subir la foto se muestra", async () => {
    mockApiError("patch", "/users/me/avatar", 413, "Imagen demasiado grande");
    setup();
    await screen.findByText("ana@x.com");
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "a.png", { type: "image/png" })] } });
    expect(await screen.findByText(/Imagen demasiado grande/)).toBeInTheDocument();
  });
});

describe("Perfil del alumno · contraseña", () => {
  async function fill(user: ReturnType<typeof userEvent.setup>, o: string, n: string, c: string) {
    await screen.findByText("ana@x.com");
    await user.type(screen.getAllByPlaceholderText("••••••••")[0], o);
    await user.type(screen.getByPlaceholderText("Mínimo 8 caracteres"), n);
    await user.type(screen.getByPlaceholderText("Repite la nueva contraseña"), c);
  }
  const save = () => screen.getByRole("button", { name: /Actualizar contraseña/ });

  it("con datos inválidos el botón está desactivado", async () => {
    const { user } = setup();
    await fill(user, "vieja", "corta", "corta");
    expect(save()).toBeDisabled();
  });

  it("cambia la contraseña y limpia los campos", async () => {
    mockApi("post", "/users/me/change-password", {});
    const { user } = setup();
    await fill(user, "vieja", "nueva12345", "nueva12345");
    await user.click(save());
    await waitFor(() => expect(callsTo("post", "/users/me/change-password")).toHaveLength(1));
    expect(callsTo("post", "/users/me/change-password")[0].body).toEqual({ current_password: "vieja", new_password: "nueva12345" });
    expect(await screen.findByText("Contraseña actualizada exitosamente")).toBeInTheDocument();
  });

  it("contraseña actual incorrecta se muestra", async () => {
    mockApiError("post", "/users/me/change-password", 400, "Contraseña actual incorrecta");
    const { user } = setup();
    await fill(user, "mala", "nueva12345", "nueva12345");
    await user.click(save());
    expect(await screen.findByText("Contraseña actual incorrecta")).toBeInTheDocument();
  });
});

describe("Perfil del alumno · zona de peligro", () => {
  it("eliminar cuenta exige escribir el usuario", async () => {
    mockApi("delete", "/users/me", {});
    const { user } = setup();
    await screen.findByText("ana@x.com");
    await user.click(screen.getByRole("button", { name: "Eliminar cuenta" }));
    expect(screen.getByRole("button", { name: "Confirmar" })).toBeDisabled();
    await user.type(screen.getByPlaceholderText("alumno"), "alumno");
    await user.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(callsTo("delete", "/users/me")).toHaveLength(1));
  });

  it("un error al eliminar se avisa; cancelar cierra", async () => {
    mockApiError("delete", "/users/me", 400, "Contraseña incorrecta");
    const { user } = setup();
    await screen.findByText("ana@x.com");
    await user.click(screen.getByRole("button", { name: "Eliminar cuenta" }));
    await user.type(screen.getByPlaceholderText("alumno"), "alumno");
    await user.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText("Contraseña incorrecta")).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "Cancelar" }).at(-1)!);
    expect(screen.queryByPlaceholderText("alumno")).not.toBeInTheDocument();
  });
});
