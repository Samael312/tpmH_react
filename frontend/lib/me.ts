import type { QueryClient } from "@tanstack/react-query";
import api from "@/lib/api";

export const ME_QUERY_KEY = ["user", "me"] as const;

/**
 * GET /users/me compartido. `staleTime: 0` fuerza dato fresco (nada queda obsoleto tras un PATCH), pero React Query
 * reutiliza la petición que ya esté en vuelo: el layout, el aviso de email y los hooks de perfil que arrancan a la vez
 * al cargar una pantalla comparten UNA sola llamada en vez de hacer 6 o más.
 */
// La forma de /users/me varía según el rol y cada llamador la tipa a su medida.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function fetchMe<T = any>(qc: QueryClient): Promise<T> {
  return qc.fetchQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: async () => (await api.get("/users/me")).data,
    staleTime: 0,
  }) as Promise<T>;
}
