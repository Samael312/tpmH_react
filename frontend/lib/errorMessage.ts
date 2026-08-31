import axios from "axios";

/**
 * Extrae un mensaje de error legible de cualquier excepción, priorizando el
 * formato `detail` que devuelve FastAPI (string o lista de errores de
 * validación de Pydantic). Si no reconoce el formato, usa `fallback`.
 *
 * Ejemplo:
 *   try {
 *     await api.post(...)
 *   } catch (e) {
 *     toast.error(getErrorMessage(e, "No se pudo guardar el paquete"));
 *   }
 */
export function getErrorMessage(err: unknown, fallback = "Ocurrió un error. Inténtalo de nuevo."): string {
  if (axios.isAxiosError(err)) {
    const detail = err.response?.data?.detail;

    if (typeof detail === "string" && detail.trim()) {
      return detail;
    }

    // Errores de validación de FastAPI/Pydantic: lista de objetos {msg, loc, ...}
    if (Array.isArray(detail) && detail.length > 0) {
      const first = detail[0];
      if (typeof first === "string") return first;
      if (first && typeof first.msg === "string") return first.msg;
    }

    if (err.message === "Network Error") {
      return "No se pudo conectar con el servidor. Revisa tu conexión.";
    }
  }

  if (err instanceof Error && err.message) {
    return err.message;
  }

  return fallback;
}
