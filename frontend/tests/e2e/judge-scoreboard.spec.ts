import { expect, test, type Page } from "@playwright/test";
import { gateReport, watchConsole } from "./gate.ts";

/*
 * The season scoreboard (/en/replay) and the proof sheet (/en/replay/proof/<claim>) in a production build. The production
 * build has no 2026 exporter file (the single scoring run has not written them), so these specs exercise the honest state
 * the live site is in today: the recorded season and its counts are real, the Warnings and Plans tables are pending
 * (### under one banner each), the roster frontier is drawn. The ideal state (scored numbers) cannot exist in production
 * without the 2026 files; it is covered by the unit tests over the synthetic shape fixtures and by the design-gate
 * screenshots, which run the dev server with SB_SHAPE_FIXTURES=1.
 * Every title contains "scoreboard" or "proof sheet", so `pnpm e2e -g scoreboard` selects the scoreboard ones.
 */

const JUDGE = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const SEASON_DAYS = 139;

async function open(page: Page, path: string, viewport = JUDGE): Promise<string[]> {
  const errors = watchConsole(page);
  await page.setViewportSize(viewport);
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  return errors;
}

test("scoreboard final frame at first paint: the whole season is drawn and Play is not playing", async ({ page }) => {
  await open(page, "/en/replay");
  const ribbon = page.locator("figure[data-ribbon]").first();
  await expect(ribbon).toBeVisible();
  await expect(ribbon).toHaveAttribute("data-upto", String(SEASON_DAYS - 1));
  const play = page.getByRole("button", { name: "Play the season" });
  await expect(play).not.toHaveAttribute("aria-pressed");
  // the tally is the finished one, from the recorded forecast file
  const tally = page.locator("[data-tally]");
  await expect(tally.getByText("1,624")).toBeVisible();
  await expect(tally.getByText("279")).toBeVisible();
  await expect(tally.getByText("139", { exact: true })).toBeVisible();
  // and it stays there: nothing autoplays
  await page.waitForTimeout(1200);
  await expect(ribbon).toHaveAttribute("data-upto", String(SEASON_DAYS - 1));
});

test("scoreboard Play runs the season, Pause stops it, and reduced motion lands on the final frame", async ({ page }) => {
  // A Windows host with animation effects off reports reduced motion to the desktop browser; this test chooses its own.
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await open(page, "/en/replay");
  const ribbon = page.locator("figure[data-ribbon]").first();
  // Pressing Play before React is attached does nothing (the flake): wait for the island to say it has hydrated.
  await expect(page.locator("[data-primary][data-hydrated=true]")).toBeVisible();
  await page.getByRole("button", { name: "Play the season" }).click();
  await expect(page.getByRole("button", { name: "Pause" })).not.toHaveAttribute("aria-pressed");
  await expect.poll(async () => Number(await ribbon.getAttribute("data-upto")), { timeout: 4000 }).toBeLessThan(SEASON_DAYS - 1);
  await page.getByRole("button", { name: "Pause" }).click();
  const paused = await ribbon.getAttribute("data-upto");
  await page.waitForTimeout(600);
  await expect(ribbon).toHaveAttribute("data-upto", paused ?? "");
  await expect(page.getByRole("button", { name: "Resume" })).toBeVisible();

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator("[data-primary][data-hydrated=true]")).toBeVisible();
  await page.getByRole("button", { name: "Play the season" }).click();
  await expect(ribbon).toHaveAttribute("data-upto", String(SEASON_DAYS - 1));
  await expect(page.getByText("Animation is off on this device, so the whole season is shown.")).toBeVisible();
});

test("scoreboard renders with the API stopped: the page makes no API request at all", async ({ page }) => {
  const api: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) api.push(request.url());
  });
  await page.route("**/api/**", (route) => route.abort());
  const errors = await open(page, "/en/replay");
  await expect(page.locator("figure[data-ribbon]").first()).toBeVisible();
  await expect(page.locator("[data-tally]").getByText("1,624")).toBeVisible();
  expect(api).toEqual([]);
  // the only console noise allowed is none: an aborted API call would be logged
  expect(errors).toEqual([]);
});

test("scoreboard pending state: one banner per table, ### in every cell, no proof inside a table", async ({ page }) => {
  await open(page, "/en/replay");
  await expect(page.locator("table[data-scoreboard=pending]")).toHaveCount(2);
  await expect(page.locator("table[data-scoreboard=pending] [aria-label='not scored yet']")).toHaveCount(16 + 12);
  await expect(page.locator("table [data-proof-id]")).toHaveCount(0);
  await expect(page.getByText(/^Warnings, summer 2026/)).toHaveCount(1);
  await expect(page.getByText(/^Plans, summer 2026/)).toHaveCount(1);
  await expect(page.getByRole("link", { name: "See how a number is proved" })).toHaveAttribute("href", "/en/replay/proof/forecast.hours_over_limit");
  await expect(page.getByText("Chosen from the pre-registered outcome table after the single scoring run.")).toBeVisible();
});

