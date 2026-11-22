/**
 * Páginas legales (Términos y Privacidad, ES/EN) y la pantalla de último recurso `global-error`.
 * Son contenido casi estático: se verifica que cada sección se pinta en los dos idiomas, que el selector de idioma
 * cambia todo el texto y que los enlaces apuntan donde deben.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { render, screen } from "@testing-library/react";
import PrivacyContent from "@/components/legal/PrivacyContent";
import TermsContent from "@/components/legal/TermsContent";
import GlobalError from "@/app/global-error";
import { renderScreen } from "./render";

const report = vi.fn();
vi.mock("@/lib/errorReporting", () => ({ reportFrontendError: (...a: unknown[]) => report(...a) }));

afterEach(() => { report.mockClear(); vi.restoreAllMocks(); });

describe.each([
  ["Privacidad", PrivacyContent, "Política de Privacidad", "Privacy Policy", "/terms"],
  ["Términos", TermsContent, "Términos de Servicio", "Terms of Service", "/privacy"],
] as const)("Legal · %s", (_n, Component, titleEs, titleEn, otherHref) => {
  it("arranca en español con su fecha de actualización y enlaces", () => {
    renderScreen(<Component />);
    expect(screen.getByRole("heading", { level: 1, name: titleEs })).toBeInTheDocument();
    expect(screen.getByText(/Última actualización/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Volver al inicio/ })).toHaveAttribute("href", "/");
    expect(screen.getAllByRole("link").some((a) => a.getAttribute("href") === otherHref)).toBe(true);
  });

  it("cada sección tiene título y contenido", () => {
    renderScreen(<Component />);
    const sections = document.querySelectorAll("section");
    expect(sections.length).toBeGreaterThan(5);
    sections.forEach((s) => {
      expect(s.querySelector("h2")?.textContent?.trim()).toBeTruthy();
      expect(s.textContent!.length).toBeGreaterThan(30);
    });
  });

  it("el selector EN cambia todo el texto a inglés y ES lo devuelve", async () => {
    const user = userEvent.setup();
    renderScreen(<Component />);
    const esTitles = Array.from(document.querySelectorAll("h2")).map((h) => h.textContent);
    await user.click(screen.getByRole("button", { name: "EN" }));
    expect(screen.getByRole("heading", { level: 1, name: titleEn })).toBeInTheDocument();
    expect(screen.getByText(/Last updated/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Back to home/ })).toBeInTheDocument();
    const enTitles = Array.from(document.querySelectorAll("h2")).map((h) => h.textContent);
    expect(enTitles).toHaveLength(esTitles.length);
    expect(enTitles).not.toEqual(esTitles);
    await user.click(screen.getByRole("button", { name: "ES" }));
    expect(screen.getByRole("heading", { level: 1, name: titleEs })).toBeInTheDocument();
  });

  it("los enlaces externos abren en pestaña nueva sin filtrar el origen", () => {
    renderScreen(<Component />);
    document.querySelectorAll('a[target="_blank"]').forEach((a) => {
      expect(a.getAttribute("rel")).toMatch(/noopener/);
    });
  });
});

describe("global-error", () => {
  const err = (over: Partial<Error & { digest?: string }> = {}) => Object.assign(new Error("boom"), over);

  it("registra el error al montarse con la pantalla y el digest", () => {
    render(<GlobalError error={err({ digest: "abc123" })} retry={() => {}} />, { container: document.body.appendChild(document.createElement("div")) });
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0][0]).toMatchObject({ message: "Error: boom", extra: { digest: "abc123" } });
  });

  it("sin digest no manda extra ni muestra la referencia", () => {
    render(<GlobalError error={err()} retry={() => {}} />, { container: document.body.appendChild(document.createElement("div")) });
    expect(report.mock.calls[0][0].extra).toBeUndefined();
    expect(screen.queryByText(/Referencia:/)).not.toBeInTheDocument();
  });

  it("muestra el aviso, la referencia, «Ir al inicio» y «Reintentar» llama a retry", async () => {
    const retry = vi.fn();
    const user = userEvent.setup();
    render(<GlobalError error={err({ digest: "d-9" })} retry={retry} />, { container: document.body.appendChild(document.createElement("div")) });
    expect(screen.getByText("Algo salió mal")).toBeInTheDocument();
    expect(screen.getByText("Referencia: d-9")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ir al inicio" })).toHaveAttribute("href", "/");
    await user.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
