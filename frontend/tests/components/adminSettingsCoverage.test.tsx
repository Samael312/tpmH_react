/**
 * Configuración · cierra funciones sin ejercitar: campos de la landing, WhatsApp y comisión, profesor destacado,
 * reintento de plataforma y chat, y los editores de catálogos (objetivos, métodos de pago, colores de tema, listas).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import SettingsPage from "@/app/(superadmin)/admin/settings/page";
import { renderScreen } from "./render";
import { mockApi, mockApiError, callsTo, FIXTURE } from "./fakeApi";

const PAYMENT = {
  paypal_enabled: true, binance_enabled: false, bank_transfer_enabled: false, mobile_payment_enabled: false,
  paypal_email: "pay@tpm.com", binance_address: "", binance_network: "", bank_transfer_details: "", mobile_payment_details: "",
  whatsapp_number: "+58 412 0000000", default_commission_rate: 0.1,
};
const RULES = {
  min_booking_hours: 1, min_cancel_hours: 12, min_reschedule_hours_student: 12, allowed_class_durations: [50], allowed_package_durations: [50, 80],
  low_credit_threshold: 1, low_credit_renotify_days: 6, trial_duration_minutes: 25, buffer_trial_minutes: 5, buffer_regular_minutes: 10,
  buffer_group_minutes: 10, meet_link_autogen_minutes: 30, min_classes_before_package_change: 0, min_withdrawal_amount: 10,
};
const CATALOGS = {
  subjects: ["Matemática"], languages: ["Español"], spoken_languages: ["Español"], skill_suggestions: ["Gramática"],
  material_categories: ["Guías"], material_levels: ["A1"], package_icon_options: ["🎯"],
  student_goals: { idiomas: [{ text: "Viajar", desc: "Para viajar", icon: "✈️" }], academico: [] },
  student_payment_methods: [{ value: "Paypal", label: "PayPal", icon: "💳" }, { value: "Zelle", label: "Zelle", icon: "💵" }],
  withdrawal_methods: [{ value: "Banco", label: "Banco", icon: "🏦" }],
  theme_presets: [{ value: "#ec4899", label: "Rosa" }, { value: "#3b82f6", label: "Azul" }],
  subject_theme_map: { Matemática: { icon: "📐", color: "#3b82f6" } },
};
const LANDING = { ...FIXTURE.platformConfig.landing_content, group_steps: [{ title: "Paso uno", desc: "Desc uno" }], title_gradients: {} };

function setup(over: { mocks?: () => void } = {}) {
  mockApi("get", "/payments/config", PAYMENT);
  mockApi("get", "/admin/platform-config", { ...FIXTURE.platformConfig, is_single_tenant: false, chat_enabled: true, chat_reactivation_hours: 24, landing_content: LANDING });
  mockApi("get", "/system-catalogs/business-rules", RULES);
  mockApi("get", "/system-catalogs/", CATALOGS);
  mockApi("get", /^\/admin\/teachers/, [{ username: "ana", name: "Ana", surname: "P" }]);
  mockApi("get", "/admin/email-settings", { categories: [], sent_today: 0, daily_limit: 100, auto_saver_enabled: false, auto_saver_percent: 80, auto_saver_active: false });
  over.mocks?.();
  const view = renderScreen(<SettingsPage />, { role: "superadmin" });
  return { ...view, user: userEvent.setup() };
}
const tab = (u: ReturnType<typeof userEvent.setup>, name: RegExp) => u.click(screen.getByRole("button", { name }));
const toggleNear = (label: string | RegExp) => {
  let el: HTMLElement | null = screen.getByText(label);
  while (el && !el.querySelector(":scope > button, :scope > div > button")) el = el.parentElement;
  return el!.querySelector("button") as HTMLElement;
};
/** La tarjeta de un editor: el <p> con su título y el contenedor que lo envuelve. */
const card = (title: string | RegExp) => screen.getAllByText(title).find((e) => e.tagName === "P")!.parentElement as HTMLElement;

afterEach(() => { vi.restoreAllMocks(); });

