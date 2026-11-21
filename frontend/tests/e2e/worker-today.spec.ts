import { expect, test, type Page } from "@playwright/test";
import ar from "../../messages/ar.json";
import en from "../../messages/en.json";
import ur from "../../messages/ur.json";
import { SITE_DEMO } from "../../src/mocks/fixtures.ts";
import { gateReport, RECORDED_HERO_EXCEPTIONS, RECORDED_HERO_TOLERANCE, watchConsole, type GateOptions, type GateReport } from "./gate.ts";
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
type Locale = "en" | "ur" | "ar";
const MESSAGES = { en, ur, ar } as const;

interface Opening {
  readonly locale?: Locale;
  readonly theme?: Theme;
  readonly scenario?: Scenario;
  readonly query?: string;
  /** The viewport the page is FIRST laid out at (default PHONE): set before the page opens, so the first paint is measured, not a resize. */
  readonly size?: { readonly width: number; readonly height: number };
}

/** Opens the settings sheet from the header's language pill and returns it. */
async function openSettings(page: Page) {
  await page.getByRole("banner").getByRole("button", { name: /Settings|الإعدادات|ترتیبات/ }).click();
  const sheet = page.getByRole("dialog").filter({ has: page.getByRole("heading", { level: 2 }) });
  await expect(sheet).toBeVisible();
  return sheet;
}

/** Opens Today as a phone: the scenario, the theme override (before paint) and the viewport set, the console watched. */
async function openToday(page: Page, { locale = "en", theme = "sun", scenario, query = PIN, size = PHONE }: Opening = {}): Promise<string[]> {
  const errors = watchConsole(page);
  await page.setViewportSize(size);
  await withScenario(page, scenario ?? null);
  await page.addInitScript((chosen) => {
    localStorage.setItem("sb-theme", JSON.stringify({ theme: chosen, until: Date.now() + 6 * 3_600_000 }));
  }, theme);
  await page.goto(`/${locale}/worker${query}`);
  await expect(page.getByRole("heading", { level: 1, name: MESSAGES[locale].worker.today.title })).toBeAttached();
  return errors;
}

test("QR-less demo entry reaches a level in two taps (Today)", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto("/en");
  // Tap one: the worker role on the landing page. A phone with no site is handed on to the join page, which keeps the demo yard as its one
  // quiet option. Tap two: the demo yard.
  await page.getByRole("link", { name: en.shell.roleChooser.worker.title }).click();
  await expect(page).toHaveURL(/\/en\/worker\/join$/);
  await expect(page.getByRole("heading", { level: 1, name: en.worker.join.pageTitle })).toBeVisible();
  await page.getByRole("button", { name: en.worker.join.demo }).click();

  await expect(page.getByRole("heading", { name: en.levels.name.orange, level: 2 })).toBeVisible();
  // The phone is pinned to the demo yard and its scored crew; the header says so and a reload stays there.
  await expect(page.getByRole("banner")).toContainText("Mussafah");
  await expect(page.getByRole("banner")).toContainText("Crew B");
  await page.reload();
  await expect(page.getByRole("heading", { name: en.levels.name.orange, level: 2 })).toBeVisible();
});

