/**
 * Pagos y retiros (admin): cola de pagos por confirmar, retiros de profesores, paquetes gratis, profesores pendientes e
 * historial. Cada acción que mueve dinero pide confirmación (o motivo) antes de llamar al servidor.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { screen, waitFor } from "@testing-library/react";
import PaymentsPage from "@/app/(superadmin)/admin/payments/page";
import { renderScreen } from "./render";
import { mockApi, mockApiError, callsTo } from "./fakeApi";

const PAY = (over: Record<string, unknown> = {}) => ({
  payment_id: 11, payment_type: "package", installment_index: null, student_name: "Ana Pérez", student_username: "ana", amount: 80,
  payment_method: "zelle", payment_method_label: "Zelle", refund_payment_info: null, transaction_reference: "TX1",
  submitted_at: "2026-01-01T00:00:00Z", class_start_utc: null, payment_expires_at: null, package_name: "Pack 8", teacher_name: "María Gómez",
  is_own_payment: false, ...over,
});
const WD = (over: Record<string, unknown> = {}) => ({
  id: 3, teacher_id: 7, teacher_username: "maria", teacher_name: "María Gómez", amount: 55, destination_method: "Zelle", destination_details: "m@x.com",
  status: "pending", created_at: "2026-01-02T00:00:00Z", is_own_withdrawal: false, ...over,
});
const GRANT = { id: 9, teacher_id: 7, student_id: 8, enrollment_id: 2, package_id: 5, reason: "Beca acordada", status: "pending", rejection_reason: null, created_at: "2026-01-03T00:00:00Z", resolved_at: null, teacher_name: "María Gómez", student_name: "Luis Gómez", package_name: "Pack 8" };

function setup(o: { payments?: unknown[]; withdrawals?: unknown[]; grants?: unknown[]; teachers?: unknown[]; history?: unknown[] } = {}, extra?: () => void, role: "superadmin" | "teacher_admin" = "superadmin") {
  mockApi("get", "/payments/pending-review", o.payments ?? [PAY()]);
  mockApi("get", /^\/payments\/admin\/withdrawals\/pending/, o.withdrawals ?? [WD()]);
  mockApi("get", /^\/payments\/manual-grant-requests/, o.grants ?? [GRANT]);
  mockApi("get", /^\/admin\/teachers/, o.teachers ?? []);
  mockApi("get", /^\/payments\/history/, o.history ?? []);
  extra?.();
  const view = renderScreen(<PaymentsPage />, { role });
  return { ...view, user: userEvent.setup() };
}
const tab = (re: RegExp) => screen.findByRole("button", { name: re });

afterEach(() => { vi.restoreAllMocks(); });

describe("Admin · pagos · por confirmar", () => {
  it("lista el pago con su detalle y los contadores de las pestañas", async () => {
    setup();
    expect(await screen.findByText("Ana Pérez")).toBeInTheDocument();
    expect(screen.getByText("$80.00")).toBeInTheDocument();
    expect(screen.getByText("Pack 8")).toBeInTheDocument();
    expect(screen.getByText("Zelle")).toBeInTheDocument();
    expect(await tab(/Pagos por confirmar \(1\)/)).toBeInTheDocument();
    expect(await tab(/Retiros \(1\)/)).toBeInTheDocument();
    expect(await tab(/Paquetes gratis \(1\)/)).toBeInTheDocument();
  });

  it("aprobar pide confirmación y llama a validate/approve", async () => {
    mockApi("patch", "/payments/11/validate", {});
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: "Confirmar pago" }));
    await user.click(await screen.findByRole("button", { name: "Aprobar pago" }));
    await waitFor(() => expect(callsTo("patch", "/payments/11/validate")).toHaveLength(1));
    expect(callsTo("patch", "/payments/11/validate")[0].body).toEqual({ action: "approve" });
    expect(await screen.findByText("Pago aprobado correctamente")).toBeInTheDocument();
  });

  it("un error al aprobar se avisa", async () => {
    mockApiError("patch", "/payments/11/validate", 409, "Ya validado");
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: "Confirmar pago" }));
    await user.click(await screen.findByRole("button", { name: "Aprobar pago" }));
    expect(await screen.findByText("Ya validado")).toBeInTheDocument();
  });

  it("rechazar exige un motivo", async () => {
    mockApi("patch", "/payments/11/validate", {});
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: "Rechazar" }));
    expect(await screen.findByText("Rechazar pago")).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText(/Explica brevemente/), "Referencia falsa");
    await user.click(screen.getByRole("button", { name: /Confirmar rechazo/ }));
    await waitFor(() => expect(callsTo("patch", "/payments/11/validate")).toHaveLength(1));
    expect(callsTo("patch", "/payments/11/validate")[0].body).toEqual({ action: "reject", rejection_reason: "Referencia falsa" });
    expect(await screen.findByText("Pago rechazado correctamente")).toBeInTheDocument();
  });

  it("un pago propio no se puede resolver aquí", async () => {
    setup({ payments: [PAY({ is_own_payment: true })] });
    expect(await screen.findByText(/Pago de tus propias clases/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirmar pago" })).not.toBeInTheDocument();
  });

  it("un reembolso muestra a dónde devolver el dinero", async () => {
    setup({ payments: [PAY({ payment_type: "refund", refund_payment_info: { bank_name: "Banesco", bank_account: "0134-1", account_holder: "Ana", paypal_or_zelle: "ana@x.com" } })] });
    expect(await screen.findByText(/Banesco/)).toBeInTheDocument();
  });

  it("sin pagos pendientes no hay filas", async () => {
    setup({ payments: [] });
    expect(await tab(/Pagos por confirmar \(0\)/)).toBeInTheDocument();
    expect(screen.queryByText("Ana Pérez")).not.toBeInTheDocument();
  });
});

describe("Admin · pagos · retiros", () => {
  it("marcar pagado pide referencia opcional", async () => {
    mockApi("post", "/payments/admin/withdrawals/3/process", {});
    const { user } = setup();
    await user.click(await tab(/Retiros/));
    await user.click(await screen.findByRole("button", { name: "Marcar Pagado" }));
    await user.type(await screen.findByPlaceholderText("Nº de operación, hash, etc."), "OP-123");
    await user.click((await screen.findAllByRole("button", { name: "Confirmar pago" })).at(-1)!);
    await waitFor(() => expect(callsTo("post", "/payments/admin/withdrawals/3/process")).toHaveLength(1));
    expect(callsTo("post", "/payments/admin/withdrawals/3/process")[0].body).toEqual({ action: "complete", reference: "OP-123" });
    expect(await screen.findByText("Retiro procesado correctamente")).toBeInTheDocument();
  });

  it("rechazar un retiro exige motivo", async () => {
    mockApi("post", "/payments/admin/withdrawals/3/process", {});
    const { user } = setup();
    await user.click(await tab(/Retiros/));
    await user.click(await screen.findByRole("button", { name: "Rechazar" }));
    expect(await screen.findByText("Rechazar retiro")).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText(/Explica brevemente/), "Datos incorrectos");
    await user.click(screen.getByRole("button", { name: /Confirmar rechazo/ }));
    await waitFor(() => expect(callsTo("post", "/payments/admin/withdrawals/3/process")).toHaveLength(1));
    expect(callsTo("post", "/payments/admin/withdrawals/3/process")[0].body).toEqual({ action: "reject", rejection_reason: "Datos incorrectos" });
    expect(await screen.findByText("Retiro rechazado correctamente")).toBeInTheDocument();
  });

  it("un error al procesar se avisa", async () => {
    mockApiError("post", "/payments/admin/withdrawals/3/process", 400, "Saldo insuficiente");
    const { user } = setup();
    await user.click(await tab(/Retiros/));
    await user.click(await screen.findByRole("button", { name: "Marcar Pagado" }));
    await user.click((await screen.findAllByRole("button", { name: "Confirmar pago" })).at(-1)!);
    expect(await screen.findByText("Saldo insuficiente")).toBeInTheDocument();
  });

  it("un teacher_admin no resuelve su propio retiro: lo hace el superadmin", async () => {
    const { user } = setup({ withdrawals: [WD({ teacher_username: "profeadmin" })] }, undefined, "teacher_admin");
    await user.click(await tab(/Retiros/));
    expect(await screen.findByText(/Tu retiro lo resuelve el superadmin/)).toBeInTheDocument();
  });
});

describe("Admin · pagos · paquetes gratis, profesores e historial", () => {
  it("aprobar un paquete gratis", async () => {
    mockApi("patch", "/payments/manual-grant-requests/9/resolve", {});
    const { user } = setup();
    await user.click(await tab(/Paquetes gratis/));
    expect(await screen.findByText("Beca acordada")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Aprobar" }));
    await user.click((await screen.findAllByRole("button", { name: "Aprobar" })).at(-1)!);
    await waitFor(() => expect(callsTo("patch", "/payments/manual-grant-requests/9/resolve")).toHaveLength(1));
    expect(callsTo("patch", "/payments/manual-grant-requests/9/resolve")[0].body).toMatchObject({ action: "approve" });
    expect(await screen.findByText("Paquete otorgado")).toBeInTheDocument();
  });

  it("rechazar un paquete gratis pide motivo", async () => {
    mockApi("patch", "/payments/manual-grant-requests/9/resolve", {});
    const { user } = setup();
    await user.click(await tab(/Paquetes gratis/));
    await user.click(await screen.findByRole("button", { name: "Rechazar" }));
    await user.type(await screen.findByPlaceholderText(/Explica brevemente/), "No procede");
    await user.click(screen.getByRole("button", { name: /Confirmar rechazo/ }));
    await waitFor(() => expect(callsTo("patch", "/payments/manual-grant-requests/9/resolve")).toHaveLength(1));
    expect(callsTo("patch", "/payments/manual-grant-requests/9/resolve")[0].body).toEqual({ action: "reject", rejection_reason: "No procede" });
    expect(await screen.findByText("Solicitud rechazada")).toBeInTheDocument();
  });

  it("sin solicitudes lo dice", async () => {
    const { user } = setup({ grants: [] });
    await user.click(await tab(/Paquetes gratis/));
    expect(await screen.findByText("No hay solicitudes de paquete gratis pendientes")).toBeInTheDocument();
  });

  it("profesores por validar lista los pendientes", async () => {
    const { user } = setup({ teachers: [{ id: 7, username: "maria", name: "María", surname: "Gómez", email: "m@x.com", status: "pending", video_url: null }] });
    await user.click(await tab(/Profesores por validar/));
    expect(await screen.findByText(/María/)).toBeInTheDocument();
  });

  it("historial: pagos aprobados y rechazados", async () => {
    const { user } = setup({ history: [PAY({ payment_id: 1, status: "approved" }), PAY({ payment_id: 2, status: "rejected", student_name: "Luis Gómez", rejection_reason: "Falso" })] });
    await user.click(await tab(/^Historial$/));
    expect(await screen.findByText("Aprobado")).toBeInTheDocument();
    expect(screen.getByText("Rechazado")).toBeInTheDocument();
  });
});

describe("Admin · pagos · errores de carga y de rechazo", () => {
  it("un error al rechazar un pago se avisa", async () => {
    const { user } = setup({}, () => mockApiError("patch", /\/payments\/11\/validate/, 400, "No se pudo rechazar el pago"));
    await user.click(await screen.findByRole("button", { name: "Rechazar" }));
    await user.type(await screen.findByPlaceholderText(/Explica brevemente/), "Falso");
    await user.click(screen.getByRole("button", { name: /Confirmar rechazo/ }));
    expect(await screen.findByText("No se pudo rechazar el pago")).toBeInTheDocument();
  });

  it("un error al resolver un paquete gratis se avisa", async () => {
    const { user } = setup({}, () => mockApiError("patch", "/payments/manual-grant-requests/9/resolve", 400, "Ya resuelta"));
    await user.click(await tab(/Paquetes gratis/));
    await user.click(await screen.findByRole("button", { name: "Rechazar" }));
    await user.type(await screen.findByPlaceholderText(/Explica brevemente/), "No procede");
    await user.click(screen.getByRole("button", { name: /Confirmar rechazo/ }));
    expect(await screen.findByText("Ya resuelta")).toBeInTheDocument();
  });

  it.each([
    [/^Retiros/, /^\/payments\/admin\/withdrawals\/pending/, "No se pudieron cargar los retiros pendientes."],
    [/Paquetes gratis/, /^\/payments\/manual-grant-requests/, "No se pudieron cargar las solicitudes."],
    [/Profesores por validar/, /^\/admin\/teachers/, "No se pudo cargar la lista de profesores pendientes."],
    [/^Historial$/, /^\/payments\/history/, "No se pudo cargar el historial de pagos."],
  ])("si falla %s ofrece reintentar y vuelve a pedirlo", async (tabName, url, msg) => {
    const { user } = setup({}, () => mockApiError("get", url, 500, "x"));
    await user.click(await tab(tabName));
    expect(await screen.findByText(msg, { exact: false })).toBeInTheDocument();
    const before = callsTo("get", url).length;
    await user.click(screen.getAllByRole("button", { name: /Reintentar/ }).at(-1)!);
    await waitFor(() => expect(callsTo("get", url).length).toBeGreaterThan(before));
  });

  it("sin retiros, sin profesores ni historial lo dice", async () => {
    const { user } = setup({ withdrawals: [], teachers: [], history: [] });
    await user.click(await tab(/^Retiros/));
    expect(await screen.findByText("No hay solicitudes de retiro pendientes")).toBeInTheDocument();
    await user.click(await tab(/Profesores por validar/));
    expect(await screen.findByText("No hay profesores pendientes de validación")).toBeInTheDocument();
    await user.click(await tab(/^Historial$/));
    expect(await screen.findByText("Sin historial todavía")).toBeInTheDocument();
  });

  it("historial: fecha de validación y estado desconocido", async () => {
    const { user } = setup({ history: [PAY({ payment_id: 1, status: "approved", validated_at: "2026-02-01T10:00:00Z" }), PAY({ payment_id: 2, status: "en_revision", payment_type: "rara" })] });
    await user.click(await tab(/^Historial$/));
    expect(await screen.findByText("en_revision")).toBeInTheDocument();
    expect(screen.getByText("rara")).toBeInTheDocument();
  });
});
