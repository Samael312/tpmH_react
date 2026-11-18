import { AxiosError, AxiosHeaders } from "axios";
import { describe, expect, it } from "vitest";
import { getErrorMessage } from "@/lib/errorMessage";

function axiosErr(data: unknown, message = "Request failed", status = 400) {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError(message, "ERR_BAD_REQUEST", config, {}, { data, status, statusText: "", headers: {}, config });
}

describe("getErrorMessage", () => {
  it("usa `detail` en texto de FastAPI", () => {
    expect(getErrorMessage(axiosErr({ detail: "Credenciales incorrectas" }))).toBe("Credenciales incorrectas");
  });

  it("detail vacío o en blanco: cae al mensaje de la excepción", () => {
    expect(getErrorMessage(axiosErr({ detail: "   " }, "Fallo X"))).toBe("Fallo X");
  });

  it("errores de validación de Pydantic: primer `msg`", () => {
    expect(getErrorMessage(axiosErr({ detail: [{ msg: "campo requerido", loc: ["body", "x"] }, { msg: "otro" }] }))).toBe("campo requerido");
  });

  it("lista de textos: el primero", () => {
    expect(getErrorMessage(axiosErr({ detail: ["primero", "segundo"] }))).toBe("primero");
  });

  it("sin respuesta del servidor: mensaje de conexión", () => {
    const e = new AxiosError("Network Error", "ERR_NETWORK");
    expect(getErrorMessage(e)).toMatch(/No se pudo conectar/);
  });

  it("login bloqueado (429) enseña el aviso del backend", () => {
    const msg = "Demasiados intentos fallidos. Inténtalo de nuevo en unos minutos o restablece tu contraseña.";
    expect(getErrorMessage(axiosErr({ detail: msg }, "Too Many", 429))).toBe(msg);
  });

  it("Error normal: su mensaje; otra cosa: el fallback", () => {
    expect(getErrorMessage(new Error("boom"))).toBe("boom");
    expect(getErrorMessage("texto", "por defecto")).toBe("por defecto");
    expect(getErrorMessage(undefined)).toBe("Ocurrió un error. Inténtalo de nuevo.");
  });
});
