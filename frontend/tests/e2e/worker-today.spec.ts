import { expect, test, type Page } from "@playwright/test";
import en from "../../messages/en.json";
import ur from "../../messages/ur.json";
import { SITE_DEMO } from "../../src/mocks/fixtures.ts";
import { gateReport, watchConsole, type GateOptions, type GateReport } from "./gate.ts";
import { withScenario, type Scenario } from "./helpers/scenario.ts";

/*
 * The worker's Today screen (F2 Task 16) in a production build against the mock API. Every title contains "Today", so
 * `pnpm e2e -g Today` selects them. States are driven through the API scenario header (helpers/scenario.ts); the theme is
 * chosen the way a worker chooses it, by the stored override the inline script reads before paint.
 *
 * The gate test runs `gateReport` (tests/e2e/gate.ts) on each state at 390 x 844: console clean, no horizontal overflow, text
 * and targets at the field sizes, axe, the hero's share of the first fold, one primary action, a spine where there is one.
 */

const PHONE = { width: 390, height: 844 };
const PIN = `?site=${SITE_DEMO}&crew=crew-b`;

type Theme = "night" | "sun";
type Locale = "en" | "ur";

interface Opening {
  readonly locale?: Locale;
  readonly theme?: Theme;
  readonly scenario?: Scenario;
  readonly query?: string;
}

/** Opens Today as a phone: the scenario, the theme override (before paint) and the viewport set, the console watched. */
async function openToday(page: Page, { locale = "en", theme = "sun", scenario, query = PIN }: Opening = {}): Promise<string[]> {
  const errors = watchConsole(page);
  await page.setViewportSize(PHONE);
  await withScenario(page, scenario ?? null);
  await page.addInitScript((chosen) => {
    localStorage.setItem("sb-theme", JSON.stringify({ theme: chosen, until: Date.now() + 6 * 3_600_000 }));
  }, theme);
  await page.goto(`/${locale}/worker${query}`);
  await expect(page.getByRole("heading", { level: 1, name: (locale === "en" ? en : ur).worker.today.title })).toBeAttached();
  return errors;
}

test("QR-less demo entry reaches a level in two taps (Today)", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto("/en");
  // Tap one: the worker role on the landing page. Tap two: the demo yard.
  await page.getByRole("link", { name: en.shell.roleChooser.worker.title }).click();
  await expect(page).toHaveURL(/\/en\/worker$/);
  await expect(page.getByRole("heading", { name: en.worker.today.entry.title })).toBeVisible();
  await page.getByRole("button", { name: en.worker.today.entry.demo }).click();

  await expect(page.getByRole("heading", { name: en.levels.name.orange, level: 2 })).toBeVisible();
  // The phone is pinned to the demo yard and its scored crew; the header says so and a reload stays there.
  await expect(page.getByRole("banner")).toContainText("Mussafah");
  await expect(page.getByRole("banner")).toContainText("Crew B");
  await page.reload();
  await expect(page.getByRole("heading", { name: en.levels.name.orange, level: 2 })).toBeVisible();
});

test("out of season Today has no slot (Today)", async ({ page }) => {
  await openToday(page, { scenario: "offseason" });
  await expect(page.getByText("No midday break by law after 15 Sep")).toBeVisible();
  await expect(page.locator("[data-spine]")).toHaveAttribute("data-ban", "not-in-force");
  await expect(page.locator("[data-slot]")).toHaveCount(0);
  await expect(page.getByText(/Break in/)).toHaveCount(0);

  // The same crew on the replay day, inside the season, has the slot: the difference is the data, not the screen.
  await openToday(page);
  await expect(page.locator("[data-spine]")).toHaveAttribute("data-ban", "in-force");
  await expect(page.locator("[data-slot]")).toHaveCount(1);
  await expect(page.getByText("Break in 1 h 20 min")).toBeVisible();
});

