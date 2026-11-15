import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { gateReport, watchConsole } from "./gate.ts";

/*
 * Try a plan (/en/replay/try) in a production build, against the mock validator behind the BFF. The first paint is the common
 * roster on the replay day with plain controls and no API call; the first tap on a control loads the interactive island. Every
 * title contains "try a plan", so `pnpm e2e -g "try a plan"` selects them. States: idle (first paint), loading (the call held),
 * answer (violations), none (the legal default: 0 rules broken), error (the validator did not answer, recorded result),
 * invalid (a 422 with per-line messages). Failures are made with `page.route` on the one validate request.
 * Screenshots are written only when SB_GATE_SHOTS names a directory (the design gate run), never in a normal e2e run.
 */

const JUDGE = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const PATH = "/en/replay/try";
const CHECK = "Check this plan";

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
  await page.screenshot({ path: path.join(dir, `${name}-${wide}-night.png`), clip: { x: 0, y: 0, width: viewport.width, height: Math.min(height, wide === "390" ? 2600 : 1500) }, fullPage: true });
}

function note(label: string, report: Awaited<ReturnType<typeof gateReport>>): void {
  if (process.env.SB_GATE_SHOTS === undefined || process.env.SB_GATE_SHOTS === "") return;
  const heroPct = report.heroShare === null ? "n/a" : (report.heroShare * 100).toFixed(1);
  console.log(`GATE ${label}: hero ${heroPct}% overflow ${String(report.overflowPx)}px minText ${String(report.minTextPx)}px minTarget ${String(report.minTargetPx)}px axe ${String(report.axeViolations.length)} failures ${String(report.failures.length)}`);
}

const problem = (status: number, extra: Record<string, unknown> = {}) => ({
  status,
  contentType: "application/problem+json",
  body: JSON.stringify({ type: "urn:stellar-blaze:problem:test", title: "Test", status, ...extra }),
});

/** An expected failure of the validate call (the state under test) is not a console error of the page. */
const withoutValidate = (errors: readonly string[]) => errors.filter((message) => !/plans\/validate|status of (422|502)/.test(message));

test("try a plan: common roster shows violations, keyboard only", async ({ page }) => {
  await open(page);
  // keyboard only: focus the check button, Enter: the island loads and the one request is made
  const check = page.getByRole("button", { name: CHECK });
  await check.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-try]")).toHaveAttribute("data-try", "answer");
  const list = page.locator("[data-violations]");
  await expect(list.getByText("P-H3", { exact: true })).toBeVisible();
  await expect(list.getByText("P-H2.daily", { exact: true })).toBeVisible();
  await expect(list).toContainText("Labour Art. 18");
  // the rule that carries no clause shows its id alone
  await expect(list.locator("li", { hasText: "P-H2.daily" }).locator("[data-clause]")).toHaveCount(0);
  await expect(page.getByText("2 rules broken")).toBeVisible();
  // the keyboard reaches the next template and a second check; the legal default breaks nothing
  await page.getByRole("button", { name: /^Legal default/ }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: /^Legal default/ })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: CHECK }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-try]")).toHaveAttribute("data-try", "none");
  await expect(page.getByText("0 rules broken")).toBeVisible();
});

test("try a plan: first load makes no API call; the first focus loads the island and sends nothing", async ({ page }) => {
  const api: string[] = [];
  const posts: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/v1/")) api.push(request.url());
    if (request.method() === "POST") posts.push(request.url());
  });
  await open(page);
  await page.waitForTimeout(800);
  expect(api).toEqual([]);
  await page.getByRole("button", { name: CHECK }).focus();
  await expect.poll(() => api.some((url) => url.includes("/sites"))).toBe(true);
  await expect(page.getByRole("button", { name: CHECK })).toBeFocused();
  await page.waitForTimeout(500);
  expect(posts).toEqual([]);
});