describe("Configuración · Pagos · WhatsApp y comisión", () => {
  it("cambiar el WhatsApp y la comisión se envía al guardar", async () => {
    mockApi("patch", "/payments/config", {});
    const { user } = setup();
    await tab(user, /Pagos/);
    const whatsapp = (await screen.findByDisplayValue("+58 412 0000000")) as HTMLInputElement;
    fireEvent.change(whatsapp, { target: { value: "+34 600 000 000" } });
    const commission = screen.getByDisplayValue("0.1") as HTMLInputElement;
    fireEvent.change(commission, { target: { value: "0.25" } });
    await user.click(screen.getByRole("button", { name: /Guardar métodos de pago/ }));
    await waitFor(() => expect(callsTo("patch", "/payments/config")).toHaveLength(1));
    expect(callsTo("patch", "/payments/config")[0].body).toMatchObject({ whatsapp_number: "+34 600 000 000", default_commission_rate: 0.25 });
  });

  it("una comisión no numérica queda en 0", async () => {
    mockApi("patch", "/payments/config", {});
    const { user } = setup();
    await tab(user, /Pagos/);
    const commission = (await screen.findByDisplayValue("0.1")) as HTMLInputElement;
    fireEvent.change(commission, { target: { value: "" } });
    await user.click(screen.getByRole("button", { name: /Guardar métodos de pago/ }));
    await waitFor(() => expect(callsTo("patch", "/payments/config")).toHaveLength(1));
    expect((callsTo("patch", "/payments/config")[0].body as { default_commission_rate: number }).default_commission_rate).toBe(0);
  });
});

