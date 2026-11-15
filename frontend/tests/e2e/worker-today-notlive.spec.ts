import { expect, test, type Page } from "@playwright/test";
import ar from "../../messages/ar.json";
import bn from "../../messages/bn.json";
import en from "../../messages/en.json";
import hi from "../../messages/hi.json";
import ne from "../../messages/ne.json";
import ur from "../../messages/ur.json";
import { SITE_DEMO } from "../../src/mocks/fixtures.ts";
import { gateReport, watchConsole, type GateOptions, type GateReport } from "./gate.ts";
import { withScenario, type Scenario } from "./helpers/scenario.ts";

/*
 * Today with no live forecast (F2 W3.2, architect ruling b), in a production build against the mock API, in ALL SIX locales.
 *
 * Stale, offline and fallback: the HERO is the "No fresh forecast: protective plan" lead (`[data-hero]` is that element and
 * only that element), it is the first text of the screen, it is always rendered, and the 35 % floor of the first fold at
 * 390 x 844 is asserted on it in en, ar, ur, hi, bn and ne, night and sun. The sign shows the PROTECTIVE level (High, which the
 * level vocabulary writes Orange; ADR 0058 decision 4, ADR 0046 decision 3), dashed; the spine stays on screen; the last known
 * level, when there is one, is secondary and dashed. The hero share of each state is printed (`hero share ...`) for the report.
 *
 * Also here: the Urdu hero shares the architect left open (partial) as RECORDED exceptions with their real numbers, and
 * the Urdu level words measured in the face that ships (Nastaliq): they never touch the rows around them (F2 W2).
 */

const PHONE = { width: 390, height: 844 };
const PIN = `?site=${SITE_DEMO}&crew=crew-b`;

const LOCALES = ["en", "ar", "ur", "hi", "bn", "ne"] as const;
type Locale = (typeof LOCALES)[number];
const CATALOGUE = { en, ar, ur, hi, bn, ne } as const;
type Theme = "night" | "sun";

async function openToday(page: Page, locale: Locale, theme: Theme, scenario: Scenario | null): Promise<string[]> {
  const errors = watchConsole(page);
  await page.setViewportSize(PHONE);
  await withScenario(page, scenario);
  await page.addInitScript((chosen) => {
    localStorage.setItem("sb-theme", JSON.stringify({ theme: chosen, until: Date.now() + 6 * 3_600_000 }));
  }, theme);
  await page.goto(`/${locale}/worker${PIN}`);
  await expect(page.getByRole("heading", { level: 1, name: CATALOGUE[locale].worker.today.title })).toBeAttached();
  return errors;
}

