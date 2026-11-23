/**
 * Perfil del profesor · cierra funciones sin ejercitar: campos de la edición (usuario, correo, bio, teléfono,
 * nacionalidad, zona horaria, redes), botón «+» de habilidades, quitar certificado, color libre y botones que abren
 * los selectores de foto y video, y mostrar/ocultar las contraseñas.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import ProfilePage from "@/app/(teacher)/teacher/profile/page";
import { renderScreen } from "./render";
import { mockApi, callsTo, makeUser, FIXTURE } from "./fakeApi";

const PROFILE = (over: Record<string, unknown> = {}) => ({
  ...FIXTURE.teacher, id: 3, user_username: "maria", bio: "Profe de mates", title: "Profesora certificada",
  timezone: "America/Caracas", languages: ["Español"], subjects: ["Matematica"], skills: ["TOEFL"],
  certificates: [{ title: "TESOL", year: "2020" }, { title: "CELTA", year: "2022" }], gallery: [], social_links: {}, status: "approved",
  video_url: "https://cdn/v.mp4", theme_color: null, rejection_reason: null, appeal_count: 0, appeal_exhausted: false, ...over,
});

function setup(over: Record<string, unknown> = {}) {
  mockApi("get", "/teachers/me/profile", PROFILE(over));
  mockApi("get", "/users/me", { ...makeUser("teacher"), username: "maria", email: "m@x.com", phone_number: "+58 412 1112233", avatar: null });
  mockApi("get", "/calendar/status", { connected: false, calendar_id: null, last_sync_at: null, sync_enabled: false });
  const view = renderScreen(<ProfilePage />, { role: "teacher" });
  return { ...view, user: userEvent.setup() };
}
async function edit(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByText("m@x.com");
  await user.click(await screen.findByRole("button", { name: "Editar perfil" }));
}
/** Pone en un <select> la primera opción distinta de la actual y devuelve su valor. */
const pickOther = (sel: HTMLSelectElement) => {
  const value = Array.from(sel.options).map((o) => o.value).find((v) => v && v !== sel.value)!;
  fireEvent.change(sel, { target: { value } });
  return value;
};

afterEach(() => { vi.restoreAllMocks(); });

describe("Perfil del profesor · edición de todos los campos", () => {
  it("usuario, correo, bio, teléfono, nacionalidad, zona horaria y redes se envían al guardar", async () => {
    mockApi("patch", "/users/me", {});
    mockApi("patch", "/teachers/me/profile", {});
    const { user } = setup();
    await edit(user);
    fireEvent.change(await screen.findByPlaceholderText("usuario123"), { target: { value: "maria2" } });
    fireEvent.change(screen.getByPlaceholderText("correo@ejemplo.com"), { target: { value: "nuevo@x.com" } });
    fireEvent.change(screen.getByPlaceholderText(/Cuéntales a los estudiantes/), { target: { value: "Nueva bio" } });
    fireEvent.change(screen.getByPlaceholderText("412 000 0000"), { target: { value: "555 1234" } });
    const selects = Array.from(document.querySelectorAll("select")) as HTMLSelectElement[];
    const nationality = selects.find((s) => Array.from(s.options).some((o) => o.text === "Seleccionar..."))!;
    const nat = pickOther(nationality);
    const timezone = selects.find((s) => Array.from(s.options).some((o) => o.value === "America/Caracas"))!;
    const tz = pickOther(timezone);
    fireEvent.change(screen.getByPlaceholderText("https://tuweb.com"), { target: { value: "https://maria.dev" } });
    fireEvent.change(screen.getByPlaceholderText("https://youtube.com/@canal"), { target: { value: "https://youtube.com/@maria" } });
    await user.click(screen.getByRole("button", { name: /Guardar cambios/ }));
    await waitFor(() => expect(callsTo("patch", "/teachers/me/profile").length).toBeGreaterThan(0));
    expect(callsTo("patch", "/users/me")[0].body).toMatchObject({ username: "maria2", email: "nuevo@x.com" });
    const body = callsTo("patch", "/teachers/me/profile").at(-1)!.body as Record<string, unknown>;
    expect(body).toMatchObject({ bio: "Nueva bio", timezone: tz });
    expect(body.social_links).toMatchObject({ website: "https://maria.dev", youtube: "https://youtube.com/@maria" });
    expect(body.nationality).toBeTruthy();
    expect(nat).toBeTruthy();
  });

  it("el botón + añade la habilidad escrita", async () => {
    const { user } = setup();
    await edit(user);
    const input = await screen.findByPlaceholderText(/Conversación fluida/);
    await user.type(input, "Escritura");
    await user.click(input.parentElement!.querySelector("button[type='button']") as HTMLElement);
    expect(await screen.findByText("Escritura")).toBeInTheDocument();
  });

  it("quitar un certificado con la X lo saca de lo que se envía", async () => {
    mockApi("patch", "/users/me", {});
    mockApi("patch", "/teachers/me/profile", {});
    const { user } = setup();
    await edit(user);
    const first = (await screen.findAllByPlaceholderText("Nombre del certificado"))[0];
    const row = first.closest("div[class*='flex']")!.parentElement as HTMLElement;
    const remove = Array.from(row.querySelectorAll("button")).find((b) => b.className.includes("bg-rose-50")) as HTMLElement;
    await user.click(remove);
    expect(screen.getAllByPlaceholderText("Nombre del certificado")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: /Guardar cambios/ }));
    await waitFor(() => expect(callsTo("patch", "/teachers/me/profile").length).toBeGreaterThan(0));
    expect((callsTo("patch", "/teachers/me/profile").at(-1)!.body as { certificates: unknown[] }).certificates).toEqual([{ title: "CELTA", year: "2022" }]);
  });
});

