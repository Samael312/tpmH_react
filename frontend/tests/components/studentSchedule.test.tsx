/**
 * Agendar clase (alumno): la pantalla cambia según la etapa del alumno (prueba → paquete → pago → renovación → lista)
 * y, ya con créditos, es un calendario + horarios + confirmación.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { screen, waitFor, within } from "@testing-library/react";
import SchedulePage from "@/app/(student)/dashboard/schedule/page";
import { renderScreen } from "./render";
import { mockApi, mockApiError, callsTo, FIXTURE } from "./fakeApi";

type Stage =
  | "needs_trial" | "trial_in_progress" | "needs_package" | "package_pending_payment" | "needs_payment"
  | "needs_renewal" | "renew_required" | "renewal_pending" | "ready";

const TEACHER = (over: Record<string, unknown> = {}) => ({
  teacher_username: "profe", name: "Profe", surname: "Uno", title: "Profe", profile_photo_url: null, theme_color: null,
  stage: "ready", status: "approved", is_frozen: false, refund_pending: false, active_enrollment: null, ...over,
});

const ENROLLMENT = { id: 11, status: "active", teacher_username: "profe", package_name: "Pack 8", classes_total: 8, classes_used: 2, cohort_id: null };

const PACKAGE = {
  id: 5, name: "Pack 8", price: 120, classes_count: 8, duration_minutes: 50, color: "#ec4899", is_active: true,
  teacher_username: "profe", description: "Ocho clases", description_type: "text", package_type: "individual",
};

const slotsAt = (hoursFromNow: number[]) =>
  hoursFromNow.map((h, i) => {
    const s = new Date(Date.now() + h * 3_600_000); s.setMinutes(0, 0, 0);
    return {
      start_time_utc: s.toISOString(), end_time_utc: new Date(s.getTime() + 50 * 60_000).toISOString(), duration_minutes: 50,
      is_preferred: i === 0, is_available: true,
    };
  });

function setup({
  stage = "ready", teachers = [TEACHER()], enrollments = [ENROLLMENT], singleTenant = false, packages = [PACKAGE], rejected = null as unknown, mocks,
}: { stage?: Stage; teachers?: unknown[]; enrollments?: unknown[]; singleTenant?: boolean; packages?: unknown[]; rejected?: unknown; mocks?: () => void } = {}) {
  mockApi("get", "/admin/platform-config", { ...FIXTURE.platformConfig, is_single_tenant: singleTenant });
  mockApi("get", "/users/me/teachers", teachers);
  mockApi("get", "/packages/my-enrollments", enrollments);
  mockApi("get", /^\/payments\/booking-status/, { stage, enrollment_id: 11, last_rejected_payment: rejected });
  mockApi("get", /^\/packages\/teacher\/profe/, packages);
  mockApi("get", "/teachers/profe", { ...FIXTURE.teacher, subjects: ["Español", "Inglés"], languages: [] });
  mockApi("get", /\/slots/, slotsAt([30, 31, 32]));
  mocks?.();
  const view = renderScreen(<SchedulePage />, { role: "student" });
  return { ...view, user: userEvent.setup() };
}

/** Pulsa un día futuro habilitado del calendario. */
async function pickDay(user: ReturnType<typeof userEvent.setup>, container: HTMLElement) {
  await screen.findByText(/Selecciona fecha y horario|Reserva tu clase/);
  const days = Array.from(container.querySelectorAll<HTMLButtonElement>(".grid-cols-7 button")).filter((b) => !b.disabled);
  await user.click(days[days.length - 1]);
}

afterEach(() => { vi.useRealTimers(); });

describe("Agendar clase · etapas", () => {
  it.each<[Stage, RegExp]>([
    ["needs_trial", /Reserva tu clase de prueba/],
    ["trial_in_progress", /Clase de prueba pendiente/],
    ["needs_package", /Elige tu paquete/],
    ["package_pending_payment", /Pago pendiente de confirmación/],
    ["needs_payment", /Pago pendiente de notificación/],
    ["needs_renewal", /Renueva tu paquete/],
    ["renew_required", /Renueva tu paquete/],
    ["renewal_pending", /Renovación en revisión/],
    ["ready", /Agendar Clase/],
  ])("etapa %s muestra su título", async (stage, title) => {
    setup({ stage });
    expect(await screen.findByRole("heading", { level: 1, name: title })).toBeInTheDocument();
  });

  it("prueba en curso explica que ya hay una clase de prueba pendiente", async () => {
    setup({ stage: "trial_in_progress" });
    expect(await screen.findByText("Tienes una clase de prueba pendiente")).toBeInTheDocument();
  });

  it("pago en revisión avisa que se está revisando", async () => {
    setup({ stage: "package_pending_payment" });
    expect(await screen.findByText("Tu pago está en revisión")).toBeInTheDocument();
  });

  it("sin ningún profesor invita a elegir uno", async () => {
    setup({ teachers: [] });
    expect(await screen.findByText("Aún no has elegido un profesor")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Elegir profesor" })).toHaveAttribute("href", "/dashboard/teachers");
  });

  it("profesor suspendido avisa que los créditos están congelados", async () => {
    setup({ teachers: [TEACHER({ status: "suspended" })] });
    expect(await screen.findByText("Su profesor ha sido suspendido")).toBeInTheDocument();
  });

  it("con varios profesores pide elegir y al elegir uno carga su estado", async () => {
    const { user } = setup({ teachers: [TEACHER(), TEACHER({ teacher_username: "ana", name: "Ana", surname: "Dos" })] });
    expect(await screen.findByRole("heading", { level: 1, name: "Elige tu Profesor" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Ana Dos/ }));
    await waitFor(() => expect(callsTo("get", /booking-status\?teacher_username=ana/).length).toBeGreaterThan(0));
  });

  it("paquete grupal activo: explica que lo agenda el profesor", async () => {
    setup({ enrollments: [{ ...ENROLLMENT, cohort_id: 3 }] });
    expect(await screen.findByText("Este es un paquete grupal")).toBeInTheDocument();
    expect(screen.queryByText("Seleccionar horario")).not.toBeInTheDocument();
  });

  it("si booking-status falla se asume «lista» en vez de bloquear la pantalla", async () => {
    setup({ mocks: () => mockApiError("get", /^\/payments\/booking-status/, 500, "x") });
    expect(await screen.findByRole("heading", { level: 1, name: "Agendar Clase" })).toBeInTheDocument();
  });
});

describe("Agendar clase · con créditos", () => {
  it("elegir día y un horario lleva a confirmar; Reservar manda la reserva con el enrollment", async () => {
    mockApi("post", "/payments/book", { status: "confirmed" });
    const { user, container } = setup();
    await pickDay(user, container);
    const slotBtn = (await screen.findAllByRole("button", { name: /hasta/ }))[0];
    await user.click(slotBtn);
    expect(await screen.findByRole("heading", { level: 1, name: "Confirmar Reserva" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Reservar/ }));
    await waitFor(() => expect(callsTo("post", "/payments/book")).toHaveLength(1));
    expect(callsTo("post", "/payments/book")[0].body).toMatchObject({ enrollment_id: 11, duration_minutes: 50 });
    expect(await screen.findByText("¡Clase confirmada!")).toBeInTheDocument();
  });

  it("la flecha atrás de confirmar vuelve a elegir horario", async () => {
    const { user, container } = setup();
    await pickDay(user, container);
    await user.click((await screen.findAllByRole("button", { name: /hasta/ }))[0]);
    await screen.findByRole("heading", { level: 1, name: "Confirmar Reserva" });
    await user.click(screen.getAllByRole("button", { name: "Volver" })[0]);
    expect(await screen.findByRole("heading", { level: 1, name: "Agendar Clase" })).toBeInTheDocument();
  });

  it("cambiar la duración vuelve a pedir los horarios con esa duración", async () => {
    const { user, container } = setup();
    await pickDay(user, container);
    await screen.findAllByRole("button", { name: /hasta/ });
    await user.click(screen.getByRole("button", { name: /80/ }));
    await waitFor(() => expect(callsTo("get", /duration=80/).length).toBeGreaterThan(0));
  });

  it("horarios ocupados, pasados o muy próximos aparecen bloqueados con su etiqueta", async () => {
    const base = slotsAt([30, 31, 32, 33]);
    const { user, container } = setup({ mocks: () => mockApi("get", /\/slots/, [
      { ...base[0], is_available: false }, { ...base[1], is_past: true }, { ...base[2], too_soon: true }, base[3],
    ]) });
    await pickDay(user, container);
    expect(await screen.findByText("Ocupado")).toBeInTheDocument();
    expect(screen.getByText("Pasado")).toBeInTheDocument();
    expect(screen.getByText("Muy pronto")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /hasta/ }).filter((b) => !(b as HTMLButtonElement).disabled)).toHaveLength(1);
  });

  it("un día sin horarios lo dice", async () => {
    const { user, container } = setup({ mocks: () => mockApi("get", /\/slots/, []) });
    await pickDay(user, container);
    expect(await screen.findByText("No hay disponibilidad para esta fecha")).toBeInTheDocument();
  });

  it("si falla la carga de horarios ofrece reintentar", async () => {
    const { user, container } = setup({ mocks: () => mockApiError("get", /\/slots/, 500, "x") });
    await pickDay(user, container);
    expect(await screen.findByText(/No se pudo cargar los horarios disponibles/)).toBeInTheDocument();
  });

  it("sin créditos (error del servidor) propone volver a comprar y no queda como reservada", async () => {
    mockApiError("post", "/payments/book", 400, "No tienes créditos disponibles");
    const { user, container } = setup();
    await pickDay(user, container);
    await user.click((await screen.findAllByRole("button", { name: /hasta/ }))[0]);
    await user.click(await screen.findByRole("button", { name: /Reservar/ }));
    expect(await screen.findByText(/No tienes créditos disponibles para agendar esta clase/)).toBeInTheDocument();
    expect(screen.queryByText("¡Clase confirmada!")).not.toBeInTheDocument();
  });

  it("otro error de la reserva se muestra y deja volver a intentar", async () => {
    mockApiError("post", "/payments/book", 409, "Ese horario ya fue tomado");
    const { user, container } = setup();
    await pickDay(user, container);
    await user.click((await screen.findAllByRole("button", { name: /hasta/ }))[0]);
    await user.click(await screen.findByRole("button", { name: /Reservar/ }));
    expect(await screen.findByText(/Ese horario ya fue tomado/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reservar/ })).toBeEnabled();
  });
});