test("scoreboard proof chip opens the drawer with the file's sha, and Escape returns focus to the chip", async ({ page }) => {
  await open(page, "/en/replay");
  const chip = page.locator("[data-tally] [data-proof-id]").first();
  await chip.click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  const sha = drawer.locator("dt", { hasText: "SHA-256" }).locator("xpath=following-sibling::dd[1]");
  await expect(sha.locator("code").first()).toHaveText(/^[0-9a-f]{64}$/);
  await expect(drawer.getByText("static/omaa_2026_ifs_d1_wbgt_hourly.json")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(chip).toBeFocused();
});

test("scoreboard drawer links to the proof sheet and back", async ({ page }) => {
  await open(page, "/en/replay");
  await page.locator("[data-tally] [data-proof-id]").first().click();
  await page.getByRole("dialog").getByRole("link", { name: "Open the proof sheet" }).click();
  await expect(page).toHaveURL(/\/en\/replay\/proof\/forecast\.days_over_limit$/);
  await expect(page.locator("[data-sheet-number]")).toContainText("139");
  await page.getByRole("link", { name: "Back to the scoreboard" }).first().click();
  await expect(page).toHaveURL(/\/en\/replay$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Summer 2026, replayed honestly");
});

test("scoreboard frontier commute lives in the URL and survives a reload", async ({ page }) => {
  await open(page, "/en/replay?commute=60#frontier");
  const slider = page.getByRole("slider", { name: "One-way commute" });
  await expect(slider).toHaveValue("60");
  await expect(page.locator("[data-frontier-chart]")).toHaveAttribute("data-commute", "60");
  await slider.fill("75");
  await expect(page).toHaveURL(/commute=75/);
  await page.reload();
  await expect(page.getByRole("slider", { name: "One-way commute" })).toHaveValue("75");
  // the default commute leaves the URL clean
  await page.getByRole("slider", { name: "One-way commute" }).fill("45");
  await expect(page).not.toHaveURL(/commute=/);
  await expect(page.getByRole("heading", { name: /^At a 45 minute commute the analysis finds no gain on top of the legal default./ })).toBeVisible();
});

test("scoreboard story footer links only to routes that exist and Next goes to the day page", async ({ page }) => {
  await open(page, "/en/replay");
  const nav = page.getByRole("navigation", { name: "Story" });
  await expect(nav.getByText("Step 2 of 5: Scoreboard")).toBeVisible();
  for (const href of await nav.locator("a").evaluateAll((links) => links.map((a) => a.getAttribute("href") ?? ""))) {
    const response = await page.request.get(href);
    expect(response.status(), href).toBeLessThan(400);
  }
  await nav.getByRole("link", { name: "Next: One day" }).click();
  await expect(page).toHaveURL(/\/en\/replay\/day$/);
});

for (const [name, viewport] of [
  ["1440", JUDGE],
  ["390", PHONE],
] as const) {
  test(`scoreboard design gate, pending state, ${name} wide`, async ({ page }) => {
    const errors = await open(page, "/en/replay", viewport);
    const report = await gateReport(page, { consoleErrors: errors, hero: viewport === JUDGE, spine: true, locale: "en" });
    await test.info().attach("gate-report.json", { body: JSON.stringify(report, null, 2), contentType: "application/json" });
    expect(report.failures).toEqual([]);
    expect(report.axeViolations).toEqual([]);
    if (viewport === JUDGE) expect(report.heroShare ?? 0).toBeGreaterThanOrEqual(0.35);
  });
}

test("proof sheet recounts the file in this browser and reports a match", async ({ page }) => {
  await open(page, "/en/replay/proof/forecast.hours_over_limit");
  await expect(page.locator("[data-sheet-number]")).toContainText("1,624");
  await expect(page.locator("[data-timeline] li")).toHaveCount(4);
  await page.getByRole("button", { name: "Recount in this browser" }).click();
  await expect(page.getByText("Matches", { exact: true })).toBeVisible();
});

test("proof sheet for an unknown number is the empty state, with a way to a number that has proof", async ({ page }) => {
  await open(page, "/en/replay/proof/policy.p9.nothing");
  await expect(page.getByRole("heading", { name: "No provenance recorded for this number" })).toBeVisible();
  await expect(page.locator("[data-sheet-number]")).toHaveCount(0);
  await page.getByRole("link", { name: "Open a number that has proof" }).click();
  await expect(page).toHaveURL(/\/en\/replay\/proof\/forecast\.hours_over_limit$/);
  await expect(page.locator("[data-sheet-number]")).toBeVisible();
});

test("proof sheet has a sheet for the frontier readouts the page offers", async ({ page }) => {
  await open(page, "/en/replay/proof/frontier.legalisation.ge30");
  await expect(page.locator("[data-sheet-number]")).toContainText("%");
  await expect(page.getByText("Not a forecast: recorded station observations and a roster model.")).toBeVisible();
});

for (const [name, viewport] of [
  ["1440", JUDGE],
  ["390", PHONE],
] as const) {
  test(`proof sheet design gate, ${name} wide`, async ({ page }) => {
    const errors = await open(page, "/en/replay/proof/forecast.hours_over_limit", viewport);
    const report = await gateReport(page, { consoleErrors: errors, hero: false, locale: "en" });
    await test.info().attach("gate-report.json", { body: JSON.stringify(report, null, 2), contentType: "application/json" });
    expect(report.failures).toEqual([]);
  });

  test(`proof sheet design gate, empty state, ${name} wide`, async ({ page }) => {
    const errors = await open(page, "/en/replay/proof/not-a-number", viewport);
    const report = await gateReport(page, { consoleErrors: errors, hero: false, locale: "en" });
    expect(report.failures).toEqual([]);
  });
}
