/**
 * Menú lateral y barra inferior móvil · cierra huecos: plegar el menú, hoja «Más», insignias de no leídos (con tope 99+),
 * cerrar sesión, chat desactivado por el admin y el render de servidor (antes de hidratar).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { QueryClientProvider } from "@tanstack/react-query";
import { screen, waitFor } from "@testing-library/react";
import NavBar from "@/components/layout/NavBar";
import { renderScreen, newQueryClient, signIn } from "./render";
import { usePageTopBar } from "@/lib/mobileTopBar";
import { mockApi, FIXTURE } from "./fakeApi";

function counts(o: { chat?: number; support?: number; teacherNotifs?: number; adminNotifs?: number; chatEnabled?: boolean } = {}) {
  mockApi("get", "/chat/conversations/unread-count", { unread_count: o.chat ?? 0 });
  mockApi("get", "/support/tickets/me/unread-count", { unread_count: o.support ?? 0 });
  mockApi("get", "/teachers/me/notifications/unread-count", { unread_count: o.teacherNotifs ?? 0 });
  mockApi("get", "/admin/notifications/unread-count", { unread_count: o.adminNotifs ?? 0 });
  mockApi("get", "/admin/platform-config", { ...FIXTURE.platformConfig, chat_enabled: o.chatEnabled ?? true });
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Menú lateral · plegado y sesión", () => {
  it("el botón de plegar alterna entre «Colapsar» y «Expandir» y el cierre de sesión conserva su título", async () => {
    counts({ chat: 4 });
    renderScreen(<NavBar />, { role: "student", route: "/dashboard" });
    const user = userEvent.setup();
    await user.click(await screen.findByTitle("Colapsar"));
    expect(screen.getByTitle("Expandir")).toBeInTheDocument();
    expect(screen.getAllByTitle("Cerrar sesión").length).toBeGreaterThan(0);
    await user.click(screen.getByTitle("Expandir"));
    expect(screen.getByTitle("Colapsar")).toBeInTheDocument();
  });

  it("cerrar sesión espera al servidor y recarga en /login", async () => {
    counts();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const original = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { ...original, href: "http://localhost/dashboard" } });
    renderScreen(<NavBar />, { role: "student", route: "/dashboard" });
    const user = userEvent.setup();
    await user.click((await screen.findAllByRole("button", { name: /Cerrar sesión/ }))[0]);
    await waitFor(() => expect(window.location.href).toBe("/login"));
    Object.defineProperty(window, "location", { configurable: true, value: original });
  });

  it("si el admin desactiva el chat, la hoja «Más» no ofrece Chat", async () => {
    counts({ chatEnabled: false });
    renderScreen(<NavBar />, { role: "student", route: "/dashboard" });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Más" }));
    await screen.findByText("Más opciones");
    expect(document.querySelectorAll("a[href='/dashboard/chat']")).toHaveLength(0);
  });
});

describe("Barra inferior móvil · hoja «Más» e insignias", () => {
  it("abre la hoja, muestra las insignias (99+ como tope) y se cierra al elegir una opción", async () => {
    counts({ chat: 120, support: 3 });
    renderScreen(<NavBar />, { role: "student", route: "/dashboard" });
    const user = userEvent.setup();
    const more = await screen.findByRole("button", { name: "Más" });
    await waitFor(() => expect(more.textContent).toContain("99+"));
    await user.click(more);
    await screen.findByText("Más opciones");
    expect(screen.getAllByText("99+").length).toBeGreaterThan(1);
    expect(screen.getAllByText("3").length).toBeGreaterThan(0);
    const sheet = screen.getByText("Más opciones").closest("div[class*='fixed']") as HTMLElement;
    await user.click(sheet.querySelector("a[href='/dashboard/support']") as HTMLAnchorElement);
    await waitFor(() => expect(screen.queryByText("Más opciones")).not.toBeInTheDocument());
  });

  it("la hoja «Más» también cierra la sesión", async () => {
    counts();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    const original = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { ...original, href: "http://localhost/dashboard" } });
    renderScreen(<NavBar />, { role: "teacher", route: "/teacher/dashboard" });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Más" }));
    const buttons = await screen.findAllByRole("button", { name: /Cerrar sesión/ });
    await user.click(buttons.at(-1)!);
    await waitFor(() => expect(window.location.href).toBe("/login"));
    Object.defineProperty(window, "location", { configurable: true, value: original });
  });
});

describe("Menú lateral · insignias por rol", () => {
  it("profesor: chat, avisos y soporte con insignia; con el menú plegado la insignia va sobre el icono", async () => {
    counts({ chat: 150, support: 2, teacherNotifs: 5 });
    renderScreen(<NavBar />, { role: "teacher", route: "/teacher/dashboard" });
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getAllByText("99+").length).toBeGreaterThan(0));
    await user.click(await screen.findByTitle("Colapsar"));
    expect(screen.getAllByText("99+").length).toBeGreaterThan(0);
  });

  it("administración: los avisos pendientes se cuentan en el menú", async () => {
    counts({ adminNotifs: 7 });
    renderScreen(<NavBar />, { role: "superadmin", route: "/admin/dashboard" });
    await waitFor(() => expect(screen.getAllByText("7").length).toBeGreaterThan(0));
  });
});

describe("Menú lateral · render de servidor", () => {
  it("antes de hidratar pinta solo un contenedor vacío", () => {
    signIn("student");
    const html = renderToString(
      <QueryClientProvider client={newQueryClient()}>
        <NavBar />
      </QueryClientProvider>,
    );
    expect(html).toContain("<aside");
    expect(html).not.toContain("Cerrar sesión");
  });
});

describe("Menú · barra superior móvil y secciones", () => {
  it("la X de la hoja «Más» la cierra", async () => {
    counts();
    renderScreen(<NavBar />, { role: "student", route: "/dashboard" });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Más" }));
    const title = await screen.findByText("Más opciones");
    await user.click(title.parentElement!.querySelector("button") as HTMLElement);
    await waitFor(() => expect(screen.queryByText("Más opciones")).not.toBeInTheDocument());
  });

  it("un teacher_admin ve a la vez Aula Virtual y Administración", async () => {
    counts();
    renderScreen(<NavBar />, { role: "teacher_admin", route: "/teacher/dashboard" });
    expect(await screen.findByText("Aula Virtual")).toBeInTheDocument();
    expect(screen.getByText("Administración")).toBeInTheDocument();
  });

  it("una pantalla que declara «actualizar» muestra el botón en la barra superior móvil", async () => {
    counts();
    const onRefresh = vi.fn();
    const Screen = () => { usePageTopBar({ title: "Mi pantalla", onRefresh, isFetching: false }); return null; };
    renderScreen(<><NavBar /><Screen /></>, { role: "student", route: "/dashboard" });
    const user = userEvent.setup();
    await screen.findByText("Mi pantalla");
    await user.click(screen.getAllByRole("button", { name: "Actualizar datos" })[0]);
    expect(onRefresh).toHaveBeenCalled();
  });
});
