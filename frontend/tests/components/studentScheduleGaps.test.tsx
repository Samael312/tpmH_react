/**
 * Agendar clase (alumno) · ramas restantes: formatos de error del servidor, tarjetas de paquete con precio decimal,
 * plan ilimitado y sin color/descripción, grupos con y sin fecha de inicio, profesor sin nombre y pago rechazado al renovar.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { screen } from "@testing-library/react";
import SchedulePage from "@/app/(student)/dashboard/schedule/page";
import { renderScreen } from "./render";
import { mockApi, mockApiError, FIXTURE } from "./fakeApi";

const TEACHER = (over: Record<string, unknown> = {}) => ({
  teacher_username: "profe", name: "Profe", surname: "Uno", title: "Profe", profile_photo_url: null, theme_color: null,
  stage: "ready", status: "approved", is_frozen: false, refund_pending: false, active_enrollment: null, ...over,
});
const ENROLLMENT = { id: 11, status: "active", teacher_username: "profe", package_name: "Pack 8", classes_total: 8, classes_used: 2, cohort_id: null };
const PACKAGE = (over: Record<string, unknown> = {}) => ({
  id: 5, name: "Pack 8", price: 120, classes_count: 8, duration_minutes: 50, color: "#ec4899", is_active: true,
  teacher_username: "profe", description: "Ocho clases", description_type: "text", package_type: "individual", ...over,
});
const slotsAt = (hours: number[]) =>
  hours.map((h, i) => {
    const s = new Date(Date.now() + h * 3_600_000); s.setMinutes(0, 0, 0);
    return { start_time_utc: s.toISOString(), end_time_utc: new Date(s.getTime() + 50 * 60_000).toISOString(), duration_minutes: 50, is_preferred: i === 0, is_available: true };
  });

function setup(o: { stage?: string; teachers?: unknown[]; enrollments?: unknown[]; packages?: unknown[]; rejected?: unknown; mocks?: () => void } = {}) {
  mockApi("get", "/admin/platform-config", { ...FIXTURE.platformConfig, is_single_tenant: false });
  mockApi("get", "/users/me/teachers", o.teachers ?? [TEACHER()]);
  mockApi("get", "/packages/my-enrollments", o.enrollments ?? [ENROLLMENT]);
  mockApi("get", /^\/payments\/booking-status/, { stage: o.stage ?? "ready", enrollment_id: 11, last_rejected_payment: o.rejected ?? null });
  mockApi("get", /^\/packages\/teacher\/profe/, o.packages ?? [PACKAGE()]);
  mockApi("get", "/teachers/profe", { ...FIXTURE.teacher, subjects: ["Español"], languages: [] });
  mockApi("get", /\/slots/, slotsAt([30, 31]));
  o.mocks?.();
  const view = renderScreen(<SchedulePage />, { role: "student" });
  return { ...view, user: userEvent.setup() };
}
async function reserve(user: ReturnType<typeof userEvent.setup>, container: HTMLElement) {
  await screen.findByText(/Selecciona fecha y horario|Reserva tu clase/);
  const days = Array.from(container.querySelectorAll<HTMLButtonElement>(".grid-cols-7 button")).filter((b) => !b.disabled);
  await user.click(days[days.length - 1]);
  await user.click((await screen.findAllByRole("button", { name: /hasta/ }))[0]);
  await user.click(await screen.findByRole("button", { name: /Reservar/ }));
}
afterEach(() => { vi.restoreAllMocks(); });

describe("Agendar clase · errores de la reserva con formatos distintos", () => {
  it("un error de validación (lista) se une en un solo mensaje, con o sin «msg»", async () => {
    mockApiError("post", "/payments/book", 422, [{ msg: "Hora inválida" }, { loc: ["body"] }]);
    const { user, container } = setup();
    await reserve(user, container);
    expect(await screen.findByText(/Hora inválida, \{"loc":\["body"\]\}/)).toBeInTheDocument();
  });

  it("un elemento de la lista sin texto ni objeto se muestra tal cual", async () => {
    mockApiError("post", "/payments/book", 422, ["fallo plano", { msg: undefined, x: 1 }]);
    const { user, container } = setup();
    await reserve(user, container);
    expect(await screen.findByText(/"fallo plano"/)).toBeInTheDocument();
  });

  it("sin detalle del servidor usa el mensaje genérico", async () => {
    mockApiError("post", "/payments/book", 500, null);
    const { user, container } = setup();
    await reserve(user, container);
    expect(await screen.findByText("Error reservando el horario")).toBeInTheDocument();
  });
});

describe("Agendar clase · tarjetas de paquete", () => {
  it("precio decimal con dos decimales, plan ilimitado y descripción en la lista; sin color usa el rosa por defecto", async () => {
    setup({ stage: "needs_package", enrollments: [], packages: [
      PACKAGE({ id: 1, name: "Decimal", price: 99.5, classes_count: null, color: null, description: "Solo hoy" }),
      PACKAGE({ id: 2, name: "Entero", price: 100, classes_count: 4, description: null }),
    ] });
    expect(await screen.findByText("Decimal")).toBeInTheDocument();
    expect(screen.getByText(/99\.50/)).toBeInTheDocument();
    expect(screen.getByText("Clases ilimitadas")).toBeInTheDocument();
    expect(screen.getByText("Solo hoy")).toBeInTheDocument();
    expect(screen.getByText("4 clases")).toBeInTheDocument();
    expect(screen.queryByText(/100\.00/)).not.toBeInTheDocument();
  });

  it("al renovar, los mismos formatos de precio y de clases", async () => {
    setup({ stage: "needs_renewal", packages: [PACKAGE({ id: 1, name: "Decimal", price: 49.9, classes_count: null, color: null, description: null })] });
    expect(await screen.findByText("Decimal")).toBeInTheDocument();
    expect(screen.getByText(/49\.90/)).toBeInTheDocument();
    expect(screen.getByText("Clases ilimitadas")).toBeInTheDocument();
  });

  it("al renovar con un pago rechazado muestra el aviso de rechazo", async () => {
    setup({
      stage: "needs_renewal",
      rejected: { payment_id: 9, rejection_reason: "Referencia inválida", payment_type: "package", amount: 120, rejected_at: new Date().toISOString() },
    });
    expect(await screen.findByText(/Referencia inválida/)).toBeInTheDocument();
  });
});

describe("Agendar clase · grupos y profesores", () => {
  const GROUP = PACKAGE({ id: 8, name: "Grupal", package_type: "group", is_group: true, classes_count: null, price: 60, min_students: 3, max_students: 6 });
  const COHORT = (over: Record<string, unknown> = {}) => ({
    id: 21, package_id: 8, package_name: "Grupal", teacher_id: 3, start_date: null, status: "filling", min_students: 3, max_students: 6,
    current_students: 2, completed_sessions: 0, effective_price: 60, ...over,
  });

  it("un grupo sin fecha dice «Aún sin fecha fija» y uno con fecha, cuándo inicia", async () => {
    setup({ stage: "needs_package", enrollments: [], packages: [PACKAGE(), GROUP], mocks: () => mockApi("get", "/cohorts/available", [
      COHORT(), COHORT({ id: 22, start_date: "2026-09-01T15:00:00Z" }),
    ]) });
    expect(await screen.findByText(/Aún sin fecha fija/)).toBeInTheDocument();
    expect(screen.getByText(/Inicia/)).toBeInTheDocument();
  });

  it("un profesor sin nombre se muestra con su usuario", async () => {
    setup({ teachers: [TEACHER({ name: null, surname: null }), TEACHER({ teacher_username: "otro", name: "Otra", surname: "Dos" })], enrollments: [] });
    expect(await screen.findByText("profe")).toBeInTheDocument();
  });
});