test("the why-drawer of Today says where the level comes from in plain words and prints no technical field outside For auditors (Today)", async ({ page }) => {
  await openToday(page);
  await page.getByRole("button", { name: /^Why / }).click();
  const drawer = page.getByRole("dialog", { name: "Where this number comes from" });
  await expect(drawer).toBeVisible();
  for (const row of ["Made by", "About", "It does not show"]) await expect(drawer.getByText(row, { exact: true })).toBeVisible();
  // the worker never meets the ruleset, the configuration or an API operation name in the main layer
  expect(await drawer.innerText()).not.toMatch(/policy=|config=|get_site_forecast|ae-heat|Not recorded/);
  // they are one deliberate step away, behind For auditors, as words
  await drawer.getByText("For auditors: the full record").click();
  await expect(drawer.getByText(/^Ruleset .*, configuration \d+$/)).toBeVisible();
  await expect(drawer.getByText("Script")).toHaveCount(0);
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

test("sun mode follows the replay clock and Screen colors in the settings sheet overrides until midnight (Today)", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto(`/en/worker${PIN}`);
  // Replay is daytime by construction: sun, and the header clock is the replay moment, not the machine's.
  await expect(page.locator("html")).toHaveAttribute("data-theme", "sun");
  await expect(page.getByRole("banner").locator('bdi[dir="ltr"]')).toContainText("11:10");

  // The header has ONE language pill, no "Sun mode" button and no row of chips; Screen colors live in the settings sheet.
  await expect(page.getByRole("banner").getByRole("button", { name: /Sun mode/ })).toHaveCount(0);
  const sheet = await openSettings(page);
  await expect(sheet.getByRole("button", { name: en.shell.settings.colors.auto })).toHaveAttribute("aria-pressed", "true");
  await sheet.getByRole("button", { name: en.shell.settings.colors.night }).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", "sun");
  await expect(sheet.getByRole("button", { name: en.shell.settings.colors.night })).toHaveAttribute("aria-pressed", "true");

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
  // ...and the sheet shows it, and Automatic hands the decision back to the replay clock (sun).
  const again = await openSettings(page);
  await expect(again.getByRole("button", { name: en.shell.settings.colors.night })).toHaveAttribute("aria-pressed", "true");
  await again.getByRole("button", { name: en.shell.settings.colors.auto }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "sun");
  expect(await page.evaluate(() => localStorage.getItem("sb-theme"))).toBeNull();

  // ?at= moves the replay clock (and nothing else about the theme).
  await page.goto(`/en/worker${PIN}&at=09:30`);
  await expect(page.getByRole("banner").locator('bdi[dir="ltr"]')).toContainText("09:30");
});

test("the Today level is the site's, live, with the action and the one clinical note (Today)", async ({ page }) => {
  await openToday(page);
  await expect(page.getByRole("heading", { name: en.levels.name.orange, level: 2 })).toBeVisible();
  await expect(page.getByText("Work 20 min, rest 40 min in shade")).toBeVisible();
  // D5: the clinical note appears ONCE per screen, in its honest words; the old "Draft wording" label is gone.
  await expect(page.getByText(en.worker.today.draftWording)).toHaveCount(1);
  await expect(page.getByText(en.worker.today.draftWording)).toBeVisible();
  await expect(page.getByText(/Draft wording/)).toHaveCount(0);
  await expect(page.locator('[data-level-sign][data-kind="live"]')).toHaveCount(1);
  // Warnings off is a quiet row, not a primary action (to Alerts); the unwell slab is the dock's, not counted.
  await expect(page.locator("[data-primary]")).toHaveCount(0);
  await expect(page.locator("[data-warnings-off]")).toContainText(en.worker.today.warningsOff);
  await expect(page.getByRole("link", { name: en.worker.today.turnOnWarnings })).toHaveAttribute("href", "/en/worker/alerts");
  await expect(page.locator("[data-emergency]")).toHaveCount(1);
  // The employer's duties are not the worker's actions: none of the three is on the screen.
  for (const duty of ["No unacclimatised person to work", "High Risk induction required", "Provide personal water bottle"]) {
    await expect(page.getByText(duty)).toHaveCount(0);
  }
});

/*
 * S17: the control must be reachable on FIRST paint, not only after a scroll. 'Why Orange?' used to be the last row of the page: at 390 x 844
 * its top was at y 749 and the fixed dock (I feel unwell, Today, Alerts) covered it, so a tap at its centre landed on the dock (Alerts or
 * the unwell sheet). The test below does not scroll: it takes the page as it paints and asks the browser what is at the control's centre.
 * (The test above asserts the same after a scroll and by keyboard, which the dock's published height and scroll-padding fix, ADR 0093.)
 */
const FIRST_PAINT_SIZES = [
  { width: 360, height: 740 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 1440, height: 900 },
] as const;

for (const locale of ["en", "ar"] as const) {
  for (const size of FIRST_PAINT_SIZES) {
    test(`the 'Why <level>?' control is the element at its own centre at scroll 0, above the dock, ${locale}, ${String(size.width)} x ${String(size.height)} (Today)`, async ({ page }) => {
      await openToday(page, { locale, size });
      await expect(page.locator('[data-level-sign][data-kind="live"]')).toHaveCount(1);
      await page.waitForLoadState("networkidle");
      await page.evaluate(() => document.fonts.ready);
      const why = page.getByRole("button", { name: locale === "en" ? /^Why .*\?$/ : /^لماذا / });
      await expect(why).toHaveCount(1);
      await expect(page.locator("html")).toHaveAttribute("dir", locale === "ar" ? "rtl" : "ltr");

      const hit = await why.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        const top = document.elementFromPoint(centre.x, centre.y);
        const dock = document.querySelector("[data-emergency]")?.closest(".fixed")?.getBoundingClientRect();
        return {
          scrollY: window.scrollY,
          self: top !== null && element.contains(top),
          what: top === null ? "nothing" : `${top.tagName.toLowerCase()} ${top.textContent.trim().slice(0, 30)}`,
          inFold: centre.y > 0 && centre.y < window.innerHeight && centre.x > 0 && centre.x < window.innerWidth,
          top: box.top,
          bottom: box.bottom,
          height: box.height,
          dockTop: dock?.top ?? Number.POSITIVE_INFINITY,
          inHero: element.closest("[data-hero]") !== null,
          inLevelSign: element.closest("[data-level-sign]") !== null,
        };
      });
      const label = `${locale} ${String(size.width)} x ${String(size.height)}`;
      expect(hit.scrollY, `${label}: measured at scroll 0, without scrolling`).toBe(0);
      expect(hit.inFold, `${label}: the control's centre is inside the first screen`).toBe(true);
      expect(hit.self, `${label}: the element at the centre is the control (it was: ${hit.what})`).toBe(true);
      expect(hit.bottom, `${label}: it ends above the dock (top ${String(hit.dockTop)})`).toBeLessThanOrEqual(hit.dockTop);
      expect(hit.height, `${label}: a 44 px target`).toBeGreaterThanOrEqual(44);
      expect(hit.inHero, `${label}: it is part of the hero, with the level it explains`).toBe(true);
      expect(hit.inLevelSign, `${label}: it is on the level sign's own row`).toBe(true);
    });
  }
}

