/**
 * Landing pública: modo un-solo-profesor y modo multi-profesor (secciones, contenido del CMS, WhatsApp), estados de carga,
 * error y vacío, y el menú del móvil.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import userEvent from "@testing-library/user-event";
import { act, screen, waitFor, within } from "@testing-library/react";
import LandingPageClient from "@/components/landing/LandingPageClient";
import { LANDING_CONTENT_DEFAULTS, type LandingData, type LandingTeacher } from "@/hooks/useLandingData";
import { renderScreen } from "./render";
import { mockApi, mockApiError, callsTo } from "./fakeApi";

// next/dynamic está anulado en el setup global; aquí lo único que se carga con él es la escena 3D.
vi.mock("next/dynamic", () => ({ default: () => () => <div data-testid="hero-scene" /> }));
const mobileState = vi.hoisted(() => ({ value: true as boolean | null }));
vi.mock("@/lib/useIsMobileOrReducedMotion", () => ({ useIsMobileOrReducedMotion: () => mobileState.value }));

const TEACHER = (u: string, over: Partial<LandingTeacher> = {}): LandingTeacher => ({
  user_username: u, name: u.toUpperCase(), surname: "Prof", bio: "Bio", title: "Profe de mates", profile_photo_url: null, video_url: null,
  nationality: "VE", languages: ["Español"], subjects: ["Matemática", "Física"], skills: ["TOEFL"], certificates: [{ title: "TESOL", year: "2020" }],
  social_links: {}, ...over,
});
const PKG = (id: number, over: Record<string, unknown> = {}) => ({
  id, name: `Pack ${id}`, subject: "Matemática", description: "Desc", description_type: "text", description_items: null, icon: "📦", color: "#e11d48",
  classes_count: 8, price: 120, duration_minutes: 50, teacher_username: "ana", teacher_name: "Ana", teacher_avatar: null,
  is_group: false, min_students: null, max_students: null, ...over,
});
const REVIEW = (id: number, over: Record<string, unknown> = {}) => ({ id, student_name: "Luis", rating: 4, comment: "Muy bueno", created_at: "2026-03-01T00:00:00Z", teacher_username: "ana", ...over });
const DATA = (over: Partial<LandingData> = {}): LandingData => ({
  isSingleTenant: true, teachers: [TEACHER("ana", { social_links: { whatsapp: "+58 412 555-0000" } })], reviews: [REVIEW(1), REVIEW(2, { rating: 5, teacher_username: undefined })],
  packages: [PKG(1), PKG(2, { classes_count: null, price: 99.5, description_type: "list", description_items: ["Extra uno"] }), PKG(3, { is_group: true, classes_count: 12 })],
  platformName: "Mi Academia", platformTagline: null,
  landingContent: { ...LANDING_CONTENT_DEFAULTS, group_steps: [{ title: "Elige grupo", desc: "Paso A" }, { title: "Paga", desc: "Paso B" }, { title: "Estudia", desc: "Paso C" }] },
  ...over,
});
const API = (d: LandingData) => ({
  is_single_tenant: d.isSingleTenant, platform_name: d.platformName, platform_tagline: d.platformTagline, teachers: d.teachers, reviews: d.reviews, packages: d.packages, landing_content: d.landingContent,
});

function setup(d: LandingData | null = DATA(), serverData?: LandingData) {
  mockApi("get", "/public/landing", API(serverData ?? d ?? DATA()));
  const view = renderScreen(<LandingPageClient initialData={d} />, { role: "anon" });
  return { ...view, user: userEvent.setup() };
}

beforeEach(() => { mobileState.value = true; Element.prototype.scrollIntoView = vi.fn(); });
afterEach(() => { vi.restoreAllMocks(); });

describe("Landing · un solo profesor", () => {
  it("muestra el título, la valoración media y el nombre de la plataforma", async () => {
    setup();
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(/Aprende idiomas a tu ritmo/);
    expect(screen.getByText(/4\.5 · 2\+ reseñas/)).toBeInTheDocument();
    expect(screen.getAllByText("Mi Academia").length).toBeGreaterThan(0);
    expect(screen.getByText(/Clases personalizadas 100% online con ANA Prof/)).toBeInTheDocument();
  });

  it("el eslogan de la plataforma sustituye al texto por defecto", async () => {
    setup(DATA({ platformTagline: "Tu eslogan" }));
    expect(await screen.findByText("Tu eslogan")).toBeInTheDocument();
  });

  it("WhatsApp abre el chat con solo los dígitos", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: /Contactar por WhatsApp/ }));
    expect(open).toHaveBeenCalledWith("https://wa.me/584125550000", "_blank");
    await user.click(screen.getByRole("button", { name: /Escríbeme por WhatsApp/ }));
    await user.click(screen.getByRole("button", { name: /Hablar por WhatsApp/ }));
    expect(open).toHaveBeenCalledTimes(3);
  });

  it("sin WhatsApp no hay botones de contacto", async () => {
    setup(DATA({ teachers: [TEACHER("ana")] }));
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByRole("button", { name: /WhatsApp/ })).not.toBeInTheDocument();
  });

  it("«Sobre mí» lista habilidades y certificados", async () => {
    setup();
    expect(await screen.findByText("TOEFL")).toBeInTheDocument();
    expect(screen.getByText("TESOL")).toBeInTheDocument();
    expect(screen.getByText("2020")).toBeInTheDocument();
  });

  it("los paquetes individuales muestran precio, beneficios y botón de elegir; los grupales llevan sus pasos", async () => {
    setup();
    expect(await screen.findByText("Elegir Pack 1")).toBeInTheDocument();
    expect(screen.getByText("$120")).toBeInTheDocument();
    expect(screen.getByText("$99.50")).toBeInTheDocument();
    expect(screen.getByText("Extra uno")).toBeInTheDocument();
    expect(screen.getByText("Clases ilimitadas")).toBeInTheDocument();
    expect(screen.getByText("Elige grupo")).toBeInTheDocument();
    expect(screen.getByText("Paso C")).toBeInTheDocument();
  });

  it("las reseñas muestran estrellas y, sin ser multi-profesor, no etiquetan al profesor", async () => {
    setup();
    expect(await screen.findAllByText(/Muy bueno/)).not.toHaveLength(0);
    expect(screen.queryByText("@ana")).not.toBeInTheDocument();
  });

  it("sin reseñas invita a dejar la primera", async () => {
    setup(DATA({ reviews: [] }));
    expect(await screen.findByText(/Sé el primero en dejar una reseña/)).toBeInTheDocument();
    expect(screen.getByText(/5\.0 · 0\+ reseñas/)).toBeInTheDocument();
  });

  it("con vídeo de presentación aparece esa sección", async () => {
    setup(DATA({ teachers: [TEACHER("ana", { video_url: "https://cdn/v.mp4" })] }));
    expect(await screen.findByText("Presentaciones")).toBeInTheDocument();
  });

  it("monta la escena 3D solo en pantallas grandes sin reduced-motion", async () => {
    const count = async (value: boolean | null) => {
      mobileState.value = value;
      const view = setup();
      await view.findByRole("heading", { level: 1 });
      const n = screen.queryAllByTestId("hero-scene").length;
      view.unmount();
      return n;
    };
    const mobile = await count(true);
    const unknown = await count(null);
    const desktop = await count(false);
    expect([mobile, unknown]).toEqual([0, 0]);
    expect(desktop).toBeGreaterThan(0);
  });
});

describe("Landing · varios profesores", () => {
  const MULTI = (n: number) => DATA({
    isSingleTenant: false,
    teachers: Array.from({ length: n }, (_, i) => TEACHER(`prof${i}`, { subjects: i === 0 ? ["Matemática", "Física", "Química", "Arte"] : ["Música"], profile_photo_url: i === 1 ? "https://img.example.com/p.png" : null })),
  });

  it("muestra el título multi, el collage de profesores y el enlace a todos", async () => {
    setup(MULTI(3));
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(/El conocimiento que buscas/);
    expect(screen.getByText(/nuestro equipo de 3 profesores/)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /Ver todos los profesores/ }).length).toBeGreaterThan(0);
    expect(document.querySelector('a[href="/dashboard/teachers/prof0"]')).not.toBeNull();
  });

  it("con más de cuatro profesores el cuarto tile es «+N ver todos»", async () => {
    setup(MULTI(7));
    expect(await screen.findByText("+4")).toBeInTheDocument();
    expect(screen.getByText("ver todos")).toBeInTheDocument();
  });

  it("la cuadrícula de equipo enlaza a cada perfil y recorta las materias a tres", async () => {
    setup(MULTI(2));
    const links = await screen.findAllByRole("link", { name: /Ver perfil/ });
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("href", "/teachers/prof0");
    expect(screen.queryByText("Arte", { selector: "span.bg-rose-50" })).not.toBeInTheDocument();
  });

  it("junta las materias de todos los profesores y etiqueta cada reseña con su profesor", async () => {
    setup(MULTI(2));
    expect((await screen.findAllByText("Música")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("@ana").length).toBeGreaterThan(0);
  });

  it("sin profesores aprobados lo dice", async () => {
    setup(DATA({ isSingleTenant: false, teachers: [] }));
    expect(await screen.findByText(/Aún no hay profesores aprobados para mostrar/)).toBeInTheDocument();
    expect(screen.getByText(/equipo de varios profesores/)).toBeInTheDocument();
  });
});

describe("Landing · carga, error y menú", () => {
  it("sin datos iniciales muestra esqueletos y luego el contenido", async () => {
    setup(null, DATA());
    expect(await screen.findByText("Elegir Pack 1")).toBeInTheDocument();
  });

  it("si falla del todo avisa y «Reintentar» lo vuelve a pedir", async () => {
    mockApiError("get", "/public/landing", 500, "x");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { user } = { ...renderScreen(<LandingPageClient initialData={null} />, { role: "anon" }), user: userEvent.setup() };
    expect(await screen.findByText("No pudimos cargar el contenido de la página.")).toBeInTheDocument();
    const before = callsTo("get", "/public/landing").length;
    await user.click(screen.getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(callsTo("get", "/public/landing").length).toBeGreaterThan(before));
  });

  it("el menú del móvil se abre, navega a la sección y se cierra", async () => {
    const { user } = setup();
    const nav = (await screen.findAllByRole("navigation"))[0];
    const burger = within(nav).getAllByRole("button").find((b) => b.className.includes("md:hidden")) ?? within(nav).getAllByRole("button").at(-1)!;
    await user.click(burger);
    const items = within(nav).getAllByRole("button").filter((b) => b.className.includes("text-left"));
    expect(items.length).toBeGreaterThan(0);
    await user.click(items[0]);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(within(nav).queryAllByRole("button").filter((b) => b.className.includes("text-left"))).toHaveLength(0);
  });

  it("al hacer scroll la barra cambia de estilo", async () => {
    setup();
    const nav = (await screen.findAllByRole("navigation"))[0];
    const before = nav.className;
    Object.defineProperty(window, "scrollY", { configurable: true, value: 200 });
    act(() => { window.dispatchEvent(new Event("scroll")); });
    await waitFor(() => expect(nav.className).not.toBe(before));
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
  });
});
