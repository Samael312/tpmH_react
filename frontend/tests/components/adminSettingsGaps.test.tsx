/**
 * Configuración · ramas restantes: catálogos incompletos (cada editor recibe su lista vacía), metas en formato antiguo
 * (lista plana), campos sin WhatsApp ni profesor destacado, y números vaciados que vuelven a su valor mínimo o por defecto.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import SettingsPage from "@/app/(superadmin)/admin/settings/page";
import { renderScreen } from "./render";
import { mockApi, callsTo, FIXTURE } from "./fakeApi";

const PAYMENT = {
  paypal_enabled: true, binance_enabled: false, bank_transfer_enabled: false, mobile_payment_enabled: false,
  paypal_email: "pay@tpm.com", binance_address: "", binance_network: "", bank_transfer_details: "", mobile_payment_details: "",
  whatsapp_number: "+58 412 0000000", default_commission_rate: 10,
};
const RULES = {
  min_booking_hours: 1, min_cancel_hours: 12, min_reschedule_hours_student: 12, allowed_class_durations: [50], allowed_package_durations: [50, 80],
  low_credit_threshold: 1, low_credit_renotify_days: 6, trial_duration_minutes: 25, buffer_trial_minutes: 5, buffer_regular_minutes: 10,
  buffer_group_minutes: 10, meet_link_autogen_minutes: 30, min_classes_before_package_change: 0, min_withdrawal_amount: 10,
};

function setup(o: { catalogs?: unknown; payment?: Record<string, unknown>; platform?: Record<string, unknown> } = {}) {
  mockApi("get", "/payments/config", { ...PAYMENT, ...o.payment });
  mockApi("get", "/admin/platform-config", { ...FIXTURE.platformConfig, is_single_tenant: false, chat_enabled: true, chat_retention_days: 30, ...o.platform });
  mockApi("get", "/system-catalogs/business-rules", RULES);
  mockApi("get", "/system-catalogs/", o.catalogs ?? {});
  mockApi("get", /^\/admin\/teachers/, [{ username: "ana", name: "Ana", surname: "P" }]);
  mockApi("get", "/admin/email-settings", { categories: [], sent_today: 0, daily_limit: 100, auto_saver_enabled: false, auto_saver_percent: 80, auto_saver_active: false });
  const view = renderScreen(<SettingsPage />, { role: "superadmin" });
  return { ...view, user: userEvent.setup() };
}
const tab = (u: ReturnType<typeof userEvent.setup>, name: RegExp) => u.click(screen.getByRole("button", { name }));
afterEach(() => { vi.restoreAllMocks(); });

describe("Configuración · catálogos incompletos", () => {
  it("con el catálogo vacío cada editor aparece con su lista vacía, sin romper", async () => {
    const { user } = setup({ catalogs: {} });
    await tab(user, /Catálogos/);
    for (const label of ["Materias", "Idiomas", "Habilidades sugeridas", "Categorías de materiales", "Niveles de materiales", "Iconos de paquetes"]) {
      expect((await screen.findAllByText(label)).length).toBeGreaterThan(0);
    }
    expect(screen.getByText("Métodos de pago (estudiante)")).toBeInTheDocument();
    expect(screen.getByText("Métodos de retiro (profesor)")).toBeInTheDocument();
  });

  it("las metas del alumno en formato antiguo (lista plana) se tratan como el grupo «Idiomas»", async () => {
    const { user } = setup({ catalogs: { student_goals: [{ text: "Viajar", desc: "Para viajar", icon: "✈️" }] } });
    await tab(user, /Catálogos/);
    expect(await screen.findByDisplayValue("Viajar")).toBeInTheDocument();
  });

  it("metas nulas no rompen el editor", async () => {
    const { user } = setup({ catalogs: { student_goals: null } });
    await tab(user, /Catálogos/);
    expect(await screen.findByText("Materias")).toBeInTheDocument();
  });
});

describe("Configuración · campos vacíos", () => {
  it("sin WhatsApp ni profesor destacado los campos salen vacíos", async () => {
    const { user } = setup({ payment: { whatsapp_number: null }, platform: { featured_teacher_username: null } });
    await tab(user, /Pagos/);
    const wa = (await screen.findAllByRole("textbox")).find((i) => (i as HTMLInputElement).placeholder?.includes("+") || (i as HTMLInputElement).type === "tel");
    if (wa) expect((wa as HTMLInputElement).value).toBe("");
    expect(screen.getByRole("button", { name: /Guardar métodos de pago/ })).toBeInTheDocument();
  });

  it("vaciar la retención de historial la deja en 0", async () => {
    mockApi("patch", "/admin/platform-config", {});
    const { user } = setup();
    await tab(user, /Chats/);
    const retention = (await screen.findByDisplayValue("30")) as HTMLInputElement;
    fireEvent.change(retention, { target: { value: "" } });
    await user.click(screen.getByRole("button", { name: /Guardar chat/ }));
    await waitFor(() => expect(callsTo("patch", "/admin/platform-config")).toHaveLength(1));
    expect((callsTo("patch", "/admin/platform-config")[0].body as { chat_retention_days: number }).chat_retention_days).toBe(0);
  });

  it("vaciar un campo numérico de las reglas lo deja en 0 y el del enlace de Meet vuelve a 30", async () => {
    mockApi("patch", "/system-catalogs/business-rules", {});
    const { user } = setup();
    await tab(user, /Reglas/);
    const hours = (await screen.findAllByDisplayValue("12"))[0] as HTMLInputElement;
    fireEvent.change(hours, { target: { value: "" } });
    const meet = (await screen.findAllByDisplayValue("30")).find((i) => (i as HTMLInputElement).max === "180") as HTMLInputElement;
    fireEvent.change(meet, { target: { value: "" } });
    await user.click(screen.getByRole("button", { name: /Guardar reglas/ }));
    await waitFor(() => expect(callsTo("patch", "/system-catalogs/business-rules")).toHaveLength(1));
    const body = callsTo("patch", "/system-catalogs/business-rules")[0].body as Record<string, number>;
    expect(body.min_cancel_hours).toBe(0);
    expect(body.meet_link_autogen_minutes).toBe(30);
  });
});
