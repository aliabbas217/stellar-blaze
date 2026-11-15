import { expect, test, type Page } from "@playwright/test";
import en from "../../messages/en.json";
import ur from "../../messages/ur.json";
import { SITE_DEMO } from "../../src/mocks/fixtures.ts";
import { gateReport, watchConsole, type GateOptions } from "./gate.ts";
import { withScenario, type Scenario } from "./helpers/scenario.ts";
import { loadControlled } from "./helpers/service-worker.ts";

/*
 * The alert card (F2 Task 17) in a production build against the mock API: what a tap on a warning opens. Every title contains
 * "alert card", so `pnpm e2e -g "alert card"` selects them. The replay day is 3 Sep 2026 at 11:10 and the mock forecast is Amber
 * at 09:00, Orange from 10:00 to 14:00, Red at 14:00, so a warning "orange from 10:00" is live and "amber from 09:00" is over.
 * The push side (a notification's target url, the tap in the worker's language) is in alerts.spec.ts.
 */

const PHONE = { width: 390, height: 844 };
const ORANGE_FROM_TEN = "2026-09-03T06:00:00Z";
const AMBER_FROM_NINE = "2026-09-03T05:00:00Z";

type Theme = "night" | "sun";
type Locale = "en" | "ur";

function alertPath(locale: Locale, level: string, validFrom: string, target = SITE_DEMO, audience = "site"): string {
  return `/${locale}/worker/alert?audience=${audience}&target=${target}&level=${level}&valid_from=${encodeURIComponent(validFrom)}`;
}

interface Opening {
  readonly locale?: Locale;
  readonly theme?: Theme;
  readonly scenario?: Scenario;
  readonly path?: string;
  /** The phone says it is offline and the forecast cannot be fetched: the card has only what the notification said. */
  readonly offlineNoForecast?: boolean;
}

async function openAlert(page: Page, { locale = "en", theme = "sun", scenario, path, offlineNoForecast = false }: Opening = {}): Promise<string[]> {
  const errors = watchConsole(page);
  await page.setViewportSize(PHONE);
  await withScenario(page, scenario ?? null);
  await page.addInitScript((chosen) => {
    localStorage.setItem("sb-theme", JSON.stringify({ theme: chosen, until: Date.now() + 6 * 3_600_000 }));
  }, theme);
  if (offlineNoForecast) {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
    });
    await page.route("**/api/v1/sites/*/forecast/today", (route) => route.abort("internetdisconnected"));
  }
  await page.goto(path ?? alertPath(locale, "orange", ORANGE_FROM_TEN));
  return errors;
}

test("the alert card shows the level, from when, what changed and what to do, and Got it goes to Today", async ({ page }) => {
  await openAlert(page);
  await expect(page.getByRole("heading", { name: en.levels.name.orange, level: 2 })).toBeVisible();
  await expect(page.getByText(en.worker.alert.kicker.site)).toBeVisible();
  await expect(page.locator("[data-level-sign]").getByText(/from/)).toContainText("10:00");
  await expect(page.getByText("Was Amber, now Orange")).toBeVisible();
  await expect(page.locator("[data-changed-spine]")).toHaveAttribute("data-from", "10");
  await expect(page.locator("[data-changed-spine]")).toHaveAttribute("data-to", "14");
  await expect(page.getByRole("region", { name: en.worker.alert.doNow }).getByRole("listitem")).toHaveCount(3);

  await expect(page.locator("[data-primary]")).toHaveCount(1);
  await page.getByRole("link", { name: en.worker.alert.gotIt }).click();
  // Today: this phone has no site pinned (the tap came from a notification, not from a join), so Today offers the way in.
  await expect(page).toHaveURL(/\/en\/worker$/);
  await expect(page.getByRole("heading", { name: en.worker.today.entry.title })).toBeVisible();
});

test("the alert card for a warning that is over says when it ended, with a way to Today", async ({ page }) => {
  await openAlert(page, { path: alertPath("en", "amber", AMBER_FROM_NINE) });
  await expect(page.getByRole("heading", { name: "This warning ended at 10:00" })).toBeVisible();
  await page.getByRole("link", { name: en.worker.alert.ended.primary }).click();
  await expect(page).toHaveURL(/\/en\/worker$/);
});

test("the alert card sends a link that is not a warning to Today, in the same language", async ({ page }) => {
  await openAlert(page, { locale: "ur", path: "/ur/worker/alert?audience=site&target=x&level=purple&valid_from=soon" });
  await expect(page).toHaveURL(/\/ur\/worker$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "ur");
});

