"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { ApiProblem, UPSTREAM_UNAVAILABLE_TYPE } from "@/api/problem";

/**
 * Whether a failed read is tried once more: one retry, except after `upstream-unavailable`. That is the 502 the BFF returns when its
 * own time limit fired (src/app/api/v1/[...path]/route.ts), so the read has already waited the whole limit and a retry would double
 * the wait before the saved copy or the error state. A network rejection (status 0), any other 5xx and unexpected errors keep the retry.
 */
export function shouldRetryRead(failureCount: number, error: Error): boolean {
  if (failureCount >= 1) return false;
  return !(error instanceof ApiProblem && error.problem.type === UPSTREAM_UNAVAILABLE_TYPE);
}

/**
 * TanStack Query for the app. The client is created once per mounted provider (useState), never at module level,
 * so server rendering cannot share one cache between requests. Defaults: data is fresh for 60 s and a failed
 * read is retried once unless the BFF's own time limit fired (`shouldRetryRead`); mutations are never retried
 * (TanStack's default). The provider renders no markup of its own.
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 60_000, retry: shouldRetryRead } } }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
