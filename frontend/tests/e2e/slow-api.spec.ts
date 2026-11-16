import { expect, test, type Page } from "@playwright/test";
import en from "../../messages/en.json";
import { SITE_DEMO } from "../../src/mocks/fixtures.ts";
import { withScenario } from "./helpers/scenario.ts";

/*
 * A cold API, end to end (the BFF's long read limit and the "waking up" line). In the cheap hosting mode the API scales to zero and
 * the first request after a quiet period waits about 30 s for it; the BFF waits that out for reads (UPSTREAM_READ_TIMEOUT_MS) instead
 * of showing an error, and a loading state says why after 3 s. Stop work is the opposite: it has its own, short limit
 * (UPSTREAM_TIMEOUT_MS) and a slow API must never hold it.
 *
 * The `slow` scenario of the mock (src/mocks/handlers.ts) answers every read after 3.6 s and holds every Stop for 20 s.
 * playwright.config.ts starts the web server with a read limit of 15 s and a Stop limit of 3 s. Every title contains "slow API",
 * so `pnpm e2e -g "slow API"` selects them. The service worker is blocked: a page route and a worker that took the page over
 * would both stand between the screen and the BFF, and the worker has its own offline tests.
 */

test.use({ serviceWorkers: "block" });

const PHONE = { width: 390, height: 844 };
const WAKING = en.states.waking;
/** Where Today reads: a pinned site and crew, as a worker who joined from the poster has. */
const PIN = `?site=${SITE_DEMO}&crew=crew-b`;

/** The waking line: a live region with the sentence in it (the skeleton's own status region and the empty one never match). */
const wakingLine = (page: Page) => page.getByRole("status").filter({ hasText: WAKING });
/** The error state's title: this run must never show it. */
const errorTitle = (page: Page) => page.getByText(en.states.error.title);

/** Layout shifts of the page (the CLS entries without recent input), collected from before the first paint. */
async function trackLayoutShifts(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const shifts: number[] = [];
    Reflect.set(window, "__sbShifts", shifts);
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean };
        if (!shift.hadRecentInput) shifts.push(shift.value);
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
}

async function layoutShift(page: Page): Promise<number> {
  const shifts = await page.evaluate(() => Reflect.get(window, "__sbShifts") as number[]);
  return shifts.reduce((sum, value) => sum + value, 0);
}

async function openSlow(page: Page, path: string): Promise<number> {
  await page.setViewportSize(PHONE);
  await withScenario(page, "slow");
  await trackLayoutShifts(page);
  await page.addInitScript(() => {
    localStorage.setItem("sb-theme", JSON.stringify({ theme: "night", until: Date.now() + 6 * 3_600_000 }));
  });
  const startedAt = Date.now();
  await page.goto(path);
  return startedAt;
}

test("slow API: worker Today waits in its loading state, says why after 3 s, then shows the level, and never an error", async ({ page }) => {
  const startedAt = await openSlow(page, `/en/worker${PIN}`);
  const level = page.getByRole("heading", { level: 2, name: en.levels.name.orange });

  // The loading state first, with no line yet and no level.
  await expect(page.locator("[data-skeleton]").first()).toBeVisible();
  await expect(wakingLine(page)).toHaveCount(0);
  await expect(level).toHaveCount(0);

  // Then the line, no sooner than 3 s after the navigation began (the timer starts when the page has mounted), and before the level.
  await expect(wakingLine(page)).toBeVisible({ timeout: 6_000 });
  expect(Date.now() - startedAt).toBeGreaterThanOrEqual(3_000);
  await expect(level).toHaveCount(0);
  await expect(errorTitle(page)).toHaveCount(0);

  // Then the content, and the line is gone with the loading state.
  await expect(level).toBeVisible({ timeout: 10_000 });
  await expect(wakingLine(page)).toHaveCount(0);
  await expect(errorTitle(page)).toHaveCount(0);
  // No alert of the page's own (Next's route announcer is a role=alert that is always there, and empty).
  await expect(page.locator("[role=alert]:not(#__next-route-announcer__)")).toHaveCount(0);

  // The line reserved its own room, so neither its arrival nor the swap to content pushed the page about beyond the budget.
  expect(await layoutShift(page)).toBeLessThanOrEqual(0.1);
});

test("slow API: the supervisor crews list waits, says why after 3 s, and a Stop pressed meanwhile is cut at its own limit", async ({ page }) => {
  await openSlow(page, "/en/supervisor");
  const stopBar = page.locator("[data-emergency]");

  await expect(page.locator("[data-skeleton]").first()).toBeVisible();
  await expect(wakingLine(page)).toHaveCount(0);
  await expect(wakingLine(page)).toBeVisible({ timeout: 6_000 });
  await expect(errorTitle(page)).toHaveCount(0);

  // Stop is live while the list is still loading. The mock holds it for 20 s; the BFF cuts it at its own 3 s, so the bar says it was
  // not sent well before the phone's own 8 s would have, and while the crews are still not on screen.
  await page.getByRole("button", { name: /^Stop work, / }).click();
  await expect(stopBar).toContainText(/Not sent/, { timeout: 6_000 });
  await expect(stopBar).not.toContainText("Stop recorded");
  await expect(page.locator("[data-crew]")).toHaveCount(0);
  // The read it overlapped was not cut by that: no error state for the list.
  await expect(errorTitle(page)).toHaveCount(0);

  // The list arrives (three sequential 3.6 s reads), the line is gone, and there was never an error state.
  await expect(page.locator("[data-crew]").first()).toBeVisible({ timeout: 25_000 });
  await expect(wakingLine(page)).toHaveCount(0);
  await expect(errorTitle(page)).toHaveCount(0);
  expect(await layoutShift(page)).toBeLessThanOrEqual(0.1);
});
