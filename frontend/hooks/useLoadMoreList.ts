import { useMemo } from "react";
import { useInfiniteQuery, type InfiniteData, type QueryKey } from "@tanstack/react-query";
import { fetchPage, nextOffset, LOAD_MORE_PAGE_SIZE, type LoadMorePage, type PageShape } from "@/lib/loadMore";

interface Options<Row, Body> extends PageShape<Row, Body> {
  enabled?: boolean;
  pageSize?: number;
  /** Filtros que van al servidor. Inclúyelos también en `queryKey` para que cambiar un filtro empiece de cero. */
  params?: Record<string, string | number | boolean | undefined>;
}

/**
 * Listado paginado en el servidor con «Cargar más». Para listas que crecen sin límite: filtros y búsqueda van al
 * backend (`params`) y los contadores salen de `total` o del cuerpo (`firstBody`), nunca de sumar lo cargado.
 */
export function useLoadMoreList<Row, Body = Row[]>(
  queryKey: QueryKey,
  path: string,
  { enabled = true, pageSize = LOAD_MORE_PAGE_SIZE, params, rows, totalOf, offsetParam }: Options<Row, Body> = {},
) {
  const query = useInfiniteQuery<LoadMorePage<Row, Body>, Error, InfiniteData<LoadMorePage<Row, Body>, number>, QueryKey, number>({
    queryKey,
    queryFn: ({ pageParam }) => fetchPage<Row, Body>(path, pageParam, pageSize, params, { rows, totalOf, offsetParam }),
    initialPageParam: 0,
    getNextPageParam: nextOffset,
    enabled,
  });
  const pages = query.data?.pages;
  // Misma referencia mientras no lleguen páginas nuevas (los consumidores la usan en dependencias de efectos).
  const allRows = useMemo(() => (pages ?? []).flatMap((p) => p.rows), [pages]);
  const last = pages?.[pages.length - 1];
  return {
    rows: allRows,
    /** Total real del servidor con los filtros actuales (0 mientras carga). */
    total: last?.total ?? 0,
    /** Cuerpo de la primera página (contadores globales que manda el servidor). */
    firstBody: pages?.[0]?.body as Body | undefined,
    loading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    refetch: query.refetch,
    hasMore: Boolean(query.hasNextPage),
    loadMore: () => query.fetchNextPage(),
    loadingMore: query.isFetchingNextPage,
  };
}
