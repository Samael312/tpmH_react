/**
 * Directorio de profesores · cierra huecos: acciones del detalle (rechazar, suspender, reactivar y su error), cierres
 * de los diálogos de motivo, ampliar el video y cerrarlo pulsando fuera, apelaciones de video, reintentos y el
 * filtro «solo con video».
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { screen, waitFor, within } from "@testing-library/react";
import TeachersPage from "@/app/(superadmin)/admin/teachers/page";
import { renderScreen } from "./render";
import { mockApi, mockApiError, callsTo } from "./fakeApi";

const T = (over: Record<string, unknown> = {}) => ({
  id: 7, username: "maria", name: "María", surname: "Gómez", phone_number: "+58 412 0000000", nationality: "Venezuela",
  profile_photo_url: null, email: "m@x.com", status: "approved", commission_rate: 0.2, balance: 120.5, has_pending_appeal: false,
  video_url: "https://cdn/v.mp4", video_pending_url: null, video_pending_rejection_reason: null, total_classes: 10, total_students: 3,
  created_at: "2026-01-01T00:00:00Z", rejection_reason: null, appeal_exhausted: false, ...over,
});
function setup(teachers: unknown[] = [T()], extra?: () => void) {
  mockApi("get", /^\/admin\/teachers(\?.*)?$/, teachers);
  extra?.();
  const view = renderScreen(<TeachersPage />, { role: "superadmin" });
  return { ...view, user: userEvent.setup() };
}
const openDetail = async (user: ReturnType<typeof userEvent.setup>) => { await user.click(await screen.findByText(/María Gómez/)); };
const card = (name: RegExp) => screen.getByText(name).closest("div[class*='rounded']")!.parentElement as HTMLElement;

afterEach(() => { vi.restoreAllMocks(); window.history.replaceState({}, "", "/"); });

describe("Admin · profesores · acciones desde el detalle", () => {
  it("un profesor aprobado se suspende desde el detalle", async () => {
    mockApi("patch", "/admin/teachers/7/status", {});
    const { user } = setup();
    await openDetail(user);
    await user.click((await screen.findAllByRole("button", { name: "Suspender" })).at(-1)!);
    await waitFor(() => expect(callsTo("patch", "/admin/teachers/7/status")[0].body).toEqual({ status: "suspended" }));
    expect(await screen.findByText("Estado del profesor actualizado")).toBeInTheDocument();
  });

  it("un profesor suspendido se reactiva desde el detalle", async () => {
    mockApi("patch", "/admin/teachers/7/status", {});
    const { user } = setup([T({ status: "suspended" })]);
    await openDetail(user);
    await user.click((await screen.findAllByRole("button", { name: "Reactivar" })).at(-1)!);
    await waitFor(() => expect(callsTo("patch", "/admin/teachers/7/status")[0].body).toEqual({ status: "approved" }));
  });

  it("un error al cambiar el estado desde el detalle se avisa", async () => {
    mockApiError("patch", "/admin/teachers/7/status", 409, "Ya cambió de estado");
    const { user } = setup();
    await openDetail(user);
    await user.click((await screen.findAllByRole("button", { name: "Suspender" })).at(-1)!);
    expect(await screen.findByText("Ya cambió de estado")).toBeInTheDocument();
  });

  it("rechazar desde el detalle abre el motivo; Cancelar lo cierra y con motivo rechaza", async () => {
    mockApi("patch", "/admin/teachers/7/status", {});
    const { user } = setup([T({ status: "pending" })]);
    await openDetail(user);
    const reject = async () => user.click((await screen.findAllByRole("button", { name: "Rechazar" })).at(-1)!);
    await reject();
    await screen.findByText("Rechazar profesor");
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByText("Rechazar profesor")).not.toBeInTheDocument());
    await reject();
    await user.type(await screen.findByPlaceholderText(/Explica brevemente/), "Sin audio");
    await user.click(screen.getByRole("button", { name: /Confirmar rechazo/ }));
    await waitFor(() => expect(callsTo("patch", "/admin/teachers/7/status")).toHaveLength(1));
    expect(callsTo("patch", "/admin/teachers/7/status")[0].body).toEqual({ status: "rejected", reason: "Sin audio" });
  });

  it("el diálogo de rechazar un video nuevo se cierra con Cancelar sin llamar", async () => {
    const { user } = setup([T({ video_pending_url: "https://cdn/nuevo.mp4" })]);
    await openDetail(user);
    await user.click(await screen.findByRole("button", { name: "Rechazar video" }));
    await screen.findByText("Rechazar video nuevo");
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByText("Rechazar video nuevo")).not.toBeInTheDocument());
    expect(callsTo("patch", "/admin/teachers/7/pending-video/reject")).toHaveLength(0);
  });

  it("el video ampliado también se cierra pulsando fuera", async () => {
    const { user } = setup();
    await openDetail(user);
    await user.click(await screen.findByRole("button", { name: /Ampliar/ }));
    const overlay = document.querySelector("video[autoplay]")!.closest("div[class*='fixed']") as HTMLElement;
    await user.click(overlay);
    await waitFor(() => expect(document.querySelectorAll("video").length).toBe(1));
  });
});

describe("Admin · profesores · apelaciones", () => {
  it("si fallan, Reintentar las vuelve a pedir; una apelación de video y el rechazo se muestran", async () => {
    mockApiError("get", "/admin/teachers/7/appeals", 500, "x");
    mockApi("patch", "/admin/appeals/4/resolve", {});
    const { user } = setup([T({ status: "rejected", rejection_reason: "Sin audio", has_pending_appeal: true })]);
    await openDetail(user);
    const retry = await screen.findByRole("button", { name: "Reintentar" });
    mockApi("get", "/admin/teachers/7/appeals", [{ id: 4, appeal_number: 1, kind: "video", message: "Regrabé", status: "pending", admin_response: null, created_at: "2026-01-01T00:00:00Z", resolved_at: null }]);
    await user.click(retry);
    expect(await screen.findByText("Apelación de video nuevo")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Rechazar apelación" }));
    expect(await screen.findByText("Apelación rechazada correctamente")).toBeInTheDocument();
  });
});

describe("Admin · profesores · lista", () => {
  it("el filtro «solo con video sin revisar» se marca y desmarca", async () => {
    const { user } = setup();
    await screen.findByText(/María Gómez/);
    const box = screen.getByLabelText(/Solo con video sin revisar/) as HTMLInputElement;
    await user.click(box);
    expect(box.checked).toBe(true);
    await user.click(box);
    expect(box.checked).toBe(false);
  });

  it("Reintentar vuelve a pedir el directorio", async () => {
    const { user } = setup([], () => mockApiError("get", /^\/admin\/teachers/, 500, "x"));
    const retry = await screen.findByRole("button", { name: /Reintentar/ });
    mockApi("get", /^\/admin\/teachers(\?.*)?$/, [T()]);
    await user.click(retry);
    expect(await screen.findByText(/María Gómez/)).toBeInTheDocument();
  });

  it("el diálogo de rechazar de la tarjeta se cierra con Cancelar", async () => {
    const { user } = setup([T({ status: "pending" })]);
    await screen.findByText(/María Gómez/);
    await user.click(within(card(/María Gómez/)).getByRole("button", { name: "Rechazar" }));
    await screen.findByText("Rechazar profesor");
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByText("Rechazar profesor")).not.toBeInTheDocument());
  });

  it("un estado desconocido se muestra tal cual", async () => {
    setup([T({ status: "en_pausa" })]);
    expect(await screen.findByText("en_pausa")).toBeInTheDocument();
  });
});
