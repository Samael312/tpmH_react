/**
 * Onboarding del profesor · cierra huecos: zona horaria y prefijo, quitar la foto, catálogos del servidor,
 * habilidades (sugeridas, Enter, quitar), materias, horario con huecos y quitar rango.
 */
import { describe, expect, it, vi } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import TeacherOnboardingPage from "@/app/(teacher)/teacher/onboarding/page";
import { renderScreen } from "./render";
import { mockApi, makeUser } from "./fakeApi";

type U = ReturnType<typeof userEvent.setup>;
const next = (u: U) => u.click(screen.getByRole("button", { name: /Continuar|Saltar por ahora/ }));

function setup(catalog: Record<string, unknown> = {}) {
  mockApi("get", "/users/me", { ...makeUser("teacher"), avatar: "https://img.example.com/yo.png" });
  mockApi("get", "/system-catalogs/", { subjects: [], languages: [], spoken_languages: ["Español", "Inglés"], skill_suggestions: [], student_goals: {}, ...catalog });
  const view = renderScreen(<TeacherOnboardingPage />, { role: "teacher" });
  return { ...view, user: userEvent.setup() };
}
async function toSpecialties(user: U, container: HTMLElement) {
  await user.click(await screen.findByRole("button", { name: /Configurar mi perfil/ }));
  await user.type(await screen.findByPlaceholderText(/Profesora certificada de inglés/), "Profe");
  await user.type(screen.getByPlaceholderText(/Cuéntales a los estudiantes/), "Bio");
  await user.selectOptions(container.querySelectorAll("select")[0] as HTMLSelectElement, "Venezuela");
  await user.type(screen.getByPlaceholderText("412 000 0000"), "414 111 2222");
  await next(user);
  await screen.findByRole("heading", { name: "Tus especialidades" });
}

describe("Onboarding del profesor · perfil", () => {
  it("cambiar la zona horaria ajusta el prefijo y el prefijo también se cambia a mano", async () => {
    const { user, container } = setup();
    await user.click(await screen.findByRole("button", { name: /Configurar mi perfil/ }));
    const selects = Array.from(container.querySelectorAll("select")) as HTMLSelectElement[];
    const tz = selects.find((s) => Array.from(s.options).some((o) => o.value === "America/Bogota"))!;
    await user.selectOptions(tz, "America/Bogota");
    const dial = selects.find((s) => Array.from(s.options).some((o) => o.value === "+57"))!;
    expect(dial.value).toBe("+57");
    fireEvent.change(dial, { target: { value: "+51" } });
    expect(dial.value).toBe("+51");
    fireEvent.change(dial, { target: { value: "+000" } });
    expect(dial.value).toBe("+51");
  });

  it("«Quitar foto» borra la vista previa y vuelve a exigirla", async () => {
    URL.createObjectURL = vi.fn(() => "blob:foto");
    mockApi("get", "/users/me", { ...makeUser("teacher"), avatar: null });
    mockApi("get", "/system-catalogs/", { subjects: [], languages: [], spoken_languages: [], skill_suggestions: [], student_goals: {} });
    const { container } = renderScreen(<TeacherOnboardingPage />, { role: "teacher" });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Configurar mi perfil/ }));
    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [new File(["x"], "yo.png", { type: "image/png" })] },
    });
    await waitFor(() => expect(container.querySelector("img[src='blob:foto']")).not.toBeNull());
    await user.click(screen.getByRole("button", { name: /Quitar foto/ }));
    expect(screen.queryByRole("button", { name: /Quitar foto/ })).not.toBeInTheDocument();
  });
});

describe("Onboarding del profesor · especialidades", () => {
  it("usa los catálogos del servidor, alterna materias y gestiona habilidades", async () => {
    const { user, container } = setup({ subjects: ["Piano"], languages: ["Latín"], skill_suggestions: ["Oratoria"] });
    await toSpecialties(user, container);
    await user.click(await screen.findByRole("button", { name: "Piano" }));
    await user.click(screen.getByRole("button", { name: "Piano" }));
    expect(screen.getByRole("button", { name: /Continuar/ })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Latín" }));
    await user.click(screen.getByRole("button", { name: "+ Oratoria" }));
    const chip = await screen.findByText("Oratoria", { selector: "span" });
    await user.click(chip.querySelector("button") as HTMLElement);
    expect(screen.queryByText("Oratoria", { selector: "span" })).not.toBeInTheDocument();
    const box = screen.getByPlaceholderText("Añadir habilidad personalizada...");
    await user.type(box, "Dibujo{enter}");
    expect(await screen.findByText("Dibujo", { selector: "span" })).toBeInTheDocument();
    await user.type(box, "Dibujo{enter}");
    expect(screen.getAllByText("Dibujo", { selector: "span" })).toHaveLength(1);
  });

  it("los idiomas y materias de respaldo aparecen si el catálogo viene vacío", async () => {
    const { user, container } = setup();
    await toSpecialties(user, container);
    expect(await screen.findByRole("button", { name: "Español" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Matematica" })).toBeInTheDocument();
  });
});

describe("Onboarding del profesor · horario", () => {
  it("horas separadas forman varios rangos y quitar un rango libera sus horas", async () => {
    const { user, container } = setup();
    await toSpecialties(user, container);
    await user.click(await screen.findByRole("button", { name: "Español" }));
    await next(user);
    await user.click(await screen.findByRole("button", { name: "Inglés" }));
    await user.click(screen.getByRole("radio", { name: "Inglés: Fluido" }));
    await next(user);
    await screen.findByRole("heading", { name: "Tu disponibilidad" });
    for (const h of ["09:00", "10:00", "13:00"]) await user.click(screen.getByRole("button", { name: h }));
    expect(await screen.findByText("09:00 – 11:00")).toBeInTheDocument();
    expect(screen.getByText("13:00 – 14:00")).toBeInTheDocument();
    const rm = screen.getByText("09:00 – 11:00").parentElement!.parentElement!.querySelector("button") as HTMLElement;
    await user.click(rm);
    await waitFor(() => expect(screen.queryByText("09:00 – 11:00")).not.toBeInTheDocument());
    expect(screen.getByText("13:00 – 14:00")).toBeInTheDocument();
  });
});
