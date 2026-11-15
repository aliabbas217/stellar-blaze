"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

/**
 * TanStack Query for the app. The client is created once per mounted provider (useState), never at module level,
 * so server rendering cannot share one cache between requests. Defaults: data is fresh for 60 s and a failed
 * query is retried once. The provider renders no markup of its own.
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 60_000, retry: 1 } } }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
