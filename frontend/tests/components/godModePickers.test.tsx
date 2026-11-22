/**
 * Modo Dios: selector de horarios del profesor (con salto de antelación mínima) y visor del historial de auditoría.
 */
import { describe, expect, it, vi } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { screen, waitFor } from "@testing-library/react";
import GodModeAvailabilityPicker from "@/components/god-mode/GodModeAvailabilityPicker";
import GodModeAuditLogViewer from "@/components/god-mode/GodModeAuditLogViewer";
import { renderScreen } from "./render";
import { mockApi, mockApiError, callsTo } from "./fakeApi";

const HOUR = 3600_000;
const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const slot = (h: number, over: Record<string, unknown> = {}) => ({
  start_time_utc: new Date(Date.now() + (24 + h) * HOUR).toISOString(), end_time_utc: new Date(Date.now() + (25 + h) * HOUR).toISOString(),
  is_available: true, is_past: false, too_soon: false, is_preferred: false, ...over,
});

async function pickTomorrow(user: ReturnType<typeof userEvent.setup>) {
  const t = new Date(); t.setDate(t.getDate() + 1);
  if (t.getMonth() !== new Date().getMonth()) await user.click(screen.getByRole("button", { name: "Mes siguiente" }));
  await user.click(screen.getByRole("button", { name: `${t.getDate()} de ${MONTHS[t.getMonth()]} de ${t.getFullYear()}` }));
}

describe("GodModeAvailabilityPicker", () => {
  function setup(props: Partial<React.ComponentProps<typeof GodModeAvailabilityPicker>> = {}) {
    const onClose = vi.fn(); const onSelect = vi.fn();
    renderScreen(<GodModeAvailabilityPicker teacherUsername="profe" duration={50} onClose={onClose} onSelect={onSelect} {...props} />, { role: "superadmin" });
    return { onClose, onSelect, user: userEvent.setup() };
  }

  it("sin profesor pide elegirlo primero y no ofrece calendario", () => {
    setup({ teacherUsername: "" });
    expect(screen.getByText("Selecciona un profesor antes de elegir horario.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mes siguiente" })).not.toBeInTheDocument();
  });

  it("antes de elegir fecha lo indica y no consulta disponibilidad", () => {
    setup();
    expect(screen.getByText("Primero selecciona una fecha")).toBeInTheDocument();
    expect(callsTo("get", /\/availability\//)).toHaveLength(0);
  });

  it("consulta la disponibilidad real del profesor SALTÁNDOSE la antelación mínima (es de staff)", async () => {
    mockApi("get", /^\/availability\/profe\/slots/, [slot(2)]);
    const { user } = setup();
    await pickTomorrow(user);
    await screen.findAllByRole("button", { name: /\d{2}:\d{2}/ });
    const url = callsTo("get", /\/availability\/profe\/slots/)[0].url;
    expect(url).toContain("duration=50");
    expect(url).toContain("bypass_min_notice=true");
  });

  it("elegir un hueco y confirmar entrega ese hueco; sin elegir, confirmar no hace nada", async () => {
    const s = slot(2);
    mockApi("get", /^\/availability\/profe\/slots/, [s]);
    const { user, onSelect } = setup();
    await pickTomorrow(user);
    expect(screen.getByRole("button", { name: "Usar este horario" })).toBeDisabled(); // sin hueco elegido
    await user.click((await screen.findAllByRole("button", { name: /\d{2}:\d{2}/ }))[0]);
    await user.click(screen.getByRole("button", { name: "Usar este horario" }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ start_time_utc: s.start_time_utc }));
  });

  it("los huecos ocupados, pasados o demasiado próximos no se pueden elegir", async () => {
    mockApi("get", /^\/availability\/profe\/slots/, [slot(1, { is_available: false }), slot(2, { too_soon: true }), slot(3, { is_past: true })]);
    const { user } = setup();
    await pickTomorrow(user);
    expect(await screen.findByText("Ocupado")).toBeInTheDocument();
    expect(screen.getByText("Muy pronto")).toBeInTheDocument();
    expect(screen.getByText("Pasado")).toBeInTheDocument();
    for (const b of screen.getAllByRole("button", { name: /\d{2}:\d{2}/ })) expect(b).toBeDisabled();
  });

  it("día sin huecos lo dice", async () => {
    mockApi("get", /^\/availability\/profe\/slots/, []);
    const { user } = setup();
    await pickTomorrow(user);
    expect(await screen.findByText("Sin disponibilidad")).toBeInTheDocument();
  });

  it("la X cierra", async () => {
    const { user, onClose } = setup();
    await user.click(screen.getAllByRole("button").find((b) => !b.textContent?.trim() && b.querySelector("svg") && !b.getAttribute("aria-label"))!);
    expect(onClose).toHaveBeenCalled();
  });
});