test("sun mode follows the replay clock and the toggle overrides until midnight (Today)", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto(`/en/worker${PIN}`);
  // Replay is daytime by construction: sun, and the header clock is the replay moment, not the machine's.
  await expect(page.locator("html")).toHaveAttribute("data-theme", "sun");
  await expect(page.getByRole("banner").locator('bdi[dir="ltr"]')).toContainText("11:10");

  const toggle = page.getByRole("banner").getByRole("button", { name: /Sun mode/ });
  await expect(toggle).toHaveText("Sun mode: on");
  await toggle.click();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", "sun");

  // The choice is kept until the next local midnight: it survives a reload, and the stored time is that midnight.
  await page.reload();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", "sun");
  const stored = await page.evaluate(() => {
    const override = JSON.parse(localStorage.getItem("sb-theme") ?? "null") as { theme: string; until: number } | null;
    const midnight = new Date();
    midnight.setHours(24, 0, 0, 0);
    return { theme: override?.theme, untilIsNextMidnight: override?.until === midnight.getTime() };
  });
  expect(stored).toEqual({ theme: "night", untilIsNextMidnight: true });

  // ?at= moves the replay clock (and nothing else about the theme).
  await page.goto(`/en/worker${PIN}&at=09:30`);
  await expect(page.getByRole("banner").locator('bdi[dir="ltr"]')).toContainText("09:30");
});

test("the Today level is the site's, live, with the action and the draft label (Today)", async ({ page }) => {
  await openToday(page);
  await expect(page.getByRole("heading", { name: en.levels.name.orange, level: 2 })).toBeVisible();
  await expect(page.getByText("Work 20 min, rest 40 min in shade")).toBeVisible();
  await expect(page.getByText(en.worker.today.draftWording)).toBeVisible();
  await expect(page.locator('[data-level-sign][data-kind="live"]')).toHaveCount(1);
  // The one primary action while push is off, to Alerts, and the unwell dock is not counted as a second.
  await expect(page.locator("[data-primary]")).toHaveCount(1);
  await expect(page.getByRole("link", { name: en.worker.today.turnOnWarnings })).toHaveAttribute("href", "/en/worker/alerts");
  await expect(page.locator("[data-emergency]")).toHaveCount(1);
});

test("Today shows a stale forecast as the protective plan, with the last known level secondary, never as live (Today)", async ({ page }) => {
  await openToday(page, { scenario: "stale" });
  // The lead is the hero (F2 W3.2): B3's "No fresh forecast: protective plan", a polite status region. The sign shows the protective
  // level, dashed; the level the forecast last gave is a dashed mini sign inside the lead with its time and age.
  await expect(page.getByRole("status").filter({ hasText: en.worker.today.kicker.fallback })).toBeVisible();
  await expect(page.locator('[data-protective-lead] [data-level-sign][data-kind="stale"]').getByText(en.worker.today.kicker.stale)).toBeVisible();
  await expect(page.locator('[data-protective-lead] [data-level-sign][data-size="hero"] [data-level-word]')).toHaveText(en.levels.name.orange);
  await expect(page.getByText(/Updated .* ago\./)).toBeVisible();
  await expect(page.locator('[data-level-sign][data-kind="stale"]')).toHaveCount(1);
  await expect(page.locator('[data-level-sign][data-kind="live"]')).toHaveCount(0);
});

test("Today shows the protective plan and the protective level for a fallback forecast, never a live level (Today)", async ({ page }) => {
  await openToday(page, { scenario: "fallback" });
  await expect(page.getByRole("heading", { name: en.worker.today.kicker.fallback, level: 2 })).toBeVisible();
  await expect(page.getByRole("heading", { name: en.levels.name.orange, level: 2 })).toBeVisible();
  await expect(page.getByText(en.worker.today.lead.protective)).toBeVisible();
  await expect(page.locator('[data-level-sign][data-kind="live"]')).toHaveCount(0);
});

test("Today says what to do offline, from what the phone saved (Today)", async ({ page, context }) => {
  await openToday(page);
  await expect(page.getByRole("heading", { name: en.levels.name.orange, level: 2 })).toBeVisible();
  await context.setOffline(true);
  await expect(page.getByText(en.states.offlineBanner.title)).toBeVisible();
  await expect(page.locator('[data-level-sign][data-kind="stale"]')).toHaveCount(1);
  // The unwell link is a safety action: still there, still a link.
  await expect(page.locator("[data-emergency]")).toBeVisible();
});

