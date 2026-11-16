import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import { fakeJwt } from "./helpers";

const future = Math.floor(Date.now() / 1000) + 3600;
const past = Math.floor(Date.now() / 1000) - 3600;

function req(path: string, cookies: Record<string, string> = {}) {
  const r = new NextRequest(`http://localhost:3000${path}`);
  for (const [k, v] of Object.entries(cookies)) r.cookies.set(k, v);
  return proxy(r);
}
const location = (res: Response) => res.headers.get("location")?.replace("http://localhost:3000", "") ?? null;

describe("proxy.ts (SEC-05: cookies tpm_access / tpm_session)", () => {
  it("sin sesión, las rutas protegidas van a /login", () => {
    for (const p of ["/dashboard", "/teacher/dashboard", "/admin/dashboard"]) {
      expect(location(req(p))).toBe("/login");
    }
  });

  it("alumno con access vigente entra a /dashboard y no a /teacher", () => {
    const c = { tpm_access: fakeJwt({ sub: "1", role: "student", exp: future }) };
    expect(location(req("/dashboard", c))).toBeNull();
    expect(location(req("/teacher/dashboard", c))).toBe("/unauthorized");
  });

  it("access vencido pero con tpm_session: deja pasar para que el cliente renueve", () => {
    const c = { tpm_access: fakeJwt({ sub: "1", role: "student", exp: past }), tpm_session: "1" };
    expect(location(req("/dashboard", c))).toBeNull();
    expect(location(req("/admin/dashboard", { tpm_session: "1" }))).toBeNull();
  });

  it("access vencido y sin tpm_session: login", () => {
    const c = { tpm_access: fakeJwt({ sub: "1", role: "student", exp: past }) };
    expect(location(req("/dashboard", c))).toBe("/login");
  });

  it("un access vencido no manda al dashboard desde /login", () => {
    const c = { tpm_access: fakeJwt({ sub: "1", role: "student", exp: past }), tpm_session: "1" };
    expect(location(req("/login", c))).toBeNull();
  });

  it("con access vigente, /login redirige según el rol", () => {
    const mk = (role: string) => ({ tpm_access: fakeJwt({ sub: "1", role, exp: future }) });
    expect(location(req("/login", mk("student")))).toBe("/dashboard");
    expect(location(req("/login", mk("teacher")))).toBe("/teacher/dashboard");
    expect(location(req("/login", mk("superadmin")))).toBe("/admin/dashboard");
  });

  it("la cookie vieja access_token ya no cuenta", () => {
    const c = { access_token: fakeJwt({ sub: "1", role: "student", exp: future }) };
    expect(location(req("/dashboard", c))).toBe("/login");
  });
});
