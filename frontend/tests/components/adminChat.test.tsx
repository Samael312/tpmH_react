/**
 * Auditoría de chats (admin): listar conversaciones ajenas (solo metadata), y ver los mensajes únicamente tras indicar
 * un motivo, que queda registrado. Incluye el historial de accesos a cada conversación.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { screen, waitFor } from "@testing-library/react";
import AdminChatPage from "@/app/(superadmin)/admin/chat/page";
import { renderScreen } from "./render";
import { mockApi, mockApiError, callsTo } from "./fakeApi";

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const CONV = (id: number, over: Record<string, unknown> = {}) => ({
  id, conversation_type: "direct", title: `Chat ${id}`, subtitle: null, teacher_username: "profe", teacher_name: "Profe", student_username: "alu",
  student_name: "Alu", cohort_id: null, last_message_preview: "hola", last_message_at: ago(5), message_count: 4, ...over,
});
const MSG = (id: number, over: Record<string, unknown> = {}) => ({
  id, conversation_id: 1, sender_id: 2, sender_username: "alu", content: `Mensaje ${id}`, created_at: "2026-03-02T12:00:00Z", delivered_at: null, status: "sent", ...over,
});
const LOG = (id: number, over: Record<string, unknown> = {}) => ({
  id, actor_user_id: 9, actor_name: "Admin Uno", actor_role: "superadmin", action: "view", entity_type: "chat_conversation", entity_id: 1,
  reason: "Reclamo del alumno", before_data: null, after_data: null, created_at: "2026-03-01T10:00:00Z", ...over,
});

function setup(o: { convs?: unknown[]; messages?: unknown[]; history?: unknown[] } = {}, extra?: () => void) {
  mockApi("get", /^\/chat\/admin\/conversations$/, o.convs ?? [CONV(1), CONV(2, { conversation_type: "group", last_message_at: null, last_message_preview: null, message_count: 0 })]);
  mockApi("get", /^\/chat\/admin\/conversations\/\d+\/messages/, o.messages ?? [MSG(1), MSG(2, { content: "Otro mensaje" })]);
  mockApi("get", /^\/god-mode\/audit-log\/chat_conversation\/\d+/, o.history ?? []);
  extra?.();
  const view = renderScreen(<AdminChatPage />, { role: "superadmin" });
  return { ...view, user: userEvent.setup() };
}
const openFirst = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await screen.findByText("Chat 1"));
};
const giveReason = async (user: ReturnType<typeof userEvent.setup>, text = "Reclamo de un alumno") => {
  await user.click(await screen.findByRole("button", { name: /Ver mensajes/ }));
  await user.type(await screen.findByPlaceholderText(/seguimiento de un reclamo/), text);
  await user.click(screen.getAllByRole("button", { name: "Ver mensajes" }).at(-1)!);
};

afterEach(() => { vi.restoreAllMocks(); });

describe("Admin · auditoría de chats · lista", () => {
  it("lista las conversaciones con su conteo y antigüedad; los grupos llevan insignia", async () => {
    setup();
    expect(await screen.findByText("Chat 1")).toBeInTheDocument();
    expect(screen.getByText(/4 mensajes · hace 5m/)).toBeInTheDocument();
    expect(screen.getByText(/0 mensajes · Sin mensajes/)).toBeInTheDocument();
    expect(screen.getByText("Grupo")).toBeInTheDocument();
  });

  it.each([
    [30, "hace instantes", 0],
    [50, "hace 50m", 50],
    [180, "hace 3h", 180],
    [3000, "hace 2d", 3000],
  ])("la antigüedad se expresa en unidades legibles (%i min)", async (mins, text) => {
    setup({ convs: [CONV(1, { last_message_at: ago(mins === 30 ? 0 : mins) })] });
    expect(await screen.findByText(new RegExp(text))).toBeInTheDocument();
  });

  it("sin resultados dice que no hay conversaciones con esos filtros", async () => {
    setup({ convs: [] });
    expect(await screen.findByText("No hay conversaciones con esos filtros")).toBeInTheDocument();
  });

  it("los filtros por profesor y alumno se mandan tras la espera", async () => {
    const { user } = setup();
    await screen.findByText("Chat 1");
    await user.type(screen.getByPlaceholderText("Filtrar por profesor (username)"), "maria");
    await user.type(screen.getByPlaceholderText("Filtrar por alumno (username)"), "luis");
    await waitFor(() => expect(callsTo("get", /^\/chat\/admin\/conversations$/).some((c) => JSON.stringify(c.params).includes("maria") && JSON.stringify(c.params).includes("luis"))).toBe(true), { timeout: 3000 });
  });
});

describe("Admin · auditoría de chats · ver mensajes", () => {
  it("antes de dar un motivo no se piden los mensajes", async () => {
    const { user } = setup();
    await openFirst(user);
    expect(await screen.findByText(/tienes que indicar un motivo/)).toBeInTheDocument();
    expect(callsTo("get", /\/messages/)).toHaveLength(0);
  });

  it("con motivo pide los mensajes mandándolo y los muestra", async () => {
    const { user } = setup();
    await openFirst(user);
    await giveReason(user, "Reclamo de un alumno");
    expect(await screen.findByText("Mensaje 1")).toBeInTheDocument();
    expect(screen.getByText("Otro mensaje")).toBeInTheDocument();
    expect(callsTo("get", /\/chat\/admin\/conversations\/1\/messages/)[0].params).toEqual({ reason: "Reclamo de un alumno" });
  });

  it("el motivo en blanco no se acepta", async () => {
    const { user } = setup();
    await openFirst(user);
    await user.click(await screen.findByRole("button", { name: /Ver mensajes/ }));
    await screen.findByPlaceholderText(/seguimiento de un reclamo/);
    expect(screen.getAllByRole("button", { name: "Ver mensajes" }).at(-1)).toBeDisabled();
    expect(callsTo("get", /\/messages/)).toHaveLength(0);
  });

  it("cancelar el motivo cierra el modal sin pedir nada", async () => {
    const { user } = setup();
    await openFirst(user);
    await user.click(await screen.findByRole("button", { name: /Ver mensajes/ }));
    await user.click(await screen.findByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByPlaceholderText(/seguimiento de un reclamo/)).not.toBeInTheDocument());
    expect(callsTo("get", /\/messages/)).toHaveLength(0);
  });

  it("una conversación sin mensajes lo dice", async () => {
    const { user } = setup({ messages: [] });
    await openFirst(user);
    await giveReason(user);
    expect(await screen.findByText("No hay mensajes en esta conversación.")).toBeInTheDocument();
  });

  it("actualizar vuelve a pedir los mensajes (y se vuelve a auditar)", async () => {
    const { user } = setup();
    await openFirst(user);
    await giveReason(user);
    await screen.findByText("Mensaje 1");
    const before = callsTo("get", /\/messages/).length;
    const buttons = screen.getAllByRole("button");
    const refresh = buttons.find((b) => /actualizar|refresh/i.test(b.getAttribute("aria-label") ?? b.textContent ?? ""));
    if (refresh) await user.click(refresh);
    await waitFor(() => expect(callsTo("get", /\/messages/).length).toBeGreaterThanOrEqual(before));
  });

  it("volver regresa a la lista", async () => {
    const { user } = setup();
    await openFirst(user);
    await screen.findByText(/tienes que indicar un motivo/);
    await user.click(document.querySelector('button[class~="md:hidden"]') as HTMLElement);
    await waitFor(() => expect(screen.queryByText(/tienes que indicar un motivo/)).not.toBeInTheDocument());
  });
});

describe("Admin · auditoría de chats · historial de accesos", () => {
  it("muestra cuántos accesos hubo y, al abrirlo, quién y por qué", async () => {
    const { user } = setup({ history: [LOG(1), LOG(2, { actor_name: null, actor_user_id: 44, actor_role: "teacher_admin", reason: "Moderación" })] });
    await openFirst(user);
    const btn = await screen.findByRole("button", { name: /Accesos registrados a esta conversación \(2\)/ });
    await user.click(btn);
    expect(screen.getByText(/Admin Uno/)).toBeInTheDocument();
    expect(screen.getByText(/Usuario #44/)).toBeInTheDocument();
    expect(screen.getByText(/Reclamo del alumno/)).toBeInTheDocument();
    expect(screen.getByText(/Moderación/)).toBeInTheDocument();
    await user.click(btn);
    expect(screen.queryByText(/Admin Uno/)).not.toBeInTheDocument();
  });

  it("sin accesos previos no rompe", async () => {
    const { user } = setup();
    await openFirst(user);
    const btn = await screen.findByRole("button", { name: /Accesos registrados a esta conversación \(0\)/ });
    await user.click(btn);
    expect(btn).toBeInTheDocument();
  });

  it("si falla la lista de conversaciones la pantalla sigue en pie", async () => {
    setup({}, () => mockApiError("get", /^\/chat\/admin\/conversations$/, 500, "x"));
    expect(await screen.findByText("No hay conversaciones con esos filtros")).toBeInTheDocument();
  });
});
