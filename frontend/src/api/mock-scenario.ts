/*
 * Test-only switch: the mock API (src/mocks/handlers.ts) answers differently when a request carries
 * `x-sb-mock-scenario: error | stale | empty`. e2e runs against the standalone mock server with no per-test
 * handler overrides, so a Playwright test sets the header (`page.setExtraHTTPHeaders`) and the BFF proxy and
 * serverApiClient carry it through. Real deployments must never forward it.
 *
 * It is also loaded by scripts/mock-api.ts, which Node runs with type stripping: no imports, no enums.
 */

export const MOCK_SCENARIO_HEADER = "x-sb-mock-scenario";

/**
 * True outside production builds, and in a production build only when the server was started with
 * SB_MOCK_SCENARIOS=1 (Playwright's `webServer` env). `process.env.NODE_ENV` is written out in full on purpose:
 * Next.js replaces that exact expression at build time, so a production build is closed even if the container
 * forgot to set NODE_ENV. SB_MOCK_SCENARIOS is not a NEXT_PUBLIC_ variable and is read at request time.
 */
export function mockScenariosEnabled(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.SB_MOCK_SCENARIOS === "1";
}
