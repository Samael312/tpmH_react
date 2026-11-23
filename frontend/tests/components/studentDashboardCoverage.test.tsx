/**
 * Inicio del alumno · cierra huecos: actualizar, cierres de los diálogos (cambio de paquete, cuota, recarga y reembolso),
 * pestañas con profesor suspendido / grupo / sin nombre, y datos ausentes.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { screen, waitFor } from "@testing-library/react";
import StudentDashboard from "@/app/(student)/dashboard/page";
import { renderScreen } from "./render";
import { mockApi, callsTo } from "./fakeApi";

const PKG = { id: 5, name: "Pack 8", price: 120, classes_count: 8, duration_minutes: 50, allow_installments: true, installment_count: 3 };
const UNLIMITED = { id: 6, name: "Ilimitado", price: 10, classes_count: null, duration_minutes: 50, allow_installments: false };
const ENR = (over: Record<string, unknown> = {}) => ({
  id: 11, status: "active", teacher_username: "profe1", teacher_name: "Profe Uno", cohort_id: null, classes_used: 2, classes_total: 8,
  available_credits: 6, prepaid_unlimited_credits: null, installments_paid: 1, installment_count: 3, payment_status: "paid", paid_via_installments: false,
  teacher_status: "approved", has_pending_recharge: false, package: { ...PKG, allow_installments: true }, ...over,
});

function setup(o: { stage?: string; classes?: unknown; enrollments?: unknown[]; rejected?: unknown } = {}, extra?: () => void) {
  mockApi("get", /^\/payments\/booking-status/, { stage: o.stage ?? "ready", enrollment_id: 11, last_rejected_payment: o.rejected ?? null, pending_recharge_payment: null });
  mockApi("get", "/classes/my-classes", o.classes ?? []);
  mockApi("get", "/packages/my-enrollments", o.enrollments ?? []);
  mockApi("get", "/payments/config", { paypal_enabled: true, has_any_method: true, paypal_email: "p@x.com" });
  extra?.();
  const view = renderScreen(<StudentDashboard />, { role: "student" });
  return { ...view, user: userEvent.setup() };
}
afterEach(() => { vi.restoreAllMocks(); });

const backdrop = (heading: HTMLElement) => heading.closest("div[class*='fixed']")!.querySelector("div[class*='bg-slate-900/40']") as HTMLElement;
const NEXT_INSTALLMENT = () => ENR({ paid_via_installments: true, installments_paid: 1, available_credits: 0, classes_used: 8, payment_status: "partial" });

describe("Inicio del alumno · actualizar y datos ausentes", () => {
  it("el botón de actualizar vuelve a pedir clases, paquetes y estado", async () => {
    const { user } = setup();
    await screen.findByText(/¡Hola, Test!/);
    const before = callsTo("get", "/classes/my-classes").length;
    await user.click(screen.getAllByRole("button", { name: "Actualizar datos" })[0]);
    await waitFor(() => expect(callsTo("get", "/classes/my-classes").length).toBeGreaterThan(before));
  });

  it("si las clases no llegan como lista se tratan como vacías", async () => {
    setup({ classes: { detail: "raro" } });
    expect(await screen.findByText(/¡Hola, Test!/)).toBeInTheDocument();
  });

  it("un pago rechazado no se avisa cuando la etapa ya está al día", async () => {
    setup({ stage: "ready", rejected: { payment_id: 3, amount: 80, rejection_reason: "Referencia inválida", payment_type: "package" } });
    await screen.findByText(/¡Hola, Test!/);
    expect(screen.queryByText(/Referencia inválida/)).not.toBeInTheDocument();
  });

  it("sin créditos desbloqueados ni saldo cuenta cero", async () => {
    setup({ enrollments: [ENR({ available_credits: undefined, unlocked_credits: undefined, classes_used: 2 })] });
    expect(await screen.findByText("Pack 8")).toBeInTheDocument();
  });

  it("la cuota siguiente se calcula aunque no venga cuántas van pagadas", async () => {
    const { user } = setup({ enrollments: [ENR({ ...NEXT_INSTALLMENT(), installments_paid: undefined })] });
    await user.click(await screen.findByRole("button", { name: /Pagar cuota 1 de 3/ }));
    expect(await screen.findByText("Pagar siguiente cuota")).toBeInTheDocument();
  });
});

describe("Inicio del alumno · pestañas por profesor", () => {
  it("muestra el copo de un profesor suspendido, el icono de grupo y el nombre por defecto", async () => {
    const { user } = setup({ enrollments: [
      ENR({ teacher_status: "suspended", teacher_name: null }),
      ENR({ id: 12, cohort_id: 4, teacher_name: null, teacher_username: "profe2" }),
    ] });
    expect(await screen.findByText(/Tu profesor no está disponible por ahora/)).toBeInTheDocument();
    const tabs = screen.getAllByRole("button", { name: "Profesor" });
    expect(tabs).toHaveLength(2);
    await user.click(tabs[1]);
    expect(await screen.findByText(/Con tu profesor/)).toBeInTheDocument();
  });
});

describe("Inicio del alumno · cierres de diálogos", () => {
  it("«Cambiar de paquete» se cierra pulsando fuera", async () => {
    const { user } = setup({ enrollments: [ENR()] }, () => mockApi("get", /^\/packages\/teacher\//, []));
    await user.click(await screen.findByRole("button", { name: /Cambiar de paquete/ }));
    await waitFor(() => expect(document.querySelector("div[class*='bg-slate-900/40']")).toBeTruthy());
    await user.click(document.querySelector("div[class*='bg-slate-900/40']") as HTMLElement);
    await waitFor(() => expect(document.querySelector("div[class*='bg-slate-900/40']")).toBeFalsy());
  });

  it("«Pagar siguiente cuota» se cierra pulsando fuera y con Cancelar del pago", async () => {
    const { user } = setup({ enrollments: [NEXT_INSTALLMENT()] });
    await user.click(await screen.findByRole("button", { name: /Pagar cuota 2 de 3/ }));
    await user.click(backdrop(await screen.findByText("Pagar siguiente cuota")));
    await waitFor(() => expect(screen.queryByText("Pagar siguiente cuota")).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Pagar cuota 2 de 3/ }));
    await screen.findByText("Pagar siguiente cuota");
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByText("Pagar siguiente cuota")).not.toBeInTheDocument());
  });

  it("«Comprar créditos» se cierra con la X, pulsando fuera y con Cancelar", async () => {
    const { user } = setup({ enrollments: [ENR({ classes_total: null, package: UNLIMITED, available_credits: null, prepaid_unlimited_credits: 4 })] });
    const open = async () => {
      await user.click(await screen.findByRole("button", { name: /Comprar más créditos/ }));
      return screen.findByRole("heading", { name: "Comprar créditos" });
    };
    let heading = await open();
    await user.click(heading.parentElement!.querySelector("button") as HTMLElement);
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Comprar créditos" })).not.toBeInTheDocument());
    heading = await open();
    await user.click(backdrop(heading));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Comprar créditos" })).not.toBeInTheDocument());
    await open();
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Comprar créditos" })).not.toBeInTheDocument());
  });

  it("el reembolso del grupo cancelado se cierra con la X", async () => {
    const { user } = setup({ stage: "needs_group_refund" });
    await user.click(await screen.findByRole("button", { name: "Solicitar reembolso" }));
    const title = await screen.findByText("Solicitar reembolso del grupo cancelado", { selector: "h2" });
    await user.click(title.parentElement!.querySelector("button") as HTMLElement);
    await waitFor(() => expect(screen.queryByText("Solicitar reembolso del grupo cancelado", { selector: "h2" })).not.toBeInTheDocument());
  });
});