test("the alert card is right to left in Urdu, with the level in the worker's own language", async ({ page }) => {
  await openAlert(page, { locale: "ur" });
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { name: ur.levels.name.orange, level: 2 })).toBeVisible();

  // The frame follows the spine's direction. Red from 14:00 is late in the 06:00 to 18:00 day: right of centre in English, and
  // mirrored, left of centre, in Urdu (the Orange window, 10:00 to 14:00, is centred and could not tell the two apart).
  const centreOfFrame = async (locale: Locale): Promise<number> => {
    await openAlert(page, { locale, path: alertPath(locale, "red", "2026-09-03T10:00:00Z") });
    await expect(page.locator("[data-changed-frame]")).toBeVisible();
    const frame = await page.locator("[data-changed-frame]").boundingBox();
    const spine = await page.locator("[data-changed-spine]").boundingBox();
    if (frame === null || spine === null) throw new Error("the frame or the spine is not drawn");
    return frame.x + frame.width / 2 - (spine.x + spine.width / 2);
  };
  expect(await centreOfFrame("en")).toBeGreaterThan(0);
  expect(await centreOfFrame("ur")).toBeLessThan(0);
});

async function gate(page: Page, errors: string[], options: Omit<GateOptions, "consoleErrors" | "field">, label: string): Promise<void> {
  // The API fails on purpose in the error state, and the forecast is aborted on purpose offline: those are the state.
  // The one more: with the service worker blocked (the offline tests, below) Serwist's client reads a registration it never got.
  const consoleErrors = errors.filter(
    (message) =>
      !/^HTTP 500 .*\/api\/v1\//.test(message) &&
      !/net::ERR_INTERNET_DISCONNECTED/.test(message) &&
      !/Cannot read properties of undefined \(reading 'waiting'\)/.test(message),
  );
  await page.evaluate(() => document.fonts.ready);
  const report = await gateReport(page, { consoleErrors, field: true, ...options });
  await test.info().attach(`gate-${label}.json`, { body: JSON.stringify(report, null, 2), contentType: "application/json" });
  console.log(`gate ${label}: hero=${report.heroShare === null ? "-" : `${(report.heroShare * 100).toFixed(1)}%`} minText=${String(report.minTextPx)} minTarget=${report.minTargetPx.toFixed(0)} overflow=${String(report.overflowPx)} label=${String(report.minFieldLabelPx)}`);
  expect(report.failures, label).toEqual([]);
}

for (const locale of ["en", "ur"] as const) {
  for (const theme of ["night", "sun"] as const) {
    test(`the alert card passes the design gate at 390: ${locale}, ${theme}`, async ({ page }) => {
      const errors = await openAlert(page, { locale, theme });
      await expect(page.getByRole("link", { name: (locale === "en" ? en : ur).worker.alert.gotIt })).toBeVisible();
      await page.waitForLoadState("networkidle");
      // As on Today, the Urdu sign is tall (Nastaliq line height 2.5): the share is measured and printed, asserted in English.
      await gate(page, errors, { hero: locale === "en", spine: true, locale }, `ideal-${locale}-${theme}`);
    });
  }
}

test("the alert card passes the design gate at 390: ended, night and sun", async ({ page }) => {
  for (const theme of ["night", "sun"] as const) {
    const errors = await openAlert(page, { theme, path: alertPath("en", "amber", AMBER_FROM_NINE) });
    await expect(page.getByRole("link", { name: en.worker.alert.ended.primary })).toBeVisible();
    await gate(page, errors, { hero: false, locale: "en" }, `ended-en-${theme}`);
  }
});

test.describe("the alert card offline", () => {
  // No service worker here: the forecast is made to fail by route interception, which a worker's own fetches would bypass (a
  // worker would answer from the network or its cache). Nothing in these tests is about the worker; alerts.spec.ts is.
  test.use({ serviceWorkers: "block" });

  test("the alert card works offline from what the notification said", async ({ page }) => {
    await openAlert(page, { offlineNoForecast: true, path: alertPath("en", "red", "2026-09-03T10:00:00Z") });
    await expect(page.getByRole("heading", { name: en.levels.name.red, level: 2 })).toBeVisible();
    await expect(page.getByText(en.states.offlineBanner.title)).toBeVisible();
    await expect(page.getByText(en.worker.today.lead.siteRules)).toBeVisible();
    await expect(page.getByRole("link", { name: en.worker.alert.gotIt })).toBeVisible();
  });

  test("the alert card passes the design gate at 390: offline, night and sun", async ({ page }) => {
    for (const theme of ["night", "sun"] as const) {
      const errors = await openAlert(page, { theme, offlineNoForecast: true, path: alertPath("en", "red", "2026-09-03T10:00:00Z") });
      await expect(page.getByText(en.states.offlineBanner.title)).toBeVisible();
      await gate(page, errors, { hero: false, locale: "en" }, `offline-en-${theme}`);
    }
  });
});

