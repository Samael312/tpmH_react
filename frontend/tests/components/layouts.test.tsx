/**
 * Guardas de acceso de los tres layouts (alumno, profesor, admin) y menú que ve cada rol.
 * Es la barrera de la interfaz: el backend valida de verdad, pero un rol equivocado nunca debe ver la pantalla de otro.
 */
import { describe, expect, it } from "vitest";
import React from "react";
import { waitFor, screen } from "@testing-library/react";
import { renderScreen, settle, type Role } from "./render";
import { routerState } from "./router";
import { mockApi, mockApiError, makeUser } from "./fakeApi";
import StudentLayout from "../../app/(student)/dashboard/layout";
import TeacherLayout from "../../app/(teacher)/teacher/layout";
import AdminLayout from "../../app/(superadmin)/admin/layout";

const Child = () => <div>CONTENIDO-DE-PANTALLA</div>;
const hrefs = (c: HTMLElement) => Array.from(c.querySelectorAll("a")).map((a) => a.getAttribute("href"));
const redirectedTo = (to: string) =>
  [...routerState.router.replace.mock.calls, ...routerState.router.push.mock.calls].some((c) => c[0] === to);

/** `/users/me` devuelve al usuario del rol dado (el layout lo consulta para verificar el onboarding). */
function meIs(role: Exclude<Role, "anon">, over: Record<string, unknown> = {}) {
  mockApi("get", "/users/me", { ...makeUser(role), ...over });
}

describe("layout del alumno", () => {
  it("alumno con onboarding completo: ve la pantalla y el menú de alumno", async () => {
    meIs("student");
    const { container } = renderScreen(<StudentLayout><Child /></StudentLayout>, { role: "student", route: "/dashboard/classes" });
    await waitFor(() => expect(screen.getByText("CONTENIDO-DE-PANTALLA")).toBeInTheDocument());
    expect(hrefs(container)).toEqual(expect.arrayContaining(["/dashboard/classes", "/dashboard/teachers"]));
    expect(hrefs(container)).not.toContain("/admin/dashboard");
    expect(hrefs(container)).not.toContain("/teacher/dashboard");
  });

  it("alumno sin onboarding: lo manda al onboarding y no pinta la pantalla", async () => {
    meIs("student", { onboarding_completed: false });
    renderScreen(<StudentLayout><Child /></StudentLayout>, { role: "student", route: "/dashboard/classes" });
    await waitFor(() => expect(redirectedTo("/dashboard/onboarding")).toBe(true));
    expect(screen.queryByText("CONTENIDO-DE-PANTALLA")).not.toBeInTheDocument();
  });

  it("un profesor que entra en /dashboard es expulsado al login", async () => {
    meIs("teacher");
    renderScreen(<StudentLayout><Child /></StudentLayout>, { role: "teacher", route: "/dashboard" });
    await waitFor(() => expect(redirectedTo("/login")).toBe(true));
    expect(screen.queryByText("CONTENIDO-DE-PANTALLA")).not.toBeInTheDocument();
  });

  it("sin sesión y con /users/me rechazado: va al login", async () => {
    mockApiError("get", "/users/me", 401, "No autenticado");
    renderScreen(<StudentLayout><Child /></StudentLayout>, { role: "anon", route: "/dashboard" });
    await waitFor(() => expect(redirectedTo("/login")).toBe(true));
    expect(screen.queryByText("CONTENIDO-DE-PANTALLA")).not.toBeInTheDocument();
  });

  it("el onboarding se pinta a pantalla completa, sin menú", async () => {
    meIs("student", { onboarding_completed: false });
    const { container } = renderScreen(<StudentLayout><Child /></StudentLayout>, { role: "student", route: "/dashboard/onboarding" });
    await settle(60);
    expect(screen.getByText("CONTENIDO-DE-PANTALLA")).toBeInTheDocument();
    expect(hrefs(container)).not.toContain("/dashboard/classes");
  });
});

