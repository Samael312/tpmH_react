import api from "@/lib/api";

/** Filas por petición (el servidor admite hasta 500; 200 es su valor por defecto). */
export const PAGE_SIZE = 200;
/** Tope de seguridad: ningún listado trae más de esto aunque el servidor diga que hay más. */
export const MAX_ITEMS = 5000;

export interface AllPages<Row, Body> {
  rows: Row[];
  /** Total real según el servidor (`X-Total-Count`); si no lo manda, lo cargado. */
  total: number;
  /** Cuerpo de la primera respuesta, para listados que traen contadores globales junto a las filas. */
  firstBody: Body;
  /** true si se cortó por MAX_ITEMS y hay más filas en el servidor. */
  truncated: boolean;
}

interface Options<Row, Body> {
  params?: Record<string, string | number | boolean | undefined>;
  /** Saca las filas del cuerpo de cada página. Por defecto el cuerpo ya es la lista. */
  rows?: (body: Body) => Row[];
  pageSize?: number;
  maxItems?: number;
  /** Nombre del parámetro de desplazamiento (`offset` por defecto; `/admin/users` usa `skip`). */
  offsetParam?: string;
  /** Total sacado del cuerpo, para listados que lo traen ahí en vez de en `X-Total-Count`. */
  totalOf?: (body: Body) => number | undefined;
}

/**
 * Los listados del backend devuelven como mucho `limit` filas (200 por defecto) y anotan el total en
 * `X-Total-Count`. Las pantallas filtran y suman sobre la lista completa, así que una lista cortada en silencio
 * daría datos incorrectos a partir de la fila 201. Esta función pide página a página hasta llegar al total.
 * En el caso normal (menos de 200 filas) es UNA sola petición, igual que antes.
 */
export async function fetchAllPages<Row, Body = Row[]>(
  path: string,
  { params, rows = (b) => b as unknown as Row[], pageSize = PAGE_SIZE, maxItems = MAX_ITEMS, offsetParam = "offset", totalOf }: Options<Row, Body> = {},
): Promise<AllPages<Row, Body>> {
  const all: Row[] = [];
  let firstBody: Body | undefined;
  let total = 0;

  for (;;) {
    const res = await api.get<Body>(path, { params: { ...params, limit: pageSize, [offsetParam]: all.length } });
    if (firstBody === undefined) firstBody = res.data;
    const page = rows(res.data) ?? [];
    all.push(...page);

    const fromBody = totalOf?.(res.data);
    const header = Number(res.headers?.["x-total-count"]);
    total =
      typeof fromBody === "number" && fromBody >= 0 ? fromBody : Number.isFinite(header) && header >= 0 ? header : all.length;

    if (page.length === 0 || all.length >= total) break; // terminó (o el servidor no devuelve más)
    if (all.length >= maxItems) break;
  }

  return { rows: all, total, firstBody: firstBody as Body, truncated: all.length < total };
}
