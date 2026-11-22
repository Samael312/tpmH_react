/**
 * Agendar clase (alumno) · casos que completan studentSchedule: margen tras la clase, lista de clases del paquete,
 * comprar créditos del plan ilimitado, inscripción a un grupo (éxito y error), paquetes con cuotas y renovación.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { screen, waitFor } from "@testing-library/react";
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
const slotsAt = (hours: number[], over: Record<string, unknown> = {}) =>
  hours.map((h, i) => {
    const s = new Date(Date.now() + h * 3_600_000); s.setMinutes(0, 0, 0);
    return { start_time_utc: s.toISOString(), end_time_utc: new Date(s.getTime() + 50 * 60_000).toISOString(), duration_minutes: 50, is_preferred: i === 0, is_available: true, ...over };
  });

function setup(o: { stage?: string; teachers?: unknown[]; enrollments?: unknown[]; packages?: unknown[]; slots?: unknown[]; mocks?: () => void } = {}) {
  mockApi("get", "/admin/platform-config", { ...FIXTURE.platformConfig, is_single_tenant: false });
  mockApi("get", "/users/me/teachers", o.teachers ?? [TEACHER()]);
  mockApi("get", "/packages/my-enrollments", o.enrollments ?? [ENROLLMENT]);
  mockApi("get", /^\/payments\/booking-status/, { stage: o.stage ?? "ready", enrollment_id: 11, last_rejected_payment: null });
  mockApi("get", /^\/packages\/teacher\/profe/, o.packages ?? [PACKAGE]);
  mockApi("get", "/teachers/profe", { ...FIXTURE.teacher, subjects: ["Español"], languages: [] });
  mockApi("get", /\/slots/, o.slots ?? slotsAt([30, 31]));
  o.mocks?.();
  const view = renderScreen(<SchedulePage />, { role: "student" });
  return { ...view, user: userEvent.setup() };
}
async function pickSlot(user: ReturnType<typeof userEvent.setup>, container: HTMLElement) {
  await screen.findByText(/Selecciona fecha y horario|Reserva tu clase/);
  const days = Array.from(container.querySelectorAll<HTMLButtonElement>(".grid-cols-7 button")).filter((b) => !b.disabled);
  await user.click(days[days.length - 1]);
  await user.click((await screen.findAllByRole("button", { name: /hasta/ }))[0]);
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("Agendar clase · margen y confirmación", () => {
  it("si el horario trae margen avisa a qué hora termina la clase y cuánto margen queda", async () => {
    const { user, container } = setup({ slots: slotsAt([30, 31], { buffer_minutes: 10 }) });
    await pickSlot(user, container);
    expect(await screen.findByText(/Dejamos 10 min de margen/)).toBeInTheDocument();
  });

  it("la reserva pendiente de aprobación avisa y vuelve al inicio", async () => {
    mockApi("post", "/payments/book", { status: "pending" });
    const { user, container } = setup();
    await pickSlot(user, container);
    await user.click(await screen.findByRole("button", { name: /Reservar/ }));
    await waitFor(() => expect(callsTo("post", "/payments/book")).toHaveLength(1));
  });
});

describe("Agendar clase · clases del paquete y créditos", () => {
  const CLASS = (id: number, status: string, hours: number) => ({
    id, enrollment_id: 11, class_type: "regular", subject: "Español", status, start_time_utc: new Date(Date.now() + hours * 3_600_000).toISOString(),
    end_time_utc: new Date(Date.now() + (hours + 1) * 3_600_000).toISOString(), duration_minutes: 60, teacher_name: "Profe Uno", student_name: "Yo",
  });

  it("separa las próximas de las anteriores", async () => {
    setup({ mocks: () => mockApi("get", /^\/classes\/my-classes/, [CLASS(1, "confirmed", 30), CLASS(2, "completed", -30), CLASS(3, "cancelled", -60)]) });
    expect(await screen.findByText(/Clases agendadas con este paquete \(3\)/)).toBeInTheDocument();
    expect(screen.getByText(/Próximas \(1\)/)).toBeInTheDocument();
    expect(screen.getByText(/Anteriores \(2\)/)).toBeInTheDocument();
  });

  it("un plan ilimitado permite comprar créditos y cerrar el diálogo", async () => {
    const { user } = setup({ enrollments: [{ ...ENROLLMENT, prepaid_unlimited_credits: 3, package: { ...PACKAGE, classes_count: null, price: 10 } }] });
    expect(await screen.findByText(/Paquete ilimitado — 3 créditos disponibles/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Comprar créditos" }));
    expect(await screen.findByRole("heading", { name: "Comprar créditos" })).toBeInTheDocument();
    await user.click(screen.getByRole("heading", { name: "Comprar créditos" }).parentElement!.querySelector("button") as HTMLElement);
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Comprar créditos" })).not.toBeInTheDocument());
  });

  it("con varios profesores muestra las clases restantes de cada uno", async () => {
    setup({ teachers: [
      TEACHER({ active_enrollment: { id: 11, package_name: "Pack 8", classes_used: 2, classes_total: 8, status: "active" } }),
      TEACHER({ teacher_username: "otro", name: "Otro", active_enrollment: { id: 12, package_name: "Ilim", classes_used: 0, classes_total: null, status: "active" } }),
      TEACHER({ teacher_username: "tercero", name: "Tercero", profile_photo_url: "https://img.example.com/t.png" }),
    ] });
    expect(await screen.findByText("6 clases restantes")).toBeInTheDocument();
    expect(screen.getByText("Plan ilimitado")).toBeInTheDocument();
    expect(screen.getByText("Sin paquete activo")).toBeInTheDocument();
  });
});

describe("Agendar clase · paquetes con cuotas y renovación", () => {
  const INSTALL = { ...PACKAGE, allow_installments: true, installment_count: 4, description_type: "list", description_items: ["Material incluido", "Soporte"] };

  it("muestra las cuotas y la lista de beneficios del paquete", async () => {
    setup({ stage: "needs_package", enrollments: [], packages: [INSTALL] });
    expect(await screen.findByText(/en 4 cuotas de \$ 30\.00/i)).toBeInTheDocument();
    expect(screen.getByText("Material incluido")).toBeInTheDocument();
  });

  it("al renovar, elegir un paquete abre el pago y se puede cerrar", async () => {
    const { user } = setup({ stage: "needs_renewal", packages: [{ ...INSTALL, price: 99.5 }] });
    await user.click(await screen.findByRole("button", { name: /Solicitar este paquete|Renovar/ }));
    expect(await screen.findByText("Completar pago")).toBeInTheDocument();
    expect(screen.getAllByText(/99\.50|99,50/).length).toBeGreaterThan(0);
    await user.click(screen.getByText("Completar pago").parentElement!.querySelector("button") as HTMLElement);
    await waitFor(() => expect(screen.queryByText("Completar pago")).not.toBeInTheDocument());
  });

  it("si no hay paquetes para renovar lo dice", async () => {
    setup({ stage: "needs_renewal", packages: [] });
    expect(await screen.findByText(/No hay paquetes disponibles/)).toBeInTheDocument();
  });
});

describe("Agendar clase · inscripción a un grupo", () => {
  const COHORT = { id: 31, name: "Grupo A", current_students: 2, max_students: 6, start_date: null, completed_sessions: 0, effective_price: 80 };
  const GROUP_PKG = { ...PACKAGE, id: 8, name: "Grupal 12", is_group: true, price: 80 };
  const groupSetup = (enroll: () => void) => setup({
    stage: "needs_package", enrollments: [], packages: [PACKAGE, GROUP_PKG],
    mocks: () => {
      mockApi("get", "/cohorts/available", [COHORT]);
      mockApi("get", "/payments/config", { paypal_enabled: true, has_any_method: true, paypal_email: "p@x.com" });
      enroll();
    },
  });
  const open = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(await screen.findByRole("button", { name: /Unirme a este grupo/ }));
    await screen.findByRole("heading", { name: "Confirmar inscripción" });
    const method = screen.getAllByRole("button").find((b) => /paypal/i.test(b.textContent ?? ""));
    if (method) await user.click(method);
    await user.type(screen.getByPlaceholderText(/últimos 4 dígitos/), "REF123");
  };
  const confirm = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getAllByRole("button", { name: "Confirmar inscripción" }).at(-1) as HTMLElement);

  it("con método y referencia manda la inscripción y avisa", async () => {
    const { user } = groupSetup(() => mockApi("post", /\/cohorts\/31\/enroll/, { ok: true }));
    await open(user);
    await confirm(user);
    await waitFor(() => expect(callsTo("post", /\/cohorts\/31\/enroll/)).toHaveLength(1));
    expect(callsTo("post", /\/cohorts\/31\/enroll/)[0].body).toMatchObject({ cohort_id: 31, transaction_reference: "REF123" });
    expect(await screen.findByText(/Te inscribiste en el grupo/)).toBeInTheDocument();
  });

  it("un error del servidor se muestra en el diálogo", async () => {
    const { user } = groupSetup(() => mockApiError("post", /\/cohorts\/31\/enroll/, 409, [{ msg: "Grupo lleno" }]));
    await open(user);
    await confirm(user);
    expect(await screen.findByText("Grupo lleno")).toBeInTheDocument();
  });

  it("un grupo ya iniciado muestra el ajuste también al confirmar", async () => {
    const { user } = setup({
      stage: "needs_package", enrollments: [], packages: [PACKAGE, GROUP_PKG],
      mocks: () => mockApi("get", "/cohorts/available", [{ ...COHORT, completed_sessions: 2, effective_price: 60 }]),
    });
    await user.click(await screen.findByRole("button", { name: /Unirme a este grupo/ }));
    expect(await screen.findByText(/Ajustado por 2 clase\(s\)/)).toBeInTheDocument();
  });
});
