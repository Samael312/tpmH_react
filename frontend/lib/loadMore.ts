import api from "@/lib/api";

/** Filas por clic en «Cargar más» (el servidor admite hasta 500). */
export const LOAD_MORE_PAGE_SIZE = 50;

export interface LoadMorePage<Row> {
  rows: Row[];
  /** Total real según `X-Total-Count`; si el servidor no lo manda, lo cargado hasta ahora. */
  total: number;
  offset: number;
}

/** Pide UNA página de un listado paginado del backend (`limit`/`offset` + `X-Total-Count`). */
export async function fetchPage<Row>(
  path: string,
  offset: number,
  pageSize: number = LOAD_MORE_PAGE_SIZE,
  params?: Record<string, string | number | boolean | undefined>,
): Promise<LoadMorePage<Row>> {
  const res = await api.get<Row[]>(path, { params: { ...params, limit: pageSize, offset } });
  const rows = res.data ?? [];
  const header = Number(res.headers?.["x-total-count"]);
  const total = Number.isFinite(header) && header >= 0 ? header : offset + rows.length;
  return { rows, total, offset };
}

/** Offset de la página siguiente, o undefined si ya se cargó todo (`getNextPageParam` de useInfiniteQuery). */
export function nextOffset<Row>(last: LoadMorePage<Row>): number | undefined {
  const next = last.offset + last.rows.length;
  return last.rows.length > 0 && next < last.total ? next : undefined;
}
