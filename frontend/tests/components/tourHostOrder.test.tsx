/**
 * El anfitrión de la guía elige el orden de los pasos al abrirla: escritorio (≥ md) = orden de la barra lateral;
 * móvil = pestañas y luego «Más». Se sustituye ProductTour para ver qué pasos recibe.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act, screen } from "@testing-library/react";
import TourHost from "@/components/tour/TourHost";
import { STUDENT_STEPS, STUDENT_STEPS_DESKTOP, TEACHER_STEPS_DESKTOP } from "@/components/tour/tourSteps";
import { useAuthStore } from "@/store/authStore";
import { renderScreen, type Role } from "./render";

vi.mock("@/components/tour/ProductTour", () => ({
  default: ({ steps, open }: { steps: { id: string }[]; open: boolean }) =>
    open ? <div data-testid="steps">{steps.map((s) => s.id).join(",")}</div> : null,
}));

const originalMatchMedia = window.matchMedia;
const withWidth = (desktop: boolean) => {
  window.matchMedia = ((q: string) => ({ matches: q.includes("min-width") ? desktop : false, media: q, addEventListener() {}, removeEventListener() {} })) as never;
};
afterEach(() => { window.matchMedia = originalMatchMedia; });

function mount(role: Role) {
  const r = renderScreen(<TourHost />, { role, route: role === "student" ? "/dashboard" : "/teacher/dashboard" });
  act(() => { useAuthStore.setState({ user: { ...useAuthStore.getState().user!, tour_completed: false } as never }); });
  return r;
}
const ids = (steps: { id: string }[]) => steps.map((s) => s.id).join(",");

describe("TourHost · orden de los pasos", () => {
  it("escritorio: alumno con el orden de la barra lateral", async () => {
    withWidth(true);
    mount("student");
    expect((await screen.findByTestId("steps")).textContent).toBe(ids(STUDENT_STEPS_DESKTOP));
  });

  it("escritorio: profesor con el orden de la barra lateral", async () => {
    withWidth(true);
    mount("teacher");
    expect((await screen.findByTestId("steps")).textContent).toBe(ids(TEACHER_STEPS_DESKTOP));
  });

  it("móvil: orden de pestañas y «Más»", async () => {
    withWidth(false);
    mount("student");
    expect((await screen.findByTestId("steps")).textContent).toBe(ids(STUDENT_STEPS));
  });

  it("sin matchMedia usa el orden móvil", async () => {
    window.matchMedia = undefined as never;
    mount("student");
    expect((await screen.findByTestId("steps")).textContent).toBe(ids(STUDENT_STEPS));
  });
});
