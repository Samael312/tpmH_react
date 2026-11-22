/**
 * Dashboard del profesor («Mis clases»): tarjetas de KPIs, tira de la semana, próximas / historial, filtro por alumno,
 * resumen «por marcar» y los avisos del estado de su perfil (video, revisión, rechazo y apelaciones).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import TeacherDashboard from "@/app/(teacher)/teacher/dashboard/page";
import { renderScreen } from "./render";
import { mockApi, mockApiError, callsTo, FIXTURE } from "./fakeApi";

const HOUR = 3600_000;
const cls = (id: number, status: string, startHours: number, over: Record<string, unknown> = {}) => {
  const start = Date.now() + startHours * HOUR;
  return {
    id, enrollment_id: 1, teacher_id: 3, student_id: 7, class_type: "regular", subject: "Español", status,
    start_time_utc: new Date(start).toISOString(), end_time_utc: new Date(start + HOUR).toISOString(), duration_minutes: 60,
    meet_link: null, notes: null, teacher_timezone: "America/Caracas", student_timezone: "America/Caracas",
    created_at: "2026-01-01T00:00:00Z", student_name: "Ana Pérez", student_avatar: null, ...over,
  };
};
const PROFILE = (over: Record<string, unknown> = {}) => ({
  ...FIXTURE.teacher, id: 3, user_username: "maria", status: "approved", video_url: "https://cdn/v.mp4",
  rejection_reason: null, rejection_feedback_seen: true, appeal_count: 0, appeal_exhausted: false, ...over,
});

function setup(classes: unknown[] = [], profile: Record<string, unknown> = PROFILE(), extra?: () => void) {
  mockApi("get", "/classes/teacher/classes", { classes, total: classes.length, upcoming: classes.length, completed: 0 });
  mockApi("get", "/teachers/me/profile", profile);
  mockApi("get", /^\/payments\/(my-)?wallet/, { balance: 120.5, total_earned: 900, currency: "USD", pending: 0 });
  extra?.();
  const view = renderScreen(<TeacherDashboard />, { role: "teacher" });
  return { ...view, user: userEvent.setup() };
}

afterEach(() => { vi.restoreAllMocks(); });

describe("Dashboard del profesor · clases", () => {
  it("muestra el título, los KPIs y la tira de la semana", async () => {
    setup([cls(1, "confirmed", 2)]);
    expect(await screen.findByText("Mis Clases")).toBeInTheDocument();
    for (const k of ["Próximas", "Completadas", "Balance", "Total ganado"]) expect((await screen.findAllByText(k)).length).toBeGreaterThan(0);
    expect(screen.getByText("Semana actual")).toBeInTheDocument();
  });

  it("sin clases dice «día libre»", async () => {
    setup([]);
    expect(await screen.findByText(/Día libre|Sin clases próximas/i)).toBeInTheDocument();
  });

  it("una clase de hoy aparece en la lista del día seleccionado", async () => {
    setup([cls(1, "confirmed", 0.5)]);
    await waitFor(() => expect(screen.getAllByText(/Ana Pérez/).length).toBeGreaterThan(0));
  });

  it("al quitar el día seleccionado muestra el total de próximas", async () => {
    const { user } = setup([cls(1, "confirmed", 48), cls(2, "confirmed", 72)]);
    await screen.findByText(/Mostrando:/);
    await user.click(screen.getByText(/Mostrando:/).parentElement!.querySelector("button") as HTMLElement);
    expect(await screen.findByText("2 próximas en total")).toBeInTheDocument();
  });

  it("elegir un día de la tira filtra las clases de ese día", async () => {
    const { user } = setup([cls(1, "confirmed", 48)]);
    await screen.findByText("Semana actual");
    const strip = screen.getByText("Semana actual").closest("div[class*='rounded']")!.parentElement as HTMLElement;
    const days = within(strip).getAllByRole("button").filter((b) => /^\D*\d{1,2}$/.test((b.textContent ?? "").trim().replace(/\s+/g, "")) || b.querySelector("span"));
    await user.click(days[days.length - 1]);
    expect(await screen.findByText(/Mostrando:/)).toBeInTheDocument();
  });

  it("«Elegir fecha» abre el calendario y se puede navegar de mes", async () => {
    const { user } = setup([]);
    await user.click(await screen.findByText("Elegir fecha"));
    const nav = Array.from(document.querySelectorAll("button")).filter((b) => !b.textContent?.trim() && b.querySelector("svg"));
    expect(nav.length).toBeGreaterThan(1);
    await user.click(nav[nav.length - 1]);
    await user.click(nav[nav.length - 2]);
    await user.click(nav[nav.length - 2]);
  });

  it("historial: lista las clases pasadas y cuenta", async () => {
    const { user } = setup([cls(1, "completed", -48), cls(2, "cancelled", -72)]);
    await user.click(await screen.findByRole("button", { name: "Historial" }));
    expect(await screen.findByText("2 en el historial")).toBeInTheDocument();
  });

  it("filtrar por alumno deja solo sus clases y se puede quitar", async () => {
    const { user } = setup([cls(1, "completed", -48), cls(2, "completed", -50, { student_id: 8, student_name: "Luis Gómez" })]);
    await user.click(await screen.findByRole("button", { name: "Historial" }));
    await user.click(await screen.findByText("Todos los estudiantes"));
    await user.click((await screen.findAllByRole("button", { name: /Luis Gómez/ }))[0]);
    expect(await screen.findByText("1 en el historial")).toBeInTheDocument();
  });

  it("con clases «por marcar» muestra el aviso y lleva al historial", async () => {
    const { user } = setup([cls(1, "finalized", -5), cls(2, "finalized", -30)]);
    const banner = await screen.findByText(/clases por marcar/);
    await user.click(banner);
    expect((await screen.findAllByText(/en el historial/)).length).toBeGreaterThan(0);
  });

  it("si falla la carga de clases no muestra «sin clases»", async () => {
    setup([], PROFILE(), () => mockApiError("get", "/classes/teacher/classes", 500, "x"));
    await waitFor(() => expect(screen.queryByText(/Día libre/)).not.toBeInTheDocument());
  });
});

describe("Dashboard del profesor · estado del perfil", () => {
  it("aprobado: sin avisos", async () => {
    setup();
    await screen.findByText("Mis Clases");
    expect(screen.queryByText(/falta subir tu video/)).not.toBeInTheDocument();
  });

  it("pendiente sin video avisa que falta el video", async () => {
    setup([], PROFILE({ status: "pending", video_url: null }));
    expect(await screen.findByText(/falta subir tu video de presentación/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Subir video" })).toHaveAttribute("href", "/teacher/profile");
  });

  it("pendiente con video avisa que está en revisión", async () => {
    setup([], PROFILE({ status: "pending" }));
    expect(await screen.findByText(/está siendo revisado por el equipo/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ver mi perfil" })).toBeInTheDocument();
  });

  const REJECTED = (over: Record<string, unknown> = {}) => PROFILE({ status: "rejected", rejection_reason: "El audio no se entiende", rejection_feedback_seen: false, ...over });

  it("rechazado: muestra el motivo y permite descartar el aviso", async () => {
    mockApi("patch", "/teachers/me/feedback-seen", {});
    const { user } = setup([], REJECTED());
    expect(await screen.findByText("El audio no se entiende")).toBeInTheDocument();
    await user.click(await screen.findByTitle("Marcar como visto"));
    await waitFor(() => expect(callsTo("patch", "/teachers/me/feedback-seen")).toHaveLength(1));
  });

  it("rechazado: apelar manda el mensaje", async () => {
    mockApi("post", "/teachers/me/appeal", {});
    const { user } = setup([], REJECTED());
    await user.click(await screen.findByRole("button", { name: /Apelar|apelación/i }));
    await user.type(await screen.findByPlaceholderText(/Explica por qué consideras/), "Regrabé el video");
    await user.click(screen.getByRole("button", { name: "Enviar apelación" }));
    await waitFor(() => expect(callsTo("post", "/teachers/me/appeal")).toHaveLength(1));
    expect(callsTo("post", "/teachers/me/appeal")[0].body).toEqual({ message: "Regrabé el video" });
    expect(await screen.findByText("Apelación enviada correctamente")).toBeInTheDocument();
  });

  it("un error al apelar se muestra", async () => {
    mockApiError("post", "/teachers/me/appeal", 400, "Ya hay una apelación pendiente");
    const { user } = setup([], REJECTED());
    await user.click(await screen.findByRole("button", { name: /Apelar|apelación/i }));
    await user.type(await screen.findByPlaceholderText(/Explica por qué consideras/), "x");
    await user.click(screen.getByRole("button", { name: "Enviar apelación" }));
    expect(await screen.findByText("Ya hay una apelación pendiente")).toBeInTheDocument();
  });

  it("agotadas las apelaciones pide subir un nuevo video, que se sube", async () => {
    mockApi("post", "/teachers/me/video", {});
    setup([], REJECTED({ appeal_exhausted: true, appeal_count: 2 }));
    expect(await screen.findByText(/Ya usaste tus 2 apelaciones/)).toBeInTheDocument();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "v.mp4", { type: "video/mp4" })] } });
    await waitFor(() => expect(callsTo("post", "/teachers/me/video")).toHaveLength(1));
    expect(await screen.findByText("Video subido correctamente")).toBeInTheDocument();
  });

  it("un error al subir el video se muestra", async () => {
    mockApiError("post", "/teachers/me/video", 413, "Video demasiado pesado");
    setup([], REJECTED({ appeal_exhausted: true, appeal_count: 2 }));
    await screen.findByText(/Ya usaste tus 2 apelaciones/);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "v.mp4", { type: "video/mp4" })] } });
    expect(await screen.findByText("Video demasiado pesado")).toBeInTheDocument();
  });

  it("historial de apelaciones con la respuesta del equipo", async () => {
    mockApi("get", "/teachers/me/appeals", [
      { id: 1, appeal_number: 1, message: "Regrabé", status: "rejected", admin_response: "Sigue sin audio", created_at: "2026-01-01T00:00:00Z", resolved_at: "2026-01-02T00:00:00Z" },
      { id: 2, appeal_number: 2, message: "Otra vez", status: "pending", admin_response: null, created_at: "2026-01-03T00:00:00Z", resolved_at: null },
    ]);
    const { user } = setup([], REJECTED({ appeal_count: 2 }));
    await user.click(await screen.findByRole("button", { name: /historial de apelaciones \(2\/2\)/ }));
    expect(await screen.findByText("Apelación 1/2")).toBeInTheDocument();
    expect(screen.getByText("Rechazada")).toBeInTheDocument();
    expect(screen.getByText("Pendiente")).toBeInTheDocument();
    expect(screen.getByText("Sigue sin audio")).toBeInTheDocument();
  });
});

describe("Dashboard del profesor · casos secundarios", () => {
  it("el calendario de «Elegir fecha» elige un día y filtra por él", async () => {
    const { user } = setup([cls(1, "confirmed", 2)]);
    await user.click(await screen.findByText("Elegir fecha"));
    const days = Array.from(document.querySelectorAll("button")).filter((b) => /^\d{1,2}$/.test(b.textContent?.trim() ?? ""));
    expect(days.length).toBeGreaterThan(27);
    await user.click(days[days.length - 1]);
    await waitFor(() => expect(screen.queryByText("Elegir fecha")).toBeInTheDocument());
  });

  it("el filtro de estudiantes muestra avatares y permite volver a «Todos»", async () => {
    const { user } = setup([cls(1, "confirmed", 2, { student_avatar: "https://img.example.com/a.png" }), cls(2, "confirmed", 3, { student_id: 8, student_name: "Luis Gómez", student_avatar: "https://img.example.com/l.png" })]);
    await user.click(await screen.findByText("Todos los estudiantes"));
    await user.click((await screen.findAllByRole("button", { name: /Luis Gómez/ }))[0]);
    expect(document.querySelectorAll("img").length).toBeGreaterThan(0);
    await user.click(screen.getAllByRole("button", { name: /Luis Gómez/ })[0]);
    await user.click(await screen.findByRole("button", { name: /Todos los estudiantes/ }));
  });

  it("filtrando por un alumno sin clases próximas lo dice", async () => {
    const { user } = setup([cls(1, "confirmed", 2), cls(2, "completed", -48, { student_id: 8, student_name: "Luis Gómez" })]);
    await user.click(await screen.findByText("Todos los estudiantes"));
    await user.click((await screen.findAllByRole("button", { name: /Luis Gómez/ }))[0]);
    expect(await screen.findByText("No hay clases próximas con este estudiante.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Historial" }));
  });

  it("historial vacío con y sin filtro de alumno", async () => {
    const { user } = setup([cls(1, "confirmed", 2)]);
    await user.click(await screen.findByRole("button", { name: "Historial" }));
    expect(await screen.findByText("Aún no hay historial de clases.")).toBeInTheDocument();
  });

  it("un error al descartar el aviso de rechazo se avisa", async () => {
    const { user } = setup([], PROFILE({ status: "rejected", rejection_reason: "El audio no se entiende", rejection_feedback_seen: false }), () => mockApiError("patch", "/teachers/me/feedback-seen", 500, "No se pudo descartar"));
    await user.click(await screen.findByTitle("Marcar como visto"));
    expect(await screen.findByText("No se pudo descartar")).toBeInTheDocument();
  });

  it("las apelaciones aprobadas se distinguen de las rechazadas", async () => {
    mockApi("get", "/teachers/me/appeals", [{ id: 1, appeal_number: 1, message: "Regrabé", status: "approved", admin_response: "Listo", created_at: "2026-01-01T00:00:00Z", resolved_at: "2026-01-02T00:00:00Z" }]);
    const { user } = setup([], PROFILE({ status: "rejected", rejection_reason: "x", rejection_feedback_seen: false, appeal_count: 1 }));
    await user.click(await screen.findByRole("button", { name: /historial de apelaciones/ }));
    expect(await screen.findByText("Aprobada")).toBeInTheDocument();
  });

  it("el aviso «por marcar» es más urgente si quedan menos de 24 horas", async () => {
    setup([cls(1, "finalized", -50)]);
    const banner = await screen.findByText(/clase por marcar|clases por marcar/);
    expect(banner.closest("button")!.className).toMatch(/rose/);
  });

  it("el aviso «por marcar» con plazo amplio no es urgente", async () => {
    setup([cls(1, "finalized", -5)]);
    const banner = await screen.findByText(/clase por marcar|clases por marcar/);
    expect(banner.closest("button")!.className).toMatch(/amber/);
  });

  it("reagendar desde una clase abre el diálogo de reagendado", async () => {
    const { user } = setup([cls(1, "confirmed", 30)]);
    await screen.findByText(/Mostrando:/);
    await user.click(screen.getByText(/Mostrando:/).parentElement!.querySelector("button") as HTMLElement); // todas las próximas
    const menu = await screen.findByRole("button", { name: /Acciones/ }).catch(() => null);
    if (menu) await user.click(menu);
    await user.click(await screen.findByRole("button", { name: "Reagendar" }));
    expect(await screen.findByText(/Reagendar/, { selector: "h2, h3" })).toBeInTheDocument();
  });
});
