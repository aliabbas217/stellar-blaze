import { expect, test, type Page } from "@playwright/test";
import { SITE_DEMO } from "../../src/mocks/fixtures.ts";
import { RECORDED_HERO_EXCEPTIONS, RECORDED_HERO_TOLERANCE, MIN_HERO_SHARE, heroShareOf, type HeroKey } from "./gate.ts";
import { withScenario, type Scenario } from "./helpers/scenario.ts";

/*
 * The hero's share of the first fold at 390 x 844, in every language, for the six field states (F2 Task 22, ruling 5). The rule is the
 * plan's: the `[data-hero]` area is at least 35 % of the fold. After the translations, a state below 35 % was fixed by layout where
 * layout could fix it; the rest are RECORDED exceptions with their measured number (RECORDED_HERO_EXCEPTIONS in gate.ts), held to that
 * number minus one point, so a recorded exception can only improve. Every share is printed (`hero share <state> <locale> <theme>: n %`)
 * for the report. Every title contains "hero share", so `pnpm e2e -g "hero share"` selects them.
 */

const PHONE = { width: 390, height: 844 };
const PIN = `?site=${SITE_DEMO}&crew=crew-b`;
const LOCALES = ["en", "ar", "ur", "hi", "bn", "ne"] as const;
const ALERT = `/worker/alert?audience=site&target=${SITE_DEMO}&level=orange&valid_from=${encodeURIComponent("2026-09-03T06:00:00Z")}`;

interface State {
  readonly name: HeroKey["state"];
  readonly path: string;
  readonly scenario?: Scenario;
  /** A selector that is on the page once the state has settled. */
  readonly ready: string;
  /**
   * Today with a worker profile on the phone: "personal" (the personal level is worked out), "partial" (the risk policy answers 503, so
   * it cannot be, and a banner says why above the site's level). Both stand above the spine and cost the hero a banner or a line.
   */
  readonly profile?: "personal" | "partial";
}

// The profile of `tests/e2e/worker-today-notlive.spec.ts` (the Urdu measurement that was the only one until fix round 1).
const PROFILE = {
  consentVersion: "2026-11-11",
  consentedAt: "2026-09-01T08:30:00.000Z",
  siteId: SITE_DEMO,
  crewId: "crew-b",
  workloadClass: "moderate",
  heatWorkStartDate: "2026-09-03",
  clothingCode: "work_clothes",
};

const STATES: readonly State[] = [
  { name: "today-live", path: `/worker${PIN}`, ready: '[data-level-sign][data-kind="live"]' },
  { name: "today-personal", path: `/worker${PIN}`, ready: "[data-level-sign]", profile: "personal" },
  { name: "today-partial", path: `/worker${PIN}`, ready: "[data-level-sign]", profile: "partial" },
  { name: "today-not-live", path: `/worker${PIN}`, scenario: "stale", ready: "[data-protective-lead]" },
  { name: "alert", path: ALERT, ready: "[data-level-sign]" },
  { name: "unwell", path: "/worker/unwell", ready: '[role="timer"]' },
  { name: "crews", path: "/supervisor", ready: "[data-emergency]" },
  { name: "plan", path: "/supervisor/crews/crew-b", ready: "[data-emergency]" },
];

async function share(page: Page, locale: string, state: State, theme: "night" | "sun"): Promise<number | null> {
  await page.setViewportSize(PHONE);
  await withScenario(page, state.scenario ?? null);
  await page.addInitScript((chosen) => {
    localStorage.setItem("sb-theme", JSON.stringify({ theme: chosen, until: Date.now() + 6 * 3_600_000 }));
  }, theme);
  if (state.name === "unwell") {
    await page.addInitScript((stored) => {
      localStorage.setItem("sb-profile-v1", stored);
    }, JSON.stringify({ state: { profile: null, push: null, site: { siteId: SITE_DEMO, crewId: null, contacts: { supervisorPhone: "+12025550143", firstAiderPhone: "+12025550144" } } }, version: 1 }));
  }
  if (state.profile !== undefined) {
    await page.addInitScript((stored) => {
      localStorage.setItem("sb-profile-v1", stored);
    }, JSON.stringify({ state: { profile: PROFILE, push: null, site: { siteId: SITE_DEMO, crewId: "crew-b" } }, version: 1 }));
  }
  if (state.profile === "partial") {
    // The forecast answers; only the risk policy does not, so the personal level cannot be worked out and a banner says why.
    await page.route("**/api/v1/risk-policy", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/problem+json",
        body: JSON.stringify({ type: "urn:stellar-blaze:problem:dependency-unavailable", title: "Dependency unavailable", status: 503 }),
      }),
    );
  }
  await page.goto(`/${locale}${state.path}`);
  await page.locator(state.ready).first().waitFor();
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  return heroShareOf(page);
}

for (const locale of LOCALES) {
  for (const state of STATES) {
    for (const theme of ["night", "sun"] as const) {
      test(`hero share: ${state.name}, ${locale}, ${theme}`, async ({ page }) => {
        const measured = await share(page, locale, state, theme);
        console.log(`hero share ${state.name} ${locale} ${theme}: ${measured === null ? "no [data-hero]" : `${(measured * 100).toFixed(1)}%`}`);
        // Every one of these states carries a [data-hero] (Today, the alert, the unwell sheet, the crews strips and the plan view). A
        // state that loses it must fail here, never pass silently as "no hero to measure" (the fix-round-1 finding: a removed [data-hero]
        // used to return early and pass).
        expect(measured, `${state.name} ${locale} ${theme}: the page has a [data-hero] element`).not.toBeNull();
        if (measured === null) return;
        const recorded = RECORDED_HERO_EXCEPTIONS[`${state.name}:${locale}`];
        if (recorded === undefined) expect(measured, `${state.name} ${locale} ${theme}`).toBeGreaterThanOrEqual(MIN_HERO_SHARE);
        else expect(measured, `${state.name} ${locale} ${theme}: a recorded exception (${(recorded * 100).toFixed(1)} %), never below it`).toBeGreaterThanOrEqual(recorded - RECORDED_HERO_TOLERANCE);
      });
    }
  }
}

test("hero share: the measure is not vacuous, a page whose [data-hero] is removed measures null and the loop above fails on it", async ({ page }) => {
  await share(page, "en", STATES[0] as State, "night");
  expect(await heroShareOf(page), "Today has a hero").toBeGreaterThan(0);
  await page.evaluate(() => {
    for (const hero of document.querySelectorAll("[data-hero]")) hero.removeAttribute("data-hero");
  });
  expect(await heroShareOf(page)).toBeNull();
});
