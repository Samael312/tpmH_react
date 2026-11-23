/**
 * Agendar clase (alumno) · cierra funciones sin ejercitar: cambio de mes del calendario (también entre años),
 * reintentos de horarios y paquetes, cierres de los diálogos de inscripción, pago y compra de créditos,
 * y el botón de actualizar.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { screen, waitFor, within } from "@testing-library/react";
import SchedulePage from "@/app/(student)/dashboard/schedule/page";
import { renderScreen } from "./render";
import { mockApi, mockApiError, callsTo, FIXTURE } from "./fakeApi";

const TEACHER = (over: Record<string, unknown> = {}) => ({
  teacher_username: "profe", name: "Profe", surname: "Uno", title: "Profe", profile_photo_url: null, theme_color: null,
  stage: "ready", status: "approved", is_frozen: false, refund_pending: false, active_enrollment: null, ...over,
});
const ENROLLMENT = { id: 11, status: "active", teacher_username: "profe", package_name: "Pack 8", classes_total: 8, classes_used: 2, cohort_id: null };
const PACKAGE = {
  id: 5, name: "Pack 8", price: 120, classes_count: 8, duration_minutes: 50, color: "#ec4899", is_active: true,
  teacher_username: "profe", description: "Ocho clases", description_type: "text", package_type: "individual",
};
const slotsAt = (hours: number[]) =>
  hours.map((h, i) => {
    const s = new Date(Date.now() + h * 3_600_000); s.setMinutes(0, 0, 0);
    return { start_time_utc: s.toISOString(), end_time_utc: new Date(s.getTime() + 50 * 60_000).toISOString(), duration_minutes: 50, is_preferred: i === 0, is_available: true };
  });
const CONFIG = { paypal_enabled: true, binance_enabled: false, bank_transfer_enabled: false, mobile_payment_enabled: false, has_any_method: true, paypal_email: "p@x.com" };

function setup(o: { stage?: string; teachers?: unknown[]; enrollments?: unknown[]; packages?: unknown[]; mocks?: () => void } = {}) {
  mockApi("get", "/admin/platform-config", { ...FIXTURE.platformConfig, is_single_tenant: false });
  mockApi("get", "/users/me/teachers", o.teachers ?? [TEACHER()]);
  mockApi("get", "/packages/my-enrollments", o.enrollments ?? [ENROLLMENT]);
  mockApi("get", /^\/payments\/booking-status/, { stage: o.stage ?? "ready", enrollment_id: 11, last_rejected_payment: null });
  mockApi("get", /^\/packages\/teacher\/profe/, o.packages ?? [PACKAGE]);
  mockApi("get", "/teachers/profe", { ...FIXTURE.teacher, subjects: ["Español"], languages: [] });
  mockApi("get", /\/slots/, slotsAt([30, 31]));
  mockApi("get", "/payments/config", CONFIG);
  o.mocks?.();
  const view = renderScreen(<SchedulePage />, { role: "student" });
  return { ...view, user: userEvent.setup() };
}
const MONTH_RE = /^(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre) \d{4}$/i;

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("Agendar clase · calendario y horarios", () => {
  it("el calendario cambia de mes hacia atrás y adelante, también cruzando el año", async () => {
    setup();
    await screen.findByText(/Selecciona fecha y horario|Reserva tu clase/);
    const user = userEvent.setup();
    const header = screen.getByText(MONTH_RE).parentElement as HTMLElement;
    const [prev, next] = Array.from(header.querySelectorAll("button"));
    const year = new Date().getFullYear();
    for (let i = 0; i < 13; i++) await user.click(prev);
    expect(screen.getByText(new RegExp(`${year - 1}$`))).toBeInTheDocument();
    for (let i = 0; i < 26; i++) await user.click(next);
    expect(screen.getByText(new RegExp(`${year + 1}$`))).toBeInTheDocument();
  });

  it("si fallan los horarios, Reintentar los vuelve a pedir y los muestra", async () => {
    const { user, container } = setup({ mocks: () => mockApiError("get", /\/slots/, 500, "x") });
    await screen.findByText(/Selecciona fecha y horario|Reserva tu clase/);
    const days = Array.from(container.querySelectorAll<HTMLButtonElement>(".grid-cols-7 button")).filter((b) => !b.disabled);
    await user.click(days[days.length - 1]);
    await screen.findByText(/No se pudo cargar los horarios disponibles/);
    mockApi("get", /\/slots/, slotsAt([30, 31]));
    await user.click(screen.getByRole("button", { name: /Reintentar/ }));
    expect((await screen.findAllByRole("button", { name: /hasta/ })).length).toBeGreaterThan(0);
  });

  it("el botón de actualizar vuelve a pedir el estado del alumno", async () => {
    const { user } = setup();
    await screen.findByText(/Selecciona fecha y horario|Reserva tu clase/);
    const before = callsTo("get", "/packages/my-enrollments").length;
    await user.click(screen.getAllByRole("button", { name: "Actualizar datos" })[0]);
    await waitFor(() => expect(callsTo("get", "/packages/my-enrollments").length).toBeGreaterThan(before));
  });
});

describe("Agendar clase · reintentos de paquetes", () => {
  it.each([["needs_package"], ["needs_renewal"]])("etapa %s: si fallan los paquetes, Reintentar los vuelve a pedir", async (stage) => {
    const { user } = setup({ stage, enrollments: stage === "needs_package" ? [] : [ENROLLMENT], mocks: () => mockApiError("get", /^\/packages\/teacher\/profe/, 500, "x") });
    await screen.findByText(/No se pudo cargar los paquetes del profesor/);
    mockApi("get", /^\/packages\/teacher\/profe/, [PACKAGE]);
    await user.click(screen.getByRole("button", { name: /Reintentar/ }));
    expect(await screen.findByText("Pack 8")).toBeInTheDocument();
  });
});

describe("Agendar clase · cierres del pago de un paquete", () => {
  it.each([["needs_package", /Elegir este paquete/, []], ["needs_renewal", /Solicitar este paquete|Renovar/, [ENROLLMENT]]])(
    "etapa %s: «Completar pago» se cierra con la X, con Cancelar y pulsando fuera", async (stage, choose, enrollments) => {
      const { user } = setup({ stage, enrollments });
      const open = async () => {
        await user.click(await screen.findByRole("button", { name: choose as RegExp }));
        return screen.findByText("Completar pago");
      };
      let title = await open();
      await user.click(title.parentElement!.querySelector("button") as HTMLElement); // X
      await waitFor(() => expect(screen.queryByText("Completar pago")).not.toBeInTheDocument());
      title = await open();
      await user.click(within(title.closest("div[class*='max-w-3xl']") as HTMLElement).getByRole("button", { name: "Cancelar" })); // Cancelar del pago
      await waitFor(() => expect(screen.queryByText("Completar pago")).not.toBeInTheDocument());
      title = await open();
      await user.click(title.closest("div[class*='fixed']")!.querySelector("div[class*='bg-slate-900/40']") as HTMLElement); // fondo
      await waitFor(() => expect(screen.queryByText("Completar pago")).not.toBeInTheDocument());
    },
  );
});

describe("Agendar clase · cierres de la inscripción a un grupo", () => {
  const COHORT = { id: 31, name: "Grupo A", current_students: 2, max_students: 6, start_date: null, completed_sessions: 0, effective_price: 80 };
  const GROUP_PKG = { ...PACKAGE, id: 8, name: "Grupal 12", is_group: true, price: 80 };

  it("el diálogo se cierra con la X, con Volver y pulsando fuera, sin inscribir", async () => {
    const { user } = setup({ stage: "needs_package", enrollments: [], packages: [PACKAGE, GROUP_PKG], mocks: () => mockApi("get", "/cohorts/available", [COHORT]) });
    const open = async () => {
      await user.click(await screen.findByRole("button", { name: /Unirme a este grupo/ }));
      return screen.findByRole("heading", { name: "Confirmar inscripción" });
    };
    let heading = await open();
    await user.click(heading.parentElement!.querySelector("button") as HTMLElement); // X
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Confirmar inscripción" })).not.toBeInTheDocument());
    heading = await open();
    await user.click(screen.getByRole("button", { name: "Volver" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Confirmar inscripción" })).not.toBeInTheDocument());
    heading = await open();
    await user.click(heading.closest("div[class*='fixed']")!.querySelector("div[class*='bg-slate-900/40']") as HTMLElement);
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Confirmar inscripción" })).not.toBeInTheDocument());
    expect(callsTo("post", /\/cohorts\/31\/enroll/)).toHaveLength(0);
  });
});

describe("Agendar clase · compra de créditos de un plan ilimitado", () => {
  const UNLIMITED = { ...ENROLLMENT, prepaid_unlimited_credits: 3, package: { ...PACKAGE, classes_count: null, price: 10 } };

  it("pulsar fuera del diálogo y Cancelar lo cierran", async () => {
    const { user } = setup({ enrollments: [UNLIMITED] });
    await user.click(await screen.findByRole("button", { name: "Comprar créditos" }));
    const heading = await screen.findByRole("heading", { name: "Comprar créditos" });
    await user.click(heading.closest("div[class*='fixed']")!.querySelector("div[class*='bg-slate-900/40']") as HTMLElement);
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Comprar créditos" })).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Comprar créditos" }));
    await screen.findByRole("heading", { name: "Comprar créditos" });
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Comprar créditos" })).not.toBeInTheDocument());
  });

  it("notificar la recarga refresca las inscripciones y cierra el diálogo", async () => {
    mockApi("post", "/payments/notify-payment", {});
    const { user } = setup({ enrollments: [UNLIMITED] });
    await user.click(await screen.findByRole("button", { name: "Comprar créditos" }));
    const label = await screen.findByText(/¿Con qué método pagaste\?/);
    await user.click(within(label.parentElement as HTMLElement).getByRole("button", { name: /PayPal/ }));
    const before = callsTo("get", "/packages/my-enrollments").length;
    await user.click(screen.getByRole("button", { name: /Ya realicé el pago/ }));
    await waitFor(() => expect(callsTo("post", "/payments/notify-payment")).toHaveLength(1));
    await waitFor(() => expect(callsTo("get", "/packages/my-enrollments").length).toBeGreaterThan(before), { timeout: 4000 });
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Comprar créditos" })).not.toBeInTheDocument(), { timeout: 4000 });
  });
});
