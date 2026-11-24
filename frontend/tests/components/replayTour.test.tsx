import { describe, expect, it } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { screen } from "@testing-library/react";
import ReplayTourButton from "@/components/tour/ReplayTourButton";
import { useAuthStore } from "@/store/authStore";
import { renderScreen, type Role } from "./render";

describe("ReplayTourButton", () => {
  it.each([["student"], ["teacher"], ["teacher_admin"]] as [Role][])("%s ve «Ver guía de la plataforma» y al pulsarlo la guía queda pendiente", async (role) => {
    useAuthStore.setState({ user: { ...useAuthStore.getState().user, tour_completed: true } as never });
    renderScreen(<ReplayTourButton />, { role, route: "/dashboard/profile" });
    useAuthStore.setState({ user: { ...useAuthStore.getState().user!, tour_completed: true } });
    await userEvent.setup().click(await screen.findByRole("button", { name: "Ver guía de la plataforma" }));
    expect(useAuthStore.getState().user?.tour_completed).toBe(false);
  });

  it("el superadmin no tiene guía: no hay botón", () => {
    renderScreen(<ReplayTourButton />, { role: "superadmin", route: "/admin/dashboard" });
    expect(screen.queryByRole("button", { name: "Ver guía de la plataforma" })).toBeNull();
  });
});
