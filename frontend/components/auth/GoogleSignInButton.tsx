"use client";

import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential?: string }) => void;
            auto_select?: boolean;
          }) => void;
          renderButton: (
            parent: HTMLElement,
            options: {
              type?: "standard" | "icon";
              theme?: "outline" | "filled_blue" | "filled_black";
              size?: "small" | "medium" | "large";
              text?: "signin_with" | "signup_with" | "continue_with" | "signin";
              shape?: "rectangular" | "pill" | "circle" | "square";
              logo_alignment?: "left" | "center";
              width?: number;
            }
          ) => void;
        };
      };
    };
  }
}

interface GoogleSignInButtonProps {
  onCredential: (idToken: string) => void;
  onError?: (message: string) => void;
  text?: "signin_with" | "signup_with" | "continue_with" | "signin";
  className?: string;
}

let scriptPromise: Promise<void> | null = null;

function loadGsiScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.google?.accounts?.id) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error("No se pudo cargar Google Identity Services"));
    document.head.appendChild(script);
  });
  return scriptPromise;
}

// ─── Singleton de inicialización ───────────────────────────────────────────
// google.accounts.id.initialize() solo debe llamarse UNA VEZ por sesión de
// navegador. Como esta es una SPA (navegación client-side entre /login y
// /register sin recargar la página), cada montaje del componente volvía a
// llamar initialize(), y Google logueaba:
//   "[GSI_LOGGER]: google.accounts.id.initialize() is called multiple times.
//    This could cause unexpected behavior and only the last initialized
//    instance will be used."
// Solución: inicializar una sola vez con un callback estable que delega al
// handler del componente actualmente montado (activeHandler), en vez de
// re-inicializar en cada mount.
let initializePromise: Promise<void> | null = null;
type CredentialHandler = (response: { credential?: string }) => void;
let activeHandler: CredentialHandler | null = null;

function ensureInitialized(clientId: string): Promise<void> {
  if (initializePromise) return initializePromise;

  initializePromise = loadGsiScript().then(() => {
    if (!window.google) throw new Error("Google Identity Services no disponible");
    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: (response) => {
        activeHandler?.(response);
      },
      auto_select: false,
    });
  });

  return initializePromise;
}

function GoogleIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
      />
    </svg>
  );
}

const TEXT_LABELS = {
  continue_with: "Continuar con Google",
  signin_with: "Iniciar sesión con Google",
  signup_with: "Registrarse con Google",
  signin: "Ingresar con Google",
};

// Google's GSI button is rendered inside an iframe whose *internal* canvas
// is drawn at a fixed pixel width (the `width` option below) — it cannot be
// stretched responsively with CSS after the fact. Forcing `[&_iframe]:!w-full`
// on a fixed 400px-wide iframe just scales/crops the fixed-size content, so
// the real clickable Google button never actually matches the width of the
// visual white button behind it (which is a real `w-full`). Wrapping it in a
// `max-w-sm` (384px) container also caps it below most form widths, so on
// desktop the button sits noticeably short of the input fields above it.
// Fix: measure the actual rendered width of the wrapper with ResizeObserver
// and re-render the Google button at that exact pixel width whenever it
// changes, so the invisible iframe always matches the visible button 1:1.
const GOOGLE_MAX_WIDTH = 400; // hard cap documented by Google's Identity Services