for (const [name, viewport] of [
  ["1440", JUDGE],
  ["390", PHONE],
] as const) {
  test(`try a plan design gate, idle state, ${name} wide`, async ({ page }) => {
    const errors = await open(page, viewport);
    const report = await gateReport(page, { consoleErrors: errors, hero: viewport === JUDGE, spine: false, locale: "en" });
    await test.info().attach("gate-report.json", { body: JSON.stringify(report, null, 2), contentType: "application/json" });
    note(test.info().title, report);
    expect(report.failures).toEqual([]);
    expect(report.axeViolations).toEqual([]);
    if (viewport === JUDGE) expect(report.heroShare ?? 0).toBeGreaterThanOrEqual(0.35);
    await shot(page, "idle", viewport);
  });

  test(`try a plan design gate, answer state, ${name} wide`, async ({ page }) => {
    const errors = await open(page, viewport);
    await page.getByRole("button", { name: CHECK }).click();
    await expect(page.locator("[data-try]")).toHaveAttribute("data-try", "answer");
    const report = await gateReport(page, { consoleErrors: errors, hero: viewport === JUDGE, spine: false, locale: "en" });
    note(test.info().title, report);
    expect(report.failures).toEqual([]);
    expect(report.axeViolations).toEqual([]);
    await shot(page, "answer", viewport);
  });

  test(`try a plan design gate, empty state (0 rules broken), ${name} wide`, async ({ page }) => {
    const errors = await open(page, viewport);
    await page.getByRole("button", { name: /^Legal default/ }).click();
    await expect(page.getByRole("button", { name: /^Legal default/ })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: CHECK }).click();
    await expect(page.locator("[data-try]")).toHaveAttribute("data-try", "none");
    const report = await gateReport(page, { consoleErrors: errors, hero: viewport === JUDGE, spine: false, locale: "en" });
    note(test.info().title, report);
    expect(report.failures).toEqual([]);
    expect(report.axeViolations).toEqual([]);
    await shot(page, "empty", viewport);
  });

  test(`try a plan design gate, loading state, ${name} wide`, async ({ page }) => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/v1/plans/validate", async (route) => {
      await held;
      await route.continue();
    });
    const errors = await open(page, viewport);
    await page.getByRole("button", { name: CHECK }).click();
    await expect(page.locator("[data-try]")).toHaveAttribute("data-try", "loading");
    await expect(page.getByRole("button", { name: CHECK })).toHaveAttribute("aria-busy", "true");
    const report = await gateReport(page, { consoleErrors: errors, hero: viewport === JUDGE, spine: false, locale: "en" });
    note(test.info().title, report);
    expect(report.failures).toEqual([]);
    await shot(page, "loading", viewport);
    release();
    await expect(page.locator("[data-try]")).not.toHaveAttribute("data-try", "loading");
  });

  test(`try a plan design gate, error state with the recorded result, ${name} wide`, async ({ page }) => {
    await page.route("**/api/v1/plans/validate", (route) =>
      route.fulfill(problem(502, { type: "urn:stellar-blaze:problem:upstream-unavailable", title: "Upstream unavailable", request_id: "req-e02b61d9" })),
    );
    const errors = await open(page, viewport);
    await page.getByRole("button", { name: CHECK }).click();
    await expect(page.locator("[data-try]")).toHaveAttribute("data-try", "error");
    await expect(page.locator("[data-notice=error]")).toContainText("req-e02b61d9");
    await page.getByRole("button", { name: "Show a recorded result" }).click();
    await expect(page.locator("[data-recorded]")).toContainText("Recorded");
    // the gate measures the first fold of the page: pressing the buttons scrolled it
    await page.evaluate(() => {
      window.scrollTo(0, 0);
    });
    const report = await gateReport(page, { consoleErrors: withoutValidate(errors), hero: viewport === JUDGE, spine: false, locale: "en" });
    note(test.info().title, report);
    expect(report.failures).toEqual([]);
    expect(report.axeViolations).toEqual([]);
    await shot(page, "error", viewport);
  });

  test(`try a plan design gate, 422 roster-invalid state, ${name} wide`, async ({ page }) => {
    await page.route("**/api/v1/plans/validate", (route) =>
      route.fulfill(problem(422, { type: "urn:stellar-blaze:problem:roster-invalid", title: "Roster invalid", errors: [{ line: 2, message: "end 25:00 is not a time" }] })),
    );
    const errors = await open(page, viewport);
    await page.getByRole("button", { name: CHECK }).click();
    await expect(page.locator("[data-try]")).toHaveAttribute("data-try", "invalid");
    await expect(page.locator("[data-invalid-line='2']")).toContainText("end 25:00 is not a time");
    const report = await gateReport(page, { consoleErrors: withoutValidate(errors), hero: viewport === JUDGE, spine: false, locale: "en" });
    note(test.info().title, report);
    expect(report.failures).toEqual([]);
    await shot(page, "invalid", viewport);
  });
}
