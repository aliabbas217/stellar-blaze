import { headers } from "next/headers";
import createClient from "openapi-fetch";
import { MOCK_SCENARIO_HEADER, mockScenariosEnabled } from "@/api/mock-scenario";
import type { paths } from "@/api/schema";

/**
 * The API client for Server Components and route handlers: it calls API_ORIGIN directly (no BFF hop).
 * The page request's X-Request-ID is carried on, so one id ties the browser, the page and the API call together;
 * the mock scenario header is carried on under the same condition as the BFF proxy (see mock-scenario.ts).
 * Async because Next.js 16 reads request headers asynchronously. Throws when API_ORIGIN is unset.
 * Use it inside `call()` (src/api/result.ts) so an HTTP error becomes a Result and keeps its request id.
 */
export async function serverApiClient() {
  const origin = process.env.API_ORIGIN;
  if (origin === undefined || origin === "") {
    throw new Error("API_ORIGIN is not set: serverApiClient() needs the API's origin (for example http://api:8000).");
  }

  const incoming = await headers();
  const forwarded: Record<string, string> = {};
  const requestId = incoming.get("x-request-id");
  if (requestId !== null) forwarded["x-request-id"] = requestId;
  const scenario = incoming.get(MOCK_SCENARIO_HEADER);
  if (scenario !== null && mockScenariosEnabled()) forwarded[MOCK_SCENARIO_HEADER] = scenario;

  // no-store: a forecast must never be served from a data cache as if it were current.
  return createClient<paths>({ baseUrl: origin, headers: forwarded, cache: "no-store" });
}
