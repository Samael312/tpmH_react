/**
 * Estudiantes baneados, callback de Google Calendar y aviso de correo sin verificar.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { screen, waitFor } from "@testing-library/react";
import BannedPage from "@/app/(superadmin)/admin/students/banned/page";
import CallbackPage from "@/app/(teacher)/teacher/calendar/callback/page";
import VerifyEmailBanner from "@/components/layout/VerifyEmailBanner";
import { renderScreen } from "./render";
import { routerState } from "./router";
import { mockApi, mockApiError, callsTo, makeUser } from "./fakeApi";

afterEach(() => { vi.useRealTimers(); });

const STUDENT = (over: Record<string, unknown> = {}) => ({
  id: 4, name: "Ana", surname: "Pérez", username: "ana", email: "a@x.com", nationality: "Venezuela",
  ban_reason: "Spam", banned_at: "2026-03-01T10:00:00Z", ...over,
});
function banned(rows: unknown[]) {
  mockApi("get", /^\/admin\/users/, { users: rows, total: rows.length, active_count: 0 });
  return { ...renderScreen(<BannedPage />, { role: "superadmin" }), user: userEvent.setup() };
}

describe("Estudiantes baneados", () => {
  it("lista con motivo, fecha y nacionalidad; con uno solo usa el singular", async () => {
    banned([STUDENT()]);
    expect(await screen.findByText("Ana Pérez")).toBeInTheDocument();
    expect(screen.getByText("1 estudiante expulsado de la plataforma")).toBeInTheDocument();
    expect(screen.getByText("Spam")).toBeInTheDocument();
    expect(screen.getByText(/Baneado el/)).toBeInTheDocument();
    expect(screen.getByText(/Venezuela/)).toBeInTheDocument();
  });

  it("un estudiante sin datos opcionales sigue pintando con inicial por defecto", async () => {
    banned([STUDENT({ name: "", surname: "", nationality: null, ban_reason: null, banned_at: null }), STUDENT({ id: 5, username: "b", email: "b@x.com" })]);
    expect(await screen.findByText("U")).toBeInTheDocument();
    expect(screen.getByText("2 estudiantes expulsados de la plataforma")).toBeInTheDocument();
  });

  it("revertir pide confirmación: Cancelar no llama; confirmar reactiva", async () => {
    mockApi("post", "/admin/students/4/unban", {});
    const { user } = banned([STUDENT()]);
    await user.click(await screen.findByRole("button", { name: /Revertir/ }));
    await screen.findByText(/¿Reactivar a Ana Pérez\?/);
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByText(/¿Reactivar a/)).not.toBeInTheDocument());
    expect(callsTo("post", "/admin/students/4/unban")).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: /Revertir/ }));
    await user.click(await screen.findByRole("button", { name: "Reactivar" }));
    await waitFor(() => expect(callsTo("post", "/admin/students/4/unban")).toHaveLength(1));
    expect(await screen.findByText("Estudiante reactivado correctamente")).toBeInTheDocument();
  });

  it("un error al reactivar se avisa", async () => {
    mockApiError("post", "/admin/students/4/unban", 409, "Ya está activo");
    const { user } = banned([STUDENT()]);
    await user.click(await screen.findByRole("button", { name: /Revertir/ }));
    await user.click(await screen.findByRole("button", { name: "Reactivar" }));
    expect(await screen.findByText("Ya está activo")).toBeInTheDocument();
  });

  it("si falla la carga ofrece reintentar", async () => {
    mockApiError("get", /^\/admin\/users/, 500, "x");
    renderScreen(<BannedPage />, { role: "superadmin" });
    const retry = await screen.findByRole("button", { name: /Reintentar/ });
    mockApi("get", /^\/admin\/users/, { users: [STUDENT()], total: 1, active_count: 0 });
    await userEvent.setup().click(retry);
    expect(await screen.findByText("Ana Pérez")).toBeInTheDocument();
  });
});

describe("Callback de Google Calendar", () => {
  const go = (search: string) => renderScreen(<CallbackPage />, { role: "teacher", route: "/teacher/calendar/callback", search });

  it("Google devuelve un error: se explica (cancelado)", async () => {
    go("error=access_denied");
    expect(await screen.findByText("Cancelaste la conexión con Google Calendar.")).toBeInTheDocument();
  });
  it("otro error de Google se muestra tal cual", async () => {
    go("error=server_error");
    expect(await screen.findByText(/Google devolvió un error: server_error/)).toBeInTheDocument();
  });
  it("sin código avisa y permite ir al perfil", async () => {
    go("");
    expect(await screen.findByText(/No se recibió el código/)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: /perfil/i }));
    expect(routerState.router.replace).toHaveBeenCalledWith("/teacher/profile");
  });
  it("con código lo envía, avisa del éxito y vuelve al perfil", async () => {
    mockApi("post", "/calendar/callback", {});
    go("code=abc&state=xyz");
    expect(await screen.findByText(/Calendario conectado correctamente/)).toBeInTheDocument();
    expect(callsTo("post", "/calendar/callback")[0].body).toEqual({ code: "abc", state: "xyz" });
    await waitFor(() => expect(routerState.router.replace).toHaveBeenCalledWith("/teacher/profile"), { timeout: 3000 });
  });
  it("si el servidor rechaza, muestra el error y Reintentar lo vuelve a intentar", async () => {
    mockApiError("post", "/calendar/callback", 400, "Código caducado");
    go("code=abc&state=xyz");
    const retry = await screen.findByRole("button", { name: "Reintentar" });
    expect(screen.getByText("Código caducado")).toBeInTheDocument();
    mockApi("post", "/calendar/callback", {});
    await userEvent.setup().click(retry);
    expect(await screen.findByText(/Calendario conectado correctamente/)).toBeInTheDocument();
  });
});

describe("Aviso de correo sin verificar", () => {
  it("no aparece si la cuenta está verificada", async () => {
    mockApi("get", "/users/me", { ...makeUser("student"), is_verified: true });
    renderScreen(<VerifyEmailBanner />, { role: "student" });
    await waitFor(() => expect(callsTo("get", "/users/me").length).toBeGreaterThan(0));
    expect(screen.queryByRole("button", { name: /Reenviar enlace/ })).not.toBeInTheDocument();
  });

  it.each(["student", "teacher"] as const)("a un %s sin verificar le ofrece reenviar el enlace", async (role) => {
    mockApi("get", "/users/me", { ...makeUser(role), is_verified: false });
    mockApi("post", "/auth/resend-verification", {});
    renderScreen(<VerifyEmailBanner />, { role });
    await userEvent.setup().click(await screen.findByRole("button", { name: /Reenviar enlace/ }));
    expect(await screen.findByText("Te enviamos un nuevo enlace. Revisa tu correo.")).toBeInTheDocument();
  });

  it("un error al reenviar se avisa", async () => {
    mockApi("get", "/users/me", { ...makeUser("student"), is_verified: false });
    mockApiError("post", "/auth/resend-verification", 429, "Demasiados intentos");
    renderScreen(<VerifyEmailBanner />, { role: "student" });
    await userEvent.setup().click(await screen.findByRole("button", { name: /Reenviar enlace/ }));
    expect(await screen.findByText("Demasiados intentos")).toBeInTheDocument();
  });

  it("si /users/me falla no muestra nada", async () => {
    mockApiError("get", "/users/me", 500, "x");
    renderScreen(<VerifyEmailBanner />, { role: "student" });
    await waitFor(() => expect(callsTo("get", "/users/me").length).toBeGreaterThan(0));
    expect(screen.queryByRole("button", { name: /Reenviar enlace/ })).not.toBeInTheDocument();
  });
});
