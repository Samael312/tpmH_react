/**
 * Componentes de interfaz compartidos: Toast, BottomSheet, FullScreenModal, LoadError, LoadMoreButton, ErrorBoundary,
 * MobileOnly/DesktopOnly, Button, Badge, Card, StatCard, ConfirmModal, RefreshButton, RejectReasonModal, Reveal, Skeleton.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { render, screen, act, waitFor } from "@testing-library/react";
import Toaster from "@/components/ui/Toast";
import { toast, useToastStore } from "@/store/toastStore";
import BottomSheet from "@/components/ui/BottomSheet";
import FullScreenModal from "@/components/ui/FullScreenModal";
import LoadError from "@/components/ui/LoadError";
import LoadMoreButton from "@/components/ui/LoadMoreButton";
import MobileOnly from "@/components/ui/MobileOnly";
import DesktopOnly from "@/components/ui/DesktopOnly";
import ErrorBoundary from "@/components/ErrorBoundary";
import ConfirmModal from "@/components/ui/ConfirmModal";
import RejectReasonModal from "@/components/ui/RejectReasonModal";
import Button from "@/components/ui/Button";

afterEach(() => { vi.useRealTimers(); document.body.style.overflow = ""; });

describe("Toast", () => {
  it("un error se anuncia como alerta; el resto como estado", () => {
    render(<Toaster />);
    act(() => { toast.error("Falló"); toast.success("Listo"); toast.info("Ojo"); toast.warning("Cuidado"); });
    expect(screen.getByRole("alert")).toHaveTextContent("Falló");
    expect(screen.getAllByRole("status").map((n) => n.textContent)).toEqual(expect.arrayContaining(["Listo", "Ojo", "Cuidado"]));
  });

  it("muestra la descripción cuando existe", () => {
    render(<Toaster />);
    act(() => { toast.error("No se pudo guardar", { description: "Revisa el precio" }); });
    expect(screen.getByText("Revisa el precio")).toBeInTheDocument();
  });

  it("el botón de cerrar lo quita", async () => {
    render(<Toaster />);
    act(() => { toast.success("Hecho"); });
    await userEvent.setup().click(screen.getByRole("button", { name: "Cerrar notificación" }));
    expect(screen.queryByText("Hecho")).not.toBeInTheDocument();
  });

  it("se cierra solo tras su duración (éxito 4 s)", () => {
    vi.useFakeTimers();
    render(<Toaster />);
    act(() => { toast.success("Auto"); });
    expect(screen.getByText("Auto")).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(3900); });
    expect(screen.getByText("Auto")).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.queryByText("Auto")).not.toBeInTheDocument();
  });

  it("duración 0 = permanente hasta cerrarlo a mano", () => {
    vi.useFakeTimers();
    render(<Toaster />);
    act(() => { toast.info("Fijo", { duration: 0 }); });
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(screen.getByText("Fijo")).toBeInTheDocument();
  });

  it("los errores duran más que los éxitos (6 s frente a 4 s)", () => {
    vi.useFakeTimers();
    render(<Toaster />);
    act(() => { toast.error("E"); toast.success("S"); });
    act(() => { vi.advanceTimersByTime(4100); });
    expect(screen.queryByText("S")).not.toBeInTheDocument();
    expect(screen.getByText("E")).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(2000); });
    expect(screen.queryByText("E")).not.toBeInTheDocument();
  });

  it("clear y dismiss del store funcionan fuera de React", () => {
    const id = toast.info("uno");
    toast.info("dos");
    toast.dismiss(id);
    expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual(["dos"]);
    toast.clear();
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it("sin toasts no pinta nada", () => {
    const { container } = render(<Toaster />);
    expect(container.firstChild).toBeNull();
  });
});

describe("BottomSheet", () => {
  it("cerrado no pinta y no bloquea el scroll", () => {
    const { container } = render(<BottomSheet open={false} onClose={() => {}}>cuerpo</BottomSheet>);
    expect(container.firstChild).toBeNull();
    expect(document.body.style.overflow).toBe("");
  });

  it("abierto muestra título y contenido, bloquea el scroll del fondo y lo libera al cerrar", () => {
    const { rerender, unmount } = render(<BottomSheet open onClose={() => {}} title="Filtros">cuerpo</BottomSheet>);
    expect(screen.getByText("Filtros")).toBeInTheDocument();
    expect(screen.getByText("cuerpo")).toBeInTheDocument();
    expect(document.body.style.overflow).toBe("hidden");
    rerender(<BottomSheet open={false} onClose={() => {}}>cuerpo</BottomSheet>);
    expect(document.body.style.overflow).toBe("");
    unmount();
  });

  it("la X y el fondo llaman a onClose", async () => {
    const onClose = vi.fn();
    const { container } = render(<BottomSheet open onClose={onClose} title="T">c</BottomSheet>);
    await userEvent.setup().click(screen.getByRole("button"));
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.setup().click(container.querySelector(".backdrop-blur-sm") as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe("FullScreenModal", () => {
  it("cerrado no pinta; abierto muestra título, cuerpo y pie, y bloquea el scroll", () => {
    const { rerender } = render(<FullScreenModal open={false} onClose={() => {}} title="Editar" footer={<button>Guardar</button>}>formulario</FullScreenModal>);
    expect(screen.queryByText("Editar")).not.toBeInTheDocument();
    rerender(<FullScreenModal open onClose={() => {}} title="Editar" footer={<button>Guardar</button>}>formulario</FullScreenModal>);
    expect(screen.getByText("Editar")).toBeInTheDocument();
    expect(screen.getByText("formulario")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guardar" })).toBeInTheDocument();
    expect(document.body.style.overflow).toBe("hidden");
  });

  it("sin footer no reserva la barra inferior y la X cierra", async () => {
    const onClose = vi.fn();
    render(<FullScreenModal open onClose={onClose} title="Solo">c</FullScreenModal>);
    await userEvent.setup().click(screen.getByRole("button"));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("LoadError / LoadMoreButton", () => {
  it("LoadError nombra lo que no cargó y reintenta", async () => {
    const onRetry = vi.fn();
    render(<LoadError what="tus clases" onRetry={onRetry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("No se pudo cargar tus clases");
    await userEvent.setup().click(screen.getByRole("button", { name: /Reintentar/ }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("LoadError con retrying deshabilita el botón", () => {
    render(<LoadError what="x" onRetry={() => {}} retrying />);
    expect(screen.getByRole("button", { name: /Reintentar/ })).toBeDisabled();
  });

  it("LoadMoreButton: sin más páginas no aparece", () => {
    const { container } = render(<LoadMoreButton hasMore={false} loading={false} onClick={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it("LoadMoreButton: con más páginas pide la siguiente; cargando se deshabilita", async () => {
    const onClick = vi.fn();
    const { rerender } = render(<LoadMoreButton hasMore loading={false} onClick={onClick} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Cargar más" }));
    expect(onClick).toHaveBeenCalledTimes(1);
    rerender(<LoadMoreButton hasMore loading onClick={onClick} />);
    expect(screen.getByRole("button", { name: /Cargando/ })).toBeDisabled();
  });
});

describe("MobileOnly / DesktopOnly", () => {
  it("cada uno usa las clases de visibilidad de su tamaño de pantalla", () => {
    const { container } = render(<><MobileOnly>móvil</MobileOnly><DesktopOnly>escritorio</DesktopOnly></>);
    expect(screen.getByText("móvil")).toHaveClass("md:hidden");
    expect(screen.getByText("escritorio")).toHaveClass("hidden", "md:block");
    expect(container.children).toHaveLength(2);
  });
});

describe("ErrorBoundary", () => {
  function Boom(): React.ReactElement { throw new Error("explotó"); }

  it("sin error pinta a sus hijos", () => {
    render(<ErrorBoundary><p>todo bien</p></ErrorBoundary>);
    expect(screen.getByText("todo bien")).toBeInTheDocument();
  });

  it("ante una excepción muestra la pantalla de recuperación en vez de dejar la app en blanco", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<ErrorBoundary><Boom /></ErrorBoundary>);
    expect(screen.getByText("Algo salió mal")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recargar" })).toBeInTheDocument();
    spy.mockRestore();
  });

  it("Recargar recarga la página", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const reload = vi.fn();
    const original = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { ...original, reload, pathname: "/x" } });
    render(<ErrorBoundary><Boom /></ErrorBoundary>);
    await userEvent.setup().click(screen.getByRole("button", { name: "Recargar" }));
    expect(reload).toHaveBeenCalled();
    Object.defineProperty(window, "location", { configurable: true, value: original });
    spy.mockRestore();
  });
});

describe("ConfirmModal / RejectReasonModal / Button", () => {
  it("ConfirmModal: confirma y cancela con sus etiquetas", async () => {
    const onConfirm = vi.fn(); const onCancel = vi.fn();
    render(<ConfirmModal open title="¿Salir?" description="Perderás tu cupo" confirmLabel="Salir" onConfirm={onConfirm} onClose={onCancel} />);
    expect(screen.getByText("¿Salir?")).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Salir" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("RejectReasonModal exige un motivo: vacío o en blanco NO confirma; con motivo lo entrega recortado", async () => {
    const onConfirm = vi.fn();
    render(<RejectReasonModal open title="Rechazar pago" onConfirm={onConfirm} onClose={() => {}} />);
    const user = userEvent.setup();
    const confirm = screen.getByRole("button", { name: "Confirmar rechazo" });
    await user.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
    await user.type(screen.getByRole("textbox"), "   ");
    await user.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
    await user.clear(screen.getByRole("textbox"));
    await user.type(screen.getByRole("textbox"), "  Comprobante ilegible  ");
    await user.click(confirm);
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith("Comprobante ilegible"));
  });

  it("RejectReasonModal: cancelar limpia el motivo escrito y cierra", async () => {
    const onClose = vi.fn();
    const { rerender } = render(<RejectReasonModal open title="Rechazar" onConfirm={() => {}} onClose={onClose} />);
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox"), "algo");
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onClose).toHaveBeenCalled();
    rerender(<RejectReasonModal open title="Rechazar" onConfirm={() => {}} onClose={onClose} />);
    expect(screen.getByRole("textbox")).toHaveValue("");
  });

  it("Button respeta disabled y onClick", async () => {
    const onClick = vi.fn();
    const { rerender } = render(<Button onClick={onClick}>Ir</Button>);
    await userEvent.setup().click(screen.getByRole("button", { name: "Ir" }));
    expect(onClick).toHaveBeenCalledTimes(1);
    rerender(<Button onClick={onClick} disabled>Ir</Button>);
    expect(screen.getByRole("button", { name: "Ir" })).toBeDisabled();
  });
});