describe("Agendar clase · clase de prueba", () => {
  it("elegir horario y confirmar reserva la prueba con la materia", async () => {
    mockApi("post", "/payments/book", { status: "confirmed" });
    const { user, container } = setup({ stage: "needs_trial", enrollments: [] });
    await pickDay(user, container);
    await user.click((await screen.findAllByRole("button", { name: /hasta/ }))[0]);
    expect(await screen.findByRole("heading", { level: 1, name: "Confirmar clase de prueba" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Confirmar clase de prueba/ }));
    await waitFor(() => expect(callsTo("post", "/payments/book")).toHaveLength(1));
    expect(callsTo("post", "/payments/book")[0].body).toMatchObject({ teacher_username: "profe" });
    expect(await screen.findByText("¡Prueba reservada!")).toBeInTheDocument();
  });

  it("con varias materias permite elegir cuál", async () => {
    const { user, container } = setup({ stage: "needs_trial", enrollments: [] });
    await pickDay(user, container);
    await user.click(await screen.findByRole("button", { name: "Inglés" }));
    await user.click((await screen.findAllByRole("button", { name: /hasta/ }))[0]);
    await user.click(await screen.findByRole("button", { name: /Confirmar clase de prueba/ }));
    await waitFor(() => expect(callsTo("post", "/payments/book")).toHaveLength(1));
    expect(callsTo("post", "/payments/book")[0].body).toMatchObject({ subject: "Inglés" });
  });

  it("un error al reservar la prueba se muestra", async () => {
    mockApiError("post", "/payments/book", 400, "Ya tuviste tu clase de prueba");
    const { user, container } = setup({ stage: "needs_trial", enrollments: [] });
    await pickDay(user, container);
    await user.click((await screen.findAllByRole("button", { name: /hasta/ }))[0]);
    await user.click(await screen.findByRole("button", { name: /Confirmar clase de prueba/ }));
    expect(await screen.findByText(/Ya tuviste tu clase de prueba/)).toBeInTheDocument();
  });
});

