import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(fn: T) => fn }));
vi.mock("@/components/landing/LandingPageClient", () => ({ default: () => null }));

import { getLandingDataServer, buildDefaultSiteTitle } from "@/lib/landingServer";
import { generateMetadata } from "@/app/page";

const BODY = {
  is_single_tenant: true, platform_name: "Mi Plataforma", platform_tagline: null,
  teachers: [{ name: "María", surname: "Gómez", username: "maria", profile_photo_url: "https://cdn/m.png" }],
  reviews: [], packages: [], landing_content: { hero_title: "Hola" },
};
const okFetch = (body: unknown) => vi.fn().mockResolvedValue({ ok: true, json: async () => body });

beforeEach(() => { delete process.env.NEXT_PHASE; vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("getLandingDataServer", () => {
  it("en la fase de build no llama al backend", async () => {
    process.env.NEXT_PHASE = "phase-production-build";
    const f = okFetch(BODY); vi.stubGlobal("fetch", f);
    expect(await getLandingDataServer()).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it("traduce la respuesta del backend", async () => {
    vi.stubGlobal("fetch", okFetch(BODY));
    const d = await getLandingDataServer();
    expect(d).toMatchObject({ isSingleTenant: true, platformName: "Mi Plataforma", platformTagline: null });
    expect(d?.landingContent.hero_title).toBe("Hola");
  });

  it("completa con valores por defecto lo que falta", async () => {
    vi.stubGlobal("fetch", okFetch({ is_single_tenant: false }));
    const d = await getLandingDataServer();
    expect(d).toMatchObject({ platformName: "TuProfeMaria", teachers: [], reviews: [], packages: [] });
  });

  it("una respuesta no válida o un fallo de red devuelven null y lo registran", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 502, statusText: "Bad Gateway" }));
    expect(await getLandingDataServer()).toBeNull();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("caído")));
    expect(await getLandingDataServer()).toBeNull();
    expect(console.error).toHaveBeenCalledTimes(2);
  });
});

describe("buildDefaultSiteTitle", () => {
  it("usa el tagline si existe y un título genérico si no", () => {
    expect(buildDefaultSiteTitle(null)).toBe("TuProfeMaria - Plataforma de clases");
    expect(buildDefaultSiteTitle({ platformName: "X", platformTagline: "Aprende" } as never)).toBe("X — Aprende");
  });
});

describe("app/page generateMetadata", () => {
  it("con tagline lo usa en título y descripción", async () => {
    vi.stubGlobal("fetch", okFetch({ ...BODY, platform_tagline: "Aprende ya" }));
    const m = await generateMetadata();
    expect(m.title).toBe("Mi Plataforma — Aprende ya");
    expect(m.description).toBe("Aprende ya");
  });

  it("de una sola profesora usa su nombre y su foto", async () => {
    vi.stubGlobal("fetch", okFetch(BODY));
    const m = await generateMetadata();
    expect(String(m.title)).toContain("Clases con");
    expect(String(m.description)).toContain("Clases particulares");
    expect(m.openGraph?.images).toEqual([{ url: "https://cdn/m.png" }]);
  });

  it("de una sola profesora sin datos de ella usa un texto genérico", async () => {
    vi.stubGlobal("fetch", okFetch({ ...BODY, teachers: [] }));
    const m = await generateMetadata();
    expect(String(m.description)).toContain("una profesora certificada");
    expect(m.twitter?.images).toEqual(["/assets/logo.png"]);
  });

  it("multi-profesor ofrece encontrar profesor, y sin datos cae a los valores por defecto", async () => {
    vi.stubGlobal("fetch", okFetch({ ...BODY, is_single_tenant: false }));
    expect(String((await generateMetadata()).title)).toContain("Encuentra tu profesor ideal");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("x")));
    expect(String((await generateMetadata()).title)).toContain("TuProfeMaria");
  });
});