test("a control near the bottom ('Why Orange?') is the topmost element at its centre once scrolled to, never under the fixed dock, at phone and desktop sizes (Today)", async ({ page }) => {
  await openToday(page);
  const why = page.getByRole("button", { name: /^Why .*\?$/ });
  for (const size of [PHONE, { width: 1440, height: 900 }]) {
    await page.setViewportSize(size);
    await page.evaluate(() => {
      window.scrollTo(0, 0);
    });
    // Scrolling a control into view (a click, the Tab key, a find) must stop above the dock: scroll-padding-bottom takes the dock's height.
    await why.scrollIntoViewIfNeeded();
    const hit = await why.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      const dock = document.querySelector("[data-emergency]")?.closest(".fixed")?.getBoundingClientRect();
      return { self: top !== null && element.contains(top), bottom: box.bottom, dockTop: dock?.top ?? Number.POSITIVE_INFINITY };
    });
    expect(hit.self, `${String(size.width)} px: the control is the topmost element at its centre`).toBe(true);
    expect(hit.bottom, `${String(size.width)} px: it ends above the dock`).toBeLessThanOrEqual(hit.dockTop);
    // And the same by keyboard: Tab from the top of the page scrolls the focused control clear of the dock too.
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      (document.activeElement as HTMLElement | null)?.blur();
    });
    let reached = false;
    for (let presses = 0; presses < 60 && !reached; presses += 1) {
      await page.keyboard.press("Tab");
      reached = await why.evaluate((element) => element === document.activeElement);
    }
    expect(reached, `${String(size.width)} px: Tab reaches the control`).toBe(true);
    const focused = await why.evaluate((element) => element.getBoundingClientRect().bottom);
    expect(focused, `${String(size.width)} px: focus scrolls it above the dock`).toBeLessThanOrEqual(hit.dockTop);
  }
  // A real click opens the drawer (it does not land on Alerts).
  await why.click();
  await expect(page).toHaveURL(/\/en\/worker(\?|$)/);
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("the settings sheet opens from the one language pill, holds six languages, Screen colors and Change crew, and closes with Escape and focus returns (Today)", async ({ page }) => {
  await openToday(page);
  const pill = page.getByRole("banner").getByRole("button", { name: /Settings/ });
  await expect(pill).toContainText("English");
  // No row of six chips under the header any more.
  await expect(page.getByRole("navigation", { name: en.shell.language })).toHaveCount(0);
  const sheet = await openSettings(page);
  await expect(sheet.getByRole("link")).toHaveCount(7);
  await expect(sheet.getByRole("link", { name: en.shell.settings.changeCrew })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(pill).toBeFocused();
  // The language persists as the chips did: a row is a link that loads the page in that language and keeps the pin.
  const again = await openSettings(page);
  await again.getByRole("link", { name: "العربية" }).click();
  await expect(page).toHaveURL(/\/ar\/worker\?site=/);
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
});

test("Change crew lets go of the pin and opens the join page (Today)", async ({ page }) => {
  await openToday(page);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("sb-profile-v1") ?? "")).toContain("crew-b");
  const sheet = await openSettings(page);
  await sheet.getByRole("link", { name: en.shell.settings.changeCrew }).click();
  await expect(page).toHaveURL(/\/en\/worker\/join$/);
  await expect(page.getByRole("heading", { level: 1, name: en.worker.join.pageTitle })).toBeVisible();
  // The old choice is gone from the phone: the join page did not re-pin it from the address that was left.
  await expect(page.getByRole("button", { name: en.worker.join.demo })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("sb-profile-v1") ?? "")).not.toContain("crew-b");
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
      // Urdu too (F2 W1, I6): the hero's share of the fold is asserted in every language. The hero is the level card and the shift
      // strip; the Urdu day (a recorded exception of 33.2 % with the 64 px word and the vertical spine) now measures 75.4 % and meets
      // the 35 % floor, so no exception is recorded for it any more (tests/e2e/gate.ts).
      const recorded = RECORDED_HERO_EXCEPTIONS[`today-live:${locale}`] ?? null;
      const report = await gate(page, errors, { hero: recorded === null, spine: true, locale }, `ideal-${locale}-${theme}`);
      if (recorded !== null) expect(report.heroShare ?? 0, `the Urdu day: a recorded exception, never below what was recorded`).toBeGreaterThanOrEqual(recorded - RECORDED_HERO_TOLERANCE);
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

test("Today puts the action sentence first, then the level, then the shift strip, in the first fold, in English and Urdu (Today)", async ({ page }) => {
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
    // Lead, then sign, then the strip; the lead and the sign are inside the first fold (the answer to "what do I do" comes first).
    expect(boxes.sign?.top ?? 0, `${locale}: sign below the lead`).toBeGreaterThanOrEqual(boxes.lead?.bottom ?? 0);
    expect(boxes.spine?.top ?? 0, `${locale}: strip below the sign`).toBeGreaterThanOrEqual(boxes.sign?.bottom ?? 0);
    expect(boxes.lead?.bottom ?? 9999, `${locale}: lead inside the first fold`).toBeLessThanOrEqual(boxes.fold);
    expect(boxes.sign?.bottom ?? 9999, `${locale}: sign inside the first fold`).toBeLessThanOrEqual(boxes.fold);
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

// The empty state of Today (no site on the phone) is now the join page's: its design gate is in worker-join.spec.ts.
