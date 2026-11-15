import type { Page } from "@playwright/test";
import { MOCK_SCENARIO_HEADER } from "../../../src/api/mock-scenario.ts";

/*
 * The mock API's scenarios (src/mocks/handlers.ts) for an e2e: the API answers differently when a request carries
 * `x-sb-mock-scenario`. The standalone server forwards it only because playwright.config.ts starts it with SB_MOCK_SCENARIOS=1;
 * a real deployment never does. Every view's spec uses this one helper, so a scenario is named the same way everywhere.
 */

export const SCENARIOS = ["error", "stale", "empty", "fallback", "suppressed", "offseason", "noshift", "shift-not-legal", "plan-invalid", "unavailable"] as const;
export type Scenario = (typeof SCENARIOS)[number];

/**
 * Makes every request of `page` carry the scenario (the document's and the BFF's), or none when `name` is null. Call it before
 * `page.goto`. The header is also sent with the page's own document request, which the app ignores.
 */
export async function withScenario(page: Page, name: Scenario | null): Promise<void> {
  await page.setExtraHTTPHeaders(name === null ? {} : { [MOCK_SCENARIO_HEADER]: name });
}