export default function GoogleSignInButton({
  onCredential,
  onError,
  text = "continue_with",
  className = "",
}: GoogleSignInButtonProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [buttonWidth, setButtonWidth] = useState<number | null>(null);

  // La variable de entorno es estática (no cambia entre renders), así que
  // se calcula acá como valor derivado en vez de sincronizarla con estado
  // dentro de un efecto (evita el setState síncrono en el cuerpo del efecto).
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  const envErrorMessage = clientId ? null : "Falta configurar NEXT_PUBLIC_GOOGLE_CLIENT_ID";

  // Guardar callbacks en refs para evitar re-ejecutar el useEffect si cambian en cada render
  const onCredentialRef = useRef(onCredential);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onCredentialRef.current = onCredential;
    onErrorRef.current = onError;
  }, [onCredential, onError]);

  // Medir el ancho real del contenedor y mantenerlo actualizado si cambia
  // (resize de ventana, cambios de layout, etc.)
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;

    const updateWidth = (width: number) => {
      const clamped = Math.max(1, Math.min(Math.round(width), GOOGLE_MAX_WIDTH));
      setButtonWidth((prev) => (prev === clamped ? prev : clamped));
    };

    updateWidth(el.getBoundingClientRect().width);

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) updateWidth(entry.contentRect.width);
    });
    observer.observe(el);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (envErrorMessage || !clientId) {
      onErrorRef.current?.(envErrorMessage ?? "Falta configurar NEXT_PUBLIC_GOOGLE_CLIENT_ID");
      return;
    }

    // Esperar a tener una medición real del ancho antes de pedirle a Google
    // que dibuje el botón con ese ancho exacto.
    if (!buttonWidth) return;

    let cancelled = false;

    // Este componente es el "activo": mientras esté montado, cualquier
    // credencial que Google devuelva se enruta a sus callbacks. Al
    // desmontarse (navegar a otra página), se libera para que el siguiente
    // GoogleSignInButton que se monte tome el control — sin volver a llamar
    // a initialize().
    const handler: (response: { credential?: string }) => void = (response) => {
      if (response?.credential) {
        onCredentialRef.current(response.credential);
      } else {
        onErrorRef.current?.("Google no devolvió credenciales");
      }
    };

    ensureInitialized(clientId)
      .then(() => {
        if (cancelled || !containerRef.current || !window.google) return;

        activeHandler = handler;

        containerRef.current.innerHTML = "";

        window.google.accounts.id.renderButton(containerRef.current, {
          type: "standard",
          theme: "outline",
          size: "large",
          text,
          shape: "rectangular",
          width: buttonWidth, // Ancho medido en vivo, igual al del botón visual
        });

        setReady(true);
      })
      .catch((e) => {
        if (cancelled) return;
        setErrorMessage("No se pudo cargar Google");
        onErrorRef.current?.(e.message);
      });

    return () => {
      cancelled = true;
      if (activeHandler === handler) activeHandler = null;
    };
  }, [text, buttonWidth, envErrorMessage, clientId]); // Re-renderiza si cambia el texto o el ancho medido

  if (envErrorMessage || errorMessage) {
    return (
      <div className="w-full p-2.5 text-xs text-red-600 bg-red-50 border border-red-100 rounded-xl text-center font-medium">
        {envErrorMessage || errorMessage}
      </div>
    );
  }

  return (
    <div ref={wrapperRef} className={`relative w-full ${className}`}>
      {/* Botón blanco visual */}
      <button
        type="button"
        disabled={!ready}
        className="group relative w-full h-11 px-4 flex items-center justify-center gap-3 rounded-xl bg-white border border-gray-200 text-gray-700 text-sm font-medium shadow-[0_1px_3px_rgba(0,0,0,0.05)] transition-all duration-200 ease-out hover:bg-gray-50/80 hover:border-gray-300 hover:shadow-[0_2px_6px_rgba(0,0,0,0.06)] active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
      >
        <GoogleIcon className="w-5 h-5 transition-transform duration-200 group-hover:scale-105" />
        <span>{TEXT_LABELS[text] || TEXT_LABELS.continue_with}</span>
      </button>

      {/* Capa invisible del iframe de Google, renderizado al ancho exacto medido */}
      <div
        ref={containerRef}
        className={`absolute inset-0 z-10 overflow-hidden flex items-center justify-center transition-opacity duration-300 ${
          ready ? "opacity-[0.0001]" : "opacity-0 pointer-events-none"
        } [&_iframe]:!cursor-pointer`}
      />

      {/* Skeleton de carga */}
      {!ready && (
        <div className="absolute inset-0 rounded-xl bg-gray-50 border border-gray-200/60 animate-pulse flex items-center justify-center gap-3 px-4">
          <div className="w-5 h-5 rounded-full bg-gray-200/70" />
          <div className="w-36 h-4 rounded-md bg-gray-200/70" />
        </div>
      )}
    </div>
  );
}