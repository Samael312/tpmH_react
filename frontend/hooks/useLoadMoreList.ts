import { useInfiniteQuery, type QueryKey } from "@tanstack/react-query";
import { fetchPage, nextOffset, LOAD_MORE_PAGE_SIZE, type LoadMorePage } from "@/lib/loadMore";

/** Listado paginado en el servidor con «Cargar más». Para listas que crecen sin límite y no se suman en el cliente. */
export function useLoadMoreList<Row>(
  queryKey: QueryKey,
  path: string,
  { enabled = true, pageSize = LOAD_MORE_PAGE_SIZE }: { enabled?: boolean; pageSize?: number } = {},
) {
  const query = useInfiniteQuery<LoadMorePage<Row>, Error, Row[], QueryKey, number>({
    queryKey,
    queryFn: ({ pageParam }) => fetchPage<Row>(path, pageParam, pageSize),
    initialPageParam: 0,
    getNextPageParam: nextOffset,
    select: (data) => data.pages.flatMap((p) => p.rows),
    enabled,
  });
  const pages = query.data;
  return {
    rows: pages ?? [],
    loading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    refetch: query.refetch,
    hasMore: Boolean(query.hasNextPage),
    loadMore: () => query.fetchNextPage(),
    loadingMore: query.isFetchingNextPage,
  };
}
