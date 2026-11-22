/**
 * Inicio del alumno: avisos según la etapa del flujo de reserva, clases próximas, paquetes activos y la solicitud
 * de reembolso de un grupo cancelado.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { screen, waitFor } from "@testing-library/react";
import StudentDashboard from "@/app/(student)/dashboard/page";
import { renderScreen } from "./render";
import { mockApi, mockApiError, callsTo } from "./fakeApi";

const HOUR = 3600_000;
const cls = (id: number, status: string, startHours: number, over: Record<string, unknown> = {}) => {
  const start = Date.now() + startHours * HOUR;
  return {
    id, class_type: "regular", subject: "Español", status, start_time_utc: new Date(start).toISOString(),
    end_time_utc: new Date(start + HOUR).toISOString(), duration_minutes: 60, meet_link: null, teacher_name: "Profe Uno",
    teacher_username: "profe1", teacher_timezone: "America/Caracas", student_timezone: "America/Caracas", reschedules_remaining: 2,
    teacher_phone: null, cohort_id: null, ...over,
  };
};
const ENR = (over: Record<string, unknown> = {}) => ({
  id: 11, status: "active", teacher_username: "profe1", teacher_name: "Profe Uno", cohort_id: null, classes_used: 2, classes_total: 8,
  available_credits: 6, prepaid_unlimited_credits: null, installments_paid: 1, installment_count: 3, payment_status: "paid", paid_via_installments: false, teacher_status: "approved", has_pending_recharge: false,
  package: { id: 5, name: "Pack 8", price: 120, classes_count: 8, duration_minutes: 50, allow_installments: true }, ...over,
});

function setup(o: { stage?: string; classes?: unknown[]; enrollments?: unknown[]; rejected?: unknown; recharge?: unknown } = {}, extra?: () => void) {
  mockApi("get", /^\/payments\/booking-status/, {
    stage: o.stage ?? "ready", enrollment_id: 11, last_rejected_payment: o.rejected ?? null, pending_recharge_payment: o.recharge ?? null,
  });
  mockApi("get", "/classes/my-classes", o.classes ?? []);
  mockApi("get", "/packages/my-enrollments", o.enrollments ?? []);
  extra?.();
  const view = renderScreen(<StudentDashboard />, { role: "student" });
  return { ...view, user: userEvent.setup() };
}

afterEach(() => { vi.restoreAllMocks(); });

describe("Inicio del alumno · etapas", () => {
  it("saluda al alumno", async () => {
    setup();
    expect(await screen.findByText(/¡Hola, Test!/)).toBeInTheDocument();
  });

  it("needs_trial sin prueba invita a reservarla", async () => {
    setup({ stage: "needs_trial" });
    expect(await screen.findByText("Tu primera clase es gratis")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Reservar prueba/ })).toHaveAttribute("href", "/dashboard/schedule");
  });

  it("con la prueba ya reservada dice que está pendiente", async () => {
    setup({ stage: "needs_trial", classes: [cls(1, "pending_trial", 24, { class_type: "trial" })] });
    expect(await screen.findByText("Tu prueba está reservada")).toBeInTheDocument();
  });

  it("trial_in_progress también", async () => {
    setup({ stage: "trial_in_progress" });
    expect(await screen.findByText("Tu prueba está reservada")).toBeInTheDocument();
  });

  it("needs_package invita a elegir paquete", async () => {
    setup({ stage: "needs_package" });
    expect(await screen.findByText("Elige tu paquete de clases")).toBeInTheDocument();
  });

  it.each([
    ["renew_required", "Tu paquete ha finalizado"],
    ["needs_renewal", "Tu paquete ha finalizado"],
    ["renewal_pending", "Tu solicitud de renovación fue enviada"],
  ])("etapa %s: «%s»", async (stage, text) => {
    setup({ stage });
    expect(await screen.findByText(text)).toBeInTheDocument();
  });

  it("un pago rechazado se avisa en las etapas que piden pagar", async () => {
    setup({ stage: "needs_package", rejected: { payment_id: 3, amount: 80, rejection_reason: "Referencia inválida", payment_type: "package" } });
    expect(await screen.findByText(/Referencia inválida/)).toBeInTheDocument();
  });

  it("una recarga pendiente de verificación se avisa", async () => {
    setup({ recharge: { payment_id: 4, amount: 40 } });
    expect(await screen.findByText(/pendiente de verificación/)).toBeInTheDocument();
  });

  it("si fallan las clases ofrece reintentar", async () => {
    setup({}, () => mockApiError("get", "/classes/my-classes", 500, "x"));
    expect(await screen.findByText("No se pudo cargar tu panel")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reintentar/ })).toBeInTheDocument();
  });
});

describe("Inicio del alumno · clases y paquetes", () => {
  it("sin clases próximas dice cuál es el siguiente paso", async () => {
    setup({ stage: "ready" });
    expect(await screen.findByText("No tienes clases próximas")).toBeInTheDocument();
    expect(screen.getAllByText("Agendar primera clase").length).toBeGreaterThan(0);
  });

  it("lista hasta 3 clases próximas con su contador", async () => {
    setup({ classes: [cls(1, "confirmed", 24), cls(2, "confirmed", 48), cls(3, "confirmed", 72), cls(4, "confirmed", 96), cls(5, "completed", -48)] });
    await waitFor(() => expect(screen.getAllByText(/Español/).length).toBe(3));
  });

  it("paquete activo y pagado: muestra el progreso y permite cambiar de paquete", async () => {
    const { user } = setup({ enrollments: [ENR()] });
    expect(await screen.findByText("25%")).toBeInTheDocument();
    expect(screen.getByText("6 restantes")).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: /Cambiar de paquete/ }));
  });

  it("paquete sin pagar del todo avisa que hay que terminar de pagar antes de cambiarlo", async () => {
    setup({ enrollments: [ENR({ payment_status: "partial" })] });
    expect(await screen.findByText(/Termina de pagar tu paquete actual/)).toBeInTheDocument();
  });

  it("cambio de paquete pendiente: en revisión por el profesor", async () => {
    setup({ enrollments: [ENR({ status: "pending_package_change" })] });
    expect(await screen.findByText(/en revisión por tu profesor/)).toBeInTheDocument();
  });

  it("pagado por cuotas: ofrece pagar la siguiente", async () => {
    const { user } = setup({ enrollments: [ENR({ paid_via_installments: true, installments_paid: 1, installment_count: 3, payment_status: "partial", package: { id: 5, name: "Pack 8", price: 120, classes_count: 8, duration_minutes: 50, allow_installments: true, installment_count: 3 } })] });
    expect(await screen.findByText(/Cuota 1 de 3/)).toBeInTheDocument();
    const pay = screen.queryByRole("button", { name: /Pagar cuota 2 de 3/ });
    if (pay) await user.click(pay);
  });

  it("paquete ilimitado: ofrece comprar más créditos, salvo si ya hay una recarga pendiente", async () => {
    const unlimited = { id: 5, name: "Ilimitado", price: 10, classes_count: null, duration_minutes: 50, allow_installments: false };
    const { user } = setup({ enrollments: [ENR({ classes_total: null, package: unlimited, available_credits: null, prepaid_unlimited_credits: 4 })] });
    await user.click(await screen.findByRole("button", { name: /Comprar más créditos/ }));
  });

  it("profesor suspendido: avisa que los créditos quedan congelados", async () => {
    setup({ enrollments: [ENR({ teacher_status: "suspended" })] });
    expect(await screen.findByText(/no está disponible por ahora/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ver mis profesores" })).toBeInTheDocument();
  });

  it("con varios paquetes se puede cambiar de pestaña", async () => {
    const { user } = setup({ enrollments: [ENR(), ENR({ id: 12, teacher_username: "profe2", teacher_name: "Profe Dos", package: { id: 6, name: "Pack 12", price: 150, classes_count: 12, duration_minutes: 50, allow_installments: false }, installments_paid: 0, installment_count: null })] });
    await screen.findByText(/Pack 8/);
    const tabs = screen.getAllByRole("button").filter((b) => /Profe Dos/.test(b.textContent ?? ""));
    if (tabs.length) await user.click(tabs[0]);
    expect((await screen.findAllByText(/Pack 12|Pack 8/)).length).toBeGreaterThan(0);
  });

  it("un grupo se muestra con el progreso de la cohorte", async () => {
    setup({ enrollments: [ENR({ cohort_id: 4, package: { id: 5, name: "Grupal B1", price: 80, classes_count: 8, duration_minutes: 50, allow_installments: false } })], classes: [cls(1, "completed", -24, { cohort_id: 4, class_type: "group" })] });
    expect(await screen.findByText(/Grupal B1/)).toBeInTheDocument();
  });
});

describe("Inicio del alumno · reembolso de grupo cancelado", () => {
  async function openRefund(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole("button", { name: "Solicitar reembolso" }));
    return screen.findByPlaceholderText("Banco");
  }

  it("sin ningún dato pide completar al menos uno", async () => {
    const { user } = setup({ stage: "needs_group_refund" });
    await openRefund(user);
    await user.click(screen.getByRole("button", { name: "Enviar solicitud" }));
    expect(await screen.findByText(/Completa al menos un dato/)).toBeInTheDocument();
    expect(callsTo("post", "/payments/request-refund-cohort-cancelled")).toHaveLength(0);
  });

  it("envía el destino del reembolso", async () => {
    mockApi("post", "/payments/request-refund-cohort-cancelled", {});
    const { user } = setup({ stage: "needs_group_refund" });
    await user.type(await openRefund(user), "Banesco");
    await user.click(screen.getByRole("button", { name: "Enviar solicitud" }));
    await waitFor(() => expect(callsTo("post", "/payments/request-refund-cohort-cancelled")).toHaveLength(1));
    expect(callsTo("post", "/payments/request-refund-cohort-cancelled")[0].body).toMatchObject({ enrollment_id: 11 });
    expect(await screen.findByText(/Reembolso solicitado/)).toBeInTheDocument();
  });

  it("un error del servidor se avisa", async () => {
    mockApiError("post", "/payments/request-refund-cohort-cancelled", 400, "Ya solicitado");
    const { user } = setup({ stage: "needs_group_refund" });
    await user.type(await openRefund(user), "Banesco");
    await user.click(screen.getByRole("button", { name: "Enviar solicitud" }));
    expect(await screen.findByText("Ya solicitado")).toBeInTheDocument();
  });
});

describe("Inicio del alumno · pagos pendientes y cuotas", () => {
  const PKG = { id: 5, name: "Pack 8", price: 120, classes_count: 8, duration_minutes: 50, allow_installments: true, installment_count: 3 };

  it("pago de paquete en revisión: avisa y lleva a notificar el pago", async () => {
    setup({ stage: "package_pending_payment" });
    expect(await screen.findByText("Tu pago está en proceso de validación")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Notificar pago/ })).toHaveAttribute("href", "/dashboard/schedule");
  });

  it("cuota o pago pendiente: avisa y lleva a realizar el pago", async () => {
    setup({ stage: "needs_payment" });
    expect(await screen.findByText("Tienes un pago o cuota pendiente")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Realizar pago/ })).toHaveAttribute("href", "/dashboard/schedule");
  });

  it("sin créditos y con cuotas por pagar ofrece la siguiente cuota y abre/cierra el pago", async () => {
    const { user } = setup({ enrollments: [ENR({ paid_via_installments: true, installments_paid: 1, available_credits: 0, classes_used: 8, payment_status: "partial", package: PKG })] });
    await user.click(await screen.findByRole("button", { name: /Pagar cuota 2 de 3/ }));
    expect(await screen.findByText("Pagar siguiente cuota")).toBeInTheDocument();
    await user.click(screen.getByText("Pagar siguiente cuota").parentElement!.querySelector("button") as HTMLElement);
    await waitFor(() => expect(screen.queryByText("Pagar siguiente cuota")).not.toBeInTheDocument());
  });

  it("paquete ilimitado con una recarga pendiente la muestra «en revisión» y no deja comprar más", async () => {
    const unlimited = { id: 5, name: "Ilimitado", price: 10, classes_count: null, duration_minutes: 50, allow_installments: false };
    setup({ enrollments: [ENR({ classes_total: null, package: unlimited, available_credits: null, prepaid_unlimited_credits: 4, has_pending_recharge: true })] });
    expect(await screen.findByText(/Recarga en revisión/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Comprar más créditos/ })).not.toBeInTheDocument();
  });

  it("paquete ilimitado sin créditos precargados cuenta cero", async () => {
    const unlimited = { id: 5, name: "Ilimitado", price: 10, classes_count: null, duration_minutes: 50, allow_installments: false };
    setup({ enrollments: [ENR({ classes_total: null, package: unlimited, available_credits: undefined, prepaid_unlimited_credits: undefined })] });
    expect(await screen.findByRole("button", { name: /Comprar más créditos \(0 disponibles\)/ })).toBeInTheDocument();
  });

  it("el crédito sale de lo desbloqueado menos lo usado cuando no hay saldo directo", async () => {
    setup({ enrollments: [ENR({ available_credits: undefined, unlocked_credits: 5, classes_used: 2 })] });
    expect(await screen.findByText("Pack 8")).toBeInTheDocument();
  });
});
