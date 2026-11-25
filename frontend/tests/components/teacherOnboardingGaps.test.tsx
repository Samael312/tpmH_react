/**
 * Onboarding del profesor · formatos de error del servidor al guardar (lista sin campo, objeto con y sin «msg»,
 * elemento suelto) y certificaciones editadas campo a campo.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { screen } from "@testing-library/react";
import TeacherOnboardingPage from "@/app/(teacher)/teacher/onboarding/page";
import { renderScreen } from "./render";
import { mockApi, mockApiError, makeUser } from "./fakeApi";

const CATALOG = { subjects: [], languages: [], spoken_languages: ["Español", "Inglés"], skill_suggestions: [], student_goals: {} };

type U = ReturnType<typeof userEvent.setup>;
const next = (u: U) => u.click(screen.getByRole("button", { name: /Continuar|Saltar por ahora/ }));

function setup() {
  mockApi("get", "/users/me", { ...makeUser("teacher"), avatar: "https://img.example.com/yo.png" });
  mockApi("get", "/system-catalogs/", CATALOG);
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

async function finish(user: U, container: HTMLElement) {
  await toSpecialties(user, container);
  await user.click(await screen.findByRole("button", { name: "Español" }));
  await next(user);
  await user.click(await screen.findByRole("button", { name: "Inglés" }));
  await user.click(screen.getByRole("radio", { name: "Inglés: Fluido" }));
  await next(user);
  await next(user); // disponibilidad → redes
  await next(user); // redes → video
  await user.click(await screen.findByRole("button", { name: /Saltar y finalizar/ }));
}

beforeEach(() => { vi.useRealTimers(); });
afterEach(() => { vi.restoreAllMocks(); });

describe("Onboarding del profesor · errores al guardar", () => {
  const fail = async (detail: unknown) => {
    mockApiError("patch", "/teachers/me/profile", 422, detail);
    const { user, container } = setup();
    await finish(user, container);
  };

  it("un elemento de la lista sin campo muestra solo el mensaje", async () => {
    await fail([{ msg: "Valor no válido" }, { loc: [], msg: "Otro fallo" }]);
    expect(await screen.findByText(/Valor no válido \| Otro fallo/)).toBeInTheDocument();
  });

  it("un detalle en forma de objeto con «msg» muestra ese texto", async () => {
    await fail({ msg: "Perfil bloqueado" });
    expect(await screen.findByText("Perfil bloqueado")).toBeInTheDocument();
  });

  it("un objeto sin «msg» se muestra serializado", async () => {
    await fail({ code: 7 });
    expect(await screen.findByText(/"code":7/)).toBeInTheDocument();
  });
});

describe("Onboarding del profesor · certificaciones", () => {
  it("el título y el año de una certificación se editan por separado", async () => {
    const { user, container } = setup();
    await toSpecialties(user, container);
    await user.click(await screen.findByRole("button", { name: /Añadir certificación|Añadir certificado|Agregar/ }));
    const inputs = Array.from(container.querySelectorAll<HTMLInputElement>("input[type=text], input:not([type])"));
    const title = inputs.find((i) => /TOEFL|certific|título/i.test(i.placeholder));
    const year = inputs.find((i) => /año|20\d\d/i.test(i.placeholder));
    expect(title).toBeTruthy();
    expect(year).toBeTruthy();
    await user.type(title!, "CELTA");
    await user.type(year!, "2020");
    expect(title!.value).toBe("CELTA");
    expect(year!.value).toBe("2020");
  });
});
