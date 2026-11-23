/**
 * Chat del alumno (pantalla): chat desactivado, enlaces profundos (?conversation y ?teacher), volver y actualizar.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { screen, waitFor } from "@testing-library/react";
import StudentChatPage from "@/app/(student)/dashboard/chat/page";
import { renderScreen } from "./render";
import { routerState } from "./router";
import { mockApi, mockApiError, callsTo, FIXTURE } from "./fakeApi";

const conv = (over: Record<string, unknown> = {}) => ({
  id: 1, conversation_type: "direct", title: "Profe Uno", subtitle: null, avatar: null, other_username: "profe",
  cohort_id: null, last_message_preview: "Hola", last_message_at: new Date().toISOString(), unread_count: 0, ...over,
});

function setup(search = "", conversations: unknown[] = [conv()], chatEnabled = true) {
  mockApi("get", "/admin/platform-config", { ...FIXTURE.platformConfig, chat_enabled: chatEnabled });
  mockApi("get", /^\/chat\/conversations(\?.*)?$/, conversations);
  mockApi("get", /^\/chat\/conversations\/\d+\/messages/, []);
  mockApi("post", /^\/chat\/conversations\/\d+\/read/, {});
  const view = renderScreen(<StudentChatPage />, { role: "student", route: "/dashboard/chat", search });
  return { ...view, user: userEvent.setup() };
}
afterEach(() => { vi.restoreAllMocks(); });

describe("Chat del alumno · pantalla", () => {
  it("si el admin desactivó el chat manda a /unauthorized y no pinta la pantalla", async () => {
    setup("", [conv()], false);
    await waitFor(() => expect(routerState.router.replace).toHaveBeenCalledWith("/unauthorized"));
    expect(screen.queryByText("Habla directamente con tu profesor o tu grupo.")).not.toBeInTheDocument();
  });

  it("sin conversación elegida invita a elegir una", async () => {
    setup();
    expect(await screen.findByText("Elige una conversación")).toBeInTheDocument();
  });

  it("?conversation=<id> abre ese hilo y «Volver» regresa a la lista sin reabrirlo", async () => {
    const { user } = setup("conversation=1");
    await user.click(await screen.findByRole("button", { name: /Volver/ }));
    expect(await screen.findByText("Elige una conversación")).toBeInTheDocument();
  });

  it("?conversation con un id que no existe no abre nada", async () => {
    setup("conversation=999");
    expect(await screen.findByText("Elige una conversación")).toBeInTheDocument();
  });

  it("?teacher=<usuario> abre (o crea) el chat directo y deja el id en la URL", async () => {
    mockApi("get", "/chat/conversations/direct/profe", conv({ id: 5, title: "Profe Cinco" }));
    setup("teacher=profe");
    await waitFor(() => expect(routerState.router.replace).toHaveBeenCalledWith("/dashboard/chat?conversation=5"));
    expect(callsTo("get", "/chat/conversations/direct/profe")).toHaveLength(1);
    expect(await screen.findByText(/Todavía no hay mensajes/)).toBeInTheDocument();
  });

  it("si no se puede abrir el chat con el profesor lo avisa y limpia la URL", async () => {
    mockApiError("get", "/chat/conversations/direct/profe", 404, "No existe ese profesor");
    setup("teacher=profe");
    expect(await screen.findByText("No existe ese profesor")).toBeInTheDocument();
    expect(routerState.router.replace).toHaveBeenCalledWith("/dashboard/chat");
  });

  it("mientras abre el chat con el profesor enseña «Abriendo conversación...»", async () => {
    mockApi("get", "/chat/conversations/direct/profe", () => new Promise(() => {}));
    setup("teacher=profe");
    expect(await screen.findByText("Abriendo conversación...")).toBeInTheDocument();
  });

  it("el botón de actualizar vuelve a pedir las conversaciones", async () => {
    const { user } = setup("conversation=1");
    await screen.findByText(/Todavía no hay mensajes/);
    const before = callsTo("get", /^\/chat\/conversations(\?.*)?$/).length;
    await user.click(screen.getAllByRole("button", { name: "Actualizar datos" })[0]);
    await waitFor(() => expect(callsTo("get", /^\/chat\/conversations(\?.*)?$/).length).toBeGreaterThan(before));
  });
});
