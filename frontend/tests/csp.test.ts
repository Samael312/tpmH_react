import { describe, expect, it } from "vitest";
import { buildCsp } from "@/lib/csp";

const directive = (csp: string, name: string) => csp.split("; ").find((d) => d.startsWith(name + " ")) ?? "";

describe("lib/csp.ts", () => {
  it("script-src usa el nonce y strict-dynamic, sin unsafe-inline ni unsafe-eval en producción", () => {
    const script = directive(buildCsp("abc123", false), "script-src");
    expect(script).toContain("'nonce-abc123'");
    expect(script).toContain("'strict-dynamic'");
    expect(script).not.toContain("'unsafe-inline'");
    expect(script).not.toContain("'unsafe-eval'");
  });

  it("en desarrollo permite unsafe-eval (lo necesita React) y nada más", () => {
    expect(directive(buildCsp("n", true), "script-src")).toContain("'unsafe-eval'");
    expect(buildCsp("n", true)).not.toContain("upgrade-insecure-requests");
  });

  it("producción añade upgrade-insecure-requests salvo con CSP_SKIP_UPGRADE=1 (solo Playwright)", () => {
    expect(buildCsp("n", false)).toContain("upgrade-insecure-requests");
    process.env.CSP_SKIP_UPGRADE = "1";
    try {
      expect(buildCsp("n", false)).not.toContain("upgrade-insecure-requests");
    } finally {
      delete process.env.CSP_SKIP_UPGRADE;
    }
  });

  it("las fuentes se sirven desde el propio sitio: style-src y font-src no abren Google Fonts", () => {
    const csp = buildCsp("n", false);
    expect(directive(csp, "font-src")).not.toContain("gstatic");
    expect(directive(csp, "style-src")).not.toContain("googleapis");
    expect(directive(csp, "style-src")).toContain("https://accounts.google.com/gsi/style");
  });

  it("producción: style-src (elementos) usa nonce y no unsafe-inline; los atributos style=\"\" se permiten aparte", () => {
    const csp = buildCsp("abc123", false);
    const style = directive(csp, "style-src");
    expect(style).toContain("'nonce-abc123'");
    expect(style).not.toContain("'unsafe-inline'");
    expect(directive(csp, "style-src-attr")).toBe("style-src-attr 'unsafe-inline'");
    // style-src-elem no se define: los elementos siguen a style-src
    expect(csp).not.toContain("style-src-elem");
  });

  it("desarrollo: style-src conserva unsafe-inline (el HMR inyecta <style> sin nonce)", () => {
    const style = directive(buildCsp("n", true), "style-src");
    expect(style).toContain("'unsafe-inline'");
    expect(style).not.toContain("'nonce-");
  });

  it("cada nonce distinto produce una política distinta", () => {
    expect(buildCsp("a", false)).not.toBe(buildCsp("b", false));
  });

  it("mantiene las protecciones de clickjacking y formularios", () => {
    const csp = buildCsp("n", false);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("form-action 'self'");
  });

  it("el WebSocket del backend está declarado con scheme ws(s) explícito", () => {
    expect(directive(buildCsp("n", false), "connect-src")).toMatch(/wss?:\/\/localhost:8000/);
  });
});