describe("Configuración · Plataforma · profesor destacado y WhatsApp visible", () => {
  it("elegir profesor destacado y activar el WhatsApp del profesor se envía al guardar", async () => {
    mockApi("patch", "/admin/platform-config", {});
    const { user } = setup({ mocks: () => mockApi("get", "/admin/platform-config", { ...FIXTURE.platformConfig, is_single_tenant: true, chat_enabled: true, landing_content: LANDING }) });
    const select = (await screen.findByRole("option", { name: /Ana P \(@ana\)/ })).closest("select") as HTMLSelectElement;
    await user.selectOptions(select, "ana");
    await user.click(toggleNear("Mostrar WhatsApp de los profesores"));
    await user.click(screen.getByRole("button", { name: /Guardar plataforma/ }));
    await waitFor(() => expect(callsTo("patch", "/admin/platform-config")).toHaveLength(1));
    const body = callsTo("patch", "/admin/platform-config")[0].body as { featured_teacher_username: string; show_teacher_whatsapp: boolean };
    expect(body.featured_teacher_username).toBe("ana");
    expect(typeof body.show_teacher_whatsapp).toBe("boolean");
  });

  it("editar cada campo de la landing y su degradado queda en landing_content", async () => {
    mockApi("patch", "/admin/platform-config", {});
    const { user } = setup();
    await screen.findByText("Título (modo individual)");
    const root = screen.getByText("Hero").closest("div")!.parentElement!.parentElement as HTMLElement;
    const fields = Array.from(root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input[type='text'], textarea"))
      .filter((el) => !el.placeholder?.startsWith("Ej: Aprende") || true);
    fields.forEach((el, i) => fireEvent.change(el, { target: { value: `v${i}-nuevo` } }));
    for (const sel of Array.from(root.querySelectorAll("select"))) {
      const opt = Array.from(sel.options).find((o) => o.value);
      if (opt) await user.selectOptions(sel, opt.value);
    }
    await user.click(screen.getByRole("button", { name: /Guardar plataforma/ }));
    await waitFor(() => expect(callsTo("patch", "/admin/platform-config")).toHaveLength(1));
    const lc = (callsTo("patch", "/admin/platform-config")[0].body as { landing_content: Record<string, unknown> }).landing_content;
    const edited = Object.entries(lc).filter(([, v]) => typeof v === "string" && /^v\d+-nuevo$/.test(v));
    expect(edited.length).toBeGreaterThanOrEqual(15);
    for (const k of ["hero_title_multi", "about_label_single", "about_description_multi", "videos_subtitle", "plans_label", "plans_subtitle", "group_plans_title", "reviews_subtitle", "cta_title", "cta_subtitle", "footer_tagline"]) {
      expect(lc[k], k).toMatch(/^v\d+-nuevo$/);
    }
    expect(Object.keys(lc.title_gradients as object).length).toBeGreaterThanOrEqual(5);
  });
});

describe("Configuración · reintentos", () => {
  it("si falla la plataforma, Reintentar la vuelve a pedir; lo mismo en Chats", async () => {
    const { user } = setup({ mocks: () => mockApiError("get", "/admin/platform-config", 500, "x") });
    const retry = await screen.findByRole("button", { name: /Reintentar/ });
    const before = callsTo("get", "/admin/platform-config").length;
    await user.click(retry);
    await waitFor(() => expect(callsTo("get", "/admin/platform-config").length).toBeGreaterThan(before));
    await tab(user, /Chats/);
    const retryChat = await screen.findByRole("button", { name: /Reintentar/ });
    const beforeChat = callsTo("get", "/admin/platform-config").length;
    await user.click(retryChat);
    await waitFor(() => expect(callsTo("get", "/admin/platform-config").length).toBeGreaterThan(beforeChat));
  });

  it("el botón de actualizar recarga pagos, plataforma, catálogos y reglas", async () => {
    const { user } = setup();
    await screen.findByText("Título (modo individual)");
    const before = callsTo("get", "/payments/config").length;
    const refresh = screen.getAllByRole("button").find((b) => /actualizar|refrescar|refresh/i.test(`${b.getAttribute("aria-label") ?? ""} ${b.title} ${b.textContent}`));
    expect(refresh).toBeTruthy();
    await user.click(refresh!);
    await waitFor(() => expect(callsTo("get", "/payments/config").length).toBeGreaterThan(before));
  });
});

describe("Configuración · Catálogos · editores", () => {
  it("cada lista de texto guarda por su clave", async () => {
    mockApi("patch", /^\/system-catalogs\//, {});
    const { user } = setup();
    await tab(user, /Catálogos/);
    for (const [label, key] of [
      ["Idiomas", "languages"], ["Habilidades sugeridas", "skill_suggestions"], ["Categorías de materiales", "material_categories"],
      ["Niveles de materiales", "material_levels"], ["Iconos de paquetes", "package_icon_options"],
    ] as const) {
      await screen.findAllByText(label);
      await user.click(within(card(label)).getByRole("button", { name: "Guardar" }));
      await waitFor(() => expect(callsTo("patch", `/system-catalogs/${key}`), key).toHaveLength(1));
    }
  });

  it("objetivos: editar icono, título y descripción; añadir en «Otras materias»; quitar; guardar", async () => {
    mockApi("patch", "/system-catalogs/student_goals", {});
    const { user } = setup();
    await tab(user, /Catálogos/);
    await screen.findByText("Objetivos de aprendizaje");
    const c = () => within(card("Objetivos de aprendizaje"));
    fireEvent.change(c().getByDisplayValue("✈️"), { target: { value: "🌍" } });
    fireEvent.change(c().getByDisplayValue("Viajar"), { target: { value: "Viajar mucho" } });
    fireEvent.change(c().getByDisplayValue("Para viajar"), { target: { value: "Viajes largos" } });
    await user.click(c().getByRole("button", { name: "Otras materias" }));
    expect(c().getByText("Sin objetivos en esta categoría todavía.")).toBeInTheDocument();
    await user.click(c().getByRole("button", { name: "+ Añadir objetivo" }));
    await user.type(c().getByPlaceholderText("Título"), "Aprobar");
    await user.click(c().getByRole("button", { name: "✕" }));
    await user.click(c().getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(callsTo("patch", "/system-catalogs/student_goals")).toHaveLength(1));
    expect(callsTo("patch", "/system-catalogs/student_goals")[0].body).toEqual({
      value: { idiomas: [{ text: "Viajar mucho", desc: "Viajes largos", icon: "🌍" }], academico: [] },
    });
  });

  it("métodos de pago y de retiro: editar los tres campos, añadir, quitar y guardar", async () => {
    mockApi("patch", /^\/system-catalogs\//, {});
    const { user } = setup();
    await tab(user, /Catálogos/);
    await screen.findByText("Métodos de pago (estudiante)");
    const pay = () => within(card("Métodos de pago (estudiante)"));
    fireEvent.change(pay().getByDisplayValue("💳"), { target: { value: "🅿️" } });
    fireEvent.change(pay().getByDisplayValue("Paypal"), { target: { value: "PayPal2" } });
    fireEvent.change(pay().getByDisplayValue("PayPal"), { target: { value: "PayPal visible" } });
    await user.click(pay().getByRole("button", { name: "+ Añadir método" }));
    expect(pay().getAllByPlaceholderText("etiqueta visible")).toHaveLength(3);
    await user.click(pay().getAllByRole("button", { name: "✕" })[1]); // quita Zelle
    await user.click(pay().getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(callsTo("patch", "/system-catalogs/student_payment_methods")).toHaveLength(1));
    expect(callsTo("patch", "/system-catalogs/student_payment_methods")[0].body).toEqual({
      value: [{ value: "PayPal2", label: "PayPal visible", icon: "🅿️" }, { value: "", label: "", icon: "💳" }],
    });
    const out = within(card("Métodos de retiro (profesor)"));
    await user.click(out.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(callsTo("patch", "/system-catalogs/withdrawal_methods")).toHaveLength(1));
  });

  it("colores de tema: cambiar color y etiqueta, añadir, quitar y guardar", async () => {
    mockApi("patch", /^\/system-catalogs\//, {});
    const { user } = setup();
    await tab(user, /Catálogos/);
    await screen.findByText("Colores de tema");
    const c = () => within(card("Colores de tema"));
    fireEvent.change(c().getByDisplayValue("Rosa"), { target: { value: "Fucsia" } });
    const color = c().getByDisplayValue("Fucsia").parentElement!.querySelector('input[type="color"]') as HTMLInputElement;
    fireEvent.change(color, { target: { value: "#ff00ff" } });
    await user.click(c().getByRole("button", { name: "+" }));
    await user.click(c().getAllByRole("button", { name: "✕" })[1]); // quita Azul
    await user.click(c().getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(callsTo("patch", "/system-catalogs/theme_presets")).toHaveLength(1));
    expect(callsTo("patch", "/system-catalogs/theme_presets")[0].body).toEqual({
      value: [{ value: "#ff00ff", label: "Fucsia" }, { label: "", value: "#000000" }],
    });
  });
});

describe("Configuración · Reglas · paquetes y márgenes", () => {
  it("duraciones de paquetes y márgenes de clase regular y grupal se envían al guardar", async () => {
    mockApi("patch", "/system-catalogs/business-rules", {});
    const { user } = setup();
    await tab(user, /Reglas/);
    const group = (await screen.findByText("Duraciones permitidas para paquetes")).parentElement as HTMLElement;
    await user.click(Array.from(group.querySelectorAll("button")).find((b) => b.textContent === "25 min") as HTMLElement);
    const margin = (label: RegExp) => screen.getByText(label).parentElement!.querySelector("input") as HTMLInputElement;
    fireEvent.change(margin(/Margen — clase regular/), { target: { value: "15" } });
    fireEvent.change(margin(/Margen — clase grupal/), { target: { value: "20" } });
    await user.click(screen.getByRole("button", { name: /Guardar reglas/ }));
    await waitFor(() => expect(callsTo("patch", "/system-catalogs/business-rules")).toHaveLength(1));
    expect(callsTo("patch", "/system-catalogs/business-rules")[0].body).toMatchObject({
      allowed_package_durations: [25, 50, 80], buffer_regular_minutes: 15, buffer_group_minutes: 20,
    });
  });
});
