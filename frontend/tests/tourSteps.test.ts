import { describe, it, expect } from "vitest";
import { STUDENT_STEPS, TEACHER_STEPS, STUDENT_STEPS_DESKTOP, TEACHER_STEPS_DESKTOP, stepsForRole, navTarget } from "@/components/tour/tourSteps";

const words = (s: string) => s.trim().split(/\s+/).length;

describe("stepsForRole", () => {
  it("alumno y profesores tienen su recorrido; el resto no", () => {
    expect(stepsForRole("student")).toBe(STUDENT_STEPS);
    expect(stepsForRole("teacher")).toBe(TEACHER_STEPS);
    expect(stepsForRole("teacher_admin")).toBe(TEACHER_STEPS);
    expect(stepsForRole("superadmin")).toEqual([]);
    expect(stepsForRole(undefined)).toEqual([]);
  });

  it.each([["student", STUDENT_STEPS], ["teacher", TEACHER_STEPS]])("%s: bienvenida, cierre, ids únicos y textos cortos", (_r, steps) => {
    expect(steps[0].target).toBeNull();
    const last = steps[steps.length - 1];
    expect(last.target).toBeNull();
    expect(last.body).toContain("Puedes repetir esta guía desde tu perfil");
    expect(new Set(steps.map(s => s.id)).size).toBe(steps.length);
    for (const s of steps) expect(words(s.body)).toBeLessThanOrEqual(25);
  });

  it("alumno cubre todo su menú y marca los de «Más»", () => {
    const hrefs = ["", "/schedule", "/classes", "/profile", "/chat", "/availability", "/materials", "/homework", "/teachers", "/support"]
      .map(p => `/dashboard${p}`);
    const targets = STUDENT_STEPS.map(s => s.target);
    for (const h of hrefs) expect(targets).toContain(navTarget(h));
    const more = STUDENT_STEPS.filter(s => s.more).map(s => s.target);
    expect(more.sort()).toEqual(["chat", "availability", "materials", "homework", "teachers", "support"]
      .map(p => navTarget(`/dashboard/${p}`)).sort());
  });

  it("profesor cubre todo su menú y marca los de «Más»", () => {
    const hrefs = ["dashboard", "availability", "students", "profile", "chat", "notifications", "materials", "homework",
      "packages", "cohorts", "wallet", "support"].map(p => `/teacher/${p}`);
    const targets = TEACHER_STEPS.map(s => s.target);
    for (const h of hrefs) expect(targets).toContain(navTarget(h));
    const more = TEACHER_STEPS.filter(s => s.more).map(s => s.target);
    expect(more.sort()).toEqual(["chat", "notifications", "materials", "homework", "packages", "cohorts", "wallet", "support"]
      .map(p => navTarget(`/teacher/${p}`)).sort());
  });

  it("navTarget arma el selector data-tour", () => {
    expect(navTarget("/dashboard/chat")).toBe('[data-tour="nav-/dashboard/chat"]');
  });
});

describe("orden en escritorio (barra lateral)", () => {
  const ids = (steps: { id: string }[]) => steps.map(s => s.id);

  it("alumno: sigue el orden del menú lateral", () => {
    expect(ids(STUDENT_STEPS_DESKTOP)).toEqual(
      ["welcome", "home", "chat", "schedule", "availability", "classes", "materials", "homework", "teachers", "support", "profile", "end"]);
  });

  it("profesor: sigue el orden del menú lateral", () => {
    expect(ids(TEACHER_STEPS_DESKTOP)).toEqual(
      ["welcome", "classes", "chat", "notifications", "availability", "students", "materials", "homework", "packages", "cohorts", "wallet", "support", "profile", "end"]);
  });

  it.each([["student", STUDENT_STEPS, STUDENT_STEPS_DESKTOP], ["teacher", TEACHER_STEPS, TEACHER_STEPS_DESKTOP]])(
    "%s: mismos pasos que en móvil, solo cambia el orden; bienvenida primero y cierre último", (_r, mobile, desktop) => {
      expect([...desktop].map(s => s.id).sort()).toEqual([...mobile].map(s => s.id).sort());
      expect(desktop[0].id).toBe("welcome");
      expect(desktop[desktop.length - 1].id).toBe("end");
      expect(desktop).not.toBe(mobile);
    });

  it("stepsForRole elige el orden según el diseño", () => {
    expect(stepsForRole("student", true)).toBe(STUDENT_STEPS_DESKTOP);
    expect(stepsForRole("student", false)).toBe(STUDENT_STEPS);
    expect(stepsForRole("teacher_admin", true)).toBe(TEACHER_STEPS_DESKTOP);
    expect(stepsForRole("superadmin", true)).toEqual([]);
  });
});