test("Today with no shift keeps the site level and says why there is no plan (Today)", async ({ page }) => {
  await openToday(page, { scenario: "noshift" });
  await expect(page.getByRole("heading", { name: "No shift for Crew B today" })).toBeVisible();
  await expect(page.getByRole("heading", { name: en.levels.name.orange, level: 2 })).toBeVisible();
  await expect(page.locator("[data-spine]")).toHaveCount(0);
});

test("Today shows the site rules and the request id when the forecast cannot be had (Today)", async ({ page }) => {
  await openToday(page, { scenario: "error" });
  await expect(page.getByText(en.worker.today.errorRules)).toBeVisible();
  await expect(page.getByRole("button", { name: en.states.retry })).toBeVisible();
  await expect(page.getByText("mock-req-1")).toBeVisible();
});

/** The gate for one state: what `gateReport` measured is attached to the test (and printed), and any failure fails it. */
async function gate(page: Page, errors: string[], options: Omit<GateOptions, "consoleErrors" | "field">, label: string): Promise<GateReport> {
  // The API fails on purpose in the error state: its 500 is the state, not a defect of the page.
  const consoleErrors = errors.filter((message) => !/^HTTP 500 .*\/api\/v1\//.test(message));
  await page.evaluate(() => document.fonts.ready);
  const report = await gateReport(page, { consoleErrors, field: true, ...options });
  await test.info().attach(`gate-${label}.json`, { body: JSON.stringify(report, null, 2), contentType: "application/json" });
  console.log(`gate ${label}: hero=${report.heroShare === null ? "-" : `${(report.heroShare * 100).toFixed(1)}%`} minText=${String(report.minTextPx)} minTarget=${report.minTargetPx.toFixed(0)} overflow=${String(report.overflowPx)} label=${String(report.minFieldLabelPx)}`);
  expect(report.failures, label).toEqual([]);
  return report;
}

for (const locale of ["en", "ur"] as const) {
  for (const theme of ["night", "sun"] as const) {
    test(`Today passes the design gate at 390: the level and spine, ${locale}, ${theme}`, async ({ page }) => {
      const errors = await openToday(page, { locale, theme });
      await expect(page.locator('[data-level-sign][data-kind="live"]')).toHaveCount(1);
      // Urdu too (F2 W1, I6): the hero's share of the fold is asserted in every language. The word is 64 px in Arabic script at the
      // Nastaliq line height of 2.5, the kicker and "until" share one row and the site name takes two lines at most; before that
      // the Urdu day was 29.6 % of the fold, under the 35 % the gate asks, and the check was waived for it.
      await gate(page, errors, { hero: true, spine: true, locale }, `ideal-${locale}-${theme}`);
    });
  }
}

const GATED: readonly { name: string; scenario: Scenario; hero: boolean; spine: boolean }[] = [
  { name: "stale", scenario: "stale", hero: true, spine: true },
  { name: "fallback", scenario: "fallback", hero: true, spine: true },
  { name: "offseason", scenario: "offseason", hero: true, spine: true },
  { name: "noshift", scenario: "noshift", hero: false, spine: false },
  { name: "error", scenario: "error", hero: false, spine: false },
];

for (const { name, scenario, hero, spine } of GATED) {
  test(`Today passes the design gate at 390: ${name}, en, night and sun`, async ({ page }) => {
    for (const theme of ["night", "sun"] as const) {
      const errors = await openToday(page, { theme, scenario });
      await expect(page.locator("main")).toBeVisible();
      await page.waitForLoadState("networkidle");
      await gate(page, errors, { hero, spine, locale: "en" }, `${name}-en-${theme}`);
    }
  });
}

// The not-live states (stale, offline, fallback) in all six locales, including their hero floor, are in worker-today-notlive.spec.ts
// (F2 W3.2): the protective-plan lead is their hero. The Urdu exceptions that were recorded here are replaced there.

test("Today puts the action lead directly under the sign, in the first fold, in English and Urdu (Today)", async ({ page }) => {
  for (const locale of ["en", "ur"] as const) {
    await openToday(page, { locale });
    await expect(page.locator('[data-level-sign][data-kind="live"]')).toHaveCount(1);
    const boxes = await page.evaluate(() => {
      const box = (selector: string) => {
        const rect = document.querySelector(selector)?.getBoundingClientRect();
        return rect === undefined ? null : { top: rect.top, bottom: rect.bottom };
      };
      return { sign: box("[data-level-sign]"), lead: box("[data-action-lead]"), spine: box("[data-spine]"), fold: window.innerHeight };
    });
    expect(boxes.sign, `${locale}: sign`).not.toBeNull();
    expect(boxes.lead, `${locale}: lead`).not.toBeNull();
    expect(boxes.spine, `${locale}: spine`).not.toBeNull();
    // Sign, then lead, then spine; the lead is inside the first fold (it was at 1010 px of 844 before).
    expect(boxes.lead?.top ?? 0, `${locale}: lead below the sign`).toBeGreaterThanOrEqual(boxes.sign?.bottom ?? 0);
    expect(boxes.spine?.top ?? 0, `${locale}: spine below the lead`).toBeGreaterThanOrEqual(boxes.lead?.bottom ?? 0);
    expect(boxes.lead?.bottom ?? 9999, `${locale}: lead inside the first fold`).toBeLessThanOrEqual(boxes.fold);
  }
});

test("Today asks for the risk policy only on a phone that holds a profile, and the site's level never waits for it (Today)", async ({ page }) => {
  // F2 W1, C1: the on-device pipeline (the profile store, the NIOSH limits, the personal level) is loaded after the first paint, and
  // only when the phone says it has a profile. A phone with none must not fetch the code or the policy it would be used with.
  const policy: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/v1/risk-policy") policy.push(request.url());
  });
  await openToday(page);
  await expect(page.getByRole("heading", { name: en.levels.name.orange, level: 2 })).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(policy, "no profile, no policy request").toEqual([]);

  // The same phone with a saved profile: the policy is asked for and a personal level can appear (day 0 of heat work is above the site's).
  const profile = {
    consentVersion: "2026-11-11",
    consentedAt: "2026-09-01T08:30:00.000Z",
    siteId: SITE_DEMO,
    crewId: "crew-b",
    workloadClass: "moderate",
    heatWorkStartDate: "2026-09-03",
    clothingCode: "work_clothes",
  };
  await page.addInitScript((stored) => {
    localStorage.setItem("sb-profile-v1", stored);
  }, JSON.stringify({ state: { profile, push: null, site: { siteId: SITE_DEMO, crewId: "crew-b" } }, version: 1 }));
  await page.goto(`/en/worker${PIN}`);
  await expect(page.getByRole("heading", { name: en.levels.name.red, level: 2 })).toBeVisible();
  expect(policy.length, "a profile asks for the policy").toBeGreaterThanOrEqual(1);
});

test("Today draws a last known level as secondary: no heat in the spine, no line at now, the protective plan as the lead (Today)", async ({ page }) => {
  await openToday(page, { scenario: "stale" });
  await expect(page.locator('[data-level-sign][data-kind="stale"]')).toHaveCount(1);
  await expect(page.getByText(en.worker.today.kicker.fallback)).toBeVisible();
  await expect(page.getByText(en.worker.today.lead.protective)).toBeVisible();
  await expect(page.getByText(en.worker.today.also.heading)).toHaveCount(0);
  await expect(page.locator('[data-spine] [data-cell][data-heat="data"]')).toHaveCount(0);
  await expect(page.locator("[data-spine] [data-now]")).toHaveCount(0);
  await expect(page.getByText(/^Work \d+ min, rest/)).toHaveCount(0);
});

test("Today passes the design gate at 390: the empty state, en, night and sun", async ({ page }) => {
  for (const theme of ["night", "sun"] as const) {
    const errors = await openToday(page, { theme, query: "" });
    await expect(page.getByRole("button", { name: en.worker.today.entry.demo })).toBeVisible();
    await gate(page, errors, { hero: false, locale: "en" }, `empty-en-${theme}`);
  }
});
