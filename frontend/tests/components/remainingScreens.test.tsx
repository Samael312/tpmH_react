/**
 * Pantallas pequeñas que solo se montaban en pages.test.tsx: aquí tienen sus propias pruebas de flujo
 * (legales, 403, soporte, avisos del profesor, vista previa del perfil, Modo Dios, logs y landing).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { screen, waitFor } from "@testing-library/react";
import PrivacyPage from "@/app/(public)/privacy/page";
import TermsPage from "@/app/(public)/terms/page";
import UnauthorizedPage from "@/app/unauthorized/page";
import StudentSupportPage from "@/app/(student)/dashboard/support/page";
import TeacherSupportPage from "@/app/(teacher)/teacher/support/page";
import TeacherNotificationsPage from "@/app/(teacher)/teacher/notifications/page";
import TeacherPreviewPage from "@/app/(teacher)/teacher/profile/preview/page";
import GodModePage from "@/app/(superadmin)/admin/god-mode/page";
import LogsPage from "@/app/(superadmin)/admin/logs/page";
import LandingPage from "@/app/page";
import { renderScreen } from "./render";
import { routerState } from "./router";
import { mockApi, mockApiError, callsTo, FIXTURE } from "./fakeApi";
import { useAuthStore } from "@/store/authStore";

vi.mock("@/components/landing/LandingPageClient", () => ({ default: () => <div>LANDING-CLIENTE</div> }));
afterEach(() => { vi.restoreAllMocks(); });

describe("Páginas legales", () => {
  it("privacidad y términos pintan su contenido", () => {
    const { unmount } = renderScreen(<PrivacyPage />, { role: "anon", route: "/privacy" });
    expect(screen.getAllByText(/privacidad/i).length).toBeGreaterThan(0);
    unmount();
    renderScreen(<TermsPage />, { role: "anon", route: "/terms" });
    expect(screen.getAllByText(/términos/i).length).toBeGreaterThan(0);
  });
});

describe("403 · sin permiso", () => {
  it("con sesión ofrece ir al panel de su rol y cambiar de cuenta", async () => {
    renderScreen(<UnauthorizedPage />, { role: "student", route: "/unauthorized" });
    expect(screen.getByText("403")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Ir a mi panel/ })).toHaveAttribute("href", "/dashboard");
    await userEvent.setup().click(screen.getByRole("button", { name: /Cerrar sesión/ }));
    expect(routerState.router.push).toHaveBeenCalledWith("/login");
  });

  it.each([["superadmin", "/admin/dashboard"], ["teacher", "/teacher/dashboard"]] as const)("%s va a %s", (role, href) => {
    renderScreen(<UnauthorizedPage />, { role, route: "/unauthorized" });
    expect(screen.getByRole("link", { name: /Ir a mi panel/ })).toHaveAttribute("href", href);
  });

  it("sin sesión invita a iniciar sesión y «Volver atrás» retrocede", async () => {
    renderScreen(<UnauthorizedPage />, { role: "anon", route: "/unauthorized" });
    expect(screen.getByRole("link", { name: /Iniciar sesión/ })).toHaveAttribute("href", "/login");
    expect(screen.queryByRole("button", { name: /Cerrar sesión/ })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: /Volver atrás/ }));
    expect(routerState.router.back).toHaveBeenCalled();
  });
});

describe("Soporte del alumno y del profesor", () => {
  it.each([["alumno", StudentSupportPage, "student"], ["profesor", TeacherSupportPage, "teacher"]] as const)(
    "%s: muestra Soporte y sus tickets",
    async (_n, Page, role) => {
      mockApi("get", /^\/support\/tickets/, []);
      renderScreen(<Page />, { role });
      expect(await screen.findByRole("heading", { name: "Soporte" })).toBeInTheDocument();
    },
  );
});

describe("Avisos del profesor", () => {
  const N = (over: Record<string, unknown> = {}) => ({ id: 1, title: "Clase movida", message: "Se movió a las 10", is_read: false, created_at: "2026-11-20T10:00:00Z", ...over });

  it("lista los avisos, marca uno como leído y luego todos", async () => {
    mockApi("get", /^\/teachers\/me\/notifications(\?.*)?$/, [N(), N({ id: 2, title: "Otro", message: null, is_read: true })]);
    mockApi("patch", "/teachers/me/notifications/1/read", {});
    mockApi("post", "/teachers/me/notifications/mark-all-read", {});
    renderScreen(<TeacherNotificationsPage />, { role: "teacher" });
    const user = userEvent.setup();
    expect(await screen.findByText("Clase movida")).toBeInTheDocument();
    expect(screen.getByText("Otro")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Marcar leído" }));
    await waitFor(() => expect(callsTo("patch", "/teachers/me/notifications/1/read")).toHaveLength(1));
    await user.click(screen.getByRole("button", { name: /Marcar todo como leído/ }));
    await waitFor(() => expect(callsTo("post", "/teachers/me/notifications/mark-all-read")).toHaveLength(1));
  });

  it("sin avisos lo dice y si falla ofrece reintentar", async () => {
    mockApi("get", /^\/teachers\/me\/notifications(\?.*)?$/, []);
    const { unmount } = renderScreen(<TeacherNotificationsPage />, { role: "teacher" });
    expect(await screen.findByText("No tienes avisos.")).toBeInTheDocument();
    unmount();
    mockApiError("get", /^\/teachers\/me\/notifications/, 500, "x");
    renderScreen(<TeacherNotificationsPage />, { role: "teacher" });
    expect(await screen.findByText(/No se pudieron cargar los avisos/)).toBeInTheDocument();
    mockApi("get", /^\/teachers\/me\/notifications(\?.*)?$/, [N()]);
    await userEvent.setup().click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Clase movida")).toBeInTheDocument();
  });
});

describe("Vista previa del perfil del profesor", () => {
  const PROFILE = (over: Record<string, unknown> = {}) => ({
    ...FIXTURE.teacher, id: 3, user_username: "maria", bio: "Profe de mates", title: "Profesora certificada", timezone: "America/Caracas",
    languages: ["Español"], subjects: ["Matematica"], skills: [], certificates: [], gallery: [], social_links: {}, status: "approved",
    video_url: "https://cdn/v.mp4", ...over,
  });

  it("un perfil aprobado se ve sin aviso", async () => {
    mockApi("get", "/teachers/me/profile", PROFILE());
    mockApi("get", /^\/reviews\//, []);
    renderScreen(<TeacherPreviewPage />, { role: "teacher" });
    expect(await screen.findByText("Profe de mates")).toBeInTheDocument();
    expect(screen.queryByText("Solicitud en revisión")).not.toBeInTheDocument();
  });

  it.each([
    ["con video", "Solicitud en revisión"], ["sin video", "Video de presentación pendiente"],
  ] as const)("un perfil pendiente %s avisa: %s", async (kind, text) => {
    mockApi("get", "/teachers/me/profile", PROFILE({ status: "pending", video_url: kind === "con video" ? "https://cdn/v.mp4" : null }));
    mockApi("get", /^\/reviews\//, []);
    renderScreen(<TeacherPreviewPage />, { role: "teacher" });
    expect(await screen.findByText(text)).toBeInTheDocument();
  });

  it("si no carga dice «Perfil no disponible» y Reintentar lo vuelve a pedir", async () => {
    mockApiError("get", "/teachers/me/profile", 500, "x");
    renderScreen(<TeacherPreviewPage />, { role: "teacher" });
    const retry = await screen.findByRole("button", { name: /Reintentar/ });
    expect(screen.getByText("Perfil no disponible")).toBeInTheDocument();
    mockApi("get", "/teachers/me/profile", PROFILE());
    mockApi("get", /^\/reviews\//, []);
    await userEvent.setup().click(retry);
    expect(await screen.findByText("Profe de mates")).toBeInTheDocument();
  });
});

describe("Modo Dios (pantalla)", () => {
  const setup = (role: "superadmin" | "teacher_admin") => {
    mockApi("get", /^\/god-mode\/audit-log/, { items: [], total: 0, page: 1, page_size: 50 });
    mockApi("get", "/god-mode/lookup/teachers", []);
    useAuthStore.setState({ hasHydrated: true });
    return { ...renderScreen(<GodModePage />, { role }), user: userEvent.setup() };
  };

  it("el superadmin ve todas las acciones y elige una por categoría", async () => {
    const { user } = setup("superadmin");
    expect(screen.getByText(/Como superadmin/)).toBeInTheDocument();
    expect(screen.getByText("Elige una acción de la izquierda para empezar.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Pagos" }));
    await user.click(await screen.findByRole("button", { name: "Añadir un pago" }));
    expect(screen.getByRole("button", { name: "Editar un pago registrado" })).toBeInTheDocument();
    expect(screen.queryByText("Elige una acción de la izquierda para empezar.")).not.toBeInTheDocument();
  });

  it("el teacher_admin no ve las acciones de pagos ni la de transferir alumno", async () => {
    const { user } = setup("teacher_admin");
    expect(screen.getByText(/Como teacher_admin/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Pagos" }));
    expect(screen.queryByRole("button", { name: "Añadir un pago" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Alumnos" }));
    expect(screen.queryByRole("button", { name: "Transferir alumno a otro profesor" })).not.toBeInTheDocument();
  });
});

describe("Logs (pantalla)", () => {
  it("explica qué muestra y monta el visor de errores", async () => {
    mockApi("get", /^\/logs/, { items: [], total: 0 });
    mockApi("get", /^\/admin\/logs/, { items: [], total: 0 });
    renderScreen(<LogsPage />, { role: "superadmin" });
    expect(screen.getByRole("heading", { name: "Logs" })).toBeInTheDocument();
    expect(screen.getByText(/crashes de React/)).toBeInTheDocument();
  });
});

describe("Landing (servidor)", () => {
  it("monta el cliente de la landing con los datos del servidor", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ is_single_tenant: false }) }));
    const element = await LandingPage();
    renderScreen(element, { role: "anon" });
    expect(screen.getByText("LANDING-CLIENTE")).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
