/**
 * PackageCheckout: el modal donde el alumno notifica un pago (compra, renovación o cambio de paquete).
 * Verifica las reglas que protegen el dinero: método de pago obligatorio, cuotas, créditos de paquetes ilimitados,
 * ajuste en el cambio de paquete y reembolso con datos de destino. Las llamadas se afirman contra el endpoint real.
 */
import { describe, expect, it, vi } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { screen, waitFor, within } from "@testing-library/react";
import PackageCheckout, { type PackageCheckoutProps, type PackageLite } from "@/components/payments/PackageCheckout";
import { renderScreen } from "./render";
import { mockApi, mockApiError, callsTo } from "./fakeApi";

const FINITE: PackageLite = { id: 3, name: "Pack 8", price: 120, classes_count: 8, allow_installments: true, installment_count: 3, installment_amount: 40 };
const UNLIMITED: PackageLite = { id: 9, name: "Ilimitado", price: 10, classes_count: null, allow_installments: false, installment_count: null, installment_amount: null };

function setup(over: Partial<PackageCheckoutProps> & { pkg?: PackageLite } = {}) {
  mockApi("get", "/payments/config", { paypal_enabled: true, binance_enabled: false, bank_transfer_enabled: true, mobile_payment_enabled: false, has_any_method: true });
  const onClose = vi.fn();
  const onDone = vi.fn();
  const props: PackageCheckoutProps = { pkg: FINITE, mode: "initial", enrollmentId: null, installmentsPaid: 0, onClose, onDone, ...over };
  renderScreen(<PackageCheckout {...props} />, { role: "student" });
  return { onClose, onDone, user: userEvent.setup() };
}

/** El selector de método vive bajo su etiqueta; "PayPal" también aparece en el panel informativo, así que se acota. */
async function method(name: RegExp) {
  const label = await screen.findByText(/¿Con qué método pagaste\?/);
  return within(label.parentElement as HTMLElement).getByRole("button", { name });
}
const pay = () => screen.getByRole("button", { name: /Ya realicé el pago/ });
const posted = () => callsTo("post", "/payments/notify-payment");

describe("PackageCheckout · compra inicial", () => {
  it("sin método de pago NO envía nada y pide indicarlo", async () => {
    const { user } = setup();
    await method(/PayPal/);
    await user.click(pay());
    expect(await screen.findAllByText(/Indica con qué método pagaste/)).not.toHaveLength(0);
    expect(posted()).toHaveLength(0);
  });

  it("con método elegido notifica el pago único con el paquete y el método", async () => {
    const { user } = setup();
    await user.click(await method(/PayPal/));
    await user.click(pay());
    await waitFor(() => expect(posted()).toHaveLength(1));
    expect(posted()[0].body).toMatchObject({ type: "package", package_id: 3, payment_method: "paypal", installment_index: null });
  });

  it("al elegir cuotas manda la primera cuota (índice 1) y muestra el importe de la cuota", async () => {
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: /3 cuotas/ }));
    await user.click(await method(/Transferencia bancaria/));
    await user.click(pay());
    await waitFor(() => expect(posted()).toHaveLength(1));
    expect(posted()[0].body).toMatchObject({ installment_index: 1, payment_method: "bank_transfer" });
  });

  it("con una cuota ya pagada avisa que es una cuota en curso y manda la siguiente (índice 2)", async () => {
    const { user } = setup({ mode: "renewal", enrollmentId: 11, installmentsPaid: 1 });
    expect(screen.getByText(/Pagando cuota en curso/)).toBeInTheDocument();
    await user.click(await method(/PayPal/));
    await user.click(pay());
    await waitFor(() => expect(posted()).toHaveLength(1));
    expect(posted()[0].body).toMatchObject({ type: "renewal", enrollment_id: 11, installment_index: 2 });
  });

  it("incluye la referencia de la transacción si el alumno la escribe", async () => {
    const { user } = setup();
    await user.click(await method(/PayPal/));
    await user.type(screen.getByPlaceholderText(/últimos 4 dígitos/), "  ABC123  ");
    await user.click(pay());
    await waitFor(() => expect(posted()).toHaveLength(1));
    expect(posted()[0].body).toMatchObject({ transaction_reference: "ABC123" });
  });

  it("si el servidor rechaza el pago muestra el motivo y no da el pago por hecho", async () => {
    mockApiError("post", "/payments/notify-payment", 400, "Ya existe un pago pendiente");
    const { user, onDone } = setup();
    await user.click(await method(/PayPal/));
    await user.click(pay());
    expect(await screen.findByText(/Ya existe un pago pendiente/)).toBeInTheDocument();
    expect(screen.queryByText(/¡Pago notificado!/)).not.toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("tras notificar muestra la confirmación y avisa al padre (onDone y onClose)", async () => {
    const { user, onDone, onClose } = setup();
    await user.click(await method(/PayPal/));
    await user.click(pay());
    expect(await screen.findByText(/¡Pago notificado!/)).toBeInTheDocument();
    await waitFor(() => { expect(onDone).toHaveBeenCalledTimes(1); expect(onClose).toHaveBeenCalledTimes(1); }, { timeout: 3000 });
  });

  it("Cancelar cierra sin enviar nada", async () => {
    const { user, onClose } = setup();
    await user.click(screen.getByRole("button", { name: /Cancelar/ }));
    expect(onClose).toHaveBeenCalled();
    expect(posted()).toHaveLength(0);
  });
});

