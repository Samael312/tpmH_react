/**
 * Perfil del profesor · ramas restantes: perfil con todos los campos nulos, avisos de contraseña alcanzables solo con
 * Enter (el botón ya los impide), y los formatos de error del servidor (texto, lista, objeto, sin detalle).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { screen, waitFor } from "@testing-library/react";
import ProfilePage from "@/app/(teacher)/teacher/profile/page";
import { renderScreen } from "./render";
import { mockApi, mockApiError, callsTo, makeUser, FIXTURE } from "./fakeApi";

const PROFILE = (over: Record<string, unknown> = {}) => ({
  ...FIXTURE.teacher, id: 3, user_username: "maria", bio: "Profe de mates", title: "Profesora certificada",
  timezone: "America/Caracas", languages: ["Español"], subjects: ["Matematica"], skills: ["TOEFL"],
  certificates: [], gallery: [], social_links: {}, status: "approved", video_url: "https://cdn/v.mp4", theme_color: null,
  rejection_reason: null, appeal_count: 0, appeal_exhausted: false, ...over,
});
const CAL = { connected: false, calendar_id: null, last_sync_at: null, sync_enabled: false };

function setup(over: Record<string, unknown> = {}, userOver: Record<string, unknown> = {}, extra?: () => void) {
  mockApi("get", "/teachers/me/profile", PROFILE(over));
  mockApi("get", "/users/me", { ...makeUser("teacher"), username: "maria", email: "m@x.com", phone_number: "+58 412 1112233", avatar: null, ...userOver });
  mockApi("get", "/calendar/status", CAL);
  extra?.();
  const view = renderScreen(<ProfilePage />, { role: "teacher" });
  return { ...view, user: userEvent.setup() };
}
async function fillPw(user: ReturnType<typeof userEvent.setup>, o: string, n: string, c: string) {
  await screen.findByText("@maria");
  const [old] = screen.getAllByPlaceholderText("••••••••");
  await user.type(old, o);
  await user.type(screen.getByPlaceholderText("Mínimo 8 caracteres"), n);
  await user.type(screen.getByPlaceholderText("Repite la nueva contraseña"), c);
}
afterEach(() => { vi.restoreAllMocks(); });

describe("Perfil del profesor · campos nulos", () => {
  it("un perfil con todo nulo se muestra y se puede editar sin romper", async () => {
    const { user } = setup(
      { bio: null, nationality: null, title: null, timezone: null, languages: null, subjects: null, skills: null, certificates: null },
      { phone_number: null, avatar: null },
    );
    await screen.findByText("@maria");
    await user.click(await screen.findByRole("button", { name: "Editar perfil" }));
    expect(await screen.findByRole("button", { name: /Guardar cambios/ })).toBeInTheDocument();
  });

  it("guardar con teléfono y nacionalidad vacíos manda null / cadena vacía", async () => {
    mockApi("patch", "/users/me", {});
    mockApi("patch", "/teachers/me/profile", {});
    const { user } = setup({ nationality: null }, { phone_number: null, nationality: null });
    await screen.findByText("@maria");
    await user.click(await screen.findByRole("button", { name: "Editar perfil" }));
    await user.click(await screen.findByRole("button", { name: /Guardar cambios/ }));
    await waitFor(() => expect(callsTo("patch", "/teachers/me/profile")).toHaveLength(1));
    expect(callsTo("patch", "/teachers/me/profile")[0].body).toMatchObject({ nationality: null });
    expect((callsTo("patch", "/users/me")[0].body as { phone_number: string }).phone_number).toBe("");
  });

  it("el usuario con foto de perfil la muestra", async () => {
    setup({}, { avatar: "https://cdn.test/yo.png" });
    await screen.findByText("@maria");
    await waitFor(() => expect(document.querySelector("img[src*='yo.png']")).not.toBeNull());
  });
});

describe("Perfil del profesor · contraseña con Enter", () => {
  it("Enter con contraseñas distintas avisa que no coinciden y no llama", async () => {
    const { user } = setup();
    await fillPw(user, "vieja", "nueva12345", "otra12345");
    await user.type(screen.getByPlaceholderText("Repite la nueva contraseña"), "{enter}");
    expect(await screen.findByText("Las contraseñas no coinciden")).toBeInTheDocument();
    expect(callsTo("post", "/users/me/change-password")).toHaveLength(0);
  });

  it("Enter con menos de 8 caracteres avisa del mínimo", async () => {
    const { user } = setup();
    await fillPw(user, "vieja", "corta", "corta");
    await user.type(screen.getByPlaceholderText("Repite la nueva contraseña"), "{enter}");
    expect(await screen.findByText("La contraseña debe tener al menos 8 caracteres")).toBeInTheDocument();
    expect(callsTo("post", "/users/me/change-password")).toHaveLength(0);
  });

  it("Enter con todo correcto cambia la contraseña", async () => {
    mockApi("post", "/users/me/change-password", {});
    const { user } = setup();
    await fillPw(user, "vieja", "nueva12345", "nueva12345");
    await user.type(screen.getByPlaceholderText("Repite la nueva contraseña"), "{enter}");
    await waitFor(() => expect(callsTo("post", "/users/me/change-password")).toHaveLength(1));
  });
});

describe("Perfil del profesor · formatos de error del servidor", () => {
  const tryChange = async (detail: unknown) => {
    mockApiError("post", "/users/me/change-password", 400, detail);
    const { user } = setup();
    await fillPw(user, "vieja", "nueva12345", "nueva12345");
    await user.click(screen.getAllByRole("button", { name: /Actualizar contraseña|Cambiar contraseña|Guardar/ }).at(-1)!);
  };

  it("un detalle en forma de objeto con «msg» muestra ese texto", async () => {
    await tryChange({ msg: "Contraseña reciente" });
    expect(await screen.findByText("Contraseña reciente")).toBeInTheDocument();
  });

  it("un objeto sin «msg» se muestra serializado", async () => {
    await tryChange({ code: 42 });
    expect(await screen.findByText(/"code":42/)).toBeInTheDocument();
  });

  it("una lista mezcla mensajes y elementos sin «msg»", async () => {
    await tryChange([{ msg: "Muy corta" }, "texto suelto", { msg: "" }]);
    expect(await screen.findByText(/Muy corta\. "texto suelto"\. \{"msg":""\}/)).toBeInTheDocument();
  });

  it("sin detalle usa el mensaje genérico", async () => {
    await tryChange(null);
    expect(await screen.findByText(/No se pudo|Error/i)).toBeInTheDocument();
  });
});
