/**
 * Paneles de administración: control de correos (cuota, categorías, modo ahorro), banner de cuota y visor de logs.
 */
import { describe, expect, it } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import EmailSettingsPanel from "@/components/admin/EmailSettingsPanel";
import EmailQuotaBanner from "@/components/admin/EmailQuotaBanner";
import ErrorLogsViewer from "@/components/admin/ErrorLogsViewer";
import { renderScreen } from "./render";
import { mockApi, mockApiError, callsTo } from "./fakeApi";

const cat = (over: Record<string, unknown> = {}) => ({
  key: "class_reminder", label: "Recordatorio de clase", probability: "alta", essential: false, enabled: true,
  sent_today: 4, skipped_today: 0, failed_today: 0, emails: [], ...over,
});
const settings = (over: Record<string, unknown> = {}) => ({
  categories: [cat(), cat({ key: "welcome", label: "Bienvenida", probability: "baja", enabled: false }), cat({ key: "password_reset", label: "Recuperar contraseña", essential: true, probability: "media" })],
  sent_today: 37, daily_limit: 100, auto_saver_enabled: false, auto_saver_percent: 80, auto_saver_active: false,
  skipped_today: 0, failed_today: 0, alert: false, ...over,
});

describe("EmailSettingsPanel", () => {
  const setup = (s = settings()) => {
    mockApi("get", "/admin/email-settings", s);
    renderScreen(<EmailSettingsPanel />, { role: "superadmin" });
    return userEvent.setup();
  };

  it("muestra el uso del día y el porcentaje de la cuota", async () => {
    setup();
    expect(await screen.findByTestId("email-usage")).toHaveTextContent("37 / 100");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "37");
  });

  it("cada categoría muestra su probabilidad y su estado de interruptor", async () => {
    setup();
    expect(await screen.findByText("Recordatorio de clase")).toBeInTheDocument();
    expect(screen.getByText("Alta")).toBeInTheDocument();
    expect(screen.getByText("Baja")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Enviar: Recordatorio de clase" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("switch", { name: "Enviar: Bienvenida" })).toHaveAttribute("aria-checked", "false");
  });

  it("las esenciales no se pueden apagar", async () => {
    setup();
    const essential = await screen.findByRole("switch", { name: "Recuperar contraseña (siempre activo)" });
    expect(essential).toBeDisabled();
    expect(essential).toHaveAttribute("aria-checked", "true");
  });

  it("guardar está desactivado hasta que se cambie algo", async () => {
    setup();
    await screen.findByTestId("email-usage");
    expect(screen.getByRole("button", { name: /Guardar/ })).toBeDisabled();
  });

  it("apagar una categoría y guardar envía SOLO lo que cambió", async () => {
    const user = setup();
    await user.click(await screen.findByRole("switch", { name: "Enviar: Recordatorio de clase" }));
    await user.click(screen.getByRole("button", { name: /Guardar/ }));
    await waitFor(() => expect(callsTo("put", "/admin/email-settings")).toHaveLength(1));
    expect(callsTo("put", "/admin/email-settings")[0].body).toEqual({ notifications: { class_reminder: false } });
    expect(await screen.findByText("Configuración de correos guardada")).toBeInTheDocument();
  });

  it("cambiar el límite diario y el modo ahorro se envía junto", async () => {
    const user = setup();
    const limit = await screen.findByLabelText("Límite diario de correos");
    // OJO UX (KNOWN_ISSUES): al borrar el campo el componente lo ajusta a 1 al instante, así que teclear "300" tras
    // borrar da "1300". Aquí se fija el valor de una vez para probar lo que se envía.
    fireEvent.change(limit, { target: { value: "300" } });
    await user.click(screen.getByRole("switch", { name: "Modo ahorro automático" }));
    await user.click(screen.getByRole("button", { name: /Guardar/ }));
    await waitFor(() => expect(callsTo("put", "/admin/email-settings")).toHaveLength(1));
    expect(callsTo("put", "/admin/email-settings")[0].body).toEqual({ daily_limit: 300, auto_saver_enabled: true });
  });

  it("el límite nunca baja de 1 ni el porcentaje pasa de 100", async () => {
    setup(settings({ auto_saver_enabled: true }));
    const limit = await screen.findByLabelText("Límite diario de correos");
    fireEvent.change(limit, { target: { value: "0" } });
    expect(limit).toHaveValue(1);
    fireEvent.change(limit, { target: { value: "-5" } });
    expect(limit).toHaveValue(1);
    const pct = screen.getByLabelText("Pausar al llegar al (%)");
    fireEvent.change(pct, { target: { value: "250" } });
    expect(pct).toHaveValue(100);
  });

  it("el porcentaje de ahorro está bloqueado si el modo ahorro está apagado", async () => {
    setup();
    expect(await screen.findByLabelText("Pausar al llegar al (%)")).toBeDisabled();
  });

  it("modo ahorro activo se anuncia", async () => {
    setup(settings({ auto_saver_active: true, auto_saver_enabled: true }));
    expect(await screen.findByText(/Modo ahorro activo/)).toBeInTheDocument();
  });

  it("con alerta muestra cuántos correos se omitieron o fallaron", async () => {
    setup(settings({ alert: true, skipped_today: 3, failed_today: 1 }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Hoy hay 3 correos omitidos y 1 fallido por cuota o configuración de correos.");
  });

  it("si el guardado falla avisa con el motivo y deja los cambios para reintentar", async () => {
    mockApiError("put", "/admin/email-settings", 500, "Servidor caído");
    const user = setup();
    await user.click(await screen.findByRole("switch", { name: "Enviar: Recordatorio de clase" }));
    await user.click(screen.getByRole("button", { name: /Guardar/ }));
    expect(await screen.findByText(/Servidor caído|No se pudo guardar/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Guardar/ })).toBeEnabled();
  });

  it("si la configuración no carga ofrece reintentar", async () => {
    mockApiError("get", "/admin/email-settings", 500, "x");
    renderScreen(<EmailSettingsPanel />, { role: "superadmin" });
    expect(await screen.findByText(/No se pudo cargar la configuración de correos/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
  });
});

describe("EmailQuotaBanner", () => {
  it("solo el superadmin lo ve y solo si hay alerta", async () => {
    mockApi("get", "/admin/email-settings", settings({ alert: true, skipped_today: 2 }));
    renderScreen(<EmailQuotaBanner />, { role: "superadmin" });
    expect(await screen.findByRole("alert")).toHaveTextContent("2 correos omitidos");
    expect(screen.getByRole("link", { name: "Revisar correos" })).toHaveAttribute("href", "/admin/settings");
  });

  it("sin alerta no pinta nada", async () => {
    mockApi("get", "/admin/email-settings", settings());
    const { container } = renderScreen(<EmailQuotaBanner />, { role: "superadmin" });
    await waitFor(() => expect(callsTo("get", "/admin/email-settings").length).toBeGreaterThan(0));
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("un teacher_admin no lo ve ni siquiera consulta la cuota", async () => {
    mockApi("get", "/admin/email-settings", settings({ alert: true, skipped_today: 2 }));
    const { container } = renderScreen(<EmailQuotaBanner />, { role: "teacher_admin" });
    await new Promise((r) => setTimeout(r, 100));
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(callsTo("get", "/admin/email-settings")).toHaveLength(0);
  });
});

describe("ErrorLogsViewer", () => {
  const log = (over: Record<string, unknown> = {}) => ({
    id: 1, level: "error", source: "backend", message: "Boom en /classes", status_code: 500, screen: "/classes", method: "GET",
    user_id: 5, user_name: "Ana Pérez", user_role: "student", detail: "Traceback (most recent call last)", extra_data: null,
    created_at: "2026-11-20T12:00:00Z", ...over,
  });
  const stats = { last_24h: 9, errors: 7, warnings: 2, security: 1, total: 120 };

  function setup(items: unknown[] = [log()], total = items.length) {
    mockApi("get", /^\/logs\/stats/, stats);
    mockApi("get", /^\/logs\/users/, [{ id: 5, name: "Ana Pérez" }]);
    mockApi("get", /^\/logs(\?.*)?$/, { items, total, page: 1, page_size: 30 });
    renderScreen(<ErrorLogsViewer />, { role: "superadmin" });
    return userEvent.setup();
  }

  it("muestra las estadísticas y el listado", async () => {
    setup();
    expect(await screen.findByText("Boom en /classes")).toBeInTheDocument();
    expect(screen.getByText("Últimas 24h").closest("div")!.textContent).toContain("9");
    expect(screen.getByText(/Ana Pérez/, { selector: "p" })).toBeInTheDocument();
  });

  it("sin resultados con los filtros actuales lo dice", async () => {
    setup([]);
    expect(await screen.findByText(/No hay errores registrados con estos filtros/)).toBeInTheDocument();
  });

  it("un log sin usuario se rotula como anónimo", async () => {
    setup([log({ user_name: null, user_role: null })]);
    expect(await screen.findByText(/Usuario anónimo \/ no identificado/)).toBeInTheDocument();
  });

  it("el detalle (stack) está oculto hasta desplegarlo", async () => {
    const user = setup([log({ extra_data: { path: "/x" } })]);
    await screen.findByText("Boom en /classes");
    expect(screen.queryByText(/Traceback/)).not.toBeInTheDocument();
    const row = screen.getByText("Boom en /classes").closest("div.rounded-2xl") as HTMLElement;
    await user.click(row.querySelector("button") as HTMLElement);
    expect(await screen.findByText(/Traceback/)).toBeInTheDocument();
    expect(screen.getByText(/"path": "\/x"/)).toBeInTheDocument();
  });

  it("filtrar por fuente y nivel pide al servidor esos filtros y vuelve a la página 1", async () => {
    const user = setup([log()], 90);
    await screen.findByText("Boom en /classes");
    await user.click(screen.getByRole("button", { name: "Siguiente" }));
    expect(await screen.findByText("Página 2 de 3")).toBeInTheDocument();
    await user.selectOptions(screen.getByDisplayValue("Backend, Frontend y Seguridad"), "security");
    await user.selectOptions(screen.getByDisplayValue("Errores y Advertencias"), "warning");
    await waitFor(() => {
      const last = callsTo("get", /^\/logs(\?.*)?$/).at(-1)!;
      expect(last.params).toMatchObject({ source: "security", level: "warning", page: 1 });
    });
    expect(await screen.findByText("Página 1 de 3")).toBeInTheDocument();
  });

  it("paginación: Anterior desactivado en la primera y Siguiente en la última", async () => {
    const user = setup([log()], 45); // 2 páginas de 30
    await screen.findByText("Página 1 de 2");
    expect(screen.getByRole("button", { name: "Anterior" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Siguiente" }));
    expect(await screen.findByText("Página 2 de 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Siguiente" })).toBeDisabled();
  });

  it("una sola página no muestra paginación", async () => {
    setup([log()], 5);
    await screen.findByText("Boom en /classes");
    expect(screen.queryByRole("button", { name: "Siguiente" })).not.toBeInTheDocument();
  });

  it("buscar por pantalla manda el texto", async () => {
    const user = setup();
    await user.type(await screen.findByPlaceholderText(/Buscar por pantalla/), "/pay");
    await waitFor(() => expect(callsTo("get", /^\/logs(\?.*)?$/).at(-1)!.params).toMatchObject({ screen: "/pay" }));
  });

  it("la insignia de fuente distingue backend, frontend y seguridad", async () => {
    setup([log({ id: 1, source: "backend" }), log({ id: 2, source: "frontend", message: "F" }), log({ id: 3, source: "security", message: "S" })]);
    await screen.findByText("F");
    const rows = screen.getAllByText(/^(backend|frontend|security)$/);
    expect(rows.map((r) => r.textContent)).toEqual(expect.arrayContaining(["backend", "frontend", "security"]));
  });
});
