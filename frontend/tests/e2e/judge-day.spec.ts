import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { gateReport, watchConsole } from "./gate.ts";

/*
 * The day zoom (/en/replay/day) in a production build. The production build has no scored day file (the single scoring run has
 * not written one), so the specs exercise the honest state the live site is in today: the raw forecast of the replay day is
 * drawn, "ours" and station truth say they come from the scoring run, and the four counters are ### under one banner. The scored
 * state needs a day file and is covered by the unit tests over the synthetic shape fixtures and by the design-gate screenshots,
 * which run the dev server with SB_SHAPE_FIXTURES=1. Every title contains "day page", so `pnpm e2e -g "day page"` selects them.
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
  await expect(page.locator("[data-day-shown=pending]")).toContainText("3 Sep");
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
  await expect(table.locator("tbody tr", { hasText: "12:00" })).toContainText("from 12:30");
});

test("day page renders with the API stopped: it makes no API request", async ({ page }) => {
  const api: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) api.push(request.url());
  });
  await page.route("**/api/**", (route) => route.abort());
  const errors = await open(page);
  await expect(page.locator("[data-series=raw]")).toBeVisible();
  expect(api).toEqual([]);
  expect(errors).toEqual([]);
});

for (const [name, viewport] of [
  ["1440", JUDGE],
  ["390", PHONE],
] as const) {
  test(`day page design gate, pending state, ${name} wide`, async ({ page }) => {
    const errors = await open(page, viewport);
    const report = await gateReport(page, { consoleErrors: errors, hero: viewport === JUDGE, spine: false, locale: "en" });
    await test.info().attach("gate-report.json", { body: JSON.stringify(report, null, 2), contentType: "application/json" });
    note(test.info().title, report);
    expect(report.failures).toEqual([]);
    expect(report.axeViolations).toEqual([]);
    if (viewport === JUDGE) expect(report.heroShare ?? 0).toBeGreaterThanOrEqual(0.35);
    await expect(page.locator("[data-counter-pending]")).toHaveCount(4);
    await shot(page, "pending", viewport);
  });
}
