import { queryOptions } from "@tanstack/react-query";
import { apiClient } from "@/api/client";
import type { ApiProblem } from "@/api/problem";
import { queryKeys } from "@/api/query-keys";
import { orThrow } from "@/api/queries";
import type { components } from "@/api/schema";

/**
 * `list_sites`, for finding the demo site. Not cached by the service worker (only forecast/today and risk-policy are),
 * and it never carries a credential. The key is `queryKeys.sites()`, like every other key of the app.
 */
export function sitesQueryOptions() {
  return queryOptions<components["schemas"]["Site"][], ApiProblem>({
    queryKey: queryKeys.sites(),
    staleTime: 5 * 60_000,
    queryFn: ({ signal }) => orThrow(apiClient.GET("/api/v1/sites", { signal })),
  });
}
