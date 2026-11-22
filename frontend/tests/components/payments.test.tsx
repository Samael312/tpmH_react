/**
 * Componentes de pago más pequeños: recarga de créditos, datos de destino del reembolso, aviso de pago rechazado,
 * selector de método y panel con los datos para pagar.
 */
import { describe, expect, it, vi } from "vitest";
import React, { useState } from "react";
import userEvent from "@testing-library/user-event";
import { screen, waitFor, within } from "@testing-library/react";
import BuyCreditsModal from "@/components/payments/BuyCreditsModal";
import RefundDestinationFields, {
  emptyRefundDestinationForm, refundFormToPayload, hasAtLeastOneRefundField, type RefundDestinationForm,
} from "@/components/payments/RefundDestinationFields";
import RejectedPaymentNotice from "@/components/payments/RejectedPaymentNotice";
import PaymentMethodPicker from "@/components/payments/PaymentMethodPicker";
import PaymentMethodsInfo from "@/components/payments/PaymentMethodsInfo";
import { renderScreen } from "./render";
import { mockApi, mockApiError, callsTo } from "./fakeApi";

const CONFIG_ALL = {
  paypal_enabled: true, binance_enabled: true, bank_transfer_enabled: true, mobile_payment_enabled: true, has_any_method: true,
  paypal_email: "pay@tpm.com", binance_address: "TX123", binance_network: "TRC20",
  bank_transfer_details: "Banco X 0000", mobile_payment_details: "0414-0000000", whatsapp_number: "+58000000000",
};

describe("BuyCreditsModal (recarga de créditos de un paquete ilimitado)", () => {
  function setup() {
    mockApi("get", "/payments/config", CONFIG_ALL);
    const onClose = vi.fn(); const onDone = vi.fn();
    renderScreen(<BuyCreditsModal enrollmentId={11} pricePerClass={12.5} currentCredits={2} onClose={onClose} onDone={onDone} />, { role: "student" });
    return { onClose, onDone, user: userEvent.setup() };
  }
  const method = async (name: RegExp) => {
    const label = await screen.findByText(/¿Con qué método pagaste\?/);
    return within(label.parentElement as HTMLElement).getByRole("button", { name });
  };

  it("muestra créditos actuales y el total = clases × precio por clase", async () => {
    const { user } = setup();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("$62.50 USD")).toBeInTheDocument(); // 5 × 12.5
    await user.click(screen.getByRole("button", { name: "+" }));
    expect(screen.getByText("$75.00 USD")).toBeInTheDocument(); // 6 × 12.5
  });

  it("sin método de pago no envía y avisa", async () => {
    const { user } = setup();
    await method(/PayPal/);
    await user.click(screen.getByRole("button", { name: /Ya realicé el pago/ }));
    expect(await screen.findAllByText(/Indica con qué método pagaste/)).not.toHaveLength(0);
    expect(callsTo("post", "/payments/notify-payment")).toHaveLength(0);
  });

  it("notifica la recarga con tipo, créditos y método", async () => {
    const { user, onDone } = setup();
    await user.click(await method(/Binance/));
    await user.click(screen.getByRole("button", { name: "+" }));
    await user.click(screen.getByRole("button", { name: /Ya realicé el pago/ }));
    await waitFor(() => expect(callsTo("post", "/payments/notify-payment")).toHaveLength(1));
    expect(callsTo("post", "/payments/notify-payment")[0].body).toMatchObject({
      type: "unlimited_recharge", enrollment_id: 11, credits_requested: 6, payment_method: "binance",
    });
    expect(await screen.findByText(/¡Pago notificado!/)).toBeInTheDocument();
    await waitFor(() => expect(onDone).toHaveBeenCalled(), { timeout: 3000 });
  });

  it("si falla, muestra el error del servidor y no confirma", async () => {
    mockApiError("post", "/payments/notify-payment", 409, "Ya tienes una recarga pendiente");
    const { user } = setup();
    await user.click(await method(/PayPal/));
    await user.click(screen.getByRole("button", { name: /Ya realicé el pago/ }));
    expect(await screen.findByText(/Ya tienes una recarga pendiente/)).toBeInTheDocument();
    expect(screen.queryByText(/¡Pago notificado!/)).not.toBeInTheDocument();
  });
});

