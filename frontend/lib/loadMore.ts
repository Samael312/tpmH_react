import api from "@/lib/api";

/** Filas por clic en «Cargar más» (el servidor admite hasta 500). */
export const LOAD_MORE_PAGE_SIZE = 50;

export interface LoadMorePage<Row, Body = unknown> {
  rows: Row[];
  /** Total real según `X-Total-Count` (o el cuerpo, ver `PageShape.totalOf`); si no viene, lo cargado hasta ahora. */
  total: number;
  offset: number;
  /** Cuerpo de la respuesta, para listados que traen contadores junto a las filas (p. ej. `/admin/users`). */
  body: Body;
}

/** Forma de la respuesta cuando no es una lista simple con `X-Total-Count` (p. ej. `/admin/users`: `{ total, users }`). */
export interface PageShape<Row, Body> {
  rows?: (body: Body) => Row[];
  totalOf?: (body: Body) => number | undefined;
  /** Nombre del parámetro de desplazamiento (`offset` por defecto; `/admin/users` usa `skip`). */
  offsetParam?: string;
}

/** Pide UNA página de un listado paginado del backend (`limit`/`offset` + `X-Total-Count`). */
export async function fetchPage<Row, Body = Row[]>(
  path: string,
  offset: number,
  pageSize: number = LOAD_MORE_PAGE_SIZE,
  params?: Record<string, string | number | boolean | undefined>,
  { rows: rowsOf = (b) => b as unknown as Row[], totalOf, offsetParam = "offset" }: PageShape<Row, Body> = {},
): Promise<LoadMorePage<Row, Body>> {
  const res = await api.get<Body>(path, { params: { ...params, limit: pageSize, [offsetParam]: offset } });
  const rows = rowsOf(res.data) ?? [];
  const fromBody = totalOf?.(res.data);
  const header = Number(res.headers?.["x-total-count"]);
  const total =
    typeof fromBody === "number" && fromBody >= 0
      ? fromBody
      : Number.isFinite(header) && header >= 0
        ? header
        : offset + rows.length;
  return { rows, total, offset, body: res.data };
}

/** Offset de la página siguiente, o undefined si ya se cargó todo (`getNextPageParam` de useInfiniteQuery). */
export function nextOffset<Row>(last: LoadMorePage<Row, unknown>): number | undefined {
  const next = last.offset + last.rows.length;
  return last.rows.length > 0 && next < last.total ? next : undefined;
}
