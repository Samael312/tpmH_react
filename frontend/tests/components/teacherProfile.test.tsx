/**
 * Perfil del profesor: datos, contraseña, foto, video, zona de peligro y sincronización con Google Calendar.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import ProfilePage from "@/app/(teacher)/teacher/profile/page";
import { renderScreen } from "./render";
import { mockApi, mockApiError, callsTo, makeUser, FIXTURE } from "./fakeApi";

const PROFILE = (over: Record<string, unknown> = {}) => ({
  ...FIXTURE.teacher, id: 3, user_username: "maria", bio: "Profe de mates", title: "Profesora certificada",
  timezone: "America/Caracas", languages: ["Español"], subjects: ["Matematica"], skills: ["TOEFL"],
  certificates: [{ title: "TESOL", year: "2020" }], gallery: [], social_links: {}, status: "approved",
  video_url: "https://cdn/v.mp4", theme_color: null, rejection_reason: null, appeal_count: 0, appeal_exhausted: false, ...over,
});
const CAL = { connected: false, calendar_id: null, last_sync_at: null, sync_enabled: false };

function setup(over: Record<string, unknown> = {}, cal: Record<string, unknown> = CAL, extra?: () => void) {
  mockApi("get", "/teachers/me/profile", PROFILE(over));
  mockApi("get", "/users/me", { ...makeUser("teacher"), username: "maria", email: "m@x.com", phone_number: "+58 412 1112233", avatar: null });
  mockApi("get", "/calendar/status", cal);
  extra?.();
  const view = renderScreen(<ProfilePage />, { role: "teacher" });
  return { ...view, user: userEvent.setup() };
}

afterEach(() => { vi.restoreAllMocks(); });

async function edit(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByText("m@x.com"); // el formulario se rellena cuando llegan perfil Y usuario
  await user.click(await screen.findByRole("button", { name: "Editar perfil" }));
}

describe("Perfil del profesor · datos", () => {
  it("muestra los datos en modo lectura", async () => {
    setup();
    expect(await screen.findByText("@maria")).toBeInTheDocument();
    expect(await screen.findByText("m@x.com")).toBeInTheDocument();
    expect(screen.getAllByText("Profesora certificada").length).toBeGreaterThan(0);
  });

  it("si falla la carga ofrece reintentar", async () => {
    mockApiError("get", "/teachers/me/profile", 500, "x");
    mockApi("get", "/users/me", { ...makeUser("teacher") });
    const { user } = { ...renderScreen(<ProfilePage />, { role: "teacher" }), user: userEvent.setup() };
    expect(await screen.findByText("No se pudo cargar tu perfil")).toBeInTheDocument();
    mockApi("get", "/teachers/me/profile", PROFILE());
    await user.click(screen.getByRole("button", { name: /Reintentar/ }));
    expect(await screen.findByText("@maria")).toBeInTheDocument();
  });

  it("editar y guardar manda usuario/correo/teléfono y el perfil profesional", async () => {
    mockApi("patch", "/users/me", {});
    mockApi("patch", "/teachers/me/profile", {});
    const { user } = setup();
    await edit(user);
    const title = await screen.findByPlaceholderText("Ej: Profesora de Inglés Certificada");
    await user.clear(title);
    await user.type(title, "Doctora en mates");
    await user.click(screen.getByRole("button", { name: /Guardar cambios/ }));
    await waitFor(() => expect(callsTo("patch", "/teachers/me/profile").length).toBeGreaterThan(0));
    expect(callsTo("patch", "/users/me")[0].body).toMatchObject({ username: "maria", email: "m@x.com" });
    expect(callsTo("patch", "/teachers/me/profile").at(-1)!.body).toMatchObject({ title: "Doctora en mates", bio: "Profe de mates" });
    expect(await screen.findByText("Perfil actualizado correctamente")).toBeInTheDocument();
  });

  it("cancelar descarta los cambios", async () => {
    const { user } = setup();
    await edit(user);
    const title = await screen.findByPlaceholderText("Ej: Profesora de Inglés Certificada");
    await user.clear(title);
    await user.type(title, "otra cosa");
    await user.click(screen.getAllByRole("button", { name: "Cancelar" })[0]);
    expect(await screen.findByRole("button", { name: "Editar perfil" })).toBeInTheDocument();
    expect(screen.queryByText("otra cosa")).not.toBeInTheDocument();
    expect(callsTo("patch", "/teachers/me/profile")).toHaveLength(0);
  });

  it("un error al guardar se muestra", async () => {
    mockApi("patch", "/users/me", {});
    mockApiError("patch", "/teachers/me/profile", 400, "Zona horaria inválida");
    const { user } = setup();
    await edit(user);
    await user.click(await screen.findByRole("button", { name: /Guardar cambios/ }));
    expect(await screen.findByText(/Zona horaria inválida/)).toBeInTheDocument();
  });

  it("certificados: añadir, escribir y quitar (los vacíos no se envían)", async () => {
    mockApi("patch", "/users/me", {});
    mockApi("patch", "/teachers/me/profile", {});
    const { user } = setup();
    await edit(user);
    await user.click(await screen.findByRole("button", { name: /Añadir certificación/ }));
    const titles = screen.getAllByPlaceholderText("Nombre del certificado");
    expect(titles).toHaveLength(2);
    await user.type(titles[1], "CELTA");
    await user.type(screen.getAllByPlaceholderText("Año (ej: 2023)")[1], "2022");
    await user.click(screen.getByRole("button", { name: /Guardar cambios/ }));
    await waitFor(() => expect(callsTo("patch", "/teachers/me/profile").length).toBeGreaterThan(0));
    expect((callsTo("patch", "/teachers/me/profile").at(-1)!.body as { certificates: unknown[] }).certificates).toEqual([
      { title: "TESOL", year: "2020" }, { title: "CELTA", year: "2022" },
    ]);
  });
});

describe("Perfil del profesor · foto", () => {
  it("subir foto la envía y avisa", async () => {
    mockApi("post", "/users/me/photo", { avatar_url: "https://cdn/a.png" });
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:x", revokeObjectURL: () => {} }));
    setup();
    await screen.findByText("@maria");
    const input = document.querySelector('input[type="file"][accept="image/*"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "a.png", { type: "image/png" })] } });
    await waitFor(() => expect(callsTo("post", "/users/me/photo")).toHaveLength(1));
    expect(await screen.findByText("Foto de perfil actualizada")).toBeInTheDocument();
  });

  it("un error al subir la foto se muestra", async () => {
    mockApiError("post", "/users/me/photo", 413, "Imagen demasiado grande");
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:x", revokeObjectURL: () => {} }));
    setup();
    await screen.findByText("@maria");
    const input = document.querySelector('input[type="file"][accept="image/*"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "a.png", { type: "image/png" })] } });
    expect(await screen.findByText(/Imagen demasiado grande/)).toBeInTheDocument();
  });
});

describe("Perfil del profesor · contraseña", () => {
  async function fill(user: ReturnType<typeof userEvent.setup>, o: string, n: string, c: string) {
    await screen.findByText("@maria");
    const [old] = screen.getAllByPlaceholderText("••••••••");
    await user.type(old, o);
    await user.type(screen.getByPlaceholderText("Mínimo 8 caracteres"), n);
    await user.type(screen.getByPlaceholderText("Repite la nueva contraseña"), c);
  }
  const save = () => {
    const btns = screen.getAllByRole("button", { name: /Actualizar contraseña|Cambiar contraseña|Guardar/ });
    return btns[btns.length - 1];
  };

  // Los avisos «no coinciden» / «mínimo 8» del handler son inalcanzables desde la UI: el botón ya está desactivado.
  it("con contraseñas distintas el botón está desactivado", async () => {
    const { user } = setup();
    await fill(user, "vieja", "nueva12345", "otra12345");
    expect(save()).toBeDisabled();
    expect(callsTo("post", "/users/me/change-password")).toHaveLength(0);
  });

  it("con menos de 8 caracteres el botón está desactivado", async () => {
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
    expect(screen.getByPlaceholderText("Mínimo 8 caracteres")).toHaveValue("");
  });

  it("contraseña actual incorrecta se muestra", async () => {
    mockApiError("post", "/users/me/change-password", 400, "Contraseña actual incorrecta");
    const { user } = setup();
    await fill(user, "mala", "nueva12345", "nueva12345");
    await user.click(save());
    expect(await screen.findByText("Contraseña actual incorrecta")).toBeInTheDocument();
  });
});

describe("Perfil del profesor · video", () => {
  const fileInput = () => document.querySelector('input[type="file"][accept*="video"]') as HTMLInputElement;

  it("sin video avisa que es obligatorio", async () => {
    setup({ video_url: null });
    expect(await screen.findByText(/Aún no has subido tu video/)).toBeInTheDocument();
  });

  it("un formato no permitido se rechaza sin llamar", async () => {
    setup({ video_url: null });
    await screen.findByText(/Aún no has subido tu video/);
    fireEvent.change(fileInput(), { target: { files: [new File(["x"], "a.avi", { type: "video/avi" })] } });
    expect(await screen.findByText("Formato no permitido. Usa MP4 o MOV.")).toBeInTheDocument();
    expect(callsTo("post", "/teachers/me/video")).toHaveLength(0);
  });

  it("un video demasiado grande se rechaza", async () => {
    setup({ video_url: null });
    await screen.findByText(/Aún no has subido tu video/);
    const big = new File(["x"], "a.mp4", { type: "video/mp4" });
    Object.defineProperty(big, "size", { value: 900 * 1024 * 1024 });
    fireEvent.change(fileInput(), { target: { files: [big] } });
    expect(await screen.findByText(/supera el tamaño máximo/)).toBeInTheDocument();
  });

  it("un MP4 válido se sube", async () => {
    mockApi("post", "/teachers/me/video", { message: "Video subido con éxito" });
    setup({ video_url: null });
    await screen.findByText(/Aún no has subido tu video/);
    fireEvent.change(fileInput(), { target: { files: [new File(["x"], "a.mp4", { type: "video/mp4" })] } });
    await waitFor(() => expect(callsTo("post", "/teachers/me/video")).toHaveLength(1));
    expect(await screen.findByText("Video subido con éxito")).toBeInTheDocument();
  });

  it("un error al subir se muestra", async () => {
    mockApiError("post", "/teachers/me/video", 500, "Fallo de almacenamiento");
    setup({ video_url: null });
    await screen.findByText(/Aún no has subido tu video/);
    fireEvent.change(fileInput(), { target: { files: [new File(["x"], "a.mp4", { type: "video/mp4" })] } });
    expect(await screen.findByText(/Fallo de almacenamiento/)).toBeInTheDocument();
  });

  it("eliminar pide confirmación y llama a DELETE", async () => {
    mockApi("delete", "/teachers/me/video", {});
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: /Eliminar|Quitar/i, hidden: false }).catch(() => screen.getAllByRole("button", { name: /Eliminar video|Eliminar/ })[0]));
    await waitFor(() => expect(callsTo("delete", "/teachers/me/video")).toHaveLength(1));
    expect(await screen.findByText("Video eliminado correctamente")).toBeInTheDocument();
  });
});

describe("Perfil del profesor · zona de peligro", () => {
  it("eliminar cuenta exige escribir el usuario y manda la confirmación", async () => {
    mockApi("delete", "/users/me", {});
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: "Eliminar cuenta" }));
    expect(screen.getByRole("button", { name: "Confirmar" })).toBeDisabled();
    await user.type(screen.getByPlaceholderText("maria"), "maria");
    await user.type(screen.getByPlaceholderText("Tu contraseña (si tu cuenta tiene)"), "secreta");
    await user.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(callsTo("delete", "/users/me")).toHaveLength(1));
  });

  it("un error al eliminar se avisa", async () => {
    mockApiError("delete", "/users/me", 400, "Contraseña incorrecta");
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: "Eliminar cuenta" }));
    await user.type(screen.getByPlaceholderText("maria"), "maria");
    await user.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText("Contraseña incorrecta")).toBeInTheDocument();
  });

  it("cancelar cierra la confirmación", async () => {
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: "Eliminar cuenta" }));
    await user.click(screen.getAllByRole("button", { name: "Cancelar" }).at(-1)!);
    expect(screen.queryByPlaceholderText("maria")).not.toBeInTheDocument();
  });
});

describe("Perfil del profesor · Google Calendar", () => {
  it("sin conectar ofrece conectar", async () => {
    setup();
    expect(await screen.findByText("Calendario no conectado")).toBeInTheDocument();
  });

  it("conectar pide la URL de autorización; un error se avisa", async () => {
    mockApiError("get", "/calendar/auth-url", 500, "Google caído");
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: /Conectar/ }));
    expect(await screen.findByText(/Google caído/)).toBeInTheDocument();
  });

  it("si falla el estado ofrece reintentar", async () => {
    setup({}, CAL, () => mockApiError("get", "/calendar/status", 500, "x"));
    expect(await screen.findByText("No se pudo cargar el estado de tu calendario.")).toBeInTheDocument();
  });

  const CONNECTED = { connected: true, calendar_id: "maria@gmail.com", last_sync_at: null, sync_enabled: true };

  it("conectado: muestra el calendario y «Nunca» sincronizado", async () => {
    setup({}, CONNECTED);
    expect(await screen.findByText("maria@gmail.com")).toBeInTheDocument();
    expect(screen.getByText(/Nunca/)).toBeInTheDocument();
  });

  it("alternar la sincronización automática", async () => {
    mockApi("post", "/calendar/toggle", {});
    const { user } = setup({}, CONNECTED);
    await screen.findByText("maria@gmail.com");
    const toggle = screen.getByText("Sincronización automática").closest("div")!.parentElement!.querySelector("button") as HTMLElement;
    await user.click(toggle);
    await waitFor(() => expect(callsTo("post", "/calendar/toggle")).toHaveLength(1));
    expect(callsTo("post", "/calendar/toggle")[0].body).toEqual({ enabled: false });
    expect(await screen.findByText("Sincronización automática desactivada")).toBeInTheDocument();
  });

  it("sincronizar ahora muestra el resumen, incluidas las clases de Preply", async () => {
    mockApi("post", "/calendar/sync", { new_count: 2, updated_count: 1, deleted_count: 0, imported_new_count: 3, imported_updated_count: 1, imported_cancelled_count: 1, msg: "ok" });
    const { user } = setup({}, CONNECTED);
    await user.click(await screen.findByRole("button", { name: "Sincronizar ahora" }));
    expect(await screen.findByText("Sincronización completada")).toBeInTheDocument();
    expect(screen.getByText("+2 nuevas")).toBeInTheDocument();
    expect(screen.getByText(/\+3 Preply/)).toBeInTheDocument();
  });

  it("un error al sincronizar se muestra", async () => {
    mockApiError("post", "/calendar/sync", 502, "Google rechazó la petición");
    const { user } = setup({}, CONNECTED);
    await user.click(await screen.findByRole("button", { name: "Sincronizar ahora" }));
    expect((await screen.findAllByText(/Google rechazó la petición/)).length).toBeGreaterThan(0);
  });

  it("desconectar pide confirmación y llama a la API", async () => {
    mockApi("post", "/calendar/disconnect", {});
    const { user } = setup({}, CONNECTED);
    await user.click(await screen.findByRole("button", { name: "Desconectar calendario" }));
    expect(screen.getByText("¿Desconectar Google Calendar?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(callsTo("post", "/calendar/disconnect")).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Desconectar calendario" }));
    await user.click(screen.getByRole("button", { name: "Desconectar" }));
    await waitFor(() => expect(callsTo("post", "/calendar/disconnect")).toHaveLength(1));
    expect(await screen.findByText("Google Calendar desconectado correctamente")).toBeInTheDocument();
  });
});
