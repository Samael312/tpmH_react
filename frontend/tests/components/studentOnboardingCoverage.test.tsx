/**
 * Onboarding del alumno · cierra huecos: horario con huecos (varios rangos), quitar rango, limpiar día, cambiar de día,
 * volver y recuperar el horario, prefijo de país a mano y formatos de error del servidor.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import StudentOnboardingPage from "@/app/(student)/dashboard/onboarding/page";
import { GOALS } from "@/lib/teacherOptions";
import { renderScreen } from "./render";
import { mockApi, mockApiError, callsTo, makeUser } from "./fakeApi";

const CATALOG = { subjects: [], languages: [], spoken_languages: ["Español", "Inglés"], skill_suggestions: [], student_goals: {} };
type U = ReturnType<typeof userEvent.setup>;
const FIRST_GOAL = GOALS.idiomas[0].text;

function setup(avatar: string | null = "https://img.example.com/yo.png") {
  mockApi("get", "/users/me", { ...makeUser("student"), avatar });
  mockApi("get", "/system-catalogs/", CATALOG);
  const view = renderScreen(<StudentOnboardingPage />, { role: "student" });
  return { ...view, user: userEvent.setup() };
}
const cont = (u: U) => u.click(screen.getByRole("button", { name: /^Continuar|Saltar por ahora/ }));

async function toSchedule() {
  const ctx = setup();
  const { user, container } = ctx;
  await user.click(await screen.findByRole("button", { name: /Empezar configuración/ }));
  await user.selectOptions(container.querySelectorAll("select")[1] as HTMLSelectElement, "Venezuela");
  await user.type(await screen.findByPlaceholderText("412 000 0000"), "414 999 8888");
  await user.click(screen.getByRole("button", { name: new RegExp(FIRST_GOAL.slice(0, 12)) }));
  await cont(user);
  await user.click(await screen.findByRole("button", { name: "Inglés" }));
  await user.click(screen.getByRole("radio", { name: "Inglés: Fluido" }));
  await cont(user);
  await screen.findByRole("heading", { name: "Tu disponibilidad" });
  return ctx;
}
afterEach(() => { vi.unstubAllGlobals(); });

describe("Onboarding del alumno · horario", () => {
  it("horas separadas forman varios rangos; quitar un rango libera sus horas", async () => {
    const { user } = await toSchedule();
    for (const h of ["09:00", "10:00", "13:00"]) await user.click(screen.getByRole("button", { name: h }));
    expect(await screen.findByText("2 rangos")).toBeInTheDocument();
    expect(screen.getByText("09:00 – 11:00")).toBeInTheDocument();
    expect(screen.getByText("13:00 – 14:00")).toBeInTheDocument();
    await user.click(screen.getAllByTitle("Eliminar rango")[0]);
    expect(await screen.findByText("1 rango")).toBeInTheDocument();
    expect(screen.queryByText("09:00 – 11:00")).not.toBeInTheDocument();
  });

  it("cada día guarda sus horas y «Limpiar día» solo vacía el actual", async () => {
    const { user } = await toSchedule();
    await user.click(screen.getByRole("button", { name: "09:00" }));
    await user.click(screen.getByRole("button", { name: "Mar" }));
    await user.click(screen.getByRole("button", { name: "10:00" }));
    expect(await screen.findByText("2 rangos")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Limpiar día" }));
    expect(await screen.findByText("1 rango")).toBeInTheDocument();
  });

  it("al volver atrás y entrar otra vez recupera el horario ya elegido", async () => {
    const { user } = await toSchedule();
    await user.click(screen.getByRole("button", { name: "09:00" }));
    await user.click(screen.getByRole("button", { name: "10:00" }));
    await user.click(screen.getByRole("button", { name: /Volver/ }));
    await screen.findByRole("heading", { name: "¿Qué idiomas hablas?" });
    await cont(user);
    await screen.findByRole("heading", { name: "Tu disponibilidad" });
    expect(screen.getByText("09:00 – 11:00")).toBeInTheDocument();
  });
});

describe("Onboarding del alumno · país y errores", () => {
  it("el prefijo telefónico se cambia a mano", async () => {
    const { user, container } = setup();
    await user.click(await screen.findByRole("button", { name: /Empezar configuración/ }));
    const dial = container.querySelectorAll("select")[2] as HTMLSelectElement;
    fireEvent.change(dial, { target: { value: "+57" } });
    expect(dial.value).toBe("+57");
    fireEvent.change(dial, { target: { value: "+999999" } });
    expect(dial.value).toBe("+57");
  });

  it.each([
    ["objeto con msg", { msg: "Cuenta bloqueada" }, /Cuenta bloqueada/],
    ["objeto sin msg", { codigo: 7 }, /\{"codigo":7\}/],
    ["lista sin loc", [{ msg: "Falta algo" }], /Falta algo/],
  ] as const)("error del servidor (%s) se muestra", async (_n, detail, re) => {
    mockApiError("patch", "/users/me/student-profile", 422, detail);
    const { user } = await toSchedule();
    await user.click(screen.getByRole("button", { name: /Saltar por ahora/ }));
    expect(await screen.findByText(re)).toBeInTheDocument();
    expect(callsTo("patch", "/users/me/student-profile")).toHaveLength(1);
  });

  it("quitar la foto subida deja de mostrar su vista previa", async () => {
    URL.createObjectURL = vi.fn(() => "blob:foto");
    const { user, container } = setup(null);
    await user.click(await screen.findByRole("button", { name: /Empezar configuración/ }));
    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [new File(["x"], "yo.png", { type: "image/png" })] },
    });
    await waitFor(() => expect(container.querySelector("img[src='blob:foto']")).not.toBeNull());
    await user.click(await screen.findByRole("button", { name: /Quitar foto/ }));
    expect(screen.queryByRole("button", { name: /Quitar foto/ })).not.toBeInTheDocument();
  });
});
