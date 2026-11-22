/**
 * Modales de clase: reagendar (con sus bloqueos por antelación y tope), link de videollamada y panel de espera de grupo.
 */
import { describe, expect, it, vi } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { RescheduleModal, type RescheduleModalClassItem } from "@/components/classes/RescheduleModal";
import { MeetLinkModal } from "@/components/classes/MeetLinkModal";
import GroupWaitingPanel from "@/components/classes/GroupWaitingPanel";
import { renderScreen } from "./render";
import { routerState } from "./router";
import { mockApi, mockApiError, callsTo, makeUser } from "./fakeApi";
import { RICH } from "./richData";

const HOUR = 3600_000;
const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

function item(hoursAhead: number, over: Partial<RescheduleModalClassItem> = {}): RescheduleModalClassItem {
  return { id: 21, subject: "Español", start_time_utc: new Date(Date.now() + hoursAhead * HOUR).toISOString(), duration_minutes: 60, counterpart_name: "Profe Uno", ...over };
}

function setupReschedule(classItem: RescheduleModalClassItem, endpoint = "/classes/21/reschedule") {
  const onClose = vi.fn(); const onSaved = vi.fn();
  renderScreen(<RescheduleModal classItem={classItem} teacherUsername="profe" endpoint={endpoint} onClose={onClose} onSaved={onSaved} />, { role: endpoint.includes("/teacher/") ? "teacher" : "student" });
  return { onClose, onSaved, user: userEvent.setup() };
}

/** Elige el día de mañana en el calendario (avanzando de mes si hace falta). */
async function pickTomorrow(user: ReturnType<typeof userEvent.setup>) {
  const t = new Date(); t.setDate(t.getDate() + 1);
  if (t.getMonth() !== new Date().getMonth()) await user.click(screen.getByRole("button", { name: "Mes siguiente" }));
  await user.click(screen.getByRole("button", { name: `${t.getDate()} de ${MONTHS[t.getMonth()]} de ${t.getFullYear()}` }));
}

const slot = (startH: number, over: Record<string, unknown> = {}) => ({
  start_time_utc: new Date(Date.now() + (24 + startH) * HOUR).toISOString(), end_time_utc: new Date(Date.now() + (25 + startH) * HOUR).toISOString(),
  is_available: true, is_past: false, too_soon: false, is_preferred: false, ...over,
});

describe("RescheduleModal · bloqueos del alumno", () => {
  it("con tiempo de sobra y reagendados disponibles deja elegir fecha y avisa cuántos quedan", () => {
    setupReschedule(item(72, { reschedulesRemaining: 2 }));
    expect(screen.getByText("Te quedan 2 reagendados para esta clase")).toBeInTheDocument();
    expect(screen.queryByText(/Ya no puedes reagendar/)).not.toBeInTheDocument();
  });

  it("singular cuando queda uno", () => {
    setupReschedule(item(72, { reschedulesRemaining: 1 }));
    expect(screen.getByText("Te queda 1 reagendado para esta clase")).toBeInTheDocument();
  });

  it("sin reagendados restantes bloquea y no permite confirmar", () => {
    setupReschedule(item(72, { reschedulesRemaining: 0 }));
    expect(screen.getByText(/Ya no te quedan reagendados/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Confirmar reagendamiento/ })).toBeDisabled();
  });

  it("con menos antelación que el mínimo (12 h) bloquea y dice cuántas horas faltan", () => {
    setupReschedule(item(5));
    expect(screen.getByText(/Ya no puedes reagendar esta clase/)).toBeInTheDocument();
    expect(screen.getByText(/al menos 12h/).textContent).toMatch(/ya quedan 4h/);
    expect(screen.getByRole("button", { name: /Confirmar reagendamiento/ })).toBeDisabled();
  });

  it("una clase 'finalized' se puede reagendar sin antelación mínima", () => {
    setupReschedule(item(-2, { status: "finalized" }));
    expect(screen.queryByText(/Ya no puedes reagendar/)).not.toBeInTheDocument();
  });
});

describe("RescheduleModal · el profesor no tiene esas restricciones", () => {
  it("ni antelación mínima ni tope de reagendados", () => {
    setupReschedule(item(1, { reschedulesRemaining: 0 }), "/classes/teacher/21/reschedule");
    expect(screen.queryByText(/Ya no puedes reagendar/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Ya no te quedan reagendados/)).not.toBeInTheDocument();
    expect(screen.queryByText(/reagendados? para esta clase/)).not.toBeInTheDocument();
  });
});

