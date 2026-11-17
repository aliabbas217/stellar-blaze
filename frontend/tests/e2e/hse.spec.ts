import { expect, test } from "@playwright/test";
import en from "../../messages/en.json";
import { SITE_DEMO } from "../../src/mocks/fixtures.ts";
import { gateReport, watchConsole } from "./gate.ts";

/*
 * The safety view and the 3-minute tour (redesign S7), in a production build against the mock API, on the mobile project.
 * Every title starts with "hse" or "tour", so `pnpm e2e -g "hse|tour"` selects them.
 */

const PHONE = { width: 390, height: 844 };
const DESK = { width: 1280, height: 800 };

// The service worker is blocked: it takes over the page after the first load, and a retry of a read made through it would skip `page.route`,
// so the error state could not be held in place long enough to be seen. (These specs do not test the worker; pwa.spec.ts does.)
test.use({ viewport: PHONE, serviceWorkers: "block" });

interface CrewRow {
  readonly id: string;
  readonly name: string;
  readonly stopped: boolean;
  readonly signoff_state: string;
}

test("hse: lists each crew of the demo site with its plan and whether work is stopped, as the API returns it", async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto("/en/hse");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(en.hse.title);
  const table = page.getByRole("table", { name: en.hse.table.caption });
  await expect(table).toBeVisible();
  const crews = (await (await page.request.get(`/api/v1/sites/${SITE_DEMO}/crews`)).json()) as CrewRow[];
  expect(crews.length).toBeGreaterThan(0);
  await expect(table.locator("[data-crew]")).toHaveCount(crews.length);
  for (const crew of crews) {
    const row = table.locator(`[data-crew="${crew.id}"]`);
    await expect(row).toContainText(crew.name);
    await expect(row).toContainText(crew.signoff_state === "signed" ? en.hse.plan.signed : crew.signoff_state === "unsigned" ? en.hse.plan.unsigned : en.hse.plan.changed);
    await expect(row).toContainText(crew.stopped ? en.hse.work.stopped : en.hse.work.running);
  }
  await expect(page.locator("[data-privacy]")).toHaveText(en.hse.privacy);
  const report = await gateReport(page, { consoleErrors: errors, field: true, hero: false, locale: "en" });
  expect(report.failures).toEqual([]);
  expect(report.axeViolations).toEqual([]);
});

test("hse: the boundary panel says employer requests are refused and logged, and its link opens the refusal", async ({ page }) => {
  await page.goto("/en/hse");
  const boundary = page.locator("[data-boundary]");
  await expect(boundary).toContainText(en.hse.boundary.body);
  await boundary.getByRole("link", { name: en.hse.boundary.link }).click();
  await expect(page).toHaveURL(/\/en\/replay\/governance$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("hse: Replay or Live and Reset are in a closed Demo controls section, and the address can open it", async ({ page }) => {
  await page.goto("/en/hse");
  const controls = page.locator("[data-demo-controls]");
  await expect(controls).toBeVisible();
  // Closed by default: neither control is on screen, so the primary chrome carries no demo scaffolding.
  await expect(page.getByRole("button", { name: en.shell.demo.reset.button })).toBeHidden();
  await expect(page.getByRole("button", { name: en.shell.demo.mode.replay })).toBeHidden();
  await controls.getByText(en.hse.demo.title).click();
  await expect(page.getByRole("button", { name: en.shell.demo.reset.button })).toBeVisible();
  await expect(page.getByRole("button", { name: en.shell.demo.mode.replay })).toBeVisible();

  await page.goto("/en/hse#demo-controls");
  await expect(page.getByRole("button", { name: en.shell.demo.reset.button })).toBeVisible();
});

test("hse: error state says what failed and its retry loads the crews", async ({ page }) => {
  let fail = true;
  await page.route("**/api/v1/sites/*/crews", async (route) => {
    if (!fail) return route.continue();
    return route.fulfill({
      status: 503,
      contentType: "application/problem+json",
      body: JSON.stringify({ type: "urn:stellar-blaze:problem:dependency-unavailable", title: "Service unavailable", status: 503, request_id: "req-e2e-503" }),
    });
  });
  await page.goto("/en/hse");
  await expect(page.getByText(en.hse.error.title)).toBeVisible();
  await expect(page.getByText("req-e2e-503")).toBeVisible();
  fail = false;
  await page.getByRole("button", { name: en.states.retry }).click();
  await expect(page.getByRole("table")).toBeVisible();
});

test("hse: empty state is actionable and leads to the front door", async ({ page }) => {
  await page.route("**/api/v1/sites/*/crews", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.goto("/en/hse");
  await expect(page.getByText(en.hse.empty.title)).toBeVisible();
  await page.getByRole("link", { name: en.hse.empty.primary }).click();
  await expect(page).toHaveURL(/\/en\/start$/);
});

test("hse: reads well at desk width and has no horizontal scroll", async ({ page }) => {
  const errors = watchConsole(page);
  await page.setViewportSize(DESK);
  await page.goto("/en/hse");
  await expect(page.getByRole("table")).toBeVisible();
  const report = await gateReport(page, { consoleErrors: errors, field: true, hero: false, locale: "en" });
  expect(report.failures).toEqual([]);
});

test("tour: five numbered stops in order, each Open link and the Where from go to a page that answers", async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto("/en/tour");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(en.judge.tour.title);
  const steps = page.locator("[data-tour-step]");
  await expect(steps).toHaveCount(5);
  expect(await steps.evaluateAll((items) => items.map((item) => (item as HTMLElement).dataset["tourStep"]))).toEqual(["story", "worker", "crew", "boundary", "scoreboard"]);
  const hrefs = await page.locator("[data-tour-step] a, main a[href*='demo-controls']").evaluateAll((links) => links.map((link) => (link as HTMLAnchorElement).getAttribute("href") ?? ""));
  expect(hrefs.length).toBeGreaterThanOrEqual(7);
  for (const href of hrefs) {
    const response = await page.request.get(href.split("#")[0] ?? href);
    expect(response.status(), href).toBe(200);
  }
  expect(await page.locator("[data-where-from]").count()).toBe(1);
  const report = await gateReport(page, { consoleErrors: errors, hero: false, locale: "en" });
  expect(report.failures).toEqual([]);
  expect(report.axeViolations).toEqual([]);
  // The unledgered numbers never appear on this page.
  const text = await page.locator("main").innerText();
  for (const banned of ["1,624", "279", "139", "370 of 374"]) expect(text).not.toContain(banned);
});

test("tour: the first stop opens the story, and the Demo controls link opens the safety view's controls", async ({ page }) => {
  await page.goto("/en/tour");
  await page.locator('[data-tour-step="story"]').getByRole("link", { name: en.judge.tour.open }).click();
  await expect(page).toHaveURL(/\/en$/);
  await page.goto("/en/tour");
  await page.getByRole("link", { name: en.judge.tour.controlsLink }).click();
  await expect(page).toHaveURL(/\/en\/hse#demo-controls$/);
  await expect(page.getByRole("button", { name: en.shell.demo.reset.button })).toBeVisible();
});

test("tour: the review tile on the landing page leads here", async ({ page }) => {
  await page.goto("/en");
  await page.locator('[data-role-door] a[data-role="review"]').click();
  await expect(page).toHaveURL(/\/en\/tour$/);
});
