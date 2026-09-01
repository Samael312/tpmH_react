import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";

export interface ErrorLogEntry {
  id: number;
  source: "backend" | "frontend";
  level: "error" | "warning";
  message: string;
  detail: string | null;
  screen: string | null;
  method: string | null;
  status_code: number | null;
  user_id: number | null;
  user_name: string | null;
  user_role: string | null;
  extra_data: Record<string, unknown> | null;
  created_at: string;
}

export interface ErrorLogStats {
  total: number;
  errors: number;
  warnings: number;
  backend: number;
  frontend: number;
  last_24h: number;
}

export interface ErrorLogFilters {
  source?: "backend" | "frontend";
  level?: "error" | "warning";
  screen?: string;
  user_id?: number;
  page?: number;
  page_size?: number;
}

export function useErrorLogs(filters: ErrorLogFilters = {}) {
  const query = useQuery({
    queryKey: ["admin", "error-logs", filters],
    queryFn: async () => {
      const res = await api.get("/logs", { params: filters });
      return res.data as { items: ErrorLogEntry[]; total: number; page: number; page_size: number };
    },
    // Se refresca solo cada 30s: es una pantalla de monitoreo, no necesita
    // ser instantánea, pero sí conviene que se mantenga al día sin que el
    // staff tenga que refrescar manualmente todo el tiempo.
    refetchInterval: 30_000,
  });

  return {
    items: query.data?.items ?? [],
    total: query.data?.total ?? 0,
    page: query.data?.page ?? 1,
    pageSize: query.data?.page_size ?? filters.page_size ?? 50,
    loading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    refetch: query.refetch,
  };
}

export function useErrorLogStats() {
  const query = useQuery({
    queryKey: ["admin", "error-logs", "stats"],
    queryFn: async () => {
      const res = await api.get("/logs/stats");
      return res.data as ErrorLogStats;
    },
    refetchInterval: 30_000,
  });

  return {
    stats: query.data,
    loading: query.isLoading,
    isFetching: query.isFetching,
    refetch: query.refetch,
  };
}
