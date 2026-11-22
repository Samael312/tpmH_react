/**
 * Billetera del profesor: saldo, solicitud de retiro (validaciones y envío) y los historiales de retiros e ingresos.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { screen, waitFor } from "@testing-library/react";
import WalletPage from "@/app/(teacher)/teacher/wallet/page";
import { renderScreen } from "./render";
import { mockApi, mockApiError, callsTo } from "./fakeApi";

const WD = (id: number, status: string, over: Record<string, unknown> = {}) => ({
  id, amount: 20, status, destination_method: "paypal", created_at: "2026-02-03T12:00:00Z", rejection_reason: null, reference: null, ...over,
});
const INC = (id: number, over: Record<string, unknown> = {}) => ({
  id, payment_type: "package", amount_teacher: 40, status: "approved", created_at: "2026-02-04T12:00:00Z", installment_number: null, ...over,
});

function setup(o: { wallet?: unknown; withdrawals?: unknown; income?: unknown } = {}, extra?: () => void) {
  mockApi("get", "/payments/my-wallet", o.wallet ?? { available_balance: 120.5, total_earned: 300, total_withdrawn: 150 });
  mockApi("get", /^\/payments\/my-withdrawals/, o.withdrawals ?? []);
  mockApi("get", /^\/payments\/my-income/, o.income ?? []);
  extra?.();
  const view = renderScreen(<WalletPage />, { role: "teacher" });
  return { ...view, user: userEvent.setup() };
}

const openModal = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await screen.findByRole("button", { name: "Solicitar Retiro" }));
  return screen.findByPlaceholderText("0.00");
};

afterEach(() => { vi.restoreAllMocks(); });

describe("Billetera · saldo e historiales", () => {
  it("muestra el total ganado y el saldo", async () => {
    setup();
    expect(await screen.findByText("$300.00")).toBeInTheDocument();
    expect(screen.getByText("Histórico acumulado")).toBeInTheDocument();
  });

  it("sin movimientos lo dice en ambos historiales", async () => {
    setup();
    expect(await screen.findByText("Aún no has solicitado retiros")).toBeInTheDocument();
    expect(screen.getByText("Sin ingresos registrados todavía")).toBeInTheDocument();
  });

  it("retiros: estado, motivo de rechazo y referencia de pago", async () => {
    setup({ withdrawals: [WD(1, "pending"), WD(2, "rejected", { rejection_reason: "Datos incorrectos" }), WD(3, "completed", { reference: "OP-77" })] });
    expect(await screen.findByText("En revisión")).toBeInTheDocument();
    expect(screen.getByText("Rechazado")).toBeInTheDocument();
    expect(screen.getByText(/Datos incorrectos/)).toBeInTheDocument();
    expect(screen.getByText("Transferido")).toBeInTheDocument();
    expect(screen.getByText(/OP-77/)).toBeInTheDocument();
  });

  it("ingresos: signo, tipo, cuota y '—' si aún no está acreditado", async () => {
    setup({ income: [INC(1), INC(2, { payment_type: "refund", amount_teacher: -15 }), INC(3, { status: "pending_review", payment_type: "renewal", installment_number: 2 }), INC(4, { payment_type: null, amount_teacher: 7 })] });
    expect(await screen.findByText("+$40.00")).toBeInTheDocument();
    expect(screen.getByText("-$15.00")).toBeInTheDocument();
    expect(screen.getByText("Reembolso")).toBeInTheDocument();
    expect(screen.getByText(/Renovación — cuota 2/)).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText("Pago")).toBeInTheDocument();
  });

  it("si algo falla avisa y «Reintentar» vuelve a pedir los datos", async () => {
    const { user } = setup({}, () => mockApiError("get", "/payments/my-wallet", 500, "x"));
    expect(await screen.findByText(/Hubo un problema cargando tu información financiera/)).toBeInTheDocument();
    const before = callsTo("get", /^\/payments\/my-income/).length;
    await user.click(screen.getAllByRole("button", { name: /Reintentar|Actualizar/ })[0]);
    await waitFor(() => expect(callsTo("get", /^\/payments\/my-income/).length).toBeGreaterThan(before));
  });

  it("sin saldo no se puede solicitar un retiro", async () => {
    setup({ wallet: { available_balance: 0, total_earned: 10, total_withdrawn: 10 } });
    expect(await screen.findByRole("button", { name: "Solicitar Retiro" })).toBeDisabled();
  });
});

describe("Billetera · solicitar retiro", () => {
  it("sin datos válidos el botón de confirmar queda desactivado", async () => {
    const { user } = setup();
    const amount = await openModal(user);
    const confirm = screen.getByRole("button", { name: "Confirmar solicitud" });
    expect(confirm).toBeDisabled();
    await user.type(amount, "5"); // por debajo del mínimo (10)
    await user.type(screen.getByPlaceholderText("ejemplo@correo.com"), "yo@x.com");
    expect(confirm).toBeDisabled();
    await user.clear(amount);
    await user.type(amount, "999"); // por encima del saldo
    expect(confirm).toBeDisabled();
  });

  it("«Usar máximo» rellena el saldo y el envío manda el monto, método y destino", async () => {
    mockApi("post", "/payments/request-withdrawal", {});
    const { user } = setup();
    const amount = await openModal(user);
    await user.click(screen.getByRole("button", { name: "Usar máximo" }));
    expect(amount).toHaveValue(120.5);
    await user.type(screen.getByPlaceholderText("ejemplo@correo.com"), "  yo@x.com ");
    await user.click(screen.getByRole("button", { name: "Confirmar solicitud" }));
    await waitFor(() => expect(callsTo("post", "/payments/request-withdrawal")).toHaveLength(1));
    expect(callsTo("post", "/payments/request-withdrawal")[0].body).toEqual({ amount: 120.5, destination_method: "paypal", payment_info: "yo@x.com" });
    expect(await screen.findByText("Solicitud de retiro enviada correctamente")).toBeInTheDocument();
  });

  it("cambiar el método cambia el marcador del destino", async () => {
    const { user } = setup();
    await openModal(user);
    await user.click(screen.getByRole("button", { name: /Binance/ }));
    expect(screen.getByPlaceholderText("Txxxx...")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Transferencia/ }));
    expect(screen.getByPlaceholderText("Banco, Titular, Número de cuenta...")).toBeInTheDocument();
  });

  it("un error del servidor se muestra dentro del modal", async () => {
    mockApiError("post", "/payments/request-withdrawal", 400, "Ya tienes un retiro pendiente");
    const { user } = setup();
    const amount = await openModal(user);
    await user.type(amount, "50");
    await user.type(screen.getByPlaceholderText("ejemplo@correo.com"), "yo@x.com");
    await user.click(screen.getByRole("button", { name: "Confirmar solicitud" }));
    expect(await screen.findByText("Ya tienes un retiro pendiente")).toBeInTheDocument();
  });
});
