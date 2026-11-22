/**
 * Chat interno: lista de conversaciones, hilo (mensajes, estados, errores) y botón flotante.
 * El envío real va por WebSocket; aquí se sustituye `sendMessage` del store para comprobar qué pide el componente.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { screen, waitFor } from "@testing-library/react";
import ConversationList from "@/components/chat/ConversationList";
import ChatThreadView from "@/components/chat/ChatThreadView";
import ChatWidget from "@/components/chat/ChatWidget";
import { useChatStore } from "@/store/chatStore";
import type { ChatConversation } from "@/hooks/useChat";
import { renderScreen } from "./render";
import { mockApi, mockApiError, FIXTURE } from "./fakeApi";

const conv = (over: Partial<ChatConversation> = {}): ChatConversation => ({
  id: 1, conversation_type: "direct", title: "Profe Uno", subtitle: null, avatar: null, other_username: "profe",
  cohort_id: null, last_message_preview: "Hola", last_message_at: new Date(Date.now() - 5 * 60_000).toISOString(), unread_count: 0, ...over,
});

const serverMsg = (over: Record<string, unknown> = {}) => ({
  id: 100, conversation_id: 1, sender_id: 7, sender_username: "profe", content: "Hola alumno", created_at: new Date().toISOString(), delivered_at: null, ...over,
});

beforeEach(() => {
  useChatStore.setState({
    messagesByConversation: {}, errorByConversation: {}, fetchingByConversation: {}, historyLoadedByConversation: {}, historyErrorByConversation: {}, connected: true,
  } as never);
});

describe("ConversationList", () => {
  const setup = (conversations: ChatConversation[], extra: Partial<React.ComponentProps<typeof ConversationList>> = {}) => {
    const onSelect = vi.fn();
    renderScreen(<ConversationList conversations={conversations} loading={false} selectedId={null} onSelect={onSelect} {...extra} />, { role: "student" });
    return { onSelect, user: userEvent.setup() };
  };

  it("cargando muestra esqueletos, sin lista ni mensaje de vacío", () => {
    const { container } = renderScreen(<ConversationList conversations={[]} loading selectedId={null} onSelect={() => {}} />, { role: "student" });
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(3);
    expect(screen.queryByText(/Todavía no tienes conversaciones/)).not.toBeInTheDocument();
  });

  it("sin conversaciones lo dice", () => {
    setup([]);
    expect(screen.getByText("Todavía no tienes conversaciones")).toBeInTheDocument();
  });

  it("muestra título, vista previa y antigüedad relativa", () => {
    setup([conv()]);
    expect(screen.getByText("Profe Uno")).toBeInTheDocument();
    expect(screen.getByText("Hola")).toBeInTheDocument();
    expect(screen.getByText("5m")).toBeInTheDocument();
  });

  it.each([
    [10_000, "ahora"], [3 * 3600_000, "3h"], [2 * 86400_000, "2d"],
  ])("antigüedad %i ms → %s", (ago, label) => {
    setup([conv({ last_message_at: new Date(Date.now() - ago).toISOString() })]);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("no leídos: contador, y 99+ cuando son más de 99", () => {
    setup([conv({ id: 1, unread_count: 3 }), conv({ id: 2, title: "Otro", unread_count: 250 })]);
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("99+")).toBeInTheDocument();
  });

  it("sin mensajes: texto según tipo (directo vs grupal)", () => {
    setup([conv({ id: 1, last_message_preview: null, last_message_at: null }), conv({ id: 2, title: "Grupo A", conversation_type: "group", last_message_preview: null, last_message_at: null })]);
    expect(screen.getByText("Sin mensajes todavía")).toBeInTheDocument();
    expect(screen.getByText("Chat grupal")).toBeInTheDocument();
  });

  it("la inicial del título hace de avatar y, con foto, se usa la imagen", () => {
    setup([conv({ id: 1, title: "maría" }), conv({ id: 2, title: "Con foto", avatar: "https://img.example.com/a.png" })]);
    expect(screen.getByText("M")).toBeInTheDocument();
    expect(screen.getByAltText("Con foto")).toHaveAttribute("src", "https://img.example.com/a.png");
  });

  it("seleccionar entrega la conversación pulsada", async () => {
    const { onSelect, user } = setup([conv({ id: 1 }), conv({ id: 2, title: "Otro" })]);
    await user.click(screen.getByText("Otro"));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }));
  });
});

describe("ChatThreadView", () => {
  function setup(conversation = conv(), props: Partial<React.ComponentProps<typeof ChatThreadView>> = {}) {
    return { user: userEvent.setup(), ...renderScreen(<ChatThreadView conversation={conversation} {...props} />, { role: "student" }) };
  }

  it("hilo vacío invita a escribir el primer mensaje", async () => {
    mockApi("get", /^\/chat\/conversations\/1\/messages/, []);
    setup();
    expect(await screen.findByText(/Todavía no hay mensajes/)).toBeInTheDocument();
  });

  it("pinta el historial; los míos y los ajenos se distinguen por el lado", async () => {
    mockApi("get", /^\/chat\/conversations\/1\/messages/, [serverMsg(), serverMsg({ id: 101, sender_id: 1, sender_username: "alumno", content: "Hola profe" })]);
    setup();
    const theirs = await screen.findByText("Hola alumno");
    const mine = screen.getByText("Hola profe");
    expect(theirs.closest(".justify-start")).not.toBeNull();
    expect(mine.closest(".justify-end")).not.toBeNull();
  });

  it("en un chat directo no rotula al remitente; en uno grupal sí", async () => {
    mockApi("get", /^\/chat\/conversations\/1\/messages/, [serverMsg()]);
    const { unmount } = setup(conv({ conversation_type: "direct" }));
    await screen.findByText("Hola alumno");
    expect(screen.queryByText("profe")).not.toBeInTheDocument();
    unmount();
    useChatStore.setState({ messagesByConversation: {}, historyLoadedByConversation: {} } as never);
    setup(conv({ conversation_type: "group" }));
    expect(await screen.findByText("profe")).toBeInTheDocument();
  });

  it("si el historial no carga muestra el error con Reintentar, que vuelve a pedirlo", async () => {
    mockApiError("get", /^\/chat\/conversations\/1\/messages/, 500, "x");
    const { user } = setup();
    const retry = await screen.findByRole("button", { name: "Reintentar" });
    mockApi("get", /^\/chat\/conversations\/1\/messages/, [serverMsg()]);
    await user.click(retry);
    expect(await screen.findByText("Hola alumno")).toBeInTheDocument();
  });

  it("enviar: el botón está desactivado con texto en blanco; con texto llama a sendMessage y limpia el campo", async () => {
    mockApi("get", /^\/chat\/conversations\/1\/messages/, []);
    const sendMessage = vi.fn();
    useChatStore.setState({ sendMessage } as never);
    const { user } = setup();
    const send = await screen.findByRole("button", { name: "Enviar mensaje" });
    expect(send).toBeDisabled();
    const input = screen.getByLabelText("Escribe un mensaje");
    await user.type(input, "   ");
    expect(send).toBeDisabled();
    await user.clear(input);
    await user.type(input, "Hola{enter}");
    expect(sendMessage).toHaveBeenCalledWith(1, "Hola");
    expect(input).toHaveValue("");
  });

  it("Enter con el campo vacío no envía nada", async () => {
    mockApi("get", /^\/chat\/conversations\/1\/messages/, []);
    const sendMessage = vi.fn();
    useChatStore.setState({ sendMessage } as never);
    const { user } = setup();
    await user.type(await screen.findByLabelText("Escribe un mensaje"), "{enter}");
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("mensaje fallido: ofrece reintentar con su client_id", async () => {
    mockApi("get", /^\/chat\/conversations\/1\/messages/, []);
    const retryMessage = vi.fn();
    useChatStore.setState({
      retryMessage,
      messagesByConversation: { 1: [{ id: -5, client_id: "abc", conversation_id: 1, sender_id: 1, sender_username: "", content: "no llegó", created_at: new Date().toISOString(), delivered_at: null, status: "failed" }] },
      historyLoadedByConversation: { 1: true },
    } as never);
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: /No enviado · Reintentar/ }));
    expect(retryMessage).toHaveBeenCalledWith(1, "abc");
  });

  it("muestra el error de envío del store", async () => {
    mockApi("get", /^\/chat\/conversations\/1\/messages/, []);
    useChatStore.setState({ errorByConversation: { 1: "No se pudo enviar el mensaje" } } as never);
    setup();
    expect(await screen.findByText("No se pudo enviar el mensaje")).toBeInTheDocument();
  });

  it("sin conexión muestra el aviso de reconexión", async () => {
    mockApi("get", /^\/chat\/conversations\/1\/messages/, []);
    useChatStore.setState({ connected: false } as never);
    setup();
    expect(await screen.findByRole("status", { name: "Reconectando" })).toBeInTheDocument();
  });

  it("mientras está abierto el hilo es el activo (para no sumar no leídos) y al cerrarlo se libera", async () => {
    mockApi("get", /^\/chat\/conversations\/1\/messages/, []);
    const { unmount } = setup();
    await waitFor(() => expect(useChatStore.getState().activeConversationId).toBe(1));
    unmount();
    expect(useChatStore.getState().activeConversationId).toBeNull();
  });

  it("el botón Volver solo existe si el padre lo pide", async () => {
    mockApi("get", /^\/chat\/conversations\/1\/messages/, []);
    const onBack = vi.fn();
    const { user } = setup(conv(), { onBack });
    await user.click(await screen.findByRole("button", { name: "Volver" }));
    expect(onBack).toHaveBeenCalled();
  });
});

describe("ChatWidget (botón flotante)", () => {
  it("el superadmin no tiene chat interno", async () => {
    const { container } = renderScreen(<ChatWidget />, { role: "superadmin" });
    await waitFor(() => expect(container.querySelector("button")).toBeNull());
  });

  it("con el chat apagado por el admin no aparece", async () => {
    mockApi("get", /^\/(admin|system-catalogs)?\/?platform-config|\/config\/public/, { ...FIXTURE.platformConfig, chat_enabled: false });
    mockApi("get", "/admin/platform-config", { ...FIXTURE.platformConfig, chat_enabled: false });
    const { container } = renderScreen(<ChatWidget />, { role: "student" });
    await new Promise((r) => setTimeout(r, 150));
    expect(container.querySelector('button[aria-label="Chat interno"]')).toBeNull();
  });

  it("alumno con chat activo: abre la lista, entra a un hilo y vuelve", async () => {
    mockApi("get", "/chat/conversations", [conv()]);
    mockApi("get", /^\/chat\/conversations\/1\/messages/, [serverMsg()]);
    const { user } = { user: userEvent.setup() };
    renderScreen(<ChatWidget />, { role: "student" });
    await user.click(await screen.findByRole("button", { name: "Chat interno" }));
    expect(await screen.findByText("Profe Uno")).toBeInTheDocument();
    await user.click(screen.getByText("Profe Uno"));
    expect(await screen.findByText("Hola alumno")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Volver" }));
    expect(await screen.findByText("Chat interno", { selector: "p" })).toBeInTheDocument();
  });

  it("el botón muestra los no leídos", async () => {
    mockApi("get", /^\/chat\/conversations\/unread-count/, { unread_count: 4 });
    renderScreen(<ChatWidget />, { role: "teacher" });
    expect(await screen.findByText("4")).toBeInTheDocument();
  });
});
