import createClient from "openapi-fetch";
import type { paths } from "@/api/schema";

/**
 * The browser's API client. Same-origin: the paths in `schema.d.ts` already carry `/api/v1`, and the route
 * handler at src/app/api/v1/[...path]/route.ts forwards them to the API. The browser never calls API_ORIGIN.
 * Wrap calls in `call()` (src/api/result.ts) to get a Result instead of `{ data, error }`.
 */
export const apiClient = createClient<paths>({ baseUrl: "" });
