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
