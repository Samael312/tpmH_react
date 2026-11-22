/**
 * Idiomas que habla el usuario: selector con nivel, paso del onboarding, aviso en el panel y sección del perfil.
 */
import { describe, expect, it, vi } from "vitest";
import React, { useState } from "react";
import userEvent from "@testing-library/user-event";
import { screen, waitFor } from "@testing-library/react";
import SpokenLanguagesPicker from "@/components/SpokenLanguagesPicker";
import SpokenLanguagesStep from "@/components/SpokenLanguagesStep";
import SpokenLanguagesNotice from "@/components/SpokenLanguagesNotice";
import SpokenLanguagesSection from "@/components/SpokenLanguagesSection";
import type { SpokenLanguage } from "@/lib/spokenLanguages";
import { renderScreen } from "./render";
import { mockApi, mockApiError, callsTo, makeUser } from "./fakeApi";

const CATALOG = { subjects: [], languages: [], spoken_languages: ["Español", "Inglés", "Francés"], skill_suggestions: [], student_goals: {} };
const seedCatalog = () => mockApi("get", "/system-catalogs/", CATALOG);
const me = (spoken: unknown[], onboarding = true) => mockApi("get", "/users/me", { ...makeUser("student"), spoken_languages: spoken, onboarding_completed: onboarding });

function Harness({ initial = [], max, onValue }: { initial?: SpokenLanguage[]; max?: number; onValue?: (v: SpokenLanguage[]) => void }) {
  const [v, setV] = useState<SpokenLanguage[]>(initial);
  onValue?.(v);
  return <SpokenLanguagesPicker value={v} onChange={setV} max={max} />;
}

