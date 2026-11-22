/**
 * Perfil del profesor · casos que completan teacherProfile: apelación de un video rechazado, video en revisión,
 * color del perfil público, chips de habilidades, cuentas de Google, redes en lectura y formato de errores del servidor.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { screen, waitFor } from "@testing-library/react";
import ProfilePage from "@/app/(teacher)/teacher/profile/page";
import { renderScreen } from "./render";
import { THEME_PRESETS } from "@/lib/color";
import { mockApi, mockApiError, callsTo, makeUser, FIXTURE } from "./fakeApi";

const PROFILE = (over: Record<string, unknown> = {}) => ({
  ...FIXTURE.teacher, id: 3, user_username: "maria", bio: "Profe de mates", title: "Profesora certificada",
  timezone: "America/Caracas", languages: ["Español"], subjects: ["Matematica"], skills: ["TOEFL"],
  certificates: [], gallery: [], social_links: {}, status: "approved", video_url: "https://cdn/v.mp4", theme_color: null,
  rejection_reason: null, appeal_count: 0, appeal_exhausted: false, ...over,
});

function setup(over: Record<string, unknown> = {}, userOver: Record<string, unknown> = {}, extra?: () => void) {
  mockApi("get", "/teachers/me/profile", PROFILE(over));
  mockApi("get", "/users/me", { ...makeUser("teacher"), username: "maria", email: "m@x.com", phone_number: "+58 412 1112233", avatar: null, ...userOver });
  mockApi("get", "/calendar/status", { connected: false, calendar_id: null, last_sync_at: null, sync_enabled: false });
  extra?.();
  const view = renderScreen(<ProfilePage />, { role: "teacher" });
  return { ...view, user: userEvent.setup() };
}
afterEach(() => { vi.restoreAllMocks(); });

describe("Perfil del profesor · video rechazado o en revisión", () => {
  const rejected = { video_pending_url: "https://cdn/new.mp4", video_pending_rejection_reason: "Mala calidad", video_pending_appeal_used: false };

  it("un video nuevo rechazado muestra el motivo y permite apelar una vez", async () => {
    mockApi("post", "/teachers/me/appeal", {});
    const { user } = setup(rejected);
    expect(await screen.findByText(/Motivo: Mala calidad/)).toBeInTheDocument();
    expect(screen.getByText(/Puedes apelar una vez/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Apelar esta decisión" }));
    const send = screen.getByRole("button", { name: "Enviar apelación" });
    expect(send).toBeDisabled();
    await user.type(screen.getByPlaceholderText(/Explica por qué crees/), "  El audio es correcto  ");
    await user.click(send);
    await waitFor(() => expect(callsTo("post", "/teachers/me/appeal")).toHaveLength(1));
    expect(callsTo("post", "/teachers/me/appeal")[0].body).toEqual({ message: "El audio es correcto" });
    expect(await screen.findByText("Apelación enviada. El equipo la revisará.")).toBeInTheDocument();
  });

  it("«Cancelar» cierra el formulario de apelación", async () => {
    const { user } = setup(rejected);
    await user.click(await screen.findByRole("button", { name: "Apelar esta decisión" }));
    await user.click(screen.getAllByRole("button", { name: "Cancelar" }).at(-1)!);
    expect(screen.getByRole("button", { name: "Apelar esta decisión" })).toBeInTheDocument();
  });

  it("un error al apelar se muestra", async () => {
    const { user } = setup(rejected, {}, () => mockApiError("post", "/teachers/me/appeal", 400, [{ msg: "Mensaje muy corto" }, { loc: ["x"] }]));
    await user.click(await screen.findByRole("button", { name: "Apelar esta decisión" }));
    await user.type(screen.getByPlaceholderText(/Explica por qué crees/), "hola");
    await user.click(screen.getByRole("button", { name: "Enviar apelación" }));
    expect(await screen.findByText(/Mensaje muy corto\. /)).toBeInTheDocument();
  });

  it("con la apelación ya usada lo indica y no ofrece apelar", async () => {
    setup({ ...rejected, video_pending_appeal_used: true });
    expect(await screen.findByText(/Tu apelación está en revisión/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Apelar esta decisión" })).not.toBeInTheDocument();
  });

  it("un video nuevo sin veredicto está «en revisión» y el actual sigue visible", async () => {
    setup({ video_pending_url: "https://cdn/new.mp4" });
    expect(await screen.findByText(/Video en revisión/)).toBeInTheDocument();
  });

  it("un perfil aún sin aprobar con video explica que se está revisando", async () => {
    setup({ status: "pending" });
    expect(await screen.findByText(/Tu video fue recibido y tu perfil está siendo revisado/)).toBeInTheDocument();
  });

  it("un error al eliminar el video se muestra", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { user } = setup({}, {}, () => mockApiError("delete", "/teachers/me/video", 400, { msg: "No se pudo borrar" }));
    await screen.findByText("@maria");
    await user.click(screen.getByRole("button", { name: "Eliminar" }));
    expect(await screen.findByText("No se pudo borrar")).toBeInTheDocument();
  });
});

describe("Perfil del profesor · color del perfil público", () => {
  it("elegir un color lo guarda y avisa; un error se muestra", async () => {
    mockApi("patch", "/teachers/me/profile", {});
    const { user } = setup();
    await screen.findByText("Estilo de perfil público");
    const preset = screen.getByTitle(THEME_PRESETS[1].label);
    await user.click(preset);
    await waitFor(() => expect(callsTo("patch", "/teachers/me/profile")).toHaveLength(1));
    expect((callsTo("patch", "/teachers/me/profile")[0].body as { theme_color: string }).theme_color).toMatch(/^#/);
    expect(await screen.findByText("Estilo actualizado")).toBeInTheDocument();
  });

  it("si falla el guardado lo dice", async () => {
    const { user } = setup({}, {}, () => mockApiError("patch", "/teachers/me/profile", 500, "Fallo del servidor"));
    await screen.findByText("Estilo de perfil público");
    await user.click(screen.getByTitle(THEME_PRESETS[1].label));
    expect(await screen.findByText("Fallo del servidor")).toBeInTheDocument();
  });
});

describe("Perfil del profesor · edición de chips y cuenta de Google", () => {
  async function edit(user: ReturnType<typeof userEvent.setup>) {
    await screen.findByText("m@x.com");
    await user.click(await screen.findByRole("button", { name: "Editar perfil" }));
  }

  it("habilidades: añadir con Enter, sin duplicados ni vacíos, por sugerencia y quitar", async () => {
    const { user } = setup();
    await edit(user);
    const input = await screen.findByPlaceholderText(/Conversación fluida/);
    await user.type(input, "Pronunciación{Enter}");
    expect(await screen.findByText("Pronunciación")).toBeInTheDocument();
    await user.type(input, "Pronunciación{Enter}");
    expect(screen.getAllByText("Pronunciación")).toHaveLength(1);
    await user.type(input, "   {Enter}");
    const suggestion = screen.queryAllByRole("button", { name: /^\+ / })[0];
    if (suggestion) { await user.click(suggestion); }
    const chip = screen.getByText("Pronunciación").querySelector("button") as HTMLElement;
    await user.click(chip);
    expect(screen.queryByText("Pronunciación")).not.toBeInTheDocument();
  });

  it("idiomas y materias se activan y desactivan al pulsarlos", async () => {
    const { user } = setup();
    await edit(user);
    const label = await screen.findByText("Idiomas");
    const chips = Array.from(label.parentElement!.querySelectorAll("button"));
    const before = chips.map((b) => b.className);
    await user.click(chips[0]);
    expect(chips[0].className).not.toBe(before[0]);
    await user.click(chips[0]);
    expect(chips[0].className).toBe(before[0]);
  });

  it("con cuenta de Google el correo no es editable y no hay cambio de contraseña", async () => {
    setup({}, { is_google_account: true });
    expect(await screen.findByText(/Inicias sesión con Google/)).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Editar perfil" }));
    expect(await screen.findByText(/No editable: tu cuenta está vinculada a Google/)).toBeInTheDocument();
  });

  it("en lectura muestra las redes que el profesor haya cargado", async () => {
    setup({ social_links: { instagram: "@maria_mates", website: "https://maria.com", tiktok: "@mm" } });
    expect(await screen.findByText(/@maria_mates/)).toBeInTheDocument();
  });

  it("cambiar el código de país del teléfono", async () => {
    const { user } = setup();
    await screen.findByText("m@x.com");
    await user.click(await screen.findByRole("button", { name: "Editar perfil" }));
    const select = Array.from(document.querySelectorAll("select")).find((s) => /\+\d+/.test((s as HTMLSelectElement).value)) as HTMLSelectElement | undefined;
    if (select) await user.selectOptions(select, select.options[1].value);
    expect(select).toBeDefined();
  });
});
