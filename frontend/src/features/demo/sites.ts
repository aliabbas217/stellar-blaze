import { queryOptions } from "@tanstack/react-query";
import { apiClient } from "@/api/client";
import type { ApiProblem } from "@/api/problem";
import { orThrow } from "@/api/queries";
import type { components } from "@/api/schema";

/**
 * `list_sites`, for finding the demo site. The query key is written here because src/api/query-keys.ts has no `sites`
 * entry yet; it moves there when that file is next opened (reported with Task 3). Not cached by the service worker
 * (only forecast/today and risk-policy are), and it never carries a credential.
 */
export const SITES_QUERY_KEY = ["sites"] as const;

export function sitesQueryOptions() {
  return queryOptions<components["schemas"]["Site"][], ApiProblem>({
    queryKey: SITES_QUERY_KEY,
    staleTime: 5 * 60_000,
    queryFn: ({ signal }) => orThrow(apiClient.GET("/api/v1/sites", { signal })),
  });
}