describe("SpokenLanguagesPicker", () => {
  it("cargando muestra el aviso y, si el catálogo falla, permite reintentar", async () => {
    mockApiError("get", "/system-catalogs/", 500, "x");
    renderScreen(<Harness />, { role: "student" });
    expect(await screen.findByText(/No se pudo cargar la lista de idiomas/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
  });

  it("ofrece los idiomas del catálogo; elegir uno añade su fila de nivel sin nivel asignado", async () => {
    seedCatalog();
    renderScreen(<Harness />, { role: "student" });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Español" }));
    expect(screen.getByRole("button", { name: "Español" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("radiogroup", { name: "Nivel de Español" })).toBeInTheDocument();
    expect(screen.getByText(/elige el nivel de un idioma/)).toBeInTheDocument();
  });

  it("elegir nivel lo marca; volver a pulsar el idioma lo quita", async () => {
    seedCatalog();
    let latest: SpokenLanguage[] = [];
    renderScreen(<Harness onValue={(v) => { latest = v; }} />, { role: "student" });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Inglés" }));
    await user.click(screen.getByRole("radio", { name: "Inglés: Fluido" }));
    expect(latest).toEqual([{ language: "Inglés", level: "fluent" }]);
    expect(screen.getByRole("radio", { name: "Inglés: Fluido" })).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByRole("button", { name: "Inglés" }));
    expect(latest).toEqual([]);
  });

  it("al llegar al máximo bloquea los demás idiomas y lo avisa", async () => {
    seedCatalog();
    renderScreen(<Harness max={2} />, { role: "student" });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Español" }));
    await user.click(screen.getByRole("button", { name: "Inglés" }));
    expect(screen.getByRole("button", { name: "Francés" })).toBeDisabled();
    expect(screen.getByText(/llegaste al máximo/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Español" })).toBeEnabled(); // los elegidos siguen pudiendo quitarse
  });

  it("un idioma que ya no está en el catálogo se ofrece para quitarlo", async () => {
    seedCatalog();
    renderScreen(<Harness initial={[{ language: "Klingon", level: "basic" }]} />, { role: "student" });
    expect(await screen.findByRole("button", { name: /Klingon · ya no disponible, quitar/ })).toBeInTheDocument();
  });

  it("en modo deshabilitado no deja cambiar nada", async () => {
    seedCatalog();
    renderScreen(<SpokenLanguagesPicker value={[{ language: "Español", level: null }]} onChange={() => {}} disabled />, { role: "student" });
    expect(await screen.findByRole("button", { name: "Inglés" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Español: Nativo" })).toBeDisabled();
  });
});

describe("SpokenLanguagesStep (onboarding)", () => {
  function setup(audience: "student" | "teacher", value: SpokenLanguage[]) {
    seedCatalog();
    const onNext = vi.fn(); const onBack = vi.fn();
    renderScreen(<SpokenLanguagesStep value={value} onChange={() => {}} onNext={onNext} onBack={onBack} audience={audience} />, { role: "student" });
    return { onNext, onBack, user: userEvent.setup() };
  }

  it("el texto cambia según sea alumno o profesor", async () => {
    setup("student", []);
    expect(await screen.findByText("¿Qué idiomas hablas?")).toBeInTheDocument();
  });

  it("para profesor usa su propio título", async () => {
    setup("teacher", []);
    expect(await screen.findByText("Idiomas que hablas")).toBeInTheDocument();
  });

  it("Continuar exige al menos un idioma y que todos tengan nivel", async () => {
    const { user, onNext } = setup("student", []);
    const next = await screen.findByRole("button", { name: /Continuar/ });
    expect(next).toBeDisabled();
    await user.click(next);
    expect(onNext).not.toHaveBeenCalled();
  });

  it("con un idioma elegido pero sin nivel sigue bloqueado", async () => {
    setup("student", [{ language: "Español", level: null }]);
    expect(await screen.findByRole("button", { name: /Continuar/ })).toBeDisabled();
  });

  it("completo: se habilita y avanza; Volver retrocede", async () => {
    const { user, onNext, onBack } = setup("student", [{ language: "Español", level: "native" }]);
    await user.click(await screen.findByRole("button", { name: /Continuar/ }));
    expect(onNext).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /Volver/ }));
    expect(onBack).toHaveBeenCalled();
  });
});

describe("SpokenLanguagesNotice", () => {
  it("avisa cuando terminó el onboarding pero no declaró idiomas, y lleva al perfil", async () => {
    me([], true);
    renderScreen(<SpokenLanguagesNotice profileHref="/dashboard/profile" />, { role: "student" });
    expect(await screen.findByRole("status")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Agregar idiomas" })).toHaveAttribute("href", "/dashboard/profile");
  });

  it("no avisa si ya tiene idiomas", async () => {
    me([{ language: "Español", level: "native" }], true);
    const { container } = renderScreen(<SpokenLanguagesNotice profileHref="/x" />, { role: "student" });
    await waitFor(() => expect(callsTo("get", "/users/me").length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 50));
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it("no avisa a quien aún está en el onboarding (ya se lo pedirá el paso)", async () => {
    me([], false);
    const { container } = renderScreen(<SpokenLanguagesNotice profileHref="/x" />, { role: "student" });
    await waitFor(() => expect(callsTo("get", "/users/me").length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 50));
    expect(container.querySelector('[role="status"]')).toBeNull();
  });
});

describe("SpokenLanguagesSection (perfil)", () => {
  const setup = (spoken: unknown[]) => {
    seedCatalog();
    me(spoken);
    renderScreen(<SpokenLanguagesSection profileHref="/p" audience="student" />, { role: "student" });
    return userEvent.setup();
  };

  it("el texto aclara a quién se le muestra según el rol", async () => {
    setup([]);
    expect(await screen.findByText(/Solo los verá tu profesor/)).toBeInTheDocument();
  });

  it("para profesor dice que los verán sus alumnos", async () => {
    seedCatalog(); me([]);
    renderScreen(<SpokenLanguagesSection profileHref="/p" audience="teacher" />, { role: "teacher" });
    expect(await screen.findByText(/Los verán tus alumnos/)).toBeInTheDocument();
  });

  it("Guardar está desactivado hasta cambiar algo y solo se habilita si todos tienen nivel", async () => {
    const user = setup([{ language: "Español", level: "native" }]);
    const save = await screen.findByRole("button", { name: "Guardar idiomas" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Inglés" })).toBeEnabled());
    expect(save).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Inglés" }));
    expect(save).toBeDisabled(); // Inglés sin nivel: el servidor lo rechazaría
    await user.click(screen.getByRole("radio", { name: "Inglés: Básico" }));
    expect(save).toBeEnabled();
  });

  it("guardar manda PATCH /users/me con los idiomas y sus niveles", async () => {
    mockApi("patch", "/users/me", { spoken_languages: [{ language: "Español", level: "native" }, { language: "Inglés", level: "basic" }] });
    const user = setup([{ language: "Español", level: "native" }]);
    await waitFor(() => expect(screen.getByRole("button", { name: "Inglés" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Inglés" }));
    await user.click(screen.getByRole("radio", { name: "Inglés: Básico" }));
    await user.click(screen.getByRole("button", { name: "Guardar idiomas" }));
    await waitFor(() => expect(callsTo("patch", "/users/me")).toHaveLength(1));
    expect(callsTo("patch", "/users/me")[0].body).toEqual({
      spoken_languages: [{ language: "Español", level: "native" }, { language: "Inglés", level: "basic" }],
    });
    expect(await screen.findByText("Idiomas guardados")).toBeInTheDocument();
  });

  it("si el guardado falla avisa con el motivo", async () => {
    mockApiError("patch", "/users/me", 422, "Idioma no permitido");
    const user = setup([{ language: "Español", level: "native" }]);
    await waitFor(() => expect(screen.getByRole("button", { name: "Inglés" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Inglés" }));
    await user.click(screen.getByRole("radio", { name: "Inglés: Básico" }));
    await user.click(screen.getByRole("button", { name: "Guardar idiomas" }));
    expect(await screen.findByText(/Idioma no permitido|No se pudieron guardar/)).toBeInTheDocument();
  });

  it("si los idiomas no cargan ofrece reintentar y no muestra el selector", async () => {
    seedCatalog();
    mockApiError("get", "/users/me", 500, "x");
    renderScreen(<SpokenLanguagesSection profileHref="/p" audience="student" />, { role: "student" });
    expect(await screen.findByText(/No se pudieron cargar tus idiomas/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Guardar idiomas" })).not.toBeInTheDocument();
  });
});