describe("RefundDestinationFields (datos de destino del reembolso)", () => {
  it("refundFormToPayload descarta los campos vacíos o en blanco", () => {
    expect(refundFormToPayload(emptyRefundDestinationForm)).toBeUndefined();
    expect(refundFormToPayload({ ...emptyRefundDestinationForm, bank_name: "  ", paypal_or_zelle: "a@b.c" })).toEqual({ paypal_or_zelle: "a@b.c" });
  });

  it("hasAtLeastOneRefundField exige al menos un dato no vacío", () => {
    expect(hasAtLeastOneRefundField(emptyRefundDestinationForm)).toBe(false);
    expect(hasAtLeastOneRefundField({ ...emptyRefundDestinationForm, other_notes: "   " })).toBe(false);
    expect(hasAtLeastOneRefundField({ ...emptyRefundDestinationForm, other_notes: "Binance" })).toBe(true);
  });

  it("cada campo escribe en su propia clave del formulario", async () => {
    let latest: RefundDestinationForm = emptyRefundDestinationForm;
    function Harness() {
      const [form, setForm] = useState<RefundDestinationForm>(emptyRefundDestinationForm);
      return <RefundDestinationFields value={form} onChange={(f) => { latest = f; setForm(f); }} />;
    }
    renderScreen(<Harness />, { role: "student" });
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText("Banco"), "Banesco");
    await user.type(screen.getByPlaceholderText("Número de cuenta / CLABE / IBAN"), "0134");
    await user.type(screen.getByPlaceholderText("Nombre del titular de la cuenta"), "Ana");
    await user.type(screen.getByPlaceholderText("Teléfono / cédula / banco del pago móvil"), "0414");
    await user.type(screen.getByPlaceholderText("Email de PayPal o Zelle"), "a@b.c");
    await user.type(screen.getByPlaceholderText(/solo tengo Binance/), "mi usuario");
    expect(latest).toEqual({
      bank_name: "Banesco", bank_account: "0134", account_holder: "Ana", mobile_payment: "0414", paypal_or_zelle: "a@b.c", other_notes: "mi usuario",
    });
  });
});

describe("RejectedPaymentNotice", () => {
  const base = { payment_id: 9, amount: 50, rejection_reason: "Comprobante ilegible", rejected_at: "2026-11-20T12:00:00Z" };

  it.each([
    ["package", /tu compra de paquete/],
    ["renewal", /tu renovación de paquete/],
    ["package_change", /tu cambio de paquete/],
    ["unlimited_recharge", /tu recarga de créditos/],
    ["refund", /tu ajuste de pago/],
    ["algo_nuevo", /tu pago/],
    [null, /tu pago/],
  ])("variante compacta: tipo %s se nombra con su etiqueta", (type, re) => {
    renderScreen(<RejectedPaymentNotice payment={{ ...base, payment_type: type as string | null }} variant="compact" />, { role: "student" });
    expect(screen.getByText(/No pudimos confirmar/).textContent).toMatch(re);
    expect(screen.getByText(/Comprobante ilegible/)).toBeInTheDocument();
  });

  it("variante completa con motivo: lo cita", () => {
    renderScreen(<RejectedPaymentNotice payment={{ ...base, payment_type: "package" }} />, { role: "student" });
    expect(screen.getByText("Tu pago anterior fue rechazado")).toBeInTheDocument();
    expect(screen.getByText(/Motivo/).textContent).toContain("Comprobante ilegible");
  });

  it("variante completa sin motivo: remite al staff", () => {
    renderScreen(<RejectedPaymentNotice payment={{ ...base, payment_type: "package", rejection_reason: null }} />, { role: "student" });
    expect(screen.getByText(/No se indicó un motivo específico/)).toBeInTheDocument();
  });
});

