/**
 * Perfil de un profesor visto por el alumno: elegirlo o dejarlo, chat, agendar, WhatsApp y dejar una reseña.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { screen, waitFor } from "@testing-library/react";
import TeacherBrowsePage from "@/app/(student)/dashboard/teachers/[username]/page";
import { renderScreen } from "./render";
import { routerState } from "./router";
import { mockApi, mockApiError, callsTo, FIXTURE } from "./fakeApi";

const TEACHER = (over: Record<string, unknown> = {}) => ({
  user_username: "maria", name: "María", surname: "Farías", title: "Profe", bio: "Bio", status: "approved", languages: ["Español"], social_links: { whatsapp: "+58 412 555" }, ...over,
});
const MINE = (stage = "ready") => ({ teacher_username: "maria", name: "María", surname: "Farías", stage, status: "approved", is_frozen: false, refund_pending: false, active_enrollment: null });

function setup(o: { teacher?: unknown; mine?: unknown[]; single?: boolean; student?: unknown; reviews?: unknown; cfg?: Record<string, unknown> } = {}, extra?: () => void) {
  mockApi("get", /^\/admin\/platform-config/, { ...FIXTURE.platformConfig, is_single_tenant: !!o.single, show_teacher_whatsapp: true, ...(o.cfg ?? {}) });
  mockApi("get", "/users/me/teachers", o.mine ?? []);
  mockApi("get", "/teachers/maria", o.teacher ?? TEACHER());
  mockApi("get", "/reviews/maria", o.reviews ?? []);
  mockApi("get", "/users/me/student-profile", o.student ?? { id: 1, teacher_username: null });
  extra?.();
  const view = renderScreen(<TeacherBrowsePage />, { role: "student", route: "/dashboard/teachers/maria", params: { username: "maria" } });
  return { ...view, user: userEvent.setup() };
}

beforeEach(() => { vi.spyOn(window, "open").mockImplementation(() => null); });
afterEach(() => { vi.restoreAllMocks(); });

describe("Perfil de profesor (alumno) · carga", () => {
  it("muestra el perfil y el enlace para volver al marketplace", async () => {
    setup();
    expect((await screen.findAllByText("María Farías")).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /Volver al marketplace/ })).toHaveAttribute("href", "/dashboard/teachers");
  });

  it("en un-solo-profesor no hay marketplace ni botón de elegir", async () => {
    setup({ single: true });
    await screen.findAllByText("María Farías");
    expect(screen.queryByRole("link", { name: /Volver al marketplace/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Elegir este profesor/ })).not.toBeInTheDocument();
  });

  it("si falla la carga ofrece reintentar", async () => {
    const { user } = setup({}, () => mockApiError("get", "/teachers/maria", 404, "No existe"));
    expect(await screen.findByText("No se pudo cargar el perfil de este profesor.")).toBeInTheDocument();
    const before = callsTo("get", "/teachers/maria").length;
    await user.click(screen.getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(callsTo("get", "/teachers/maria").length).toBeGreaterThan(before));
  });

  it("si fallan las reseñas o el perfil del alumno igual se muestra el profesor", async () => {
    setup({}, () => { mockApiError("get", "/reviews/maria", 500, "x"); mockApiError("get", "/users/me/student-profile", 500, "x"); });
    expect((await screen.findAllByText("María Farías")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Dejar una reseña" })).not.toBeInTheDocument();
  });
});

describe("Perfil de profesor (alumno) · elegir y dejar", () => {
  it("elegir un profesor lo añade y avisa", async () => {
    mockApi("post", "/users/me/teachers/maria", {});
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: /Elegir este profesor/ }));
    await waitFor(() => expect(callsTo("post", "/users/me/teachers/maria")).toHaveLength(1));
    expect(await screen.findByText("Profesor añadido correctamente")).toBeInTheDocument();
  });

  it("un error al elegir se muestra", async () => {
    const { user } = setup({}, () => mockApiError("post", "/users/me/teachers/maria", 409, "Ya tienes ese profesor"));
    await user.click(await screen.findByRole("button", { name: /Elegir este profesor/ }));
    expect(await screen.findByText("Ya tienes ese profesor")).toBeInTheDocument();
  });

  it("si ya es su profesor ofrece terminar la relación", async () => {
    mockApi("delete", "/users/me/teachers/maria", {});
    const { user } = setup({ mine: [MINE()] });
    await user.click(await screen.findByRole("button", { name: /Ya es tu profesor/ }));
    await waitFor(() => expect(callsTo("delete", "/users/me/teachers/maria")).toHaveLength(1));
    expect(await screen.findByText("Profesor eliminado de tu lista correctamente")).toBeInTheDocument();
  });

  it("no se puede terminar con paquete activo: el error del servidor se muestra", async () => {
    const { user } = setup({ mine: [MINE()] }, () => mockApiError("delete", "/users/me/teachers/maria", 400, "Tienes un paquete activo"));
    await user.click(await screen.findByRole("button", { name: /Ya es tu profesor/ }));
    expect(await screen.findByText("Tienes un paquete activo")).toBeInTheDocument();
  });
});

describe("Perfil de profesor (alumno) · acciones", () => {
  it("el chat lleva a la conversación con ese profesor y se puede apagar desde el admin", async () => {
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: /Chat/ }));
    expect(routerState.router.push).toHaveBeenCalledWith("/dashboard/chat?teacher=maria");
  });

  it("con el chat apagado no aparece el botón", async () => {
    setup({ cfg: { chat_enabled: false } });
    await screen.findAllByText("María Farías");
    expect(screen.queryByRole("button", { name: /^Chat$/ })).not.toBeInTheDocument();
  });

  it("agendar: «clase de prueba» si aún no la tuvo, «clase» si ya", async () => {
    const first = setup();
    await first.user.click(await screen.findByRole("button", { name: "Agendar clase de prueba" }));
    expect(routerState.router.push).toHaveBeenCalledWith("/dashboard/schedule");
    first.unmount();
    setup({ mine: [MINE("ready")] });
    expect(await screen.findByRole("button", { name: "Agendar clase" })).toBeInTheDocument();
  });

  it("WhatsApp abre el chat con solo los dígitos en una pestaña segura", async () => {
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: /WhatsApp/ }));
    expect(window.open).toHaveBeenCalledWith("https://wa.me/58412555", "_blank", "noopener,noreferrer");
  });

  it("el administrador puede ocultar el WhatsApp", async () => {
    setup({ cfg: { show_teacher_whatsapp: false } });
    await screen.findAllByText("María Farías");
    expect(screen.queryByRole("button", { name: /WhatsApp/ })).not.toBeInTheDocument();
  });
});

describe("Perfil de profesor (alumno) · reseña", () => {
  const open = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(await screen.findByRole("button", { name: "Dejar una reseña" }));
    return screen.findByPlaceholderText("¿Qué te parecieron las clases con este profesor?");
  };

  it("solo los alumnos pueden dejar reseña", async () => {
    setup({ student: {} });
    await screen.findAllByText("María Farías");
    expect(screen.queryByRole("button", { name: "Dejar una reseña" })).not.toBeInTheDocument();
  });

  it("exige estrellas y luego comentario", async () => {
    const { user } = setup();
    await open(user);
    await user.click(screen.getByRole("button", { name: "Enviar reseña" }));
    expect(await screen.findByText("Por favor selecciona una calificación en estrellas.")).toBeInTheDocument();
    await user.click(screen.getAllByRole("button").filter((b) => b.querySelector("svg.w-8"))[3]);
    await user.click(screen.getByRole("button", { name: "Enviar reseña" }));
    expect(await screen.findByText("Por favor escribe un comentario.")).toBeInTheDocument();
    expect(callsTo("post", /reviews/)).toHaveLength(0);
  });

  it("envía la reseña, refresca la lista y cierra el formulario", async () => {
    mockApi("post", "/reviews/maria", {});
    const { user } = setup();
    const box = await open(user);
    await user.click(screen.getAllByRole("button").filter((b) => b.querySelector("svg.w-8"))[4]);
    await user.type(box, "Excelente profe");
    mockApi("get", "/reviews/maria", [{ id: 1, student_name: "Test", rating: 5, comment: "Excelente profe", created_at: "2026-03-01T00:00:00Z", total_completed_classes: 2 }]);
    await user.click(screen.getByRole("button", { name: "Enviar reseña" }));
    await waitFor(() => expect(callsTo("post", "/reviews/maria")).toHaveLength(1));
    expect(callsTo("post", "/reviews/maria")[0].body).toEqual({ rating: 5, comment: "Excelente profe" });
    expect(await screen.findByText("Reseña enviada correctamente")).toBeInTheDocument();
    expect(await screen.findByText(/Excelente profe/)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("¿Qué te parecieron las clases con este profesor?")).not.toBeInTheDocument();
  });

  it("un error del servidor se muestra y «Cancelar» cierra el formulario", async () => {
    const { user } = setup({}, () => mockApiError("post", "/reviews/maria", 400, "Ya dejaste una reseña"));
    const box = await open(user);
    await user.click(screen.getAllByRole("button").filter((b) => b.querySelector("svg.w-8"))[2]);
    await user.type(box, "Bien");
    await user.click(screen.getByRole("button", { name: "Enviar reseña" }));
    expect(await screen.findByText("Ya dejaste una reseña")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByPlaceholderText("¿Qué te parecieron las clases con este profesor?")).not.toBeInTheDocument();
  });
});