describe("layout del profesor", () => {
  it.each(["teacher", "teacher_admin"] as const)("%s con onboarding completo ve la pantalla", async (role) => {
    meIs(role);
    renderScreen(<TeacherLayout><Child /></TeacherLayout>, { role, route: "/teacher/dashboard" });
    await waitFor(() => expect(screen.getByText("CONTENIDO-DE-PANTALLA")).toBeInTheDocument());
  });

  it("profesor sin onboarding: lo manda a /teacher/onboarding", async () => {
    meIs("teacher", { onboarding_completed: false });
    renderScreen(<TeacherLayout><Child /></TeacherLayout>, { role: "teacher", route: "/teacher/dashboard" });
    await waitFor(() => expect(redirectedTo("/teacher/onboarding")).toBe(true));
    expect(screen.queryByText("CONTENIDO-DE-PANTALLA")).not.toBeInTheDocument();
  });

  it("un alumno que entra en /teacher/* es expulsado al login", async () => {
    meIs("student");
    renderScreen(<TeacherLayout><Child /></TeacherLayout>, { role: "student", route: "/teacher/dashboard" });
    await waitFor(() => expect(redirectedTo("/login")).toBe(true));
    expect(screen.queryByText("CONTENIDO-DE-PANTALLA")).not.toBeInTheDocument();
  });

  it("el menú del profesor no incluye rutas de administración", async () => {
    meIs("teacher");
    const { container } = renderScreen(<TeacherLayout><Child /></TeacherLayout>, { role: "teacher", route: "/teacher/dashboard" });
    await waitFor(() => expect(screen.getByText("CONTENIDO-DE-PANTALLA")).toBeInTheDocument());
    expect(hrefs(container)).toEqual(expect.arrayContaining(["/teacher/dashboard", "/teacher/students"]));
    expect(hrefs(container).filter((h) => h?.startsWith("/admin"))).toEqual([]);
  });
});

describe("layout del admin", () => {
  it("superadmin ve la pantalla y el menú completo, incluidas las rutas solo-superadmin", async () => {
    const { container } = renderScreen(<AdminLayout><Child /></AdminLayout>, { role: "superadmin", route: "/admin/dashboard" });
    await settle();
    expect(screen.getByText("CONTENIDO-DE-PANTALLA")).toBeInTheDocument();
    expect(hrefs(container)).toEqual(expect.arrayContaining(["/admin/dashboard", "/admin/payments", "/admin/settings"]));
    expect(redirectedTo("/login")).toBe(false);
  });

  it.each(["student", "teacher", "anon"] as const)("%s en /admin/* es expulsado al login", async (role) => {
    renderScreen(<AdminLayout><Child /></AdminLayout>, { role, route: "/admin/dashboard" });
    await waitFor(() => expect(redirectedTo("/login")).toBe(true));
  });

  it.each(["/admin/chat", "/admin/flow-tester", "/admin/classes", "/admin/materials"])(
    "teacher_admin en %s (solo superadmin) vuelve al panel y no ve la pantalla",
    async (route) => {
      renderScreen(<AdminLayout><Child /></AdminLayout>, { role: "teacher_admin", route });
      await waitFor(() => expect(routerState.router.replace).toHaveBeenCalledWith("/admin/dashboard"));
      expect(screen.queryByText("CONTENIDO-DE-PANTALLA")).not.toBeInTheDocument();
    },
  );

  it("teacher_admin sí ve las pantallas de administración compartidas", async () => {
    renderScreen(<AdminLayout><Child /></AdminLayout>, { role: "teacher_admin", route: "/admin/payments" });
    await settle();
    expect(screen.getByText("CONTENIDO-DE-PANTALLA")).toBeInTheDocument();
    expect(routerState.router.replace).not.toHaveBeenCalledWith("/admin/dashboard");
  });

  it("el menú del teacher_admin oculta los enlaces solo-superadmin pero mantiene los de profesor", async () => {
    const { container } = renderScreen(<AdminLayout><Child /></AdminLayout>, { role: "teacher_admin", route: "/admin/payments" });
    await settle();
    const h = hrefs(container);
    for (const blocked of ["/admin/chat", "/admin/flow-tester", "/admin/classes", "/admin/materials"]) expect(h).not.toContain(blocked);
    expect(h).toEqual(expect.arrayContaining(["/admin/dashboard", "/teacher/dashboard"]));
  });
});