describe("Perfil del profesor · color libre y selectores de archivo", () => {
  it("el selector de color personalizado guarda el color elegido", async () => {
    mockApi("patch", "/teachers/me/profile", {});
    setup();
    await screen.findByText("Estilo de perfil público");
    fireEvent.change(document.querySelector('input[type="color"]') as HTMLInputElement, { target: { value: "#12ab34" } });
    await waitFor(() => expect(callsTo("patch", "/teachers/me/profile")).toHaveLength(1));
    expect((callsTo("patch", "/teachers/me/profile")[0].body as { theme_color: string }).theme_color).toBe("#12ab34");
  });

  it("pulsar la foto o «Reemplazar video» abre el selector de archivos correspondiente", async () => {
    const { user } = setup();
    await screen.findByText("@maria");
    const photoInput = document.querySelector('input[type="file"][accept="image/*"]') as HTMLInputElement;
    const videoInput = document.querySelector('input[type="file"][accept*="video"]') as HTMLInputElement;
    const photoClick = vi.spyOn(photoInput, "click").mockImplementation(() => {});
    const videoClick = vi.spyOn(videoInput, "click").mockImplementation(() => {});
    await user.click(document.querySelector("div[class*='w-20'][class*='cursor-pointer']") as HTMLElement);
    expect(photoClick).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /Reemplazar video/ }));
    expect(videoClick).toHaveBeenCalled();
  });
});

describe("Perfil del profesor · ver y ocultar contraseñas", () => {
  it("el ojo de la contraseña actual y de la nueva alterna entre oculta y visible", async () => {
    const { user } = setup();
    await screen.findByText("@maria");
    const old = screen.getAllByPlaceholderText("••••••••")[0] as HTMLInputElement;
    expect(old.type).toBe("password");
    await user.click(old.parentElement!.querySelector("button[type='button']") as HTMLElement);
    expect(old.type).toBe("text");
    await user.click(old.parentElement!.querySelector("button[type='button']") as HTMLElement);
    expect(old.type).toBe("password");
    const next = screen.getByPlaceholderText("Mínimo 8 caracteres") as HTMLInputElement;
    await user.click(next.parentElement!.querySelector("button[type='button']") as HTMLElement);
    expect(next.type).toBe("text");
  });
});
