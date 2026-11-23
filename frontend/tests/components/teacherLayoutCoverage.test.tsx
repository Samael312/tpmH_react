/**
 * Layout del profesor · cierra huecos: recuperar la sesión desde /users/me, pantalla de onboarding sin menú,
 * y qué pasa cuando falla la verificación del onboarding.
 */
import { describe, expect, it } from "vitest";
import React from "react";
import { screen, waitFor } from "@testing-library/react";
import TeacherLayout from "../../app/(teacher)/teacher/layout";
import { renderScreen } from "./render";
import { routerState } from "./router";
import { mockApi, mockApiError, makeUser } from "./fakeApi";
import { useAuthStore } from "@/store/authStore";

const Child = () => <div>CONTENIDO-DE-PANTALLA</div>;
const redirectedTo = (to: string) =>
  [...routerState.router.replace.mock.calls, ...routerState.router.push.mock.calls].some((c) => c[0] === to);

describe("layout del profesor · casos límite", () => {
  it("sin sesión en el navegador pero con cookie válida recupera al profesor de /users/me", async () => {
    mockApi("get", "/users/me", { ...makeUser("teacher"), onboarding_completed: true });
    renderScreen(<TeacherLayout><Child /></TeacherLayout>, { role: "anon", route: "/teacher/dashboard" });
    await waitFor(() => expect(useAuthStore.getState().user?.role).toBe("teacher"));
    await waitFor(() => expect(screen.getByText("CONTENIDO-DE-PANTALLA")).toBeInTheDocument());
  });

  it("sin sesión y con /users/me rechazado va al login y enseña el indicador de carga", async () => {
    mockApiError("get", "/users/me", 401, "No autenticado");
    const { container } = renderScreen(<TeacherLayout><Child /></TeacherLayout>, { role: "anon", route: "/teacher/dashboard" });
    await waitFor(() => expect(redirectedTo("/login")).toBe(true));
    expect(container.querySelector(".animate-spin")).not.toBeNull();
    expect(screen.queryByText("CONTENIDO-DE-PANTALLA")).not.toBeInTheDocument();
  });

  it("la ruta de onboarding se pinta a pantalla completa, sin menú ni verificación", async () => {
    mockApi("get", "/users/me", { ...makeUser("teacher"), onboarding_completed: false });
    const { container } = renderScreen(<TeacherLayout><Child /></TeacherLayout>, { role: "teacher", route: "/teacher/onboarding" });
    expect(await screen.findByText("CONTENIDO-DE-PANTALLA")).toBeInTheDocument();
    expect(container.querySelector("a[href='/teacher/dashboard']")).toBeNull();
  });

  it("si falla la verificación y el onboarding no consta como hecho, va al onboarding", async () => {
    mockApiError("get", "/users/me", 500, "caída");
    mockApi("get", "/teachers/me/profile", {});
    renderScreen(<TeacherLayout><Child /></TeacherLayout>, { role: "teacher", route: "/teacher/dashboard" });
    useAuthStore.setState({ user: { ...makeUser("teacher"), onboarding_completed: false } as never });
    await waitFor(() => expect(redirectedTo("/teacher/onboarding")).toBe(true));
  });

  it("si falla la verificación pero el onboarding ya constaba como hecho, deja pasar", async () => {
    mockApiError("get", "/users/me", 500, "caída");
    renderScreen(<TeacherLayout><Child /></TeacherLayout>, { role: "teacher", route: "/teacher/dashboard" });
    useAuthStore.setState({ user: { ...makeUser("teacher"), onboarding_completed: true } as never });
    await waitFor(() => expect(screen.getByText("CONTENIDO-DE-PANTALLA")).toBeInTheDocument());
  });
});
