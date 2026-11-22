/**
 * GoogleSignInButton. El componente guarda promesas a nivel de módulo (script cargado / SDK inicializado), por lo que
 * el orden importa: primero lo que no toca el módulo, luego el fallo de carga (que se limpia solo) y por último los
 * casos con el SDK ya inicializado. `initialize` se llama una sola vez por proceso, así que su callback se captura
 * en el primer caso correcto y se reutiliza.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { screen, waitFor, act } from "@testing-library/react";
import GoogleSignInButton from "@/components/auth/GoogleSignInButton";
import { renderScreen } from "./render";

type Google = NonNullable<Window["google"]>;
let renderButton: ReturnType<typeof vi.fn>;
let initialize: ReturnType<typeof vi.fn>;
let credentialCallback: ((r: { credential?: string }) => void) | null = null;

function installFakeGoogle() {
  renderButton = vi.fn();
  initialize = vi.fn((cfg: { callback: (r: { credential?: string }) => void }) => { credentialCallback = cfg.callback; });
  (window as unknown as { google: Google }).google = { accounts: { id: { initialize, renderButton } } } as unknown as Google;
}

afterEach(() => {
  vi.unstubAllEnvs();
  delete (window as unknown as { google?: Google }).google;
  document.head.querySelectorAll('script[src*="accounts.google.com"]').forEach((s) => s.remove());
});

describe("GoogleSignInButton · configuración", () => {
  it("sin NEXT_PUBLIC_GOOGLE_CLIENT_ID lo dice en pantalla y avisa al padre (no deja un botón muerto)", () => {
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_CLIENT_ID", "");
    const onError = vi.fn();
    renderScreen(<GoogleSignInButton onCredential={() => {}} onError={onError} />, { role: "anon" });
    expect(screen.getByText("Falta configurar NEXT_PUBLIC_GOOGLE_CLIENT_ID")).toBeInTheDocument();
    expect(onError).toHaveBeenCalledWith("Falta configurar NEXT_PUBLIC_GOOGLE_CLIENT_ID");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("GoogleSignInButton · fallo al cargar el SDK (va primero: no deja estado)", () => {
  it("si el script de Google no carga muestra el error y avisa al padre", async () => {
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_CLIENT_ID", "client-123.apps.googleusercontent.com");
    const onError = vi.fn();
    renderScreen(<GoogleSignInButton onCredential={() => {}} onError={onError} />, { role: "anon" });
    const script = await waitFor(() => {
      const s = document.head.querySelector('script[src*="accounts.google.com/gsi/client"]') as HTMLScriptElement | null;
      if (!s) throw new Error("aún no se pidió el script");
      return s;
    });
    act(() => { script.onerror?.(new Event("error")); });
    expect(await screen.findByText("No se pudo cargar Google")).toBeInTheDocument();
    expect(onError).toHaveBeenCalledWith("No se pudo cargar Google Identity Services");
  });
});

describe("GoogleSignInButton · SDK disponible", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_CLIENT_ID", "client-123.apps.googleusercontent.com");
    installFakeGoogle();
  });

  it("inicializa Google con el client_id y dibuja su botón con el texto pedido; el botón visual se habilita", async () => {
    renderScreen(<GoogleSignInButton onCredential={() => {}} text="signup_with" />, { role: "anon" });
    const btn = await screen.findByRole("button", { name: "Registrarse con Google" });
    await waitFor(() => expect(btn).toBeEnabled());
    expect(initialize).toHaveBeenCalledWith(expect.objectContaining({ client_id: "client-123.apps.googleusercontent.com", auto_select: false }));
    expect(renderButton).toHaveBeenCalledWith(expect.any(HTMLElement), expect.objectContaining({ text: "signup_with", type: "standard", size: "large" }));
  });

  it.each([
    ["continue_with", "Continuar con Google"],
    ["signin_with", "Iniciar sesión con Google"],
    ["signin", "Ingresar con Google"],
  ] as const)("rótulo para %s", async (text, label) => {
    renderScreen(<GoogleSignInButton onCredential={() => {}} text={text} />, { role: "anon" });
    expect(await screen.findByRole("button", { name: label })).toBeInTheDocument();
  });

  it("mientras no está listo el botón está desactivado", async () => {
    renderScreen(<GoogleSignInButton onCredential={() => {}} />, { role: "anon" });
    expect(screen.getByRole("button", { name: "Continuar con Google" })).toBeDisabled();
    await waitFor(() => expect(screen.getByRole("button", { name: "Continuar con Google" })).toBeEnabled());
  });

  it("el ancho que pide a Google nunca pasa de 400 px", async () => {
    renderScreen(<GoogleSignInButton onCredential={() => {}} />, { role: "anon" });
    await waitFor(() => expect(renderButton).toHaveBeenCalled());
    const width = renderButton.mock.calls[0][1].width as number;
    expect(width).toBeGreaterThanOrEqual(1);
    expect(width).toBeLessThanOrEqual(400);
  });

  it("una credencial de Google se entrega al padre", async () => {
    const onCredential = vi.fn();
    renderScreen(<GoogleSignInButton onCredential={onCredential} />, { role: "anon" });
    await waitFor(() => expect(renderButton).toHaveBeenCalled());
    expect(credentialCallback).not.toBeNull();
    act(() => { credentialCallback!({ credential: "id-token-abc" }); });
    expect(onCredential).toHaveBeenCalledWith("id-token-abc");
  });

  it("una respuesta sin credencial avisa del error y no llama a onCredential", async () => {
    const onCredential = vi.fn(); const onError = vi.fn();
    renderScreen(<GoogleSignInButton onCredential={onCredential} onError={onError} />, { role: "anon" });
    await waitFor(() => expect(renderButton).toHaveBeenCalled());
    act(() => { credentialCallback!({}); });
    expect(onError).toHaveBeenCalledWith("Google no devolvió credenciales");
    expect(onCredential).not.toHaveBeenCalled();
  });

  it("tras desmontar ya no entrega credenciales (no hay fugas hacia un componente que no existe)", async () => {
    const onCredential = vi.fn();
    const { unmount } = renderScreen(<GoogleSignInButton onCredential={onCredential} />, { role: "anon" });
    await waitFor(() => expect(renderButton).toHaveBeenCalled());
    unmount();
    act(() => { credentialCallback!({ credential: "tarde" }); });
    expect(onCredential).not.toHaveBeenCalled();
  });
});
