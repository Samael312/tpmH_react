import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const post = vi.fn();
vi.mock("axios", () => ({ default: { create: () => ({ post: (...a: unknown[]) => post(...a) }) } }));

import { reportFrontendError, installGlobalErrorReporting } from "@/lib/errorReporting";

beforeEach(() => { post.mockReset(); post.mockResolvedValue({}); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("reportFrontendError", () => {
  it("envía el error recortado con su pantalla y nivel por defecto", () => {
    reportFrontendError({ message: "m".repeat(3000), stack: "s".repeat(9000), screen: "/a".repeat(200), extra: { a: 1 } });
    const [url, body, opts] = post.mock.calls[0];
    expect(url).toBe("/logs/frontend");
    expect(body.message).toHaveLength(2000);
    expect(body.stack).toHaveLength(8000);
    expect(body.screen).toHaveLength(300);
    expect(body.level).toBe("error");
    expect(opts).toEqual({ withCredentials: true });
  });

  it("el mismo error repetido no se manda dos veces dentro de la ventana, y sí después", () => {
    vi.useFakeTimers();
    reportFrontendError({ message: "igual", screen: "/x" });
    reportFrontendError({ message: "igual", screen: "/x" });
    expect(post).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(4100);
    reportFrontendError({ message: "igual", screen: "/x" });
    expect(post).toHaveBeenCalledTimes(2);
  });

  it("si el envío falla no lanza ni deja la promesa sin capturar", async () => {
    post.mockRejectedValue(new Error("sin red"));
    expect(() => reportFrontendError({ message: "falla", screen: "/y" })).not.toThrow();
    await Promise.resolve();
  });

  it("si algo revienta dentro del reporte tampoco lanza", () => {
    expect(() => reportFrontendError({ message: undefined as unknown as string, screen: "/z" })).not.toThrow();
  });
});

describe("installGlobalErrorReporting", () => {
  function fakeWindow() {
    const target = new EventTarget() as EventTarget & { location: { pathname: string }; __errorReportingInstalled?: boolean };
    target.location = { pathname: "/pantalla" };
    vi.stubGlobal("window", target);
    return target;
  }

  it("sin window no hace nada", () => {
    vi.stubGlobal("window", undefined);
    expect(() => installGlobalErrorReporting()).not.toThrow();
  });

  it("se instala una sola vez y reporta errores de JS y promesas rechazadas", () => {
    const w = fakeWindow();
    installGlobalErrorReporting();
    installGlobalErrorReporting();
    const err = Object.assign(new Event("error"), { message: "boom", error: new Error("x") });
    w.dispatchEvent(err);
    w.dispatchEvent(Object.assign(new Event("error"), { message: "", error: undefined }));
    w.dispatchEvent(Object.assign(new Event("unhandledrejection"), { reason: new TypeError("mal") }));
    w.dispatchEvent(Object.assign(new Event("unhandledrejection"), { reason: "texto" }));
    const messages = post.mock.calls.map((c) => c[1].message);
    expect(messages).toEqual(["boom", "Error de JS no controlado", "TypeError: mal", "Promesa rechazada sin manejar: texto"]);
    expect(post.mock.calls[2][1].stack).toBeTruthy();
    expect(post.mock.calls[3][1].stack).toBeUndefined();
  });
});
