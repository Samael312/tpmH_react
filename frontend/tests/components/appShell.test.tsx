/**
 * Carcasa de la aplicación: pantallas de error y de «no encontrado», y el árbol de proveedores.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { render, screen, waitFor } from "@testing-library/react";
import GlobalRouteError from "@/app/error";
import NotFound from "@/app/not-found";
import Providers from "@/app/providers";
import { toast } from "@/store/toastStore";
import { renderScreen } from "./render";
import { routerState } from "./router";

const { reportFrontendError, installGlobalErrorReporting } = vi.hoisted(() => ({
  reportFrontendError: vi.fn(), installGlobalErrorReporting: vi.fn(),
}));
vi.mock("@/lib/errorReporting", () => ({ reportFrontendError, installGlobalErrorReporting }));

beforeEach(() => { reportFrontendError.mockClear(); installGlobalErrorReporting.mockClear(); });

const homeFor = [
  ["anon", "/"], ["student", "/dashboard"], ["teacher", "/teacher/dashboard"], ["teacher_admin", "/teacher/dashboard"], ["superadmin", "/admin/dashboard"],
] as const;

describe("app/error.tsx (error de ruta)", () => {
  const boom = Object.assign(new Error("explotó el render"), { digest: "abc123" });

  it("avisa al usuario, muestra la referencia y reporta el error con su pantalla", () => {
    renderScreen(<GlobalRouteError error={boom} retry={() => {}} />, { role: "anon" });
    expect(screen.getByRole("heading", { name: "Algo salió mal" })).toBeInTheDocument();
    expect(screen.getByText(/Referencia: abc123/)).toBeInTheDocument();
    expect(reportFrontendError).toHaveBeenCalledWith(expect.objectContaining({
      message: "Error: explotó el render", extra: { digest: "abc123" },
    }));
  });

  it("sin digest no muestra referencia ni la envía", () => {
    renderScreen(<GlobalRouteError error={new Error("x")} retry={() => {}} />, { role: "anon" });
    expect(screen.queryByText(/Referencia:/)).not.toBeInTheDocument();
    expect(reportFrontendError.mock.calls[0][0].extra).toBeUndefined();
  });

  it("Reintentar llama a retry", async () => {
    const retry = vi.fn();
    renderScreen(<GlobalRouteError error={boom} retry={retry} />, { role: "anon" });
    await userEvent.setup().click(screen.getByRole("button", { name: /Reintentar/ }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it.each(homeFor)("«Ir al inicio» de %s lleva a %s", (role, href) => {
    renderScreen(<GlobalRouteError error={boom} retry={() => {}} />, { role });
    expect(screen.getByRole("link", { name: "Ir al inicio" })).toHaveAttribute("href", href);
  });
});

describe("app/not-found.tsx (404)", () => {
  it("dice 404 y ofrece volver o ir al inicio", () => {
    renderScreen(<NotFound />, { role: "anon" });
    expect(screen.getByText("404")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "No encontramos esta página" })).toBeInTheDocument();
  });

  it("«Volver atrás» retrocede en el historial", async () => {
    renderScreen(<NotFound />, { role: "student" });
    await userEvent.setup().click(screen.getByRole("button", { name: /Volver atrás/ }));
    expect(routerState.router.back).toHaveBeenCalledTimes(1);
  });

  it.each(homeFor)("«Ir al inicio» de %s lleva a %s", (role, href) => {
    renderScreen(<NotFound />, { role });
    expect(screen.getByRole("link", { name: "Ir al inicio" })).toHaveAttribute("href", href);
  });
});

describe("app/providers.tsx", () => {
  it("pinta a sus hijos e instala el reporte global de errores una vez", async () => {
    render(<Providers><p>contenido</p></Providers>);
    expect(screen.getByText("contenido")).toBeInTheDocument();
    await waitFor(() => expect(installGlobalErrorReporting).toHaveBeenCalledTimes(1));
  });

  it("incluye el contenedor de notificaciones: un toast lanzado desde cualquier parte se ve", async () => {
    render(<Providers><p>x</p></Providers>);
    toast.success("Desde fuera de React");
    expect(await screen.findByText("Desde fuera de React")).toBeInTheDocument();
  });

  it("un error de render en un hijo se contiene (pantalla de recuperación) en vez de tumbar toda la app", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    function Boom(): React.ReactElement { throw new Error("hijo roto"); }
    render(<Providers><Boom /></Providers>);
    expect(screen.getByText("Algo salió mal")).toBeInTheDocument();
    spy.mockRestore();
  });
});