describe("RescheduleModal · flujo completo", () => {
  it("elegir día y hueco y confirmar manda PATCH con el horario del hueco al endpoint recibido", async () => {
    const s = slot(2);
    mockApi("get", /^\/availability\/profe\/slots/, [s]);
    const { user, onSaved, onClose } = setupReschedule(item(72, { reschedulesRemaining: 2 }));
    expect(screen.getByRole("button", { name: /Confirmar reagendamiento/ })).toBeDisabled(); // sin hueco elegido
    await pickTomorrow(user);
    const buttons = await screen.findAllByRole("button", { name: /\d{2}:\d{2}/ });
    await user.click(buttons[0]);
    expect(await screen.findByText(/Nuevo horario seleccionado/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Confirmar reagendamiento/ }));
    await waitFor(() => expect(callsTo("patch", "/classes/21/reschedule")).toHaveLength(1));
    expect(callsTo("patch", "/classes/21/reschedule")[0].body).toEqual({ start_time_utc: s.start_time_utc, end_time_utc: s.end_time_utc });
    expect(await screen.findByText(/reagendada con éxito/)).toBeInTheDocument();
    await waitFor(() => { expect(onSaved).toHaveBeenCalled(); expect(onClose).toHaveBeenCalled(); }, { timeout: 3000 });
  });

  it("los huecos ocupados, pasados o demasiado próximos no se pueden elegir", async () => {
    mockApi("get", /^\/availability\/profe\/slots/, [slot(1, { is_available: false }), slot(2, { too_soon: true }), slot(3, { is_past: true })]);
    const { user } = setupReschedule(item(72));
    await pickTomorrow(user);
    expect(await screen.findByText("Ocupado")).toBeInTheDocument();
    expect(screen.getByText("Muy pronto")).toBeInTheDocument();
    expect(screen.getByText("Pasado")).toBeInTheDocument();
    for (const b of screen.getAllByRole("button", { name: /\d{2}:\d{2}/ })) await user.click(b);
    expect(screen.queryByText(/Nuevo horario seleccionado/)).not.toBeInTheDocument();
  });

  it("un día sin huecos lo dice", async () => {
    mockApi("get", /^\/availability\/profe\/slots/, []);
    const { user } = setupReschedule(item(72));
    await pickTomorrow(user);
    expect(await screen.findByText(/No hay huecos libres en este día/)).toBeInTheDocument();
  });

  it("si el servidor rechaza el cambio muestra el motivo y no cierra", async () => {
    mockApi("get", /^\/availability\/profe\/slots/, [slot(2)]);
    mockApiError("patch", "/classes/21/reschedule", 400, "Ese horario ya no está libre");
    const { user, onSaved } = setupReschedule(item(72));
    await pickTomorrow(user);
    await user.click((await screen.findAllByRole("button", { name: /\d{2}:\d{2}/ }))[0]);
    await user.click(screen.getByRole("button", { name: /Confirmar reagendamiento/ }));
    expect(await screen.findByText(/Ese horario ya no está libre/)).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("una sesión grupal pide confirmación y, si se rechaza, no envía nada", async () => {
    mockApi("get", /^\/availability\/profe\/slots/, [slot(2)]);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { user } = setupReschedule(item(72, { isGroup: true }));
    await pickTomorrow(user);
    await user.click((await screen.findAllByRole("button", { name: /\d{2}:\d{2}/ }))[0]);
    await user.click(screen.getByRole("button", { name: /Confirmar reagendamiento/ }));
    expect(confirm).toHaveBeenCalled();
    expect(callsTo("patch", "/classes/21/reschedule")).toHaveLength(0);
    confirm.mockRestore();
  });

  it("Escape y la X cierran el modal", async () => {
    const { user, onClose } = setupReschedule(item(72));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("no deja elegir días pasados", () => {
    setupReschedule(item(72));
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    if (yesterday.getMonth() === new Date().getMonth()) {
      expect(screen.getByRole("button", { name: `${yesterday.getDate()} de ${MONTHS[yesterday.getMonth()]} de ${yesterday.getFullYear()}` })).toBeDisabled();
    }
  });
});

describe("MeetLinkModal", () => {
  function setup(meet_link: string | null = null) {
    const onClose = vi.fn(); const onSaved = vi.fn();
    renderScreen(<MeetLinkModal classItem={{ id: 21, subject: "Español", meet_link, counterpart_name: "Alumno Uno" }} onClose={onClose} onSaved={onSaved} />, { role: "teacher" });
    return { onClose, onSaved, user: userEvent.setup() };
  }

  it("precarga el link actual y muestra contexto de la clase", async () => {
    setup("https://meet.example.com/old");
    expect(await screen.findByDisplayValue("https://meet.example.com/old")).toBeInTheDocument();
    expect(screen.getByText(/Español · Alumno Uno/)).toBeInTheDocument();
  });

  it("guardar manda PATCH /classes/{id}/meet-link con el link recortado", async () => {
    const { user, onSaved } = setup();
    await user.type(await screen.findByPlaceholderText(/meet.google.com/), "  https://meet.example.com/new  ");
    await user.click(screen.getByRole("button", { name: /Guardar/ }));
    await waitFor(() => expect(callsTo("patch", "/classes/21/meet-link")).toHaveLength(1));
    expect(callsTo("patch", "/classes/21/meet-link")[0].body).toEqual({ meet_link: "https://meet.example.com/new" });
    expect(await screen.findByText(/¡Link guardado!/)).toBeInTheDocument();
    await waitFor(() => expect(onSaved).toHaveBeenCalled(), { timeout: 3000 });
  });

  it("dejarlo vacío QUITA el link (envía null)", async () => {
    const { user } = setup("https://meet.example.com/old");
    await user.clear(await screen.findByDisplayValue("https://meet.example.com/old"));
    await user.click(screen.getByRole("button", { name: /Guardar/ }));
    await waitFor(() => expect(callsTo("patch", "/classes/21/meet-link")).toHaveLength(1));
    expect(callsTo("patch", "/classes/21/meet-link")[0].body).toEqual({ meet_link: null });
  });

  it("si falla muestra el error y no confirma", async () => {
    mockApiError("patch", "/classes/21/meet-link", 403, "No puedes editar este link");
    const { user, onSaved } = setup();
    await user.type(await screen.findByPlaceholderText(/meet.google.com/), "https://x.example.com");
    await user.click(screen.getByRole("button", { name: /Guardar/ }));
    expect(await screen.findByText(/No puedes editar este link/)).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("explica que sin link se genera solo unos minutos antes", async () => {
    setup();
    expect(await screen.findByText(/se genera automáticamente 30 min antes/)).toBeInTheDocument();
  });
});

describe("GroupWaitingPanel (grupo del alumno)", () => {
  const group = (over: Record<string, unknown> = {}) => RICH.enrollment({
    cohort_id: 4, cohort_status: "filling", cohort_current_students: 2, cohort_max_students: 6, payment_status: "paid", status: "active", ...over,
  }) as never;
  function setup(enrollment: never, props: Record<string, unknown> = {}) {
    const onChanged = vi.fn();
    renderScreen(<GroupWaitingPanel enrollment={enrollment} onChanged={onChanged} {...props} />, { role: "student" });
    return { onChanged, user: userEvent.setup() };
  }

  it("llenándose: muestra inscritos y que el lugar está reservado", () => {
    setup(group());
    expect(screen.getByText("Llenándose")).toBeInTheDocument();
    expect(screen.getByText(/\/6 inscritos/)).toBeInTheDocument();
    expect(screen.getByText(/Tu lugar ya está reservado/)).toBeInTheDocument();
  });

  it.each([
    ["in_progress", /Tu grupo ya está en curso/],
    ["completed", /Este grupo ya terminó/],
    ["cancelled", /Este grupo fue cancelado/],
  ])("estado %s se explica al alumno", (cohort_status, re) => {
    setup(group({ cohort_status }));
    expect(screen.getByText(re)).toBeInTheDocument();
  });

  it("confirmado con fecha: muestra cuándo inicia", () => {
    setup(group({ cohort_status: "confirmed", cohort_start_date: "2026-12-01T15:00:00Z" }));
    expect(screen.getByText("Fecha confirmada")).toBeInTheDocument();
    expect(screen.getByText(/Tu grupo inicia el/)).toBeInTheDocument();
  });

  it("en curso con total de clases: muestra el progreso", () => {
    setup(group({ cohort_status: "in_progress" }), { completedClasses: 3, totalClasses: 10 });
    expect(screen.getByText(/\/10 clases completadas/)).toBeInTheDocument();
  });

  it("si el pago no está confirmado avisa y no ofrece migrar a individual", () => {
    setup(group({ payment_status: "pending" }));
    expect(screen.getByText(/confirmará tu pago/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Cambiar a clases individuales/ })).not.toBeInTheDocument();
  });

  it("pagado y activo: ofrece cambiar a clases individuales mientras se llena", () => {
    setup(group());
    expect(screen.getByRole("button", { name: /Cambiar a clases individuales/ })).toBeInTheDocument();
  });

  it("en curso ya no ofrece migrar", () => {
    setup(group({ cohort_status: "in_progress" }));
    expect(screen.queryByRole("button", { name: /Cambiar a clases individuales/ })).not.toBeInTheDocument();
  });

  it("el chat del grupo abre la conversación y lleva al chat", async () => {
    const { user } = setup(group());
    await user.click(await screen.findByRole("button", { name: /Chat del grupo/ }));
    await waitFor(() => expect(callsTo("get", "/chat/conversations/group/4")).toHaveLength(1));
    await waitFor(() => expect(routerState.router.push).toHaveBeenCalledWith("/dashboard/chat"));
  });

  it("con el chat desactivado por el admin no aparece el botón", async () => {
    mockApi("get", "/admin/platform-config", { chat_enabled: false });
    setup(group());
    await waitFor(() => expect(screen.queryByRole("button", { name: /Chat del grupo/ })).not.toBeInTheDocument());
  });
});

void makeUser;
