/**
 * Configuración global del superadmin: pestañas Plataforma, Chats, Correos, Pagos, Catálogos y Reglas.
 * Se prueba qué se envía al servidor al guardar y cómo reacciona la pantalla a los errores.
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
  whatsapp_number: "+58 412 0000000", default_commission_rate: 10,
};
const RULES = {
  min_booking_hours: 1, min_cancel_hours: 12, min_reschedule_hours_student: 12, allowed_class_durations: [50, 80],
  allowed_package_durations: [50, 80], low_credit_threshold: 1, low_credit_renotify_days: 6, trial_duration_minutes: 25,
  buffer_trial_minutes: 5, buffer_regular_minutes: 10, buffer_group_minutes: 10, meet_link_autogen_minutes: 30,
  min_classes_before_package_change: 0, min_withdrawal_amount: 10,
};
const CATALOGS = {
  subjects: ["Matemática"], languages: ["Español"], spoken_languages: ["Español"], skill_suggestions: ["Gramática"],
  material_categories: ["Guías"], material_levels: ["A1"], package_icon_options: ["🎯"],
  student_goals: { idiomas: [{ text: "Viajar", desc: "Para viajar", icon: "✈️" }], academico: [] },
  student_payment_methods: [{ value: "Paypal", label: "PayPal", icon: "💳" }],
  withdrawal_methods: [{ value: "Banco", label: "Banco", icon: "🏦" }],
  theme_presets: [{ value: "#ec4899", label: "Rosa" }], subject_theme_map: {},
};
const PLATFORM = (over: Record<string, unknown> = {}) => ({ ...FIXTURE.platformConfig, is_single_tenant: false, chat_enabled: true, ...over });

function setup(role: "superadmin" | "teacher_admin" = "superadmin", over: { platform?: Record<string, unknown>; mocks?: () => void } = {}) {
  mockApi("get", "/payments/config", PAYMENT);
  mockApi("get", "/admin/platform-config", PLATFORM(over.platform));
  mockApi("get", "/admin/platform-config/single-blockers", { blocked: false, target: "mar12", affected_students: 0, sample: [] });
  mockApi("get", "/system-catalogs/business-rules", RULES);
  mockApi("get", "/system-catalogs/", CATALOGS);
  mockApi("get", /^\/admin\/teachers/, []);
  mockApi("get", "/admin/email-settings", { categories: [], sent_today: 0, daily_limit: 100, auto_saver_enabled: false, auto_saver_percent: 80, auto_saver_active: false, skipped_today: 0, failed_today: 0, alert: false });
  over.mocks?.();
  const view = renderScreen(<SettingsPage />, { role });
  return { ...view, user: userEvent.setup() };
}

const tab = (u: ReturnType<typeof userEvent.setup>, name: RegExp) => u.click(screen.getByRole("button", { name }));
/** El interruptor sin nombre accesible que acompaña a un rótulo. */
const toggleNear = (label: string | RegExp) => {
  let el: HTMLElement | null = screen.getByText(label);
  while (el && !el.querySelector(":scope > button, :scope > div > button")) el = el.parentElement;
  return (el!.querySelector("button")) as HTMLElement;
};

afterEach(() => { vi.restoreAllMocks(); });

describe("Configuración · pestañas y permisos", () => {
  it("el superadmin ve las seis pestañas y empieza en Plataforma", async () => {
    setup();
    for (const t of ["Plataforma", "Chats", "Correos", "Pagos", "Catálogos", "Reglas"]) {
      expect(await screen.findByRole("button", { name: new RegExp(t) })).toBeInTheDocument();
    }
  });

  it("el teacher_admin solo ve Pagos, Catálogos y Reglas y empieza en Pagos", async () => {
    setup("teacher_admin");
    expect(await screen.findByRole("button", { name: /Pagos/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Plataforma/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Chats/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Correos/ })).not.toBeInTheDocument();
    expect(await screen.findByPlaceholderText("tu@paypal.com")).toBeInTheDocument();
  });

  it("Correos muestra el panel de correos", async () => {
    const { user } = setup();
    await tab(user, /Correos/);
    expect(await screen.findByText(/Límite diario de correos/)).toBeInTheDocument();
  });
});

