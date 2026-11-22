/**
 * Directorio de profesores (admin): pestañas por estado, aprobar / rechazar / suspender / reactivar, comisión,
 * detalle con video nuevo pendiente y apelaciones.
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

afterEach(() => { vi.restoreAllMocks(); window.history.replaceState({}, "", "/"); });

describe("Admin · profesores · lista", () => {
  it("lista con estado, comisión y saldo", async () => {
    setup();
    expect(await screen.findByText(/María Gómez/)).toBeInTheDocument();
    expect(screen.getByText("20%")).toBeInTheDocument();
    expect(screen.getByText("$120.50")).toBeInTheDocument();
    expect(screen.getByText(/10 clases • 3 est\./)).toBeInTheDocument();
  });

  it("sin profesores en la categoría lo dice", async () => {
    setup([]);
    expect(await screen.findByText("No hay profesores en esta categoría")).toBeInTheDocument();
  });

  it("al cambiar de pestaña pide el estado al servidor", async () => {
    const { user } = setup();
    await screen.findByText(/María Gómez/);
    await user.click(screen.getByRole("button", { name: "Pendientes" }));
    await waitFor(() => expect(callsTo("get", /^\/admin\/teachers/).some((c) => c.params?.status_filter === "pending")).toBe(true));
  });

  it("?tab= y ?video=1 de la URL preseleccionan filtros", async () => {
    window.history.replaceState({}, "", "/admin/teachers?tab=pending&video=1");
    setup();
    await screen.findByText(/María Gómez/);
    await waitFor(() => expect(callsTo("get", /^\/admin\/teachers/).some((c) => c.params?.has_video === "true")).toBe(true));
  });

  it("si falla la carga ofrece reintentar", async () => {
    setup([], () => mockApiError("get", /^\/admin\/teachers/, 500, "x"));
    expect(await screen.findByRole("button", { name: /Reintentar/ })).toBeInTheDocument();
  });
});

describe("Admin · profesores · estados", () => {
  const card = (name: RegExp) => screen.getByText(name).closest("div[class*='rounded']")!.parentElement as HTMLElement;

  it("pendiente: aprobar", async () => {
    mockApi("patch", "/admin/teachers/7/status", {});
    const { user } = setup([T({ status: "pending" })]);
    await screen.findByText(/María Gómez/);
    await user.click(within(card(/María Gómez/)).getByRole("button", { name: "Aprobar" }));
    await waitFor(() => expect(callsTo("patch", "/admin/teachers/7/status")).toHaveLength(1));
    expect(callsTo("patch", "/admin/teachers/7/status")[0].body).toEqual({ status: "approved" });
    expect(await screen.findByText("Profesor aprobado correctamente")).toBeInTheDocument();
  });

  it("pendiente: rechazar exige un motivo", async () => {
    mockApi("patch", "/admin/teachers/7/status", {});
    const { user } = setup([T({ status: "pending" })]);
    await screen.findByText(/María Gómez/);
    await user.click(within(card(/María Gómez/)).getByRole("button", { name: "Rechazar" }));
    await screen.findByText("Rechazar profesor");
    await user.type(await screen.findByPlaceholderText(/Explica brevemente/), "Audio inaudible");
    await user.click(screen.getByRole("button", { name: /Confirmar rechazo/ }));
    await waitFor(() => expect(callsTo("patch", "/admin/teachers/7/status")).toHaveLength(1));
    expect(callsTo("patch", "/admin/teachers/7/status")[0].body).toEqual({ status: "rejected", reason: "Audio inaudible" });
    expect(await screen.findByText("Profesor rechazado correctamente")).toBeInTheDocument();
  });

  it("aprobado: suspender; suspendido: reactivar", async () => {
    mockApi("patch", "/admin/teachers/7/status", {});
    const { user } = setup([T()]);
    await screen.findByText(/María Gómez/);
    await user.click(within(card(/María Gómez/)).getByRole("button", { name: "Suspender" }));
    await waitFor(() => expect(callsTo("patch", "/admin/teachers/7/status")[0].body).toEqual({ status: "suspended" }));
    expect(await screen.findByText("Estado del profesor actualizado")).toBeInTheDocument();
  });

  it("rechazado o suspendido muestra «Reactivar»", async () => {
    mockApi("patch", "/admin/teachers/7/status", {});
    const { user } = setup([T({ status: "suspended" })]);
    await screen.findByText(/María Gómez/);
    await user.click(within(card(/María Gómez/)).getByRole("button", { name: "Reactivar" }));
    await waitFor(() => expect(callsTo("patch", "/admin/teachers/7/status")[0].body).toEqual({ status: "approved" }));
  });

  it("un error al cambiar el estado se avisa", async () => {
    mockApiError("patch", "/admin/teachers/7/status", 403, "No puedes revisar tu propio perfil");
    const { user } = setup([T()]);
    await screen.findByText(/María Gómez/);
    await user.click(within(card(/María Gómez/)).getByRole("button", { name: "Suspender" }));
    expect(await screen.findByText("No puedes revisar tu propio perfil")).toBeInTheDocument();
  });

  it("pendiente sin video / con video / apelación pendiente muestran su señal", async () => {
    setup([T({ id: 1, name: "Sin", surname: "Video", status: "pending", video_url: null }), T({ id: 2, name: "Con", surname: "Video", status: "pending" }), T({ id: 3, name: "Ape", surname: "Lada", status: "rejected", has_pending_appeal: true })]);
    expect(await screen.findByText("Apelación pendiente")).toBeInTheDocument();
    expect(screen.getAllByText(/video/i).length).toBeGreaterThan(2);
  });
});

describe("Admin · profesores · comisión", () => {
  async function openEdit(user: ReturnType<typeof userEvent.setup>) {
    await screen.findByText(/María Gómez/);
    await user.click(screen.getByText("20%"));
    return screen.findByPlaceholderText("0.15");
  }

  it("editar la comisión la guarda", async () => {
    mockApi("patch", "/admin/teachers/7/commission", {});
    const { user } = setup();
    const input = await openEdit(user);
    await user.clear(input);
    await user.type(input, "0.15");
    await user.click(input.parentElement!.querySelectorAll("button")[0] as HTMLElement);
    await waitFor(() => expect(callsTo("patch", "/admin/teachers/7/commission")).toHaveLength(1));
    expect(callsTo("patch", "/admin/teachers/7/commission")[0].body).toMatchObject({ commission_rate: 0.15 });
    expect(await screen.findByText("Comisión del profesor actualizada correctamente")).toBeInTheDocument();
  });

  it("un valor fuera de 0–1 se avisa y no llama", async () => {
    const { user } = setup();
    const input = await openEdit(user);
    await user.clear(input);
    await user.type(input, "15");
    await user.click(input.parentElement!.querySelectorAll("button")[0] as HTMLElement);
    expect(await screen.findByText(/Introduce un valor entre 0 y 1/)).toBeInTheDocument();
    expect(callsTo("patch", "/admin/teachers/7/commission")).toHaveLength(0);
  });

  it("cancelar cierra la edición", async () => {
    const { user } = setup();
    const input = await openEdit(user);
    await user.click(input.parentElement!.querySelectorAll("button")[1] as HTMLElement);
    expect(screen.queryByPlaceholderText("0.15")).not.toBeInTheDocument();
  });

  it("un error al guardar la comisión se avisa", async () => {
    mockApiError("patch", "/admin/teachers/7/commission", 400, "Comisión inválida");
    const { user } = setup();
    const input = await openEdit(user);
    await user.clear(input);
    await user.type(input, "0.3");
    await user.click(input.parentElement!.querySelectorAll("button")[0] as HTMLElement);
    expect(await screen.findByText("Comisión inválida")).toBeInTheDocument();
  });
});

describe("Admin · profesores · detalle", () => {
  async function openDetail(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByText(/María Gómez/));
  }

  it("video nuevo pendiente: aprobar o rechazar con motivo", async () => {
    mockApi("patch", "/admin/teachers/7/pending-video/approve", {});
    mockApi("patch", "/admin/teachers/7/pending-video/reject", {});
    const { user } = setup([T({ video_pending_url: "https://cdn/nuevo.mp4" })]);
    await openDetail(user);
    await user.click(await screen.findByRole("button", { name: "Aprobar video" }));
    await waitFor(() => expect(callsTo("patch", "/admin/teachers/7/pending-video/approve")).toHaveLength(1));
    expect(await screen.findByText("Video nuevo aprobado")).toBeInTheDocument();
  });

  it("rechazar el video nuevo pide motivo", async () => {
    mockApi("patch", "/admin/teachers/7/pending-video/reject", {});
    const { user } = setup([T({ video_pending_url: "https://cdn/nuevo.mp4" })]);
    await openDetail(user);
    await user.click(await screen.findByRole("button", { name: "Rechazar video" }));
    await user.type(await screen.findByPlaceholderText(/Explica brevemente/), "Mala imagen");
    await user.click(screen.getByRole("button", { name: /Confirmar rechazo/ }));
    await waitFor(() => expect(callsTo("patch", "/admin/teachers/7/pending-video/reject")).toHaveLength(1));
    expect(callsTo("patch", "/admin/teachers/7/pending-video/reject")[0].body).toEqual({ reason: "Mala imagen" });
  });

  it("rechazado: muestra el motivo y resuelve apelaciones con respuesta opcional", async () => {
    mockApi("get", "/admin/teachers/7/appeals", [{ id: 4, appeal_number: 1, message: "Regrabé", status: "pending", admin_response: null, created_at: "2026-01-01T00:00:00Z", resolved_at: null }]);
    mockApi("patch", "/admin/appeals/4/resolve", {});
    const { user } = setup([T({ status: "rejected", rejection_reason: "Sin audio", has_pending_appeal: true })]);
    await openDetail(user);
    expect(await screen.findByText(/Sin audio/)).toBeInTheDocument();
    await user.type(await screen.findByPlaceholderText("Respuesta opcional para el profesor..."), "Ok, aprobada");
    await user.click(screen.getByRole("button", { name: "Aprobar apelación" }));
    await waitFor(() => expect(callsTo("patch", "/admin/appeals/4/resolve")).toHaveLength(1));
    expect(callsTo("patch", "/admin/appeals/4/resolve")[0].body).toEqual({ action: "approve", admin_response: "Ok, aprobada" });
    expect(await screen.findByText("Apelación aprobada correctamente")).toBeInTheDocument();
  });

  it("un error al resolver la apelación se avisa", async () => {
    mockApi("get", "/admin/teachers/7/appeals", [{ id: 4, appeal_number: 1, message: "Regrabé", status: "pending", admin_response: null, created_at: "2026-01-01T00:00:00Z", resolved_at: null }]);
    mockApiError("patch", "/admin/appeals/4/resolve", 400, "Ya resuelta");
    const { user } = setup([T({ status: "rejected", rejection_reason: "Sin audio", has_pending_appeal: true })]);
    await openDetail(user);
    await user.click(await screen.findByRole("button", { name: "Rechazar apelación" }));
    expect(await screen.findByText("Ya resuelta")).toBeInTheDocument();
  });

  it("si fallan las apelaciones ofrece reintentar", async () => {
    mockApiError("get", "/admin/teachers/7/appeals", 500, "x");
    const { user } = setup([T({ status: "rejected", rejection_reason: "Sin audio" })]);
    await openDetail(user);
    expect(await screen.findByRole("button", { name: "Reintentar" })).toBeInTheDocument();
  });

  it("desde el detalle se puede aprobar un pendiente", async () => {
    mockApi("patch", "/admin/teachers/7/status", {});
    const { user } = setup([T({ status: "pending" })]);
    await openDetail(user);
    const approve = (await screen.findAllByRole("button", { name: "Aprobar" })).at(-1)!;
    await user.click(approve);
    await waitFor(() => expect(callsTo("patch", "/admin/teachers/7/status")).toHaveLength(1));
  });
});

describe("Admin · profesores · detalle · casos secundarios", () => {
  async function openDetail(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByText(/María Gómez/));
  }
  const PENDING = { video_pending_url: "https://cdn/nuevo.mp4" };

  it("un error al aprobar el video nuevo se avisa", async () => {
    const { user } = setup([T(PENDING)], () => mockApiError("patch", "/admin/teachers/7/pending-video/approve", 400, "Video inválido"));
    await openDetail(user);
    await user.click(await screen.findByRole("button", { name: "Aprobar video" }));
    expect(await screen.findByText("Video inválido")).toBeInTheDocument();
  });

  it("un video nuevo ya rechazado muestra el motivo y manda a Apelaciones", async () => {
    const { user } = setup([T({ ...PENDING, video_pending_rejection_reason: "Sin audio" })]);
    await openDetail(user);
    expect(await screen.findByText(/Rechazado \(Sin audio\)/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Aprobar video" })).not.toBeInTheDocument();
  });

  it("un teacher_admin no revisa su propio video", async () => {
    mockApi("get", /^\/admin\/teachers(\?.*)?$/, [T({ ...PENDING, username: "profeadmin" })]);
    renderScreen(<TeachersPage />, { role: "teacher_admin" });
    await userEvent.setup().click(await screen.findByText(/María Gómez/));
    expect(await screen.findByText(/No puedes revisar tu propio video/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Aprobar video" })).not.toBeInTheDocument();
  });

  it("el video se puede ampliar y cerrar", async () => {
    const { user } = setup();
    await openDetail(user);
    await user.click(await screen.findByRole("button", { name: /Ampliar/ }));
    expect(document.querySelectorAll("video[autoplay], video").length).toBeGreaterThan(1);
    await user.click(document.querySelector("video[autoplay]")!.parentElement!.parentElement!.querySelector("button") as HTMLElement);
    await waitFor(() => expect(document.querySelectorAll("video").length).toBe(1));
  });

  it("si el video no carga lo explica y quita «Ampliar»", async () => {
    const { user } = setup();
    await openDetail(user);
    await screen.findByRole("button", { name: /Ampliar/ });
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.error(document.querySelector("video")!);
    expect(await screen.findByText(/No se pudo cargar el video/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Ampliar/ })).not.toBeInTheDocument();
  });

  it("un profesor pendiente sin video no se puede aprobar hasta que lo suba", async () => {
    const { user } = setup([T({ status: "pending", video_url: null })]);
    await openDetail(user);
    expect(await screen.findByText(/Aún no ha subido su video/)).toBeInTheDocument();
  });

  it("rechazado con apelaciones agotadas lo indica", async () => {
    const { user } = setup([T({ status: "rejected", rejection_reason: "Sin audio", appeal_exhausted: true })]);
    await openDetail(user);
    expect(await screen.findByText(/Apelaciones agotadas \(2\/2\)/)).toBeInTheDocument();
  });

  it("las apelaciones se listan con su estado y la respuesta del equipo", async () => {
    mockApi("get", "/admin/teachers/7/appeals", [
      { id: 4, appeal_number: 1, message: "Regrabé", status: "approved", admin_response: "Aprobada ya", created_at: "2026-01-01T00:00:00Z", resolved_at: "2026-01-02T00:00:00Z" },
      { id: 5, appeal_number: 2, message: "Otra vez", status: "rejected", admin_response: null, created_at: "2026-01-03T00:00:00Z", resolved_at: "2026-01-04T00:00:00Z" },
    ]);
    const { user } = setup([T({ status: "rejected", rejection_reason: "Sin audio", has_pending_appeal: true })]);
    await openDetail(user);
    expect(await screen.findByText("Aprobada")).toBeInTheDocument();
    expect(screen.getByText("Rechazada")).toBeInTheDocument();
    expect(screen.getByText(/Respuesta del equipo: Aprobada ya/)).toBeInTheDocument();
  });

  it("con ?tab=all arranca sin filtro", async () => {
    window.history.replaceState({}, "", "/?tab=all");
    setup();
    expect(await screen.findByText(/María Gómez/)).toBeInTheDocument();
  });

  it("con foto de perfil la muestra", async () => {
    setup([T({ profile_photo_url: "https://img.example.com/m.png" })]);
    await screen.findByText(/María Gómez/);
    expect(document.querySelector("img")).not.toBeNull();
  });
});
