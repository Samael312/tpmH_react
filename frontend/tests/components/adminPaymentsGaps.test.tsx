/**
 * Pagos y retiros (admin) · ramas restantes: cuotas sin índice, tipo desconocido, vencimiento, reembolso con datos vacíos o
 * campos no previstos, y alumno / paquete ausentes en las solicitudes de paquete gratis.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { screen } from "@testing-library/react";
import PaymentsPage from "@/app/(superadmin)/admin/payments/page";
import { renderScreen } from "./render";
import { mockApi } from "./fakeApi";

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

describe("Admin · pagos · casos de borde", () => {
  it("las cuotas sin índice cuentan como la 1 en paquete, renovación y cambio", async () => {
    setup({ payments: [
      PAY({ payment_id: 1, payment_type: "package", installment_total: 3, student_name: "Uno" }),
      PAY({ payment_id: 2, payment_type: "renewal", installment_total: 4, student_name: "Dos" }),
      PAY({ payment_id: 3, payment_type: "package_change", installment_total: 2, student_name: "Tres" }),
    ], grants: [], withdrawals: [] });
    expect(await screen.findByText("Cuota 1/3")).toBeInTheDocument();
    expect(screen.getByText("Renovación (Cuota 1/4)")).toBeInTheDocument();
    expect(screen.getByText("Cambio (Cuota 1/2)")).toBeInTheDocument();
  });

  it("un tipo de pago desconocido muestra su nombre y uno vacío, «Pago»", async () => {
    setup({ payments: [PAY({ payment_id: 1, payment_type: "rara", student_name: "Uno" }), PAY({ payment_id: 2, payment_type: "", student_name: "Dos" })], grants: [], withdrawals: [] });
    expect(await screen.findByText("rara")).toBeInTheDocument();
    expect(screen.getByText("Pago")).toBeInTheDocument();
  });

  it("un pago con vencimiento lo muestra", async () => {
    setup({ payments: [PAY({ payment_expires_at: "2026-03-01T12:00:00Z" })], grants: [], withdrawals: [] });
    expect(await screen.findByText(/Expira:/)).toBeInTheDocument();
  });

  it("el aviso de aprobar sin nombre de alumno solo lleva el importe", async () => {
    const { user } = setup({ payments: [PAY({ student_name: null })], grants: [], withdrawals: [] });
    await user.click(await screen.findByRole("button", { name: "Confirmar pago" }));
    expect(await screen.findByText(/Vas a aprobar \$80\.00/)).toBeInTheDocument();
  });

  it("un reembolso con todos los datos vacíos no muestra el destino", async () => {
    setup({ payments: [PAY({ payment_type: "refund", refund_payment_info: { bank_name: "", bank_account: "  ", account_holder: null } })], grants: [], withdrawals: [] });
    await screen.findByText("Ana Pérez");
    expect(screen.queryByText("Destino del reembolso")).not.toBeInTheDocument();
  });

  it("un reembolso con un campo no previsto lo muestra con su clave", async () => {
    setup({ payments: [PAY({ payment_type: "refund", refund_payment_info: { swift: "BSCHESMM" } })], grants: [], withdrawals: [] });
    expect(await screen.findByText(/swift:/)).toBeInTheDocument();
  });
});

describe("Admin · paquetes gratis · casos de borde", () => {
  const open = async (user: ReturnType<typeof userEvent.setup>) => { await user.click(await tab(/Paquetes gratis/)); };

  it("sin nombre de alumno ni de paquete usa el número del alumno y un guion", async () => {
    const { user } = setup({ payments: [], withdrawals: [], grants: [{ ...GRANT, student_name: null, package_name: null }] });
    await open(user);
    expect(await screen.findByText("Alumno #8")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("aprobar sin nombres genéricos en el aviso", async () => {
    const { user } = setup({ payments: [], withdrawals: [], grants: [{ ...GRANT, student_name: null, package_name: null }] });
    await open(user);
    await user.click(await screen.findByRole("button", { name: /Aprobar/ }));
    expect(await screen.findByText(/dar «el paquete» gratis a este alumno/)).toBeInTheDocument();
  });
});

describe("Admin · rechazos sin nombre", () => {
  it("rechazar un pago sin nombre de alumno identifica solo el importe", async () => {
    const { user } = setup({ payments: [PAY({ student_name: null })], grants: [], withdrawals: [] });
    await user.click(await screen.findByRole("button", { name: "Rechazar" }));
    expect(await screen.findByText("Rechazar pago")).toBeInTheDocument();
    expect(screen.getAllByText("$80.00", { exact: false }).length).toBeGreaterThan(1);
  });

  it("rechazar un retiro sin nombre de profesor lo identifica por su número", async () => {
    const { user } = setup({ payments: [], grants: [], withdrawals: [WD({ teacher_name: null })] });
    await user.click(await tab(/Retiros/));
    await user.click(await screen.findByRole("button", { name: "Rechazar" }));
    expect(await screen.findByText("Rechazar retiro")).toBeInTheDocument();
    expect(screen.getByText(/Retiro #3/)).toBeInTheDocument();
  });

  it("el historial con un tipo vacío muestra «Pago»", async () => {
    const { user } = setup({ payments: [], grants: [], withdrawals: [], history: [PAY({ payment_id: 5, status: "approved", payment_type: "" })] });
    await user.click(await tab(/^Historial$/));
    expect(await screen.findByText("Pago")).toBeInTheDocument();
  });
});