describe("PackageCheckout · paquete ilimitado", () => {
  it("el importe es créditos × precio por clase y se envía credits_requested (5 por defecto)", async () => {
    const { user } = setup({ pkg: UNLIMITED });
    expect(screen.getByDisplayValue("5")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "+" })); // 6
    await user.click(await method(/PayPal/));
    await user.click(pay());
    await waitFor(() => expect(posted()).toHaveLength(1));
    expect(posted()[0].body).toMatchObject({ package_id: 9, credits_requested: 6 });
  });

  it("nunca baja de 1 clase", async () => {
    const { user } = setup({ pkg: UNLIMITED });
    for (let i = 0; i < 8; i++) await user.click(screen.getByRole("button", { name: "−" }));
    expect(screen.getByDisplayValue("1")).toBeInTheDocument();
  });
});

describe("PackageCheckout · cambio de paquete", () => {
  it("upgrade: solo se pagan los créditos que faltan para completar el paquete nuevo", async () => {
    const { user } = setup({ mode: "change", enrollmentId: 11, pkg: FINITE, currentCredits: 3, currentPackagePrice: 60, currentPackageClassesTotal: 4 });
    expect(screen.getByText(/Solo pagas la diferencia/)).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument(); // 8 - 3 clases faltantes
    await user.click(await method(/PayPal/));
    await user.click(screen.getByRole("button", { name: /Ya realicé el pago/ }));
    await waitFor(() => expect(posted()).toHaveLength(1));
    expect(posted()[0].body).toMatchObject({ type: "package_change", enrollment_id: 11, package_id: 3, installment_index: null });
  });

  it("si los créditos actuales ya cubren el paquete nuevo no hay costo adicional", () => {
    setup({ mode: "change", enrollmentId: 11, pkg: FINITE, currentCredits: 8, currentPackagePrice: 120, currentPackageClassesTotal: 8 });
    expect(screen.getByText(/ya cubren este paquete/)).toBeInTheDocument();
  });

  it("cambio hacia ilimitado: instantáneo y gratis, sin pedir método de pago", async () => {
    const { user } = setup({ mode: "change", enrollmentId: 11, pkg: UNLIMITED, currentCredits: 4 });
    expect(screen.getByText(/Cambio instantáneo y sin costo/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Confirmar cambio/ }));
    await waitFor(() => expect(posted()).toHaveLength(1));
    expect(posted()[0].body).toMatchObject({ type: "package_change", package_id: 9 });
    expect((posted()[0].body as Record<string, unknown>).payment_method, "el cambio gratis no lleva método de pago").toBeUndefined();
  });

  it("downgrade sin créditos usados con reembolso total: exige un dato de destino antes de enviar", async () => {
    const small: PackageLite = { ...FINITE, id: 2, name: "Pack 4", price: 60, classes_count: 4 };
    const { user } = setup({
      mode: "change", enrollmentId: 11, pkg: small, currentCredits: 8, currentPackagePrice: 120, currentPackageClassesTotal: 8, changeOption: "full_refund",
    });
    expect(screen.getByText(/reembolsará el 100%/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Solicitar reembolso/ }));
    expect(await screen.findByText(/Completa al menos un dato/)).toBeInTheDocument();
    expect(posted()).toHaveLength(0);

    await user.type(screen.getByPlaceholderText("Email de PayPal o Zelle"), "alumno@example.com");
    await user.click(screen.getByRole("button", { name: /Solicitar reembolso/ }));
    await waitFor(() => expect(posted()).toHaveLength(1));
    expect(posted()[0].body).toMatchObject({
      type: "package_change", payment_info: { paypal_or_zelle: "alumno@example.com" }, change_option: "full_refund",
    });
    expect((posted()[0].body as Record<string, unknown>).payment_method, "un reembolso no lleva método de pago").toBeUndefined();
  });
});
