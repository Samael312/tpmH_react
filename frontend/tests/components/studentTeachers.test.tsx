/**
 * Lista de profesores (alumno): «Tus profesores» con su etapa, profesores congelados con solicitud de reembolso,
 * marketplace con filtro de idioma y redirección en modo un-solo-profesor.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { screen, waitFor } from "@testing-library/react";
import ChooseTeacherPage from "@/app/(student)/dashboard/teachers/page";
import { renderScreen } from "./render";
import { routerState } from "./router";
import { mockApi, mockApiError, callsTo, FIXTURE } from "./fakeApi";

const DIR = (u: string, name: string) => ({ user_username: u, name, surname: "X", title: "Profe", languages: ["Español"], subjects: [] });
const MINE = (u: string, over: Record<string, unknown> = {}) => ({
  teacher_username: u, name: u, surname: "Z", title: null, profile_photo_url: null, theme_color: null, stage: "ready", status: "approved",
  is_frozen: false, refund_pending: false, active_enrollment: null, ...over,
});

function setup(o: { dir?: unknown[]; mine?: unknown[]; single?: boolean; langs?: string[] } = {}, extra?: () => void) {
  mockApi("get", /^\/admin\/platform-config/, { ...FIXTURE.platformConfig, is_single_tenant: !!o.single });
  mockApi("get", "/teachers/", o.dir ?? []);
  mockApi("get", "/users/me/teachers", o.mine ?? []);
  mockApi("get", "/system-catalogs/", { spoken_languages: o.langs ?? [] });
  extra?.();
  const view = renderScreen(<ChooseTeacherPage />, { role: "student" });
  return { ...view, user: userEvent.setup() };
}
afterEach(() => { vi.restoreAllMocks(); });

describe("Profesores (alumno)", () => {
  it("sin profesores propios ni disponibles lo dice", async () => {
    setup();
    expect(await screen.findByText(/Aún no has elegido ningún profesor/)).toBeInTheDocument();
    expect(await screen.findByText("No hay más profesores disponibles por ahora")).toBeInTheDocument();
  });

  it("el marketplace excluye a los que ya son tuyos", async () => {
    setup({ dir: [DIR("ana", "Ana"), DIR("beto", "Beto")], mine: [MINE("ana")] });
    expect(await screen.findByText(/Beto X/)).toBeInTheDocument();
    expect(screen.getAllByText(/ana/i).length).toBeGreaterThan(0);
  });

  it("cada profesor propio enlaza a su perfil y muestra su etapa y paquete", async () => {
    setup({ mine: [MINE("ana", { stage: "needs_package" }), MINE("luz", { stage: "weird_stage", active_enrollment: { id: 1, package_name: "Pack 8", classes_used: 2, classes_total: null, status: "active" } })] });
    expect(await screen.findByText("Elige tu paquete")).toBeInTheDocument();
    expect(screen.getByText("weird_stage")).toBeInTheDocument();
    expect(screen.getByText(/Pack 8 · 2\/∞/)).toBeInTheDocument();
    expect(document.querySelector('a[href="/dashboard/teachers/ana"]')).not.toBeNull();
  });

  it("el filtro de idioma pide al servidor solo esos profesores", async () => {
    const { user } = setup({ langs: ["Español", "Inglés"] });
    await user.selectOptions(await screen.findByRole("combobox"), "Inglés");
    await waitFor(() => expect(callsTo("get", "/teachers/").some((c) => (c.params as { speaks?: string } | undefined)?.speaks === "Inglés")).toBe(true));
    expect(await screen.findByText("Ningún profesor disponible habla Inglés por ahora")).toBeInTheDocument();
  });

  it("en un-solo-profesor redirige al perfil del destacado", async () => {
    setup({ single: true });
    await waitFor(() => expect(routerState.router.replace).toHaveBeenCalledWith(`/dashboard/teachers/${FIXTURE.platformConfig.featured_teacher.username}`));
  });
});

describe("Profesores (alumno) · congelado y reembolso", () => {
  const frozen = (over: Record<string, unknown> = {}) => MINE("ana", { is_frozen: true, active_enrollment: { id: 9, package_name: "P", classes_used: 2, classes_total: 8, status: "active" }, ...over });

  it("un profesor congelado muestra el aviso y no es un enlace", async () => {
    setup({ mine: [frozen()] });
    expect(await screen.findByText(/quedaron congelados/)).toBeInTheDocument();
    expect(document.querySelector('a[href="/dashboard/teachers/ana"]')).toBeNull();
  });

  it("con reembolso pendiente lo indica y no ofrece pedirlo otra vez", async () => {
    setup({ mine: [frozen({ refund_pending: true })] });
    expect(await screen.findByText("Reembolso en revisión")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Solicitar reembolso" })).not.toBeInTheDocument();
  });

  it("sin ningún dato de cuenta no envía", async () => {
    const { user } = setup({ mine: [frozen()] });
    await user.click(await screen.findByRole("button", { name: "Solicitar reembolso" }));
    await user.click(await screen.findByRole("button", { name: "Enviar solicitud" }));
    expect(await screen.findByText(/Completa al menos un dato/)).toBeInTheDocument();
    expect(callsTo("post", /refund/)).toHaveLength(0);
  });

  it("con un dato envía la solicitud y refresca", async () => {
    mockApi("post", "/payments/request-refund-teacher-suspended", {});
    const { user } = setup({ mine: [frozen()] });
    await user.click(await screen.findByRole("button", { name: "Solicitar reembolso" }));
    await user.type(await screen.findByPlaceholderText("Banco"), "Banesco");
    await user.click(screen.getByRole("button", { name: "Enviar solicitud" }));
    await waitFor(() => expect(callsTo("post", "/payments/request-refund-teacher-suspended")).toHaveLength(1));
    expect(callsTo("post", "/payments/request-refund-teacher-suspended")[0].body).toMatchObject({ enrollment_id: 9 });
    expect(await screen.findByText(/Reembolso solicitado/)).toBeInTheDocument();
  });

  it("un error del servidor se avisa", async () => {
    const { user } = setup({ mine: [frozen()] }, () => mockApiError("post", "/payments/request-refund-teacher-suspended", 400, "Ya solicitado"));
    await user.click(await screen.findByRole("button", { name: "Solicitar reembolso" }));
    await user.type(await screen.findByPlaceholderText("Banco"), "Banesco");
    await user.click(screen.getByRole("button", { name: "Enviar solicitud" }));
    expect(await screen.findByText("Ya solicitado")).toBeInTheDocument();
  });
});