describe("Agendar clase · elegir paquete y renovar", () => {
  it("lista los paquetes del profesor con su precio y deja elegir uno (abre el pago)", async () => {
    const { user } = setup({ stage: "needs_package", enrollments: [] });
    expect(await screen.findByText("Pack 8")).toBeInTheDocument();
    expect(screen.getByText(/Completaste tu clase de prueba/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Elegir este paquete/ }));
    expect(await screen.findByText("Completar pago")).toBeInTheDocument();
  });

  it("sin paquetes avisa que contacte al staff", async () => {
    setup({ stage: "needs_package", enrollments: [], packages: [] });
    expect(await screen.findByText(/No hay paquetes disponibles/)).toBeInTheDocument();
  });

  it("un pago rechazado reemplaza el mensaje de bienvenida por el aviso de rechazo", async () => {
    setup({ stage: "needs_package", enrollments: [], rejected: { payment_id: 9, rejection_reason: "Referencia inválida", payment_type: "package", amount: 120, rejected_at: new Date().toISOString() } });
    expect(await screen.findByText(/Referencia inválida/)).toBeInTheDocument();
    expect(screen.queryByText(/Completaste tu clase de prueba/)).not.toBeInTheDocument();
  });

  it("si fallan los paquetes ofrece reintentar", async () => {
    setup({ stage: "needs_package", enrollments: [], mocks: () => mockApiError("get", /^\/packages\/teacher\/profe/, 500, "x") });
    expect(await screen.findByText(/No se pudo cargar los paquetes del profesor/)).toBeInTheDocument();
  });

  it("renovar muestra los paquetes para renovar", async () => {
    setup({ stage: "needs_renewal" });
    expect(await screen.findByRole("heading", { level: 1, name: "Renueva tu paquete" })).toBeInTheDocument();
    expect(await screen.findAllByText(/Pack 8/)).not.toHaveLength(0);
  });
});

describe("Agendar clase · grupos", () => {
  const COHORT = { id: 31, name: "Grupo A", current_students: 2, max_students: 6, start_date: null, completed_sessions: 0, effective_price: 80 };
  const GROUP_PKG = { ...PACKAGE, id: 8, name: "Grupal 12", is_group: true, price: 80 };

  it("muestra los grupos con cupo y deja unirse eligiendo método de pago", async () => {
    const { user } = setup({ stage: "needs_package", enrollments: [], packages: [PACKAGE, GROUP_PKG], mocks: () => {
      mockApi("get", "/cohorts/available", [COHORT]);
      mockApi("post", /\/cohorts\/31\/enroll/, { ok: true });
      mockApi("get", "/payments/config", { paypal_enabled: true, has_any_method: true, paypal_email: "p@x.com" });
    } });
    await user.click(await screen.findByRole("button", { name: /Unirme a este grupo/ }));
    expect(await screen.findByRole("heading", { name: "Confirmar inscripción" })).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "Confirmar inscripción" }).at(-1) as HTMLElement);
    expect(await screen.findAllByText(/Indica con qué método pagaste/)).not.toHaveLength(0);
    expect(callsTo("post", /enroll/)).toHaveLength(0);
  });

  it("sin cupo dice que no hay grupos disponibles", async () => {
    setup({ stage: "needs_package", enrollments: [], packages: [PACKAGE, GROUP_PKG], mocks: () => mockApi("get", "/cohorts/available", []) });
    expect(await screen.findByText(/No hay grupos con cupo disponible/)).toBeInTheDocument();
  });

  it("un grupo ya iniciado muestra el ajuste de precio", async () => {
    setup({ stage: "needs_package", enrollments: [], packages: [PACKAGE, GROUP_PKG], mocks: () => mockApi("get", "/cohorts/available", [{ ...COHORT, completed_sessions: 3, effective_price: 60 }]) });
    expect(await screen.findByText(/3 clase\(s\) ya dictada\(s\)/)).toBeInTheDocument();
    expect(screen.getByText("$60")).toBeInTheDocument();
  });
});

describe("Agendar clase · un solo profesor (single-tenant)", () => {
  it("usa el profesor destacado sin pedir elegir", async () => {
    setup({ singleTenant: true, teachers: [] });
    expect(await screen.findByRole("heading", { level: 1, name: "Agendar Clase" })).toBeInTheDocument();
    expect(screen.queryByText("Aún no has elegido un profesor")).not.toBeInTheDocument();
    within(document.body);
  });
});
