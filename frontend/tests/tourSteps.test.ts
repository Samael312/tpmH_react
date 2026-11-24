import { describe, it, expect } from "vitest";
import { STUDENT_STEPS, TEACHER_STEPS, stepsForRole, navTarget } from "@/components/tour/tourSteps";

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
