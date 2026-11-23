/**
 * Admin · materiales: listado de cualquier profesor, filtros (profesor y título), tamaños, archivo ausente, vacío,
 * error con reintento.
 */
import { describe, expect, it } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import AdminMaterialsPage from "@/app/(superadmin)/admin/materials/page";
import { renderScreen } from "./render";
import { mockApi, mockApiError, callsTo } from "./fakeApi";

const MAT = (over: Record<string, unknown> = {}) => ({
  id: 1, teacher_id: 7, title: "Guía de verbos", description: null, category: "Gramática", level: "A1",
  file_url: "https://cdn.example.com/guia.pdf", file_type: "pdf", file_size: 2 * 1048576, created_at: "2026-01-01T00:00:00Z", ...over,
});

function setup(rows: unknown[]) {
  mockApi("get", "/god-mode/lookup/teachers", [{ id: 7, username: "profe", name: "Profe Uno" }]);
  mockApi("get", /^\/materials\/admin\/list/, rows);
  const view = renderScreen(<AdminMaterialsPage />, { role: "superadmin" });
  return { ...view, user: userEvent.setup() };
}

describe("Admin · materiales", () => {
  it("lista los materiales con profesor, categoría, nivel, tamaño y enlace de descarga", async () => {
    setup([
      MAT(),
      MAT({ id: 2, teacher_id: 99, title: "Ficha pequeña", level: null, file_size: 100, file_type: null }),
      MAT({ id: 3, title: "Sin tamaño", file_size: null, file_url: null }),
    ]);
    expect(await screen.findByText("Guía de verbos")).toBeInTheDocument();
    expect(screen.getByText(/Profe Uno · Gramática · A1 2\.0 MB/)).toBeInTheDocument();
    expect(screen.getByText(/Profesor #99 · Gramática 1 KB/)).toBeInTheDocument();
    expect(screen.getAllByText("pdf")).toHaveLength(2);
    expect(screen.getByText("Sin archivo")).toBeInTheDocument();
    expect(screen.getByText("3 materiales")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /Descargar/ })[0]).toHaveAttribute("href", "https://cdn.example.com/guia.pdf");
  });

  it("filtrar por profesor y buscar por título lo manda al servidor", async () => {
    const { user } = setup([MAT()]);
    await screen.findByText("Guía de verbos");
    await screen.findByRole("option", { name: /Profe Uno/ });
    await user.selectOptions(screen.getByLabelText("Profesor"), "7");
    await waitFor(() => expect(callsTo("get", /\/materials\/admin\/list/).some((c) => c.url.includes("teacher_id=7") || JSON.stringify(c).includes('"teacher_id":7'))).toBe(true));
    fireEvent.change(screen.getByPlaceholderText("Buscar por título"), { target: { value: "verbos" } });
    await waitFor(() => expect(JSON.stringify(callsTo("get", /\/materials\/admin\/list/).at(-1))).toContain("verbos"), { timeout: 2000 });
    await user.selectOptions(screen.getByLabelText("Profesor"), "");
    expect(screen.getByLabelText("Profesor")).toHaveValue("");
  });

  it("sin materiales lo dice", async () => {
    setup([]);
    expect(await screen.findByText("No hay materiales.")).toBeInTheDocument();
  });

  it("si falla ofrece reintentar", async () => {
    mockApi("get", "/god-mode/lookup/teachers", []);
    mockApiError("get", /^\/materials\/admin\/list/, 500, "x");
    renderScreen(<AdminMaterialsPage />, { role: "superadmin" });
    const retry = await screen.findByRole("button", { name: /Reintentar/ });
    mockApi("get", /^\/materials\/admin\/list/, [MAT()]);
    await userEvent.setup().click(retry);
    expect(await screen.findByText("Guía de verbos")).toBeInTheDocument();
  });
});
