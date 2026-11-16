import { describe, expect, it } from "vitest";
import { decodeToken, isTokenExpired } from "@/lib/auth";
import { fakeJwt } from "./helpers";

describe("decodeToken / isTokenExpired", () => {
  it("lee el payload de un JWT base64url", () => {
    expect(decodeToken(fakeJwt({ sub: "7", role: "student", exp: 9999999999 }))?.role).toBe("student");
  });

  it("devuelve null con basura", () => {
    expect(decodeToken("no-es-un-jwt")).toBeNull();
    expect(decodeToken("")).toBeNull();
  });

  it("expirado en el límite: vencido hace 1 s sí, vigente 60 s no", () => {
    const now = Math.floor(Date.now() / 1000);
    expect(isTokenExpired(fakeJwt({ exp: now - 1 }))).toBe(true);
    expect(isTokenExpired(fakeJwt({ exp: now + 60 }))).toBe(false);
  });

  it("un token ilegible se considera vencido", () => {
    expect(isTokenExpired("x")).toBe(true);
  });
});