async function gate(page: Page, errors: string[], options: Omit<GateOptions, "consoleErrors" | "field">, label: string): Promise<GateReport> {
  const consoleErrors = errors.filter((message) => !/^HTTP 500 .*\/api\/v1\//.test(message));
  await page.evaluate(() => document.fonts.ready);
  const report = await gateReport(page, { consoleErrors, field: true, ...options });
  await test.info().attach(`gate-${label}.json`, { body: JSON.stringify(report, null, 2), contentType: "application/json" });
  console.log(`hero share ${label}: ${report.heroShare === null ? "-" : `${(report.heroShare * 100).toFixed(1)}%`}`);
  expect(report.failures, label).toEqual([]);
  return report;
}

/** The lead is the hero, the first text, and the sign and spine are as the ruling says. */
async function expectProtectiveLead(page: Page, locale: Locale, label: string): Promise<void> {
  const words = CATALOGUE[locale];
  const lead = page.locator("[data-protective-lead]");
  await expect(lead, `${label}: the lead is rendered`).toHaveCount(1);
  await expect(page.locator("[data-hero]"), `${label}: the lead is the only hero`).toHaveCount(1);
  await expect(page.locator("[data-hero]")).toHaveAttribute("data-protective-lead", "");
  await expect(lead.getByRole("heading", { name: words.worker.today.kicker.fallback })).toBeVisible();
  // The first VISIBLE text of the page's own content (the shell header sits above it; the page's sr-only <h1> is its title for a
  // screen reader and is not a sighted worker's first read) is the lead's heading.
  const first = await page.evaluate(() => {
    const walker = document.createTreeWalker(document.querySelector("main") as HTMLElement, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const text = (node.textContent ?? "").trim();
      if (text !== "" && node.parentElement?.closest(".sr-only") === null) return text;
    }
    return "";
  });
  expect(first, `${label}: the lead is the first text in reading order`).toBe(words.worker.today.kicker.fallback);
  // The sign: the protective level, dashed, never live; the spine stays and is not the hero.
  const sign = lead.locator('[data-level-sign][data-size="hero"]');
  await expect(sign).toHaveAttribute("data-kind", "fallback");
  await expect(sign.locator("[data-level-word]")).toHaveText(words.levels.name.orange);
  await expect(page.locator('[data-level-sign][data-kind="live"]')).toHaveCount(0);
  await expect(page.locator("[data-spine]")).toHaveCount(1);
  await expect(page.locator("[data-spine]").locator("xpath=ancestor-or-self::*[@data-hero]")).toHaveCount(0);
}

for (const locale of LOCALES) {
  for (const theme of ["night", "sun"] as const) {
    test(`Today leads with the protective plan and holds the hero floor: stale, ${locale}, ${theme}`, async ({ page }) => {
      const errors = await openToday(page, locale, theme, "stale");
      await expect(page.locator("[data-protective-lead]")).toBeVisible();
      await page.waitForLoadState("networkidle");
      await expectProtectiveLead(page, locale, `stale-${locale}-${theme}`);
      // The level the forecast last gave is secondary: a dashed mini sign inside the lead.
      await expect(page.locator('[data-protective-lead] [data-level-sign][data-kind="stale"][data-size="mini"]')).toHaveCount(1);
      await gate(page, errors, { hero: true, spine: true, locale }, `stale-${locale}-${theme}`);
    });

    test(`Today leads with the protective plan and holds the hero floor: fallback, ${locale}, ${theme}`, async ({ page }) => {
      const errors = await openToday(page, locale, theme, "fallback");
      await expect(page.locator("[data-protective-lead]")).toBeVisible();
      await page.waitForLoadState("networkidle");
      await expectProtectiveLead(page, locale, `fallback-${locale}-${theme}`);
      // No forecast was ever read: there is no last known level to show.
      await expect(page.locator('[data-level-sign][data-kind="stale"]')).toHaveCount(0);
      await gate(page, errors, { hero: true, spine: true, locale }, `fallback-${locale}-${theme}`);
    });

    test(`Today leads with the protective plan and holds the hero floor: offline, ${locale}, ${theme}`, async ({ page, context }) => {
      const errors = await openToday(page, locale, theme, null);
      await expect(page.locator('[data-level-sign][data-kind="live"]')).toHaveCount(1);
      expect(await page.locator("[data-protective-lead]").count(), "live before the signal goes").toBe(0);
      await context.setOffline(true);
      await expect(page.locator("[data-protective-lead]")).toBeVisible();
      await expectProtectiveLead(page, locale, `offline-${locale}-${theme}`);
      // The offline lead says why, in the page's words (W2: offline reads the protective-plan explanation, not only the stale state).
      const words = CATALOGUE[locale].states.offlineBanner;
      await expect(page.locator("[data-protective-lead]")).toContainText(words.title);
      await expect(page.locator("[data-protective-lead]")).toContainText(words.body);
      await expect(page.locator('[data-protective-lead] [data-level-sign][data-kind="stale"][data-size="mini"]')).toHaveCount(1);
      await gate(page, errors, { hero: true, spine: true, locale }, `offline-${locale}-${theme}`);
      await context.setOffline(false);
      // Back online: the lead goes and the live screen comes back.
      await expect(page.locator('[data-level-sign][data-kind="live"]')).toHaveCount(1);
      await expect(page.locator("[data-protective-lead]")).toHaveCount(0);
    });
  }
}

test("Today shows the emergency control and the protective lead together when offline (Today)", async ({ page, context }) => {
  await openToday(page, "en", "night", null);
  await expect(page.locator('[data-level-sign][data-kind="live"]')).toHaveCount(1);
  await context.setOffline(true);
  await expect(page.locator("[data-protective-lead]")).toBeVisible();
  await expect(page.locator("[data-emergency]")).toBeVisible();
  await context.setOffline(false);
});

// ---- The Urdu hero shares the architect left open: RECORDED exceptions, with the real numbers, never silent (F2 W2) ----------
//
// Live states have the spine as their hero (the level sign and the action lead stand above it). In Urdu every text row is 2.5 lines
// tall, so a partial state (a banner above the sign) pushes the spine's top below the 35 % mark of the fold. It is held to the number
// measured when it was recorded (a floor that can only go up), not to 35 %: a ruling of the architect is still open for it. The ideal
// and personal states meet 35 % (the Urdu word trim measured in the Nastaliq face took personal from 31.8 % to above the floor), and
// the fallback's hero is the protective lead now (asserted above).
const RECORDED_UR_EXCEPTIONS = { partial: 0.283 } as const;
const RECORDED_TOLERANCE = 0.01;

const PROFILE = {
  consentVersion: "2026-11-11",
  consentedAt: "2026-09-01T08:30:00.000Z",
  siteId: SITE_DEMO,
  crewId: "crew-b",
  workloadClass: "moderate",
  heatWorkStartDate: "2026-09-03",
  clothingCode: "work_clothes",
};

// "partial": a profile on the phone and a risk policy the API cannot give (503), so the personal level cannot be worked out and the
// screen says why above the site's level. The forecast itself answers, so the scenario header ("unavailable" fails every read) is not used.
for (const [state, policyDown] of [
  ["personal", false],
  ["partial", true],
] as const) {
  const recorded = state === "partial" ? RECORDED_UR_EXCEPTIONS.partial : null;
  const title = recorded === null ? `Today, Urdu, ${state}: the hero holds the 35% floor (Today)` : `Today, Urdu, ${state}: the hero share is a recorded exception (${(recorded * 100).toFixed(1)}%) and never lower (Today)`;
  test(title, async ({ page }) => {
    await page.addInitScript((stored) => {
      localStorage.setItem("sb-profile-v1", stored);
    }, JSON.stringify({ state: { profile: PROFILE, push: null, site: { siteId: SITE_DEMO, crewId: "crew-b" } }, version: 1 }));
    if (policyDown) {
      await page.route("**/api/v1/risk-policy", (route) =>
        route.fulfill({
          status: 503,
          contentType: "application/problem+json",
          body: JSON.stringify({ type: "urn:stellar-blaze:problem:dependency-unavailable", title: "Dependency unavailable", status: 503 }),
        }),
      );
    }
    const errors = await openToday(page, "ur", "night", null);
    // The 503 is the state, not a defect of the page.
    const unexpected = errors.filter((message) => !/503|risk-policy|Failed to load resource/.test(message));
    await expect(page.locator("[data-level-sign]").first()).toBeVisible();
    await page.waitForLoadState("networkidle");
    const report = await gate(page, unexpected, { hero: recorded === null, spine: true, locale: "ur" }, `${state}-ur-night`);
    if (recorded !== null) expect(report.heroShare ?? 0, `${state}: a recorded exception, never below what was recorded`).toBeGreaterThanOrEqual(recorded - RECORDED_TOLERANCE);
  });
}

// ---- The Urdu level words in the face that ships: ink never touches the rows around the word (F2 W2) --------------------------
//
// `--sign-word-trim` pulls the blank above and below the 64 px word out of the layout (negative block margin on the word row). It was
// measured in the fallback Naskh; the face that ships is Noto Nastaliq Urdu, whose words reach differently. This measures the ink of
// each of the four Urdu level words (canvas ink against the DOM baseline, in the real loaded font) and asks for 8 px between it and
// the kicker row above and the scale below.
test("Today's Urdu level words keep clear of the rows around them in the Nastaliq face (Today)", async ({ page }) => {
  await openToday(page, "ur", "night", null);
  await expect(page.locator("[data-level-word]").first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const clearances = await page.evaluate(async (names) => {
    const word = document.querySelector("[data-level-word]") as HTMLElement;
    const sign = word.closest("[data-level-sign]") as HTMLElement;
    const style = getComputedStyle(word);
    const font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const context = document.createElement("canvas").getContext("2d") as CanvasRenderingContext2D;
    const result: Record<string, { top: number; bottom: number }> = {};
    for (const [level, text] of Object.entries(names)) {
      word.textContent = text;
      await document.fonts.load(font, text);
      context.font = font;
      context.direction = "rtl";
      const ink = context.measureText(text);
      const probe = document.createElement("span");
      probe.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline";
      word.appendChild(probe);
      const baseline = probe.getBoundingClientRect().top;
      probe.remove();
      const above = (sign.firstElementChild as HTMLElement).getBoundingClientRect().bottom;
      const below = (word.parentElement?.nextElementSibling as HTMLElement).getBoundingClientRect().top;
      result[level] = { top: baseline - ink.actualBoundingBoxAscent - above, bottom: below - (baseline + ink.actualBoundingBoxDescent) };
    }
    return result;
  }, ur.levels.name);
  for (const [level, gap] of Object.entries(clearances)) {
    expect(gap.top, `${level}: ink to the kicker row`).toBeGreaterThanOrEqual(8);
    expect(gap.bottom, `${level}: ink to the scale`).toBeGreaterThanOrEqual(8);
  }
  console.log(`urdu word clearance (px): ${JSON.stringify(clearances)}`);
});
