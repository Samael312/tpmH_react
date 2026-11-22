/**
 * Chat del profesor: redirección con el chat apagado, lista de conversaciones, deep-links (?conversation= y ?student=),
 * refrescar y volver desde el hilo.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { screen, waitFor } from "@testing-library/react";
import TeacherChatPage from "@/app/(teacher)/teacher/chat/page";
import { useChatStore } from "@/store/chatStore";
import { renderScreen } from "./render";
import { routerState } from "./router";
import { mockApi, mockApiError, callsTo, FIXTURE } from "./fakeApi";

const CONV = (id: number, over: Record<string, unknown> = {}) => ({
  id, conversation_type: "direct", title: `Alumno ${id}`, subtitle: null, avatar: null, other_username: `al${id}`,
  cohort_id: null, last_message_preview: "Hola", last_message_at: new Date().toISOString(), unread_count: 0, ...over,
});

function setup(o: { conversations?: unknown[]; chatEnabled?: boolean; search?: string; extra?: () => void } = {}) {
  mockApi("get", "/admin/platform-config", { ...FIXTURE.platformConfig, chat_enabled: o.chatEnabled ?? true });
  mockApi("get", "/chat/conversations", o.conversations ?? [CONV(1), CONV(2)]);
  mockApi("get", /^\/chat\/conversations\/\d+\/messages/, []);
  o.extra?.();
  const view = renderScreen(<TeacherChatPage />, { role: "teacher", route: "/teacher/chat", search: o.search });
  return { ...view, user: userEvent.setup() };
}

beforeEach(() => {
  useChatStore.setState({
    messagesByConversation: {}, errorByConversation: {}, fetchingByConversation: {}, historyLoadedByConversation: {}, historyErrorByConversation: {}, connected: true,
  } as never);
});
afterEach(() => { vi.restoreAllMocks(); });

describe("Chat del profesor", () => {
  it("lista las conversaciones y pide elegir una", async () => {
    setup();
    expect(await screen.findByText("Alumno 1")).toBeInTheDocument();
    expect(screen.getByText("Elige una conversación")).toBeInTheDocument();
  });

  it("con el chat apagado por el admin redirige a «no autorizado»", async () => {
    setup({ chatEnabled: false });
    await waitFor(() => expect(routerState.router.replace).toHaveBeenCalledWith("/unauthorized"));
    expect(screen.queryByText("Elige una conversación")).not.toBeInTheDocument();
  });

  it("elegir una conversación abre su hilo y «Volver» regresa a la lista", async () => {
    const { user } = setup();
    await user.click(await screen.findByText("Alumno 2"));
    await waitFor(() => expect(callsTo("get", /\/chat\/conversations\/2\/messages/).length).toBeGreaterThan(0));
    expect(screen.queryByText("Elige una conversación")).not.toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: /Volver|Atrás/ }));
    expect(await screen.findByText("Elige una conversación")).toBeInTheDocument();
  });

  it("?conversation= abre ese hilo una sola vez", async () => {
    const { user } = setup({ search: "conversation=2" });
    await waitFor(() => expect(callsTo("get", /\/chat\/conversations\/2\/messages/).length).toBeGreaterThan(0));
    await user.click(await screen.findByRole("button", { name: /Volver|Atrás/ }));
    expect(await screen.findByText("Elige una conversación")).toBeInTheDocument();
  });

  it("?conversation= con un id desconocido no abre nada", async () => {
    setup({ search: "conversation=999" });
    expect(await screen.findByText("Alumno 1")).toBeInTheDocument();
    expect(screen.getByText("Elige una conversación")).toBeInTheDocument();
  });

  it("?student= abre la conversación directa y deja la URL con ?conversation=", async () => {
    setup({ search: "student=al5", extra: () => mockApi("get", "/chat/conversations/direct/al5", CONV(5)) });
    await waitFor(() => expect(routerState.router.replace).toHaveBeenCalledWith("/teacher/chat?conversation=5"));
    expect(callsTo("get", "/chat/conversations/direct/al5")).toHaveLength(1);
  });

  it("?student= muestra «Abriendo conversación…» mientras espera", async () => {
    let release: (v: unknown) => void = () => {};
    setup({ search: "student=al5", extra: () => mockApi("get", "/chat/conversations/direct/al5", () => new Promise((r) => { release = r; }) as never) });
    expect(await screen.findByText("Abriendo conversación...")).toBeInTheDocument();
    release(CONV(5));
  });

  it("?student= con error lo avisa y vuelve a la lista", async () => {
    setup({ search: "student=al5", extra: () => mockApiError("get", "/chat/conversations/direct/al5", 404, "Sin permiso para chatear") });
    expect(await screen.findByText("Sin permiso para chatear")).toBeInTheDocument();
    expect(routerState.router.replace).toHaveBeenCalledWith("/teacher/chat");
  });

  it("el botón de refrescar vuelve a pedir la lista y el hilo abierto", async () => {
    const { user } = setup();
    await user.click(await screen.findByText("Alumno 1"));
    await waitFor(() => expect(callsTo("get", /\/chat\/conversations\/1\/messages/).length).toBeGreaterThan(0));
    const before = callsTo("get", "/chat/conversations").length;
    const refresh = screen.getAllByRole("button").find((b) => /actualizar|refrescar/i.test(b.getAttribute("aria-label") ?? b.title ?? ""));
    expect(refresh).toBeTruthy();
    await user.click(refresh!);
    await waitFor(() => expect(callsTo("get", "/chat/conversations").length).toBeGreaterThan(before));
  });
});
