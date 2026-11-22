/**
 * Soporte: modal para abrir un ticket y vista con los tickets propios (alumno y profesor).
 */
import { describe, expect, it, vi } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { screen, waitFor } from "@testing-library/react";
import SupportTicketModal from "@/components/support/SupportTicketModal";
import SupportTicketsView from "@/components/support/SupportTicketsView";
import { renderScreen } from "./render";
import { mockApi, mockApiError, callsTo, FIXTURE } from "./fakeApi";

describe("SupportTicketModal", () => {
  function setup(props: Partial<React.ComponentProps<typeof SupportTicketModal>> = {}) {
    const onClose = vi.fn(); const onSent = vi.fn();
    renderScreen(<SupportTicketModal open onClose={onClose} onSent={onSent} screenContext="/dashboard/classes" {...props} />, { role: "student" });
    return { onClose, onSent, user: userEvent.setup() };
  }
  const subject = () => screen.getByPlaceholderText(/No puedo agendar/);
  const body = () => screen.getAllByRole("textbox").find((e) => e.tagName === "TEXTAREA") as HTMLElement;
  const send = () => screen.getByRole("button", { name: "Enviar a soporte" });

  it("cerrado no pinta nada", () => {
    const { container } = renderScreen(<SupportTicketModal open={false} onClose={() => {}} />, { role: "student" });
    expect(container.textContent).toBe("");
  });

  it("no se puede enviar sin asunto y mensaje", async () => {
    const { user } = setup();
    expect(send()).toBeDisabled();
    await user.type(subject(), "Duda");
    expect(send()).toBeDisabled();
    await user.type(body(), "   ");
    expect(send()).toBeDisabled(); // un mensaje en blanco no cuenta
    await user.type(body(), "Hola");
    expect(send()).toBeEnabled();
  });

  it("ofrece las cuatro categorías y por defecto es «Duda»", async () => {
    const { user } = setup();
    for (const c of ["Bug", "Error", "Duda", "Otro"]) expect(screen.getByRole("button", { name: new RegExp(c) })).toBeInTheDocument();
    await user.type(subject(), "x");
    await user.type(body(), "y");
    await user.click(send());
    await waitFor(() => expect(callsTo("post", "/support/tickets")).toHaveLength(1));
    expect(callsTo("post", "/support/tickets")[0].body).toMatchObject({ category: "question" });
  });

  it("envía categoría elegida, asunto y mensaje recortados y la pantalla desde la que se reportó", async () => {
    const { user, onSent } = setup();
    await user.click(screen.getByRole("button", { name: /Bug/ }));
    await user.type(subject(), "  No carga  ");
    await user.type(body(), "  La pantalla queda en blanco  ");
    await user.click(send());
    await waitFor(() => expect(callsTo("post", "/support/tickets")).toHaveLength(1));
    expect(callsTo("post", "/support/tickets")[0].body).toEqual({
      category: "bug", subject: "No carga", message: "La pantalla queda en blanco", screen_context: "/dashboard/classes",
    });
    expect(await screen.findByText("Ticket enviado correctamente")).toBeInTheDocument();
    expect(onSent).toHaveBeenCalledTimes(1);
  });

  it("precarga el mensaje inicial (lo usa Chipi al derivar a soporte)", () => {
    setup({ initialMessage: "Chipi no supo ayudarme" });
    expect(body()).toHaveValue("Chipi no supo ayudarme");
  });

  it("si falla muestra el error y deja reintentar sin perder lo escrito", async () => {
    mockApiError("post", "/support/tickets", 500, "Servidor caído");
    const { user, onSent } = setup();
    await user.type(subject(), "Asunto");
    await user.type(body(), "Mensaje");
    await user.click(send());
    expect(await screen.findByText(/Servidor caído|No pudimos enviar/)).toBeInTheDocument();
    expect(onSent).not.toHaveBeenCalled();
    expect(subject()).toHaveValue("Asunto");
    expect(send()).toBeEnabled();
  });

  it("cerrar llama a onClose", async () => {
    const { user, onClose } = setup();
    await user.click(screen.getAllByRole("button").find((b) => b.querySelector("svg") && !b.textContent?.trim())!);
    expect(onClose).toHaveBeenCalled();
  });
});

describe("SupportTicketsView", () => {
  const answered = { ...FIXTURE.ticket, id: 52, status: "answered", admin_response: "Ya lo solucionamos", user_notified_seen: false, subject: "Pago no aparece" };
  const pending = { ...FIXTURE.ticket, id: 51, status: "pending", subject: "Duda sobre horarios" };

  it("sin tickets invita a crear el primero", async () => {
    renderScreen(<SupportTicketsView />, { role: "student" });
    expect(await screen.findByText("Soporte")).toBeInTheDocument();
    expect(screen.queryByText("Pendiente")).not.toBeInTheDocument();
  });

  it("lista los tickets con su estado", async () => {
    mockApi("get", "/support/tickets/me", [pending, answered]);
    renderScreen(<SupportTicketsView />, { role: "student" });
    expect(await screen.findByText("Duda sobre horarios")).toBeInTheDocument();
    expect(screen.getByText("Pago no aparece")).toBeInTheDocument();
    expect(screen.getByText("Pendiente")).toBeInTheDocument();
    expect(screen.getByText("Respondido")).toBeInTheDocument();
  });

  it("un ticket pendiente, al abrirlo, avisa que aún no hay respuesta y NO marca nada como visto", async () => {
    mockApi("get", "/support/tickets/me", [pending]);
    renderScreen(<SupportTicketsView />, { role: "student" });
    await userEvent.setup().click(await screen.findByText("Duda sobre horarios"));
    expect(screen.getByText(/Aún no hay respuesta/)).toBeInTheDocument();
    expect(callsTo("patch", /\/support\/tickets\/\d+\/seen/)).toHaveLength(0);
  });

  it("un ticket respondido y no visto, al abrirlo, muestra la respuesta y se marca como visto", async () => {
    mockApi("get", "/support/tickets/me", [answered]);
    renderScreen(<SupportTicketsView />, { role: "student" });
    await userEvent.setup().click(await screen.findByText("Pago no aparece"));
    expect(screen.getByText("Ya lo solucionamos")).toBeInTheDocument();
    await waitFor(() => expect(callsTo("patch", "/support/tickets/52/seen")).toHaveLength(1));
  });

  it("abrir un ticket ya visto no vuelve a marcarlo", async () => {
    mockApi("get", "/support/tickets/me", [{ ...answered, user_notified_seen: true }]);
    renderScreen(<SupportTicketsView />, { role: "student" });
    await userEvent.setup().click(await screen.findByText("Pago no aparece"));
    expect(screen.getByText("Ya lo solucionamos")).toBeInTheDocument();
    expect(callsTo("patch", /seen/)).toHaveLength(0);
  });

  it("el botón de nuevo ticket abre el modal", async () => {
    renderScreen(<SupportTicketsView />, { role: "teacher" });
    const open = (await screen.findAllByRole("button")).find((b) => /nuevo|reportar|crear/i.test(b.textContent ?? ""))!;
    await userEvent.setup().click(open);
    expect(await screen.findByText("Reportar a soporte")).toBeInTheDocument();
  });
});
