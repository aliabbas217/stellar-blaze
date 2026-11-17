import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { gateReport, watchConsole } from "./gate.ts";

/*
 * The day zoom (/en/replay/day) in a production build, which ships the held-out 2026 files (data/eval/2026): the day is the one
 * demo_day.json says (14 June 2026, the day before the midday break comes into force, so the break is drawn as a labelled dashed
 * outline), the chart draws raw forecast, ours (5 to 95 %), station truth and the limit, and the five counters (both thetas) each
 * carry a proof chip. The pending state (no day file) and the unreadable-file state are covered by the unit tests and by the
 * design-gate captures that run the dev server (SB_SHAPE_FIXTURES=1, SB_EVAL_DATA_ROOT). Every title contains "day page", so
 * `pnpm e2e -g "day page"` selects them.
 * Screenshots are written only when SB_GATE_SHOTS names a directory (the design gate run), never in a normal e2e run.
 */

const JUDGE = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const PATH = "/en/replay/day";

async function open(page: Page, viewport = JUDGE): Promise<string[]> {
  const errors = watchConsole(page);
  await page.setViewportSize(viewport);
  await page.goto(PATH);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  return errors;
}

async function shot(page: Page, name: string, viewport: { width: number; height: number }): Promise<void> {
  const dir = process.env.SB_GATE_SHOTS;
  if (dir === undefined || dir === "") return;
  const wide = viewport.width === JUDGE.width ? "1440" : "390";
  mkdirSync(dir, { recursive: true });
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.screenshot({ path: path.join(dir, `${name}-${wide}-night.png`), clip: { x: 0, y: 0, width: viewport.width, height: Math.min(height, wide === "390" ? 2400 : 1500) }, fullPage: true });
}

function note(label: string, report: Awaited<ReturnType<typeof gateReport>>): void {
  if (process.env.SB_GATE_SHOTS === undefined || process.env.SB_GATE_SHOTS === "") return;
  const heroPct = report.heroShare === null ? "n/a" : (report.heroShare * 100).toFixed(1);
  console.log(`GATE ${label}: hero ${heroPct}% overflow ${String(report.overflowPx)}px minText ${String(report.minTextPx)}px minTarget ${String(report.minTargetPx)}px axe ${String(report.axeViolations.length)} failures ${String(report.failures.length)}`);
}

test("day page keyboard: chart table toggle and day rule drawer", async ({ page }) => {
  await open(page);
  await expect(page.locator("[data-day-shown=scored]")).toContainText("Sun 14 Jun");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("One day, hour by hour: 14 June 2026");
  // the rule button is the page's one primary action and opens the proof drawer
  const rule = page.getByRole("button", { name: "Read the day rule" });
  await expect(rule).toBeVisible();
  await expect(page.locator("[data-primary]")).toHaveCount(1);
  // keyboard only: Tab reaches the button, Enter opens the dialog, Escape closes it and focus comes back
  await rule.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("The scored day and how it is chosen");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(rule).toBeFocused();
  // the table alternative opens from the keyboard and lists the hours
  const toggle = page.getByText("Show the hours as a table");
  await toggle.focus();
  await page.keyboard.press("Enter");
  const table = page.locator("[data-day-table] table");
  await expect(table).toBeVisible();
  await expect(table.locator("tbody tr")).toHaveCount(16);
  // 14 June is the day before the break comes into force: no hour is marked "in the break"; the hours have the three series
  const hour = table.locator("tbody tr", { hasText: "13:00" });
  await expect(hour).toContainText(/\d\d\.\d to \d\d\.\d/);
  await expect(table.locator("tbody tr", { hasText: "yes" })).toHaveCount(0);
});

test("day page renders with the API stopped: it makes no API request", async ({ page }) => {
  const api: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) api.push(request.url());
  });
  await page.route("**/api/**", (route) => route.abort());
  const errors = await open(page);
  await expect(page.locator("[data-series=raw]")).toBeVisible();
  await expect(page.locator("[data-series=ours]")).toBeVisible();
  await expect(page.locator("[data-series=truth]")).toBeVisible();
  expect(api).toEqual([]);
  expect(errors).toEqual([]);
});

for (const [name, viewport] of [
  ["1440", JUDGE],
  ["390", PHONE],
] as const) {
  test(`day page design gate, scored state, ${name} wide`, async ({ page }) => {
    const errors = await open(page, viewport);
    const report = await gateReport(page, { consoleErrors: errors, hero: viewport === JUDGE, spine: false, locale: "en" });
    await test.info().attach("gate-report.json", { body: JSON.stringify(report, null, 2), contentType: "application/json" });
    note(test.info().title, report);
    expect(report.failures).toEqual([]);
    expect(report.axeViolations).toEqual([]);
    if (viewport === JUDGE) expect(report.heroShare ?? 0).toBeGreaterThanOrEqual(0.35);
    await expect(page.locator("[data-counter-id]")).toHaveCount(6);
    await expect(page.locator("[data-counter-pending]")).toHaveCount(0);
    await shot(page, "ideal", viewport);
  });

  test(`day page counters carry both thetas and the not-in-force outline is named in words, ${name} wide`, async ({ page }) => {
    await open(page, viewport);
    const counters = page.locator("[data-day-counters]");
    // whole hours, out of the 7 the station recorded; the label names the way to warn (the fixed 32 °C rule warned about all 7, the regulator's zones 5)
    await expect(counters.locator("[data-counter-id=high]")).toContainText("7");
    await expect(counters.locator("[data-counter-id=p1]")).toContainText("7 of 7");
    await expect(counters.locator("[data-counter-id=raw]")).toContainText("5 of 7");
    await expect(counters.locator("[data-counter-id=raw]")).toContainText("Warned about by the regulator's zones, raw forecast");
    await expect(counters.locator("[data-counter-id=ours]")).toContainText("6 of 7");
    await expect(counters.locator("[data-counter-id=balanced]")).toContainText("5 of 7");
    await expect(counters).not.toContainText(/\d\.0(?!\d)/);
    for (const id of ["high", "outside", "p1", "raw", "ours", "balanced"]) await expect(counters.locator(`[data-counter-id=${id}] [data-proof-id]`)).toHaveCount(1);
    // the break is not in force on 14 June: a dashed outline, named in the legend where a phone can read it
    await expect(page.locator("[data-slot=outline]")).toHaveCount(1);
    await expect(page.locator("[data-legend-item=outline]")).toContainText("Midday break by law: not in force until 15 Jun");
    // no truncated slot label ("Midd...") anywhere in the chart
    expect(await page.locator("[data-slot] .truncate").count()).toBe(0);
  });
}
