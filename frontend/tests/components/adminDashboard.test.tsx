/**
 * Panel del administrador: notificaciones (marcar leída / todas), pagos por confirmar (aprobar y rechazar con motivo),
 * estadísticas y profesores pendientes, cada bloque con su estado de error, vacío y carga.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { screen, waitFor } from "@testing-library/react";
import AdminDashboard from "@/app/(superadmin)/admin/dashboard/page";
import { renderScreen } from "./render";
import { mockApi, mockApiError, callsTo } from "./fakeApi";

const STATS = {
  total_users: 1200, total_students: 900, total_teachers: 40, total_teachers_pending: 3, total_teachers_approved: 35, total_classes: 5000,
  classes_this_month: 120, classes_completed: 4000, classes_cancelled: 50, total_revenue: 12345.5, total_paid_to_teachers: 8000,
  total_platform_earnings: 2000, pending_withdrawals: 300, new_users_this_week: 15, new_classes_this_week: 80,
};
const NOTIF = (id: number, type: string, over: Record<string, unknown> = {}) => ({
  id, type, title: `Aviso ${id}`, message: `Detalle ${id}`, related_teacher_id: null, related_support_ticket_id: null, is_read: false, created_at: "2026-03-01T10:00:00Z", ...over,
});
const PAY = (id: number, over: Record<string, unknown> = {}) => ({
  payment_id: id, payment_type: "single_class", installment_index: null, student_name: `Alumno ${id}`, student_username: `al${id}`, amount: 25, payment_expires_at: "2026-12-01T10:00:00Z", ...over,
});

function setup(o: { stats?: unknown; notifs?: unknown[]; pays?: unknown[] } = {}, extra?: () => void) {
  mockApi("get", "/admin/stats", o.stats ?? STATS);
  mockApi("get", /^\/admin\/notifications\?/, o.notifs ?? []);
  mockApi("get", "/payments/pending-review", o.pays ?? []);
  extra?.();
  const view = renderScreen(<AdminDashboard />, { role: "superadmin" });
  return { ...view, user: userEvent.setup() };
}
afterEach(() => { vi.restoreAllMocks(); });

describe("Panel admin · estadísticas y profesores pendientes", () => {
  it("muestra los totales y avisa de los profesores por revisar", async () => {
    setup();
    expect(await screen.findByText(/^1[.,202f00a0 ]?200$/)).toBeInTheDocument();
    expect(screen.getByText("+15 esta semana")).toBeInTheDocument();
    expect(screen.getByText("Requieren revisión")).toBeInTheDocument();
    expect(screen.getByText("$12,345.50")).toBeInTheDocument();
    expect(screen.getByText(/profesor\(es\)/)).toBeInTheDocument();
  });

  it("sin profesores pendientes lo dice", async () => {
    setup({ stats: { ...STATS, total_teachers_pending: 0, classes_cancelled: 0 } });
    expect(await screen.findByText("Sin profesores pendientes ✅")).toBeInTheDocument();
  });

  it("si fallan las estadísticas ofrece reintentar", async () => {
    const { user } = setup({}, () => mockApiError("get", "/admin/stats", 500, "x"));
    const retry = (await screen.findAllByRole("button", { name: /Reintentar/ }))[0];
    const before = callsTo("get", "/admin/stats").length;
    await user.click(retry);
    await waitFor(() => expect(callsTo("get", "/admin/stats").length).toBeGreaterThan(before));
  });
});

describe("Panel admin · notificaciones", () => {
  it("sin notificaciones dice que está al día", async () => {
    setup();
    expect(await screen.findByText(/Estás al día/)).toBeInTheDocument();
  });

  it("cada tipo lleva a su pantalla y «Marcar leída» llama a la API", async () => {
    mockApi("patch", "/admin/notifications/1/read", {});
    const { user } = setup({ notifs: [NOTIF(1, "teacher_pending"), NOTIF(2, "support_ticket"), NOTIF(3, "manual_grant_request"), NOTIF(4, "otro")] });
    await screen.findByText("Aviso 1");
    const hrefs = screen.getAllByRole("link", { name: "Revisar" }).map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/admin/teachers?tab=pending&video=1", "/admin/support", "/admin/payments", "/admin/support"]);
    await user.click(screen.getAllByRole("button", { name: "Marcar leída" })[0]);
    await waitFor(() => expect(callsTo("patch", "/admin/notifications/1/read")).toHaveLength(1));
  });

  it("un error al marcar una se avisa", async () => {
    const { user } = setup({ notifs: [NOTIF(1, "support_ticket")] }, () => mockApiError("patch", "/admin/notifications/1/read", 500, "Falló"));
    await user.click(await screen.findByRole("button", { name: "Marcar leída" }));
    expect(await screen.findByText("Falló")).toBeInTheDocument();
  });

  it("«Marcar todas como leídas» avisa y un error también", async () => {
    mockApi("post", "/admin/notifications/mark-all-read", {});
    const { user } = setup({ notifs: [NOTIF(1, "support_ticket")] });
    await user.click(await screen.findByRole("button", { name: /Marcar todas como leídas/ }));
    expect(await screen.findByText("Todas las notificaciones marcadas como leídas")).toBeInTheDocument();
  });

  it("un error al marcar todas se avisa", async () => {
    const { user } = setup({ notifs: [NOTIF(1, "support_ticket")] }, () => mockApiError("post", "/admin/notifications/mark-all-read", 500, "No se pudo"));
    await user.click(await screen.findByRole("button", { name: /Marcar todas como leídas/ }));
    expect(await screen.findByText("No se pudo")).toBeInTheDocument();
  });

  it("si no cargan ofrece reintentar", async () => {
    const { user } = setup({}, () => mockApiError("get", /^\/admin\/notifications\?/, 500, "x"));
    await screen.findByText("No se pudieron cargar las notificaciones.");
    const before = callsTo("get", /^\/admin\/notifications\?/).length;
    await user.click(screen.getAllByRole("button", { name: /Reintentar/ }).at(-1)!);
    await waitFor(() => expect(callsTo("get", /^\/admin\/notifications\?/).length).toBeGreaterThan(before));
  });
});

describe("Panel admin · pagos por confirmar", () => {
  it("sin pagos pendientes lo dice", async () => {
    setup();
    expect(await screen.findByText("Sin pagos pendientes ✅")).toBeInTheDocument();
  });

  it("aprobar pide confirmación, valida con approve y avisa", async () => {
    mockApi("patch", "/payments/7/validate", {});
    const { user } = setup({ pays: [PAY(7)] });
    await screen.findByText("Alumno 7");
    await user.click(screen.getByRole("button", { name: "Confirmar" }));
    await user.click(await screen.findByRole("button", { name: "Aprobar pago" }));
    await waitFor(() => expect(callsTo("patch", "/payments/7/validate")).toHaveLength(1));
    expect(callsTo("patch", "/payments/7/validate")[0].body).toEqual({ action: "approve" });
    expect(await screen.findByText("Pago aprobado correctamente")).toBeInTheDocument();
  });

  it("un error al aprobar se avisa", async () => {
    const { user } = setup({ pays: [PAY(7)] }, () => mockApiError("patch", "/payments/7/validate", 400, "Ya validado"));
    await user.click(await screen.findByRole("button", { name: "Confirmar" }));
    await user.click(await screen.findByRole("button", { name: "Aprobar pago" }));
    expect(await screen.findByText("Ya validado")).toBeInTheDocument();
  });

  it("rechazar exige un motivo y lo envía", async () => {
    mockApi("patch", "/payments/7/validate", {});
    const { user } = setup({ pays: [PAY(7, { payment_expires_at: null })] });
    await user.click(await screen.findByRole("button", { name: "Rechazar" }));
    await user.type(await screen.findByPlaceholderText(/Explica brevemente/), "Comprobante ilegible");
    await user.click(screen.getByRole("button", { name: "Confirmar rechazo" }));
    await waitFor(() => expect(callsTo("patch", "/payments/7/validate")).toHaveLength(1));
    expect(callsTo("patch", "/payments/7/validate")[0].body).toEqual({ action: "reject", rejection_reason: "Comprobante ilegible" });
    expect(await screen.findByText("Pago rechazado correctamente")).toBeInTheDocument();
  });

  it("un error al rechazar se avisa", async () => {
    const { user } = setup({ pays: [PAY(7)] }, () => mockApiError("patch", "/payments/7/validate", 400, "No se pudo rechazar"));
    await user.click(await screen.findByRole("button", { name: "Rechazar" }));
    await user.type(await screen.findByPlaceholderText(/Explica brevemente/), "Motivo");
    await user.click(screen.getByRole("button", { name: "Confirmar rechazo" }));
    expect(await screen.findByText("No se pudo rechazar")).toBeInTheDocument();
  });

  it("si no cargan los pagos ofrece reintentar", async () => {
    setup({}, () => mockApiError("get", "/payments/pending-review", 500, "x"));
    expect(await screen.findByText("No se pudieron cargar los pagos pendientes.")).toBeInTheDocument();
  });
});