test.describe("the alert card with the real service worker (F2 W1, I3)", () => {
  // The worker is ACTIVE here: this is the first tap on a warning with no signal, which is the case a heat warning is for. The card
  // is one static page that every warning's query is matched to, so a query nobody has requested before is still answered.
  test("the alert card is precached for every locale, and a notification's query never asks the network for it", async ({ page }) => {
    await loadControlled(page, "/en/worker");
    const cached = await page.evaluate(async () => {
      const found: Record<string, boolean> = {};
      for (const locale of ["en", "ur", "hi", "bn", "ne", "ar"]) {
        found[locale] = (await caches.match(`/${locale}/worker/alert`, { ignoreSearch: true })) !== undefined;
      }
      return found;
    });
    expect(cached).toEqual({ en: true, ur: true, hi: true, bn: true, ne: true, ar: true });
  });

  test("the alert card opens offline from a notification's own url that this phone has never loaded, and shows the warning, not the offline page", async ({
    page,
    context,
  }) => {
    await page.setViewportSize(PHONE);
    // One visit to the app while online (any worker page): that is all the phone has done before the notification arrives.
    await loadControlled(page, "/en/worker");
    await context.setOffline(true);
    // A navigation like the one a tap on a notification makes: a new document, a query this phone has never seen.
    const url = alertPath("en", "red", "2026-09-03T10:00:00Z", "site-never-visited");
    await page.goto(url);
    await expect(page).toHaveURL(new RegExp(String.raw`/en/worker/alert\?audience=site&target=site-never-visited&level=red`));
    await expect(page.getByRole("heading", { name: en.levels.name.red, level: 2 })).toBeVisible();
    await expect(page.getByText(en.states.offlineBanner.title)).toBeVisible();
    await expect(page.getByText(en.worker.today.lead.siteRules)).toBeVisible();
    // Not the offline page: its own heading is absent and the card's action is there.
    await expect(page.getByRole("link", { name: en.worker.alert.gotIt })).toBeVisible();
    await expect(page.getByText(en.worker.alert.kicker.site)).toBeVisible();
  });

  test("a query that is not a warning still opens Today (the check is on the client now)", async ({ page }) => {
    await page.goto("/en/worker/alert?audience=site&level=purple");
    await expect(page).toHaveURL(/\/en\/worker$/);
  });

  test("an urdu worker offline gets the card in Urdu from the same shell", async ({ page, context }) => {
    await page.setViewportSize(PHONE);
    await loadControlled(page, "/ur/worker");
    await context.setOffline(true);
    await page.goto(alertPath("ur", "red", "2026-09-03T10:00:00Z", "site-never-visited"));
    await expect(page.locator('html[lang="ur"][dir="rtl"]')).toHaveCount(1);
    await expect(page.getByRole("heading", { name: ur.levels.name.red, level: 2 })).toBeVisible();
  });
});

test.describe("the alert card when the forecast cannot place the warning (F2 W1, I1)", () => {
  test("never says ended: a Red warning tapped while the forecast is in fallback keeps the level and the site rules", async ({ page }) => {
    for (const theme of ["night", "sun"] as const) {
      const errors = await openAlert(page, { theme, scenario: "fallback", path: alertPath("en", "red", ORANGE_FROM_TEN) });
      await expect(page.getByRole("heading", { name: en.levels.name.red, level: 2 })).toBeVisible();
      await expect(page.getByText(en.worker.alert.notCovered)).toBeVisible();
      await expect(page.getByText(en.worker.today.lead.siteRules)).toBeVisible();
      await expect(page.getByText(/This warning (has )?ended/)).toHaveCount(0);
      await gate(page, errors, { hero: false, locale: "en" }, `uncovered-en-${theme}`);
    }
  });

  test("a warning that starts tomorrow is the same card, never 'ended'", async ({ page }) => {
    await openAlert(page, { path: alertPath("en", "orange", "2026-09-04T06:00:00Z") });
    await expect(page.getByRole("heading", { name: en.levels.name.orange, level: 2 })).toBeVisible();
    await expect(page.getByText(en.worker.alert.notCovered)).toBeVisible();
    await expect(page.getByText(/This warning (has )?ended/)).toHaveCount(0);
  });

  test("the header names the warning's site on a phone that is pinned to none, never 'No site chosen' above a site warning", async ({ page }) => {
    await openAlert(page);
    await expect(page.getByRole("heading", { name: en.levels.name.orange, level: 2 })).toBeVisible();
    await expect(page.getByText(en.shell.field.noSite)).toHaveCount(0);
  });
});