describe("PaymentMethodPicker (método con el que se pagó)", () => {
  function Harness({ showError = false }: { showError?: boolean }) {
    const [v, setV] = useState<string | null>(null);
    return <><PaymentMethodPicker value={v} onChange={setV} showError={showError} /><span data-testid="valor">{v ?? "ninguno"}</span></>;
  }

  it("ofrece SOLO los métodos que el admin habilitó", async () => {
    mockApi("get", "/payments/config", { paypal_enabled: true, binance_enabled: false, bank_transfer_enabled: false, mobile_payment_enabled: true, has_any_method: true });
    renderScreen(<Harness />, { role: "student" });
    expect(await screen.findByRole("button", { name: /PayPal/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Pago móvil/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Binance/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Transferencia/ })).not.toBeInTheDocument();
  });

  it("al elegir uno lo notifica al padre", async () => {
    mockApi("get", "/payments/config", CONFIG_ALL);
    renderScreen(<Harness />, { role: "student" });
    await userEvent.setup().click(await screen.findByRole("button", { name: /Transferencia bancaria/ }));
    expect(screen.getByTestId("valor")).toHaveTextContent("bank_transfer");
  });

  it("sin métodos configurados no pinta nada (no bloquea con un selector vacío)", async () => {
    mockApi("get", "/payments/config", { paypal_enabled: false, binance_enabled: false, bank_transfer_enabled: false, mobile_payment_enabled: false, has_any_method: false });
    const { container } = renderScreen(<PaymentMethodPicker value={null} onChange={() => {}} />, { role: "student" });
    await waitFor(() => expect(container.querySelector(".animate-pulse")).toBeNull());
    expect(container.textContent).toBe("");
  });

  it("si la configuración no carga tampoco pinta nada", async () => {
    mockApiError("get", "/payments/config", 500, "caído");
    const { container } = renderScreen(<PaymentMethodPicker value={null} onChange={() => {}} />, { role: "student" });
    await waitFor(() => expect(container.querySelector(".animate-pulse")).toBeNull());
    expect(container.textContent).toBe("");
  });

  it("showError sin selección muestra el aviso; con selección no", async () => {
    mockApi("get", "/payments/config", CONFIG_ALL);
    const { rerender } = renderScreen(<PaymentMethodPicker value={null} onChange={() => {}} showError />, { role: "student" });
    expect(await screen.findByText(/Indica con qué método pagaste/)).toBeInTheDocument();
    rerender(<PaymentMethodPicker value="paypal" onChange={() => {}} showError />);
    await waitFor(() => expect(screen.queryByText(/Indica con qué método pagaste/)).not.toBeInTheDocument());
  });
});

describe("PaymentMethodsInfo (datos para pagar)", () => {
  it("lista los métodos habilitados y despliega sus datos", async () => {
    mockApi("get", "/payments/config", CONFIG_ALL);
    renderScreen(<PaymentMethodsInfo />, { role: "student" });
    const paypal = await screen.findByText("PayPal");
    await userEvent.setup().click(paypal);
    expect(await screen.findByText("pay@tpm.com")).toBeInTheDocument();
  });

  it("sin ningún método configurado no muestra datos de pago", async () => {
    mockApi("get", "/payments/config", { ...CONFIG_ALL, paypal_enabled: false, binance_enabled: false, bank_transfer_enabled: false, mobile_payment_enabled: false, has_any_method: false });
    const { container } = renderScreen(<PaymentMethodsInfo />, { role: "student" });
    await waitFor(() => expect(container.querySelector(".animate-pulse")).toBeNull());
    expect(screen.queryByText("pay@tpm.com")).not.toBeInTheDocument();
  });
});
