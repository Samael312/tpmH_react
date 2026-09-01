"use client";

import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MobileTopBarProvider } from "@/lib/mobileTopBar";
import Toaster from "@/components/ui/Toast";
import ErrorBoundary from "@/components/ErrorBoundary";
import { installGlobalErrorReporting } from "@/lib/errorReporting";

export default function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
            gcTime: 5 * 60 * 1000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      })
  );

  useEffect(() => {
    installGlobalErrorReporting();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>
        <MobileTopBarProvider>{children}</MobileTopBarProvider>
      </ErrorBoundary>
      <Toaster />
    </QueryClientProvider>
  );
}