import { afterEach, describe, expect, it, vi } from "vitest";

// En jsdom nada es visible: sin esto cada paso «Más» esperaría 600 ms reales.
vi.mock("@/components/tour/resolveTarget", async (orig) => ({ ...(await orig<typeof import("@/components/tour/resolveTarget")>()), waitForVisibleTarget: async () => null }));
import React from "react";
import userEvent from "@testing-library/user-event";
import { act, screen, waitFor } from "@testing-library/react";
import NavBar from "@/components/layout/NavBar";
import TourHost from "@/components/tour/TourHost";
import { useTourStore } from "@/components/tour/tourStore";
import { STUDENT_STEPS, TEACHER_STEPS } from "@/components/tour/tourSteps";
import { useAuthStore } from "@/store/authStore";
import { renderScreen, signIn, type Role } from "./render";
import { mockApi, mockApiError, callsTo, FIXTURE } from "./fakeApi";

function menuApis(chatEnabled = true) {
  mockApi("get", "/chat/conversations/unread-count", { unread_count: 0 });
  mockApi("get", "/support/tickets/me/unread-count", { unread_count: 0 });
  mockApi("get", "/teachers/me/notifications/unread-count", { unread_count: 0 });
  mockApi("get", "/admin/notifications/unread-count", { unread_count: 0 });
  mockApi("get", "/admin/platform-config", { ...FIXTURE.platformConfig, chat_enabled: chatEnabled });
}
function withUser(patch: Record<string, unknown>) {
  act(() => { useAuthStore.setState({ user: { ...useAuthStore.getState().user!, ...patch } as never }); });
}
const route = (role: Role) => (role === "student" ? "/dashboard" : "/teacher/dashboard");
const mount = (role: Role, patch: Record<string, unknown>) => {
  mockApi("patch", "/users/me", {});
  const r = renderScreen(<TourHost />, { role, route: route(role) });
  withUser(patch);
  return r;
};

afterEach(() => { useTourStore.setState({ forceMoreOpen: false }); });

describe("TourHost · cuándo aparece", () => {
  it("alumno con onboarding hecho y tour_completed=false ve la guía", async () => {
    mount("student", { tour_completed: false });
    expect(await screen.findByText("¡Te damos la bienvenida!")).toBeInTheDocument();
  });
  it("profesor también", async () => {
    mount("teacher", { tour_completed: false });
    expect(await screen.findByText("¡Te damos la bienvenida!")).toBeInTheDocument();
  });
  it.each([
    ["student", { tour_completed: undefined }],      // store viejo de localStorage
    ["student", { tour_completed: true }],
    ["student", { tour_completed: false, onboarding_completed: false }],
    ["superadmin", { tour_completed: false }],
  ] as [Role, Record<string, unknown>][])("no aparece: %s %j", async (role, patch) => {
    mount(role, patch);
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("TourHost · terminar y saltar", () => {
  it("«Saltar guía» guarda tour_completed=true en el servidor y en el store, y cierra", async () => {
    const user = userEvent.setup();
    mount("student", { tour_completed: false });
    await user.click(await screen.findByRole("button", { name: "Saltar guía" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(useAuthStore.getState().user?.tour_completed).toBe(true);
    await waitFor(() => expect(callsTo("patch", "/users/me")).toHaveLength(1));
    expect(callsTo("patch", "/users/me")[0].body).toEqual({ tour_completed: true });
  });

  it("recorrerla hasta «Terminar» hace el mismo PATCH", async () => {
    const user = userEvent.setup();
    mount("student", { tour_completed: false });
    await user.click(await screen.findByRole("button", { name: "Siguiente" }));   // en jsdom ningún ítem es visible: pasa al cierre
    await user.click(await screen.findByRole("button", { name: "Terminar" }));
    await waitFor(() => expect(callsTo("patch", "/users/me")).toHaveLength(1));
    expect(useAuthStore.getState().user?.tour_completed).toBe(true);
  });

  it("si el PATCH falla se cierra igual y no hay error sin capturar", async () => {
    const user = userEvent.setup();
    mockApiError("patch", "/users/me", 500, "caído");
    renderScreen(<TourHost />, { role: "student", route: "/dashboard" });
    withUser({ tour_completed: false });
    await user.click(await screen.findByRole("button", { name: "Saltar guía" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(useAuthStore.getState().user?.tour_completed).toBe(true);
  });

  it("repetir: poner tour_completed=false en el store la abre de nuevo", async () => {
    mount("student", { tour_completed: true });
    expect(screen.queryByRole("dialog")).toBeNull();
    withUser({ tour_completed: false });
    expect(await screen.findByText("¡Te damos la bienvenida!")).toBeInTheDocument();
  });
});

describe("Acople con el NavBar", () => {
  it.each([["student", STUDENT_STEPS], ["teacher", TEACHER_STEPS]] as [Role, typeof STUDENT_STEPS][])(
    "%s: cada target de la guía existe en el menú", async (role, steps) => {
      menuApis(true);
      signIn(role);
      renderScreen(<NavBar />, { role, route: route(role) });
      await screen.findAllByRole("link", { name: /Perfil/ });
      for (const st of steps) {
        if (!st.target) continue;
        expect(document.querySelector(st.target), st.target).not.toBeNull();
      }
    });

  it("el NavBar monta la guía para una cuenta nueva", async () => {
    menuApis(true);
    renderScreen(<NavBar />, { role: "student", route: "/dashboard" });
    withUser({ tour_completed: false });
    expect(await screen.findByText("¡Te damos la bienvenida!")).toBeInTheDocument();
  });
});
