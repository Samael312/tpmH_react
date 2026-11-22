/**
 * Pagos del profesor: pendientes de revisión (aprobar / rechazar con motivo, solo teacher_admin) e historial paginado.
 * Un teacher normal solo ve el estado «pendiente de revisión por el staff».
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { screen, waitFor } from "@testing-library/react";
import TeacherPaymentsPage from "@/app/(teacher)/teacher/payments/page";
import { renderScreen } from "./render";
import { mockApi, mockApiError, callsTo } from "./fakeApi";

const PAY = (id: number, over: Record<string, unknown> = {}) => ({
  payment_id: id, payment_type: "package", installment_index: null, amount: 80, transaction_reference: "TX", submitted_at: "2026-01-01T00:00:00Z",
  student_name: `Alumno ${id}`, student_username: `al${id}`, package_name: "Pack 8", installment_total: null, is_own_payment: false, payment_expires_at: null, ...over,
});

function setup(role: "teacher" | "teacher_admin" = "teacher_admin", o: { pending?: unknown[]; history?: unknown[] } = {}, extra?: () => void) {
  mockApi("get", "/payments/pending-review", o.pending ?? [PAY(1)]);
  mockApi("get", /^\/payments\/history/, o.history ?? []);
  extra?.();
  const view = renderScreen(<TeacherPaymentsPage />, { role });
  return { ...view, user: userEvent.setup() };
}
afterEach(() => { vi.restoreAllMocks(); });

describe("Pagos del profesor · pendientes", () => {
  it("sin pagos pendientes lo dice", async () => {
    setup("teacher_admin", { pending: [] });
    expect(await screen.findByText(/Todo al día/)).toBeInTheDocument();
  });

  it("un teacher normal no aprueba: ve que lo revisa el staff", async () => {
    setup("teacher");
    expect(await screen.findByText("Pendiente de revisión por el staff")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Aprobar|Confirmar/ })).not.toBeInTheDocument();
  });

  it("un pago propio del teacher_admin lo revisa el superadmin", async () => {
    setup("teacher_admin", { pending: [PAY(1, { is_own_payment: true })] });
    expect(await screen.findByText("Pendiente de revisión por el superadmin")).toBeInTheDocument();
  });

  it("la etiqueta depende del tipo de pago y de las cuotas", async () => {
    setup("teacher_admin", { pending: [
      PAY(1, { payment_type: "package", installment_total: 3, installment_index: 2 }),
      PAY(2, { payment_type: "renewal" }),
      PAY(3, { payment_type: "package_renewal", installment_total: 4, installment_index: 1 }),
      PAY(4, { payment_type: "package_change" }),
      PAY(5, { payment_type: "installment", installment_index: 2, installment_total: 5 }),
      PAY(6, { payment_type: "unlimited_recharge", installment_index: 5 }),
      PAY(7, { payment_type: "unlimited_recharge" }),
      PAY(8, { payment_type: "refund" }),
      PAY(9, { payment_type: "raro" }),
    ] });
    expect(await screen.findByText("Cuota 2/3")).toBeInTheDocument();
    expect(screen.getByText("Renovación")).toBeInTheDocument();
    expect(screen.getByText("Renovación (Cuota 1/4)")).toBeInTheDocument();
    expect(screen.getByText("Cuota 2/5")).toBeInTheDocument();
    expect(screen.getByText("Recarga 5 clases")).toBeInTheDocument();
    expect(screen.getByText("Recarga Ilimitada")).toBeInTheDocument();
    expect(screen.getByText("Reembolso a favor del estudiante")).toBeInTheDocument();
    expect(screen.getByText("raro")).toBeInTheDocument();
    expect(screen.getByText(/Cambio/)).toBeInTheDocument();
  });

  it("aprobar pide confirmación, valida y avisa", async () => {
    mockApi("patch", "/payments/1/validate", {});
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: /Aprobar|Confirmar/ }));
    await user.click(await screen.findByRole("button", { name: "Aprobar pago" }));
    await waitFor(() => expect(callsTo("patch", "/payments/1/validate")).toHaveLength(1));
    expect(callsTo("patch", "/payments/1/validate")[0].body).toEqual({ action: "approve" });
    expect(await screen.findByText("Pago aprobado correctamente")).toBeInTheDocument();
  });

  it("un error al aprobar se avisa", async () => {
    const { user } = setup("teacher_admin", {}, () => mockApiError("patch", "/payments/1/validate", 400, "Ya validado"));
    await user.click(await screen.findByRole("button", { name: /Aprobar|Confirmar/ }));
    await user.click(await screen.findByRole("button", { name: "Aprobar pago" }));
    expect(await screen.findByText("Ya validado")).toBeInTheDocument();
  });

  it("rechazar exige un motivo y lo envía", async () => {
    mockApi("patch", "/payments/1/validate", {});
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: /Rechazar/ }));
    await user.type(await screen.findByPlaceholderText(/Explica brevemente/), "Comprobante ilegible");
    await user.click(screen.getByRole("button", { name: "Confirmar rechazo" }));
    await waitFor(() => expect(callsTo("patch", "/payments/1/validate")).toHaveLength(1));
    expect(callsTo("patch", "/payments/1/validate")[0].body).toEqual({ action: "reject", rejection_reason: "Comprobante ilegible" });
    expect(await screen.findByText("Pago rechazado correctamente")).toBeInTheDocument();
  });

  it("un error al rechazar se avisa", async () => {
    const { user } = setup("teacher_admin", {}, () => mockApiError("patch", "/payments/1/validate", 400, "No se pudo"));
    await user.click(await screen.findByRole("button", { name: /Rechazar/ }));
    await user.type(await screen.findByPlaceholderText(/Explica brevemente/), "Motivo");
    await user.click(screen.getByRole("button", { name: "Confirmar rechazo" }));
    expect(await screen.findByText("No se pudo")).toBeInTheDocument();
  });

  it("si falla la carga ofrece reintentar", async () => {
    const { user } = setup("teacher_admin", {}, () => mockApiError("get", "/payments/pending-review", 500, "x"));
    expect(await screen.findByText("No se pudo cargar los pagos pendientes")).toBeInTheDocument();
    const before = callsTo("get", "/payments/pending-review").length;
    await user.click(screen.getByRole("button", { name: /Reintentar/ }));
    await waitFor(() => expect(callsTo("get", "/payments/pending-review").length).toBeGreaterThan(before));
  });
});

describe("Pagos del profesor · historial", () => {
  it("lista pagos aprobados y rechazados", async () => {
    const { user } = setup("teacher_admin", { history: [PAY(1, { status: "approved", validated_at: "2026-02-01T10:00:00Z" }), PAY(2, { status: "rejected", rejection_reason: "Falso" })] });
    await user.click(await screen.findByRole("button", { name: "Historial" }));
    expect(await screen.findByText("Alumno 1")).toBeInTheDocument();
    expect(screen.getByText("Alumno 2")).toBeInTheDocument();
    expect(screen.getByText(/Falso/)).toBeInTheDocument();
  });

  it("sin historial lo dice", async () => {
    const { user } = setup("teacher_admin");
    await user.click(await screen.findByRole("button", { name: "Historial" }));
    expect(await screen.findByText("No hay historial disponible.")).toBeInTheDocument();
  });

  it("si falla el historial ofrece reintentar", async () => {
    const { user } = setup("teacher_admin", {}, () => mockApiError("get", /^\/payments\/history/, 500, "x"));
    await user.click(await screen.findByRole("button", { name: "Historial" }));
    expect(await screen.findByText("No se pudo cargar el historial")).toBeInTheDocument();
  });
});