describe("GodModeAuditLogViewer", () => {
  const entry = (over: Record<string, unknown> = {}) => ({
    id: 1, actor_user_id: 99, actor_name: "Super Admin", actor_role: "superadmin", action: "class.force_status", entity_type: "class", entity_id: 21,
    reason: "Corrección autorizada", before_data: { status: "confirmed" }, after_data: { status: "completed" }, created_at: "2026-11-20T12:00:00Z", ...over,
  });
  const setup = (items: unknown[] = [entry()], total = items.length) => {
    mockApi("get", /^\/god-mode\/audit-log/, { items, total, page: 1, page_size: 50 });
    renderScreen(<GodModeAuditLogViewer />, { role: "superadmin" });
    return userEvent.setup();
  };

  it("sin acciones registradas lo dice", async () => {
    setup([]);
    expect(await screen.findByText(/Todavía no hay acciones de Modo Dios registradas/)).toBeInTheDocument();
  });

  it("lista quién hizo qué, sobre qué entidad y por qué motivo", async () => {
    setup();
    expect(await screen.findByText("class.force_status")).toBeInTheDocument();
    expect(screen.getByText("class #21")).toBeInTheDocument();
    expect(screen.getByText("superadmin")).toBeInTheDocument();
    expect(screen.getByText("Corrección autorizada")).toBeInTheDocument();
    expect(screen.getByText(/Super Admin/)).toBeInTheDocument();
  });

  it("sin nombre del actor usa su número de usuario; grupo y chat tienen etiqueta en español", async () => {
    setup([entry({ actor_name: null }), entry({ id: 2, entity_type: "cohort", entity_id: 4 }), entry({ id: 3, entity_type: "chat_conversation", entity_id: 8 })]);
    expect(await screen.findByText(/Usuario #99/)).toBeInTheDocument();
    expect(screen.getByText("Grupo #4")).toBeInTheDocument();
    expect(screen.getByText("Chat #8")).toBeInTheDocument();
  });

  it("el antes/después está oculto hasta desplegarlo", async () => {
    const user = setup();
    await screen.findByText("class.force_status");
    expect(screen.queryByText("Antes")).not.toBeInTheDocument();
    const row = screen.getByText("Corrección autorizada").closest("div.rounded-2xl") as HTMLElement;
    await user.click(row.querySelector("button") as HTMLElement);
    expect(await screen.findByText("Antes")).toBeInTheDocument();
    expect(screen.getByText("Después")).toBeInTheDocument();
    expect(screen.getByText(/"completed"/)).toBeInTheDocument();
  });

  it("una entrada sin datos antes/después no ofrece desplegar", async () => {
    setup([entry({ before_data: null, after_data: null })]);
    await screen.findByText("class.force_status");
    const row = screen.getByText("Corrección autorizada").closest("div.rounded-2xl") as HTMLElement;
    expect(row.querySelector("button")).toBeNull();
  });

  it("filtrar por entidad pide solo esa entidad al servidor", async () => {
    const user = setup();
    await screen.findByText("class.force_status");
    await user.selectOptions(screen.getByDisplayValue("Todas las entidades"), "payment");
    await waitFor(() => expect(callsTo("get", /^\/god-mode\/audit-log/).at(-1)!.params).toMatchObject({ entity_type: "payment" }));
  });

  it("muestra el total registrado", async () => {
    setup([entry()], 128);
    expect(await screen.findByText("128")).toBeInTheDocument();
  });

  it("si el servidor falla no deja la pantalla en blanco", async () => {
    mockApiError("get", /^\/god-mode\/audit-log/, 500, "x");
    const { container } = renderScreen(<GodModeAuditLogViewer />, { role: "superadmin" });
    await waitFor(() => expect(screen.getByText(/Historial de auditoría/)).toBeInTheDocument());
    expect(container.textContent?.length).toBeGreaterThan(0);
  });
});
