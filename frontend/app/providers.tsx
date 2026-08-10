"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

export default function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,       // 1 min sin considerarse "vieja"
            gcTime: 5 * 60 * 1000,      // 5 min en caché tras dejar de usarse
            refetchOnWindowFocus: false, // evitamos refetch agresivo al cambiar de pestaña
            retry: 1,
          },
        },
      })
  );

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}