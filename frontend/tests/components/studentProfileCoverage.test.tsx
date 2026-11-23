/**
 * Perfil del alumno · cierra huecos: formato de los errores del servidor, todos los campos de la edición, métodos
 * de pago preferidos en lectura, catálogos con valores de texto, foto (respuesta alternativa), ojos de contraseña
 * y la confirmación de borrado.
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

function setup(user: Record<string, unknown> = USER(), student: Record<string, unknown> = STUDENT(), extra?: () => void) {
  mockApi("get", "/users/me", user);
  mockApi("get", "/users/me/student-profile", student);
  extra?.();
  const view = renderScreen(<StudentProfilePage />, { role: "student" });
  return { ...view, user: userEvent.setup() };
}
async function edit(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByText("ana@x.com");
  await user.click(await screen.findByRole("button", { name: "Editar perfil" }));
}
afterEach(() => { vi.restoreAllMocks(); });

describe("Perfil del alumno · formato de errores del servidor", () => {
  const save = async (detail: unknown) => {
    mockApiError("patch", "/users/me", 422, detail);
    mockApi("patch", "/users/me/student-profile", {});
    const { user } = setup();
    await edit(user);
    await user.click(await screen.findByRole("button", { name: /Guardar cambios/ }));
  };

  it("una lista de errores de validación se une con puntos", async () => {
    await save([{ msg: "Nombre muy corto" }, { msg: "Correo inválido" }, { loc: ["x"] }]);
    expect(await screen.findByText(/Nombre muy corto\. Correo inválido\. \{"loc":\["x"\]\}/)).toBeInTheDocument();
  });

  it("un objeto con msg muestra su msg", async () => {
    await save({ msg: "Cuenta bloqueada" });
    expect(await screen.findByText(/Cuenta bloqueada/)).toBeInTheDocument();
  });

  it("un objeto sin msg se muestra como JSON", async () => {
    await save({ codigo: 7 });
    expect(await screen.findByText(/\{"codigo":7\}/)).toBeInTheDocument();
  });

  it("sin detalle usa el mensaje genérico", async () => {
    await save(undefined);
    expect(await screen.findByText("Error al guardar los cambios")).toBeInTheDocument();
  });
});

describe("Perfil del alumno · edición de todos los campos", () => {
  it("usuario, apellido, correo, teléfono, nacionalidad y zona horaria se envían al guardar", async () => {
    mockApi("patch", "/users/me", {});
    mockApi("patch", "/users/me/student-profile", {});
    const { user } = setup();
    await edit(user);
    fireEvent.change(await screen.findByDisplayValue("alumno"), { target: { value: "alumno2" } });
    fireEvent.change(screen.getByDisplayValue("Pérez"), { target: { value: "Gómez" } });
    fireEvent.change(screen.getByDisplayValue("ana@x.com"), { target: { value: "nueva@x.com" } });
    const selects = Array.from(document.querySelectorAll("select")) as HTMLSelectElement[];
    const country = selects.find((s) => Array.from(s.options).some((o) => /^\+\d+$/.test(o.value)))!;
    const dial = Array.from(country.options).map((o) => o.value).find((v) => v !== country.value)!;
    fireEvent.change(country, { target: { value: dial } });
    fireEvent.change(screen.getByPlaceholderText(/000/), { target: { value: "555 7788" } });
    const nationality = selects.find((s) => Array.from(s.options).some((o) => o.text === "Seleccionar..."))!;
    const nat = Array.from(nationality.options).map((o) => o.value).find((v) => v && v !== nationality.value)!;
    fireEvent.change(nationality, { target: { value: nat } });
    const tz = selects.find((s) => Array.from(s.options).some((o) => o.value === "America/Caracas"))!;
    const otherTz = Array.from(tz.options).map((o) => o.value).find((v) => v !== tz.value)!;
    fireEvent.change(tz, { target: { value: otherTz } });
    await user.click(screen.getByRole("button", { name: /Guardar cambios/ }));
    await waitFor(() => expect(callsTo("patch", "/users/me")).toHaveLength(1));
    expect(callsTo("patch", "/users/me")[0].body).toMatchObject({ username: "alumno2", surname: "Gómez", email: "nueva@x.com", nationality: nat });
    expect((callsTo("patch", "/users/me")[0].body as { phone_number: string }).phone_number).toContain("555 7788");
    expect(callsTo("patch", "/users/me/student-profile")[0].body).toMatchObject({ timezone: otherTz });
  });

  it("sin teléfono escrito se envía vacío", async () => {
    mockApi("patch", "/users/me", {});
    mockApi("patch", "/users/me/student-profile", {});
    const { user } = setup(USER({ phone_number: "" }));
    await edit(user);
    await user.click(await screen.findByRole("button", { name: /Guardar cambios/ }));
    await waitFor(() => expect(callsTo("patch", "/users/me")).toHaveLength(1));
    expect((callsTo("patch", "/users/me")[0].body as { phone_number: string }).phone_number).toBe("");
  });

  it("al guardar usa lo que devuelve el servidor aunque falten campos", async () => {
    mockApi("patch", "/users/me", { name: "Anita" });
    mockApi("patch", "/users/me/student-profile", null);
    const { user } = setup();
    await edit(user);
    await user.click(await screen.findByRole("button", { name: /Guardar cambios/ }));
    expect(await screen.findByText("Perfil actualizado correctamente")).toBeInTheDocument();
  });
});

describe("Perfil del alumno · lectura y catálogos", () => {
  it("en lectura muestra los métodos de pago preferidos, también los que no están en el catálogo", async () => {
    setup(USER(), STUDENT({ preferred_payment_methods: ["zelle", "otra-cosa"] }));
    await screen.findByText("ana@x.com");
    expect(await screen.findByText("otra-cosa")).toBeInTheDocument();
  });

  it("con catálogos de texto, los objetivos y los métodos se normalizan", async () => {
    mockApi("patch", "/users/me", {});
    mockApi("patch", "/users/me/student-profile", {});
    const { user } = setup(USER(), STUDENT({ goal: "Hablar", preferred_payment_methods: ["Zelle"] }), () =>
      mockApi("get", "/system-catalogs/", { student_goals: { idiomas: ["Hablar"], academico: ["Aprobar"] }, student_payment_methods: ["Zelle", "Efectivo"] }));
    await edit(user);
    await user.click(await screen.findByRole("button", { name: /Otras materias/ }));
    await user.click(await screen.findByRole("button", { name: /Aprobar/ }));
    await user.click(screen.getByRole("button", { name: /Efectivo/ }));
    await user.click(screen.getByRole("button", { name: /Guardar cambios/ }));
    await waitFor(() => expect(callsTo("patch", "/users/me/student-profile")).toHaveLength(1));
    expect(callsTo("patch", "/users/me/student-profile")[0].body).toMatchObject({ goal: "Aprobar", preferred_payment_methods: ["Zelle", "Efectivo"] });
  });

  it("un método marcado se desmarca al pulsarlo otra vez", async () => {
    mockApi("patch", "/users/me", {});
    mockApi("patch", "/users/me/student-profile", {});
    const { user } = setup(USER(), STUDENT({ preferred_payment_methods: ["Zelle"] }), () =>
      mockApi("get", "/system-catalogs/", { student_payment_methods: ["Zelle", "Efectivo"] }));
    await edit(user);
    await user.click(await screen.findByRole("button", { name: /Zelle/ }));
    await user.click(screen.getByRole("button", { name: /Guardar cambios/ }));
    await waitFor(() => expect(callsTo("patch", "/users/me/student-profile")).toHaveLength(1));
    expect((callsTo("patch", "/users/me/student-profile")[0].body as { preferred_payment_methods: string[] }).preferred_payment_methods).toEqual([]);
  });

  it("elegir «Otro objetivo» con un objetivo del catálogo seleccionado lo vacía", async () => {
    const { user } = setup();
    await edit(user);
    await user.click(await screen.findByRole("button", { name: /Otro objetivo/ }));
    expect(await screen.findByPlaceholderText("Describe tu objetivo personalizado...")).toBeInTheDocument();
  });
});

describe("Perfil del alumno · foto, contraseña y borrado", () => {
  it("pulsar el icono de la cámara abre el selector de archivos", async () => {
    const { user } = setup();
    await screen.findByText("ana@x.com");
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const click = vi.spyOn(input, "click").mockImplementation(() => {});
    await user.click(screen.getByTitle("Cambiar foto de perfil"));
    expect(click).toHaveBeenCalled();
  });

  it("la foto sube también si el servidor responde con «avatar»; sin archivo no pasa nada", async () => {
    mockApi("patch", "/users/me/avatar", { avatar: "https://cdn/b.png" });
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:x", revokeObjectURL: () => {} }));
    setup();
    await screen.findByText("ana@x.com");
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [] } });
    expect(callsTo("patch", "/users/me/avatar")).toHaveLength(0);
    fireEvent.change(input, { target: { files: [new File(["x"], "b.png", { type: "image/png" })] } });
    await waitFor(() => expect(callsTo("patch", "/users/me/avatar")).toHaveLength(1));
  });

  it("los ojos muestran y ocultan las contraseñas, y Enter envía el cambio", async () => {
    mockApi("post", "/users/me/change-password", {});
    const { user } = setup();
    await screen.findByText("ana@x.com");
    const [showOld, showNew] = screen.getAllByRole("button", { name: "Mostrar contraseña" });
    await user.click(showOld);
    await user.click(showNew);
    expect(screen.getAllByRole("button", { name: "Ocultar contraseña" })).toHaveLength(2);
    await user.click(screen.getAllByRole("button", { name: "Ocultar contraseña" })[0]);
    await user.click(screen.getAllByRole("button", { name: "Ocultar contraseña" })[0]);
    const [oldPw] = document.querySelectorAll<HTMLInputElement>('input[autocomplete="current-password"]');
    const newPw = document.querySelector('input[autocomplete="new-password"]') as HTMLInputElement;
    await user.type(oldPw, "vieja123");
    await user.type(newPw, "nueva12345");
    const confirm = screen.getByPlaceholderText(/Repite/) as HTMLInputElement;
    await user.type(confirm, "nueva12345{enter}");
    await waitFor(() => expect(callsTo("post", "/users/me/change-password")).toHaveLength(1));
  });

  it("al borrar la cuenta se escribe el usuario y la contraseña; el botón se activa solo con el usuario exacto", async () => {
    const { user } = setup();
    await screen.findByText("ana@x.com");
    await user.click(await screen.findByRole("button", { name: /Eliminar mi cuenta|Eliminar cuenta/ }));
    const userInput = screen.getByPlaceholderText("alumno");
    await user.type(userInput, "alum");
    await user.type(screen.getByPlaceholderText(/Tu contraseña/), "secreta");
    const buttons = screen.getAllByRole("button").filter((b) => (b as HTMLButtonElement).className.includes("bg-rose-500"));
    expect(buttons.at(-1)).toBeDisabled();
    await user.type(userInput, "no");
    expect(buttons.at(-1)).not.toBeDisabled();
  });
});