describe("Configuración · Pagos", () => {
  it("cargar: muestra el email de PayPal y la comisión", async () => {
    const { user } = setup();
    await tab(user, /Pagos/);
    expect(await screen.findByPlaceholderText("tu@paypal.com")).toHaveValue("pay@tpm.com");
  });

  it("editar el email y guardar envía todo el objeto por PATCH /payments/config", async () => {
    mockApi("patch", "/payments/config", {});
    const { user } = setup();
    await tab(user, /Pagos/);
    const email = await screen.findByPlaceholderText("tu@paypal.com");
    await user.clear(email);
    await user.type(email, "nuevo@tpm.com");
    await user.click(screen.getByRole("button", { name: /Guardar/ }));
    await waitFor(() => expect(callsTo("patch", "/payments/config")).toHaveLength(1));
    expect(callsTo("patch", "/payments/config")[0].body).toMatchObject({ paypal_enabled: true, paypal_email: "nuevo@tpm.com" });
    expect(await screen.findByText("Configuración de pagos guardada correctamente")).toBeInTheDocument();
  });

  it("encender Binance, transferencia y pago móvil muestra sus campos; apagar PayPal los esconde", async () => {
    const { user } = setup();
    await tab(user, /Pagos/);
    await screen.findByPlaceholderText("tu@paypal.com");
    await user.click(toggleNear("Binance (USDT)"));
    expect(await screen.findByPlaceholderText("Dirección de wallet")).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText("Dirección de wallet"), "TX1");
    await user.type(screen.getByPlaceholderText("Red (ej: USDT TRC20)"), "TRC20");
    await user.click(toggleNear("PayPal"));
    expect(screen.queryByPlaceholderText("tu@paypal.com")).not.toBeInTheDocument();
  });

  it("un error al guardar se avisa", async () => {
    mockApiError("patch", "/payments/config", 500, "Falló");
    const { user } = setup();
    await tab(user, /Pagos/);
    await user.type(await screen.findByPlaceholderText("tu@paypal.com"), "x");
    await user.click(screen.getByRole("button", { name: /Guardar/ }));
    expect(await screen.findByText("Falló")).toBeInTheDocument();
  });

  it("si no cargan los pagos ofrece reintentar", async () => {
    const { user } = setup("superadmin", { mocks: () => mockApiError("get", "/payments/config", 500, "x") });
    await tab(user, /Pagos/);
    await user.click(await screen.findByRole("button", { name: /Reintentar/ }));
    await waitFor(() => expect(callsTo("get", "/payments/config").length).toBeGreaterThan(1));
  });
});

