import { expect, type Page } from "@playwright/test";

/** How long the app's service worker may take to register and activate on the production build (as pwa.spec.ts allows). */
export const INSTALL_TIMEOUT_MS = 20_000;

/**
 * Opens `path`, waits for the app's service worker to be active, then reloads so the page is loaded under its control: the
 * first load of a page is never controlled (see pwa.spec.ts). After this the worker can answer a request with no network.
 */
export async function loadControlled(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect
    .poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map((registration) => registration.active?.state)), {
      message: "the app registers a service worker and it activates",
      timeout: INSTALL_TIMEOUT_MS,
    })
    .toEqual(["activated"]);
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null), { timeout: INSTALL_TIMEOUT_MS })
    .toBe(true);
}
