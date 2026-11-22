/**
 * Configuración · casos que completan adminSettings: transferencia y pago móvil, interruptores de plataforma,
 * degradado de títulos, pasos del grupo, duraciones (siempre queda una), mapa de temas y reactivación de chats.
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
const CATALOGS = {
  subjects: ["Matemática"], languages: ["Español"], spoken_languages: ["Español"], skill_suggestions: [], material_categories: [], material_levels: [],
  package_icon_options: [], student_goals: { idiomas: [] }, student_payment_methods: [], withdrawal_methods: [], theme_presets: [],
  subject_theme_map: { Matemática: { icon: "📐", color: "#3b82f6" } },
};
const LANDING = {
  ...FIXTURE.platformConfig.landing_content,
  group_steps: [{ title: "Paso uno", desc: "Desc uno" }, { title: "Paso dos", desc: "Desc dos" }],
  title_gradients: {},
};

function setup() {
  mockApi("get", "/payments/config", PAYMENT);
  mockApi("get", "/admin/platform-config", { ...FIXTURE.platformConfig, is_single_tenant: false, chat_enabled: true, chat_reactivation_hours: 24, landing_content: LANDING });
  mockApi("get", "/system-catalogs/business-rules", RULES);
  mockApi("get", "/system-catalogs/", CATALOGS);
  mockApi("get", /^\/admin\/teachers/, [{ username: "ana", name: "Ana", surname: "P" }]);
  mockApi("get", "/admin/email-settings", { categories: [], sent_today: 0, daily_limit: 100, auto_saver_enabled: false, auto_saver_percent: 80, auto_saver_active: false });
  const view = renderScreen(<SettingsPage />, { role: "superadmin" });
  return { ...view, user: userEvent.setup() };
}
const tab = (u: ReturnType<typeof userEvent.setup>, name: RegExp) => u.click(screen.getByRole("button", { name }));
const toggleNear = (label: string | RegExp) => {
  let el: HTMLElement | null = screen.getByText(label);
  while (el && !el.querySelector(":scope > button, :scope > div > button")) el = el.parentElement;
  return el!.querySelector("button") as HTMLElement;
};

afterEach(() => { vi.restoreAllMocks(); });

describe("Configuración · Pagos · transferencia y pago móvil", () => {
  it("al encender cada método aparece su caja de datos y se envían al guardar", async () => {
    mockApi("patch", "/payments/config", {});
    const { user } = setup();
    await tab(user, /Pagos/);
    await screen.findByPlaceholderText("tu@paypal.com");
    await user.click(toggleNear("Transferencia bancaria"));
    await user.type(await screen.findByPlaceholderText(/Banco, titular de la cuenta/), "Banesco 0102");
    await user.click(toggleNear("Pago móvil / Bizum"));
    await user.type(await screen.findByPlaceholderText(/Teléfono, cédula\/DNI y banco/), "0414 123");
    await user.click(screen.getByRole("button", { name: /Guardar métodos de pago/ }));
    await waitFor(() => expect(callsTo("patch", "/payments/config")).toHaveLength(1));
    expect(callsTo("patch", "/payments/config")[0].body).toMatchObject({
      bank_transfer_enabled: true, bank_transfer_details: "Banesco 0102", mobile_payment_enabled: true, mobile_payment_details: "0414 123",
    });
  });
});

describe("Configuración · Plataforma · detalles", () => {
  it("tagline, interruptores y profesor destacado se envían al guardar", async () => {
    mockApi("patch", "/admin/platform-config", {});
    const { user } = setup();
    const tagline = (await screen.findByText(/Tagline \(Eslogan\)/)).parentElement!.querySelector("input") as HTMLInputElement;
    await user.clear(tagline);
    await user.type(tagline, "Aprende ya");
    await user.click(toggleNear(/Modo un solo profesor|un solo profesor|Single/i));
    await user.click(screen.getByRole("button", { name: /Guardar plataforma/ }));
    await waitFor(() => expect(callsTo("patch", "/admin/platform-config")).toHaveLength(1));
    const body = callsTo("patch", "/admin/platform-config")[0].body as { platform_tagline: string; is_single_tenant: boolean };
    expect(body.platform_tagline).toBe("Aprende ya");
    expect(body.is_single_tenant).toBe(true);
  });

  it("el degradado de un título y los pasos del grupo quedan en landing_content", async () => {
    mockApi("patch", "/admin/platform-config", {});
    const { user } = setup();
    await screen.findByText("Título (modo individual)");
    const gradient = screen.getByText("Título (modo individual)").parentElement!.querySelector("select") as HTMLSelectElement;
    const option = Array.from(gradient.options).find((o) => o.value)!;
    await user.selectOptions(gradient, option.value);
    const stepTitle = screen.getByDisplayValue("Paso uno");
    await user.clear(stepTitle);
    await user.type(stepTitle, "Primero");
    const stepDesc = screen.getByDisplayValue("Desc dos");
    fireEvent.change(stepDesc, { target: { value: "Segundo texto" } });
    await user.click(screen.getByRole("button", { name: /Guardar plataforma/ }));
    await waitFor(() => expect(callsTo("patch", "/admin/platform-config")).toHaveLength(1));
    const lc = (callsTo("patch", "/admin/platform-config")[0].body as { landing_content: { title_gradients: Record<string, string>; group_steps: { title: string; desc: string }[] } }).landing_content;
    expect(lc.title_gradients.hero_title_single).toBe(option.value);
    expect(lc.group_steps).toEqual([{ title: "Primero", desc: "Desc uno" }, { title: "Paso dos", desc: "Segundo texto" }]);
  });
});

describe("Configuración · Chats", () => {
  it("las horas de reactivación no pueden ser negativas", async () => {
    mockApi("patch", "/admin/platform-config", {});
    const { user } = setup();
    await tab(user, /Chats/);
    const hours = (await screen.findByDisplayValue("24")) as HTMLInputElement;
    fireEvent.change(hours, { target: { value: "-5" } });
    await user.click(screen.getByRole("button", { name: /Guardar chat/ }));
    await waitFor(() => expect(callsTo("patch", "/admin/platform-config")).toHaveLength(1));
    expect((callsTo("patch", "/admin/platform-config")[0].body as { chat_reactivation_hours: number }).chat_reactivation_hours).toBe(0);
  });
});

describe("Configuración · Reglas · duraciones y enlace de Meet", () => {
  it("siempre queda una duración; se pueden sumar y quitar otras", async () => {
    mockApi("patch", "/system-catalogs/business-rules", {});
    const { user } = setup();
    await tab(user, /Reglas/);
    await screen.findByText("Duraciones permitidas para clases regulares");
    const group = screen.getByText("Duraciones permitidas para clases regulares").parentElement as HTMLElement;
    const btn = (n: number) => Array.from(group.querySelectorAll("button")).find((b) => b.textContent === `${n} min`) as HTMLElement;
    await user.click(btn(50)); // única activa: no se quita
    expect(btn(50).className).toMatch(/bg-pink-500/);
    await user.click(btn(110));
    await user.click(btn(25));
    await user.click(btn(110)); // quitar una de varias
    await user.click(screen.getByRole("button", { name: /Guardar reglas/ }));
    await waitFor(() => expect(callsTo("patch", "/system-catalogs/business-rules")).toHaveLength(1));
    expect((callsTo("patch", "/system-catalogs/business-rules")[0].body as { allowed_class_durations: number[] }).allowed_class_durations).toEqual([25, 50]);
  });

  it("el tiempo para generar el enlace de Meet se acota entre 5 y 180", async () => {
    mockApi("patch", "/system-catalogs/business-rules", {});
    const { user } = setup();
    await tab(user, /Reglas/);
    const input = (await screen.findAllByDisplayValue("30")).find((i) => (i as HTMLInputElement).max === "180") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "999" } });
    await user.click(screen.getByRole("button", { name: /Guardar reglas/ }));
    await waitFor(() => expect(callsTo("patch", "/system-catalogs/business-rules")).toHaveLength(1));
    expect((callsTo("patch", "/system-catalogs/business-rules")[0].body as { meet_link_autogen_minutes: number }).meet_link_autogen_minutes).toBe(180);
  });
});

describe("Configuración · Catálogos · mapa de temas", () => {
  it("cambiar icono y color de una materia y guardar", async () => {
    mockApi("patch", "/system-catalogs/subject_theme_map", {});
    mockApi("patch", /^\/system-catalogs/, {});
    const { user } = setup();
    await tab(user, /Catálogos/);
    const icon = await screen.findByDisplayValue("📐");
    await user.clear(icon);
    await user.type(icon, "🧮");
    const color = icon.parentElement!.querySelector('input[type="color"]') as HTMLInputElement;
    fireEvent.change(color, { target: { value: "#ff0000" } });
    const save = icon.closest("div")!.parentElement!.parentElement!.querySelector("button[class*='bg-pink-500']") as HTMLButtonElement | null;
    await user.click(save ?? screen.getAllByRole("button", { name: "Guardar" }).at(-2)!);
    await waitFor(() => expect(callsTo("patch", /^\/system-catalogs/).length).toBeGreaterThan(0));
    expect(JSON.stringify(callsTo("patch", /^\/system-catalogs/).map((c) => c.body))).toContain("🧮");
  });
});