describe("Configuración · Plataforma", () => {
  it("muestra el nombre de la plataforma y guarda con PATCH /admin/platform-config", async () => {
    mockApi("patch", "/admin/platform-config", {});
    const { user } = setup();
    const name = await screen.findByDisplayValue("TPM Test");
    await user.clear(name);
    await user.type(name, "Mi Academia");
    await user.click(screen.getByRole("button", { name: /Guardar plataforma/ }));
    await waitFor(() => expect(callsTo("patch", "/admin/platform-config")).toHaveLength(1));
    expect(callsTo("patch", "/admin/platform-config")[0].body).toMatchObject({ platform_name: "Mi Academia" });
    expect(await screen.findByText("Configuración de la plataforma guardada correctamente")).toBeInTheDocument();
  });

  it("un 409 por alumnos afectados es un bloqueo: lo avisa, no reintenta y recarga la configuración", async () => {
    mockApi("patch", "/admin/platform-config", () => {
      throw Object.assign(new Error("conflict"), { isAxiosError: true, response: { status: 409, data: { detail: { message: "Hay alumnos con paquetes", affected_students: 2, sample: [{ student_username: "ana" }, {}] } } } });
    });
    const confirm = vi.spyOn(window, "confirm");
    const { user } = setup();
    await screen.findByDisplayValue("TPM Test");
    const before = callsTo("get", /^\/admin\/platform-config/).length;
    await user.click(screen.getByRole("button", { name: /Guardar plataforma/ }));
    expect(await screen.findByText(/Hay alumnos con paquetes[\s\S]*2[\s\S]*ana/)).toBeInTheDocument();
    expect(callsTo("patch", "/admin/platform-config")).toHaveLength(1);
    expect(confirm).not.toHaveBeenCalled();
    await waitFor(() => expect(callsTo("get", /^\/admin\/platform-config/).length).toBeGreaterThan(before));
  });

  it("un 409 sin mensaje usa el texto por defecto", async () => {
    mockApi("patch", "/admin/platform-config", () => {
      throw Object.assign(new Error("c"), { isAxiosError: true, response: { status: 409, data: { detail: { affected_students: 1 } } } });
    });
    const { user } = setup();
    await screen.findByDisplayValue("TPM Test");
    await user.click(screen.getByRole("button", { name: /Guardar plataforma/ }));
    expect(await screen.findByText(/Hay alumnos afectados\. Alumnos afectados: 1/)).toBeInTheDocument();
  });

  it("otro error se avisa con su mensaje", async () => {
    mockApiError("patch", "/admin/platform-config", 400, "Nombre inválido");
    const { user } = setup();
    await screen.findByDisplayValue("TPM Test");
    await user.click(screen.getByRole("button", { name: /Guardar plataforma/ }));
    expect(await screen.findByText("Nombre inválido")).toBeInTheDocument();
  });

  it("multi -> single bloqueado: el interruptor se deshabilita y avisa con los alumnos afectados", async () => {
    setup("superadmin", { mocks: () => mockApi("get", "/admin/platform-config/single-blockers", { blocked: true, target: "mar12", affected_students: 2, sample: [{ student_username: "ana" }, {}] }) });
    expect(await screen.findByText(/hay 2 alumno\(s\)[\s\S]*\(ana\)/)).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Modo profesora única" })).toBeDisabled();
  });

  it("multi -> single sin alumnos que lo impidan: el interruptor está activo y no hay aviso", async () => {
    setup();
    await screen.findByDisplayValue("TPM Test");
    expect(screen.getByRole("switch", { name: "Modo profesora única" })).toBeEnabled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("bloqueo sin nombres de alumnos: el aviso sale igualmente", async () => {
    setup("superadmin", { mocks: () => mockApi("get", "/admin/platform-config/single-blockers", { blocked: true, target: "mar12", affected_students: 1, sample: [] }) });
    expect(await screen.findByText(/hay 1 alumno\(s\)/)).toBeInTheDocument();
  });

  describe("destacada dentro de single", () => {
    const TEACHERS = [{ username: "mar12", name: "Mar", surname: "A" }, { username: "luz", name: "Luz", surname: "B" }];
    const withTeachers = (blockers: unknown, fail = false) => () => {
      mockApi("get", /^\/admin\/teachers/, TEACHERS.map((t) => ({ ...t, user_username: t.username, status: "approved" })));
      if (fail) mockApiError("get", "/admin/platform-config/single-blockers", 500, "x");
      else mockApi("get", "/admin/platform-config/single-blockers", blockers);
    };

    it("elegir otra destacada con alumnos vivos en A avisa y no cambia el valor", async () => {
      const { user } = setup("superadmin", { platform: { is_single_tenant: true }, mocks: withTeachers({ blocked: true, target: "luz", affected_students: 3, sample: [{ student_username: "ana" }] }) });
      const select = (await screen.findAllByRole("combobox"))[0] as HTMLSelectElement;
      const before = select.value;
      await user.selectOptions(select, "luz");
      expect(await screen.findByText(/No se puede cambiar la destacada: hay 3 alumno\(s\)[\s\S]*\(ana\)/)).toBeInTheDocument();
      expect(select.value).toBe(before);
    });

    it("elegir otra destacada sin bloqueo (o si falla la comprobación) cambia el valor", async () => {
      for (const fail of [false, true]) {
        const { user, unmount } = setup("superadmin", { platform: { is_single_tenant: true }, mocks: withTeachers({ blocked: false, target: "luz", affected_students: 0, sample: [] }, fail) });
        const select = (await screen.findAllByRole("combobox"))[0] as HTMLSelectElement;
        await user.selectOptions(select, "luz");
        await waitFor(() => expect(select.value).toBe("luz"));
        unmount();
      }
    });
  });

  it("en modo un-solo-profesor aparece el selector de profesor destacado", async () => {
    setup("superadmin", { platform: { is_single_tenant: true } });
    expect(await screen.findByText("Profesor Destacado")).toBeInTheDocument();
  });

  it("editar un campo de la landing se refleja en lo que se envía", async () => {
    mockApi("patch", "/admin/platform-config", {});
    const { user } = setup();
    const tagline = await screen.findByText("Tagline del footer");
    const input = tagline.parentElement!.querySelector("input, textarea") as HTMLInputElement;
    await user.clear(input);
    await user.type(input, "Aprende feliz");
    await user.click(screen.getByRole("button", { name: /Guardar plataforma/ }));
    await waitFor(() => expect(callsTo("patch", "/admin/platform-config")).toHaveLength(1));
    const body = callsTo("patch", "/admin/platform-config")[0].body as { landing_content: Record<string, unknown> };
    expect(body.landing_content.footer_tagline).toBe("Aprende feliz");
  });

  it("si la configuración no carga muestra un esqueleto, no un formulario vacío", async () => {
    setup("superadmin", { mocks: () => mockApi("get", "/admin/platform-config", () => new Promise(() => {})) });
    expect(screen.queryByRole("button", { name: /Guardar plataforma/ })).not.toBeInTheDocument();
  });
});

describe("Configuración · Chats", () => {
  it("el interruptor general y los números se guardan juntos con la configuración de plataforma", async () => {
    mockApi("patch", "/admin/platform-config", {});
    const { user } = setup();
    await tab(user, /Chats/);
    expect(await screen.findByText("Chat interno")).toBeInTheDocument();
    const nums = document.querySelectorAll('input[type="number"]');
    expect(nums.length).toBeGreaterThanOrEqual(2);
    fireEvent.change(nums[0], { target: { value: "45" } });
    await user.click(screen.getByRole("button", { name: /Guardar/ }));
    await waitFor(() => expect(callsTo("patch", "/admin/platform-config")).toHaveLength(1));
    expect(callsTo("patch", "/admin/platform-config")[0].body).toMatchObject({ chat_retention_days: 45 });
  });

  it("apagar el chat se envía como chat_enabled false", async () => {
    mockApi("patch", "/admin/platform-config", {});
    const { user } = setup();
    await tab(user, /Chats/);
    await user.click(toggleNear("Habilitar el chat interno"));
    await user.click(screen.getByRole("button", { name: /Guardar/ }));
    await waitFor(() => expect(callsTo("patch", "/admin/platform-config")).toHaveLength(1));
    expect(callsTo("patch", "/admin/platform-config")[0].body).toMatchObject({ chat_enabled: false });
  });

  it("si no carga ofrece reintentar", async () => {
    const { user } = setup("superadmin", { mocks: () => mockApiError("get", "/admin/platform-config", 500, "x") });
    await tab(user, /Chats/);
    expect(await screen.findByText(/No se pudo cargar la configuración del chat/)).toBeInTheDocument();
  });
});

describe("Configuración · Catálogos", () => {
  it("lista los valores de cada catálogo", async () => {
    const { user } = setup();
    await tab(user, /Catálogos/);
    expect(await screen.findByText("Materias")).toBeInTheDocument();
    expect(screen.getAllByText("Matemática").length).toBeGreaterThan(0);
    expect(screen.getByText("Gramática")).toBeInTheDocument();
  });

  it("añadir un valor (botón o Enter), no duplicar, quitar y guardar manda la lista a PATCH /system-catalogs/subjects", async () => {
    mockApi("patch", "/system-catalogs/subjects", {});
    const { user } = setup();
    await tab(user, /Catálogos/);
    const card = (await screen.findByText("Materias")).parentElement as HTMLElement;
    const input = within(card).getByPlaceholderText("Añadir...");
    await user.type(input, "Física{enter}");
    expect(within(card).getByText("Física")).toBeInTheDocument();
    await user.type(input, "Física");
    await user.click(within(card).getByRole("button", { name: "+" }));
    expect(within(card).getAllByText("Física")).toHaveLength(1);
    await user.click(within(card).getByText("Matemática").parentElement!.querySelector("button") as HTMLElement);
    await user.click(within(card).getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(callsTo("patch", "/system-catalogs/subjects")).toHaveLength(1));
    expect(callsTo("patch", "/system-catalogs/subjects")[0].body).toEqual({ value: ["Física"] });
    expect(await screen.findByText("Catálogo actualizado correctamente")).toBeInTheDocument();
  });

  it("un error al guardar un catálogo se avisa", async () => {
    mockApiError("patch", /\/system-catalogs\/languages/, 500, "Catálogo roto");
    const { user } = setup();
    await tab(user, /Catálogos/);
    const card = (await screen.findAllByText("Idiomas")).find((e) => e.tagName === "P")!.parentElement as HTMLElement;
    await user.click(within(card).getByRole("button", { name: "Guardar" }));
    expect(await screen.findByText("Catálogo roto")).toBeInTheDocument();
  });

  it("objetivos: editar, añadir y quitar por categoría; cambiar de categoría", async () => {
    mockApi("patch", "/system-catalogs/student_goals", {});
    const { user } = setup();
    await tab(user, /Catálogos/);
    const title = await screen.findByDisplayValue("Viajar");
    await user.clear(title);
    await user.type(title, "Viajar más");
    await user.click(screen.getByRole("button", { name: /Añadir objetivo/ }));
    expect(screen.getAllByPlaceholderText("Título")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Otras materias" }));
    expect(screen.queryByDisplayValue("Viajar más")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Idiomas" }));
    const card = screen.getByDisplayValue("Viajar más").closest("div")!.parentElement!.parentElement as HTMLElement;
    await user.click(within(card).getAllByRole("button", { name: "Guardar" })[0]);
    await waitFor(() => expect(callsTo("patch", "/system-catalogs/student_goals")).toHaveLength(1));
    expect((callsTo("patch", "/system-catalogs/student_goals")[0].body as { value: { idiomas: unknown[] } }).value.idiomas[0]).toMatchObject({ text: "Viajar más" });
  });

  it("métodos de pago: editar valor y etiqueta, añadir y quitar", async () => {
    mockApi("patch", "/system-catalogs/student_payment_methods", {});
    const { user } = setup();
    await tab(user, /Catálogos/);
    const value = await screen.findByDisplayValue("Paypal");
    await user.clear(value);
    await user.type(value, "PayPal2");
    await user.click(screen.getAllByRole("button", { name: /Añadir método/ })[0]);
    expect(screen.getAllByPlaceholderText("etiqueta visible").length).toBeGreaterThanOrEqual(3);
  });

  it("temas: cambiar el color y la etiqueta de un preset", async () => {
    const { user } = setup();
    await tab(user, /Catálogos/);
    const label = await screen.findByDisplayValue("Rosa");
    await user.clear(label);
    await user.type(label, "Fucsia");
    expect(label).toHaveValue("Fucsia");
  });

  it("si no cargan los catálogos ofrece reintentar", async () => {
    const { user } = setup("superadmin", { mocks: () => mockApiError("get", "/system-catalogs/", 500, "x") });
    await tab(user, /Catálogos/);
    await user.click(await screen.findByRole("button", { name: /Reintentar/ }));
    await waitFor(() => expect(callsTo("get", "/system-catalogs/").length).toBeGreaterThan(1));
  });
});

describe("Configuración · Reglas de negocio", () => {
  it("cargar: muestra los valores y las duraciones marcadas", async () => {
    const { user } = setup();
    await tab(user, /Reglas/);
    expect(await screen.findByText(/Duraciones permitidas para clases regulares/)).toBeInTheDocument();
    expect(screen.getAllByRole("spinbutton").length).toBeGreaterThan(3);
  });

  it("cambiar números y duraciones y guardar manda las reglas por PATCH", async () => {
    mockApi("patch", "/system-catalogs/business-rules", RULES);
    const { user } = setup();
    await tab(user, /Reglas/);
    await screen.findByText(/Duraciones permitidas para clases regulares/);
    const firstNum = screen.getAllByRole("spinbutton")[0];
    fireEvent.change(firstNum, { target: { value: "3" } });
    const regular = screen.getByText(/Duraciones permitidas para clases regulares/).parentElement as HTMLElement;
    const buttons = within(regular).getAllByRole("button");
    await user.click(buttons[buttons.length - 1]); // marca/desmarca una duración
    await user.click(screen.getByRole("button", { name: /Guardar reglas|Guardar/ }));
    await waitFor(() => expect(callsTo("patch", "/system-catalogs/business-rules")).toHaveLength(1));
    expect(callsTo("patch", "/system-catalogs/business-rules")[0].body).toMatchObject({ min_booking_hours: 3 });
    expect(await screen.findByText("Reglas de negocio guardadas correctamente")).toBeInTheDocument();
  });

  it("la duración de la prueba y los márgenes se pueden cambiar", async () => {
    mockApi("patch", "/system-catalogs/business-rules", RULES);
    const { user } = setup();
    await tab(user, /Reglas/);
    await screen.findByText(/Duración de la clase de prueba/);
    const trial = screen.getByText(/Duración de la clase de prueba/).parentElement as HTMLElement;
    const opts = within(trial).getAllByRole("button");
    await user.click(opts[opts.length - 1]);
    const margin = screen.getByText(/Margen — clase de prueba/).parentElement!.querySelector("input") as HTMLInputElement;
    fireEvent.change(margin, { target: { value: "99" } });
    expect(margin).toHaveValue(60); // tope
    fireEvent.change(margin, { target: { value: "" } });
    expect(margin).toHaveValue(0);
    await user.click(screen.getByRole("button", { name: /Guardar reglas|Guardar/ }));
    await waitFor(() => expect(callsTo("patch", "/system-catalogs/business-rules")).toHaveLength(1));
  });

  it("un error al guardar las reglas se avisa y no pierde lo editado", async () => {
    mockApiError("patch", "/system-catalogs/business-rules", 422, "Regla inválida");
    const { user } = setup();
    await tab(user, /Reglas/);
    await screen.findByText(/Duraciones permitidas para clases regulares/);
    fireEvent.change(screen.getAllByRole("spinbutton")[0], { target: { value: "4" } });
    await user.click(screen.getByRole("button", { name: /Guardar reglas|Guardar/ }));
    expect(await screen.findByText("Regla inválida")).toBeInTheDocument();
    expect(screen.getAllByRole("spinbutton")[0]).toHaveValue(4);
  });

  it("si no cargan las reglas ofrece reintentar", async () => {
    const { user } = setup("superadmin", { mocks: () => mockApiError("get", "/system-catalogs/business-rules", 500, "x") });
    await tab(user, /Reglas/);
    await user.click(await screen.findByRole("button", { name: /Reintentar/ }));
    await waitFor(() => expect(callsTo("get", "/system-catalogs/business-rules").length).toBeGreaterThan(1));
  });
});
