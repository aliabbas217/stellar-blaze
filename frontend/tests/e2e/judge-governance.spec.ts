import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";
import { gateReport, watchConsole } from "./gate.ts";

/*
 * The governance refusal (/en/replay/governance) in a production build, against the mock API behind the BFF (which holds the
 * demo employer token here, as it does on the public demo). Safety and governance work: the specs pin the refusal path, the
 * audit row and the worker-visible log end to end. Every title contains "governance", so `pnpm e2e -g governance` selects them.
 *
 * The mock API keeps its log for the whole run and the specs run in two browser projects, so a spec never assumes how many
 * rows the log has: it reads the count first and asserts what changed.
 *
 * States: recorded (first paint), live (a real send), loading (the call held), empty (the log answers with no rows), error
 * (the API unreachable), 401 (no token), 429 (rate limited). The failure states are made with `page.route` on the one data
 * request, because the specimen mock cannot be told to fail it; the other calls (sites, log, reset) stay real.
 * Screenshots are written only when SB_GATE_SHOTS names a directory (the design gate run), never in a normal e2e run.
 */

const JUDGE = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const PATH = "/en/replay/governance";
const SEND = "Send the employer's request";
const REFUSED_BODY = {
  type: "urn:stellar-blaze:problem:individual-data-refused",
  title: "Individual data refused",
  status: 403,
  detail: "Individual health data is not held by this service and is never released to an employer (ADR 0004).",
  request_id: "e2e-req-0001",
};

const problem = (status: number, extra: Record<string, unknown> = {}) => ({
  status,
  contentType: "application/problem+json",
  body: JSON.stringify({ type: "urn:stellar-blaze:problem:test", title: "Test", status, ...extra }),
});

async function open(page: Page, viewport = JUDGE): Promise<string[]> {
  const errors = watchConsole(page);
  await page.setViewportSize(viewport);
  await page.goto(PATH);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // hydrated and the demo site known: the reset control only exists then
  await expect(page.getByRole("button", { name: "Reset demo site" })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  return errors;
}

const rows = (page: Page) => page.locator("[data-access-row]");
const state = (page: Page) => page.locator("[data-governance]");

async function shot(page: Page, name: string, viewport: { width: number; height: number }): Promise<void> {
  const dir = process.env.SB_GATE_SHOTS;
  if (dir === undefined || dir === "") return;
  const wide = viewport.width === JUDGE.width ? "1440" : "390";
  mkdirSync(dir, { recursive: true });
  // Full page, capped: a phone shot of the stacked sequence is long, and a gate PNG must stay readable and under 500 KB.
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.screenshot({
    path: path.join(dir, `${name}-${wide}-night.png`),
    clip: { x: 0, y: 0, width: viewport.width, height: Math.min(height, wide === "390" ? 2600 : 1500) },
    fullPage: true,
  });
}

/** The measured gate numbers, printed only in a design-gate run (SB_GATE_SHOTS set). */
function note(label: string, report: Awaited<ReturnType<typeof gateReport>>): void {
  if (process.env.SB_GATE_SHOTS === undefined || process.env.SB_GATE_SHOTS === "") return;
  const heroPct = report.heroShare === null ? "n/a" : (report.heroShare * 100).toFixed(1);
  console.log(
    `GATE ${label}: hero ${heroPct}% overflow ${String(report.overflowPx)}px minText ${String(report.minTextPx)}px minTarget ${String(report.minTargetPx)}px axe ${String(report.axeViolations.length)} failures ${String(report.failures.length)}`,
  );
}

/** An expected failure of the data request (the state under test) is not a console error of the page. */
const withoutDataRequest = (errors: readonly string[]) => errors.filter((message) => !/data-requests/.test(message));

test("governance refusal visible in the worker log: send, see the 403 and the new row, reload and see it in the log", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: SEND }).click();

  await expect(state(page)).toHaveAttribute("data-governance", "live");
  const answer = page.locator("[data-answer=shown]");
  await expect(answer.locator("[data-status]")).toHaveText("403");
  await expect(answer).toContainText("urn:stellar-blaze:problem:individual-data-refused");
  await expect(page.getByText("Live.")).toBeVisible();
  // the new audit row and the worker's list: the sentence is the site's, not "about you"
  await expect(page.locator("[data-audit=shown]")).toContainText("Refused");
  const phone = page.locator("[data-log-source=live]");
  await expect(phone.locator("[data-access-row]").first()).toContainText("An employer request for individual data at this site was refused");
  // step 4 is the API's own log now (newest three): at least the row just written, never the recorded row stacked on top
  const after = await phone.locator("[data-access-row]").count();
  expect(after).toBeGreaterThanOrEqual(1);
  await expect(page.locator("main")).not.toContainText(/about you|ADR|PDPL|purpose/i);

  // reload: the sequence is the recorded run again; the rows the API already has sit in their own labelled block (they come with
  // the lazy island, which a tap on the Replay switch brings in without sending anything: focus alone only warms the chunk)
  await page.reload();
  await expect(page.getByRole("button", { name: "Reset demo site" })).toBeVisible();
  await page.getByRole("button", { name: "Replay" }).click();
  const block = page.locator("[data-live-rows]");
  await expect(block.getByRole("heading", { name: "Live rows from the demo API" })).toBeVisible();
  await expect.poll(() => block.locator("[data-access-row]").count()).toBeGreaterThanOrEqual(after);
  await expect(block.locator("[data-access-row]").first()).toContainText("An employer request for individual data at this site was refused");
  await expect(page.locator("[data-log-source=recorded] [data-access-row]")).toHaveCount(1);
});

test("governance first paint is the recorded run, with nothing sent, and it needs no API", async ({ page }) => {
  const posts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") posts.push(request.url());
  });
  // the whole API stopped: the page still shows a completed run
  await page.route("**/api/v1/**", (route) => route.abort("connectionrefused"));
  await page.setViewportSize(JUDGE);
  await page.goto(PATH);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(state(page)).toHaveAttribute("data-governance", "recorded");
  await expect(page.getByText("Recorded", { exact: true })).toBeVisible();
  await expect(page.locator("[data-answer=shown] [data-status]")).toHaveText("403");
  await expect(rows(page)).toHaveCount(1);
  await page.waitForTimeout(500);
  expect(posts).toEqual([]);
});

test("governance first load makes no API call and ships no island; focus only warms it, the first tap brings it in and still sends nothing", async ({ page }) => {
  const api: string[] = [];
  const posts: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/v1/")) api.push(request.url());
    if (request.method() === "POST") posts.push(request.url());
  });
  await page.setViewportSize(JUDGE);
  await page.goto(PATH);
  await expect(state(page)).toHaveAttribute("data-governance", "recorded");
  await page.waitForTimeout(800);
  expect(api).toEqual([]);
  // a keyboard user reaches the send button with Tab: the chunk is warmed, the page is the same page and still no API call
  const send = page.getByRole("button", { name: SEND });
  await send.focus();
  await page.waitForTimeout(800);
  await expect(send).toBeFocused();
  await expect(state(page)).toHaveAttribute("data-governance", "recorded");
  expect(api).toEqual([]);
  // a real tap on the Replay switch brings the island in (sites are asked for) and no request is sent
  await page.getByRole("button", { name: "Replay" }).click();
  await expect.poll(() => api.some((url) => url.includes("/sites"))).toBe(true);
  await page.waitForTimeout(500);
  expect(posts).toEqual([]);
});

test("governance a press that outlasts the island load still sends exactly once (pointerdown, chunk resolves, pointerup)", async ({ page }) => {
  const posts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/data-requests")) posts.push(request.url());
  });
  await page.setViewportSize(JUDGE);
  await page.goto(PATH);
  await expect(state(page)).toHaveAttribute("data-governance", "recorded");
  const send = page.getByRole("button", { name: SEND });
  await send.hover();
  await page.mouse.down();
  // the chunk arrives while the button is still down (a fast or cached chunk does this inside a 60 to 150 ms press)
  await page.waitForTimeout(1200);
  await expect(state(page)).toHaveAttribute("data-governance", "recorded");
  await page.mouse.up();
  await expect(state(page)).toHaveAttribute("data-governance", "live");
  await expect.poll(() => posts.length).toBe(1);
  await page.waitForTimeout(500);
  expect(posts).toHaveLength(1);
});

test("governance live rows the API already has sit in their own block and never replace the recorded step 4", async ({ page }) => {
  const entry = (at: string) => ({ at, kind: "data_request.refused", outcome: "refused", actor_role: "employer", rule: "r", policy_version: "p", config_version: 1, model_id: null });
  await page.route("**/api/v1/sites/*/transparency-log", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ site_id: "site-demo-mussafah", entries: [entry("2026-11-15T09:00:02Z"), entry("2026-11-15T09:00:01Z")] }),
    }),
  );
  await open(page);
  // the rows come with the lazy island: a tap on the Replay switch brings it in, and sends nothing
  await page.getByRole("button", { name: "Replay" }).click();
  const block = page.locator("[data-live-rows]");
  await expect(block.getByRole("heading", { name: "Live rows from the demo API" })).toBeVisible();
  await expect(block.locator("[data-access-row]")).toHaveCount(2);
  // step 4 is still the recorded run's own row, and the sequence is still labelled recorded
  await expect(page.locator("[data-log-source=recorded] [data-access-row]")).toHaveCount(1);
  await expect(state(page)).toHaveAttribute("data-governance", "recorded");
  await expect(page.locator("[data-notice=recorded]")).toContainText("Recorded against the demo mock, not the live service.");
});

test("governance 429 is 'Not sent. Try again in a minute.' and the page never retries", async ({ page }) => {
  let posts = 0;
  await page.route("**/api/v1/sites/*/data-requests", (route: Route) => {
    posts += 1;
    return route.fulfill({ ...problem(429, { type: "urn:stellar-blaze:problem:rate-limited", title: "Rate limited" }), headers: { "retry-after": "60" } });
  });
  await open(page);
  await page.getByRole("button", { name: SEND }).click();
  await expect(state(page)).toHaveAttribute("data-governance", "limited");
  await expect(page.getByText("Not sent. Try again in a minute.")).toBeVisible();
  await page.waitForTimeout(800);
  expect(posts).toBe(1);
});

test("governance 401 says the deployment has no demo token and records nothing", async ({ page }) => {
  await page.route("**/api/v1/sites/*/data-requests", (route) => route.fulfill(problem(401, { type: "urn:stellar-blaze:problem:unauthorized", title: "Unauthorized" })));
  await open(page);
  // step 4 is the recorded run's one row; the API's own rows (earlier sends) arrive with the island and sit in their own block
  const step4 = page.locator("[data-log-source] [data-access-row]");
  const before = await step4.count();
  await page.getByRole("button", { name: SEND }).click();
  await expect(state(page)).toHaveAttribute("data-governance", "unauthorized");
  await expect(page.locator("[data-notice=unauthorized]")).toContainText("no demo employer token");
  await expect(step4).toHaveCount(before);
  await expect(page.locator("[data-log-source=recorded]")).toHaveCount(1);
});

test("governance API unreachable shows the recorded run and 'Nothing was sent, so nothing was recorded'", async ({ page }) => {
  await page.route("**/api/v1/sites/*/data-requests", (route) => route.abort("connectionrefused"));
  await open(page);
  await page.getByRole("button", { name: SEND }).click();
  await expect(state(page)).toHaveAttribute("data-governance", "failed");
  await expect(page.locator("[data-notice=failed]")).toContainText("Nothing was sent, so nothing was recorded.");
  await expect(page.getByText("Recorded", { exact: true })).toBeVisible();
});

for (const [name, viewport] of [
  ["1440", JUDGE],
  ["390", PHONE],
] as const) {
  test(`governance design gate, recorded state, ${name} wide`, async ({ page }) => {
    // a fresh deployment: the API's log has no rows yet, so the whole sequence is the recorded run
    await page.route("**/api/v1/sites/*/transparency-log", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ site_id: "site-demo-mussafah", entries: [] }) }),
    );
    const errors = await open(page, viewport);
    const report = await gateReport(page, { consoleErrors: errors, hero: viewport === JUDGE, spine: true, locale: "en" });
    await test.info().attach("gate-report.json", { body: JSON.stringify(report, null, 2), contentType: "application/json" });
    note(test.info().title, report);
    expect(report.failures).toEqual([]);
    expect(report.axeViolations).toEqual([]);
    if (viewport === JUDGE) expect(report.heroShare ?? 0).toBeGreaterThanOrEqual(0.35);
    await shot(page, "recorded", viewport);
  });

  test(`governance design gate, live state, ${name} wide`, async ({ page }) => {
    const errors = await open(page, viewport);
    await page.getByRole("button", { name: SEND }).click();
    await expect(state(page)).toHaveAttribute("data-governance", "live");
    // the 403 IS the answer this screen shows: it is the designed result of the request, not a page error
    const report = await gateReport(page, { consoleErrors: withoutDataRequest(errors), hero: viewport === JUDGE, spine: true, locale: "en" });
    await test.info().attach("gate-report.json", { body: JSON.stringify(report, null, 2), contentType: "application/json" });
    note(test.info().title, report);
    expect(report.failures).toEqual([]);
    await shot(page, "live", viewport);
  });

  test(`governance design gate, loading state, ${name} wide`, async ({ page }) => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/v1/sites/*/data-requests", async (route) => {
      await held;
      await route.fulfill({ status: 403, contentType: "application/problem+json", body: JSON.stringify(REFUSED_BODY) });
    });
    const errors = await open(page, viewport);
    await page.getByRole("button", { name: SEND }).click();
    await expect(state(page)).toHaveAttribute("data-governance", "loading");
    await expect(page.getByRole("button", { name: SEND })).toHaveAttribute("aria-busy", "true");
    const report = await gateReport(page, { consoleErrors: errors, hero: viewport === JUDGE, spine: true, locale: "en" });
    note(test.info().title, report);
    expect(report.failures).toEqual([]);
    await shot(page, "loading", viewport);
    release();
    await expect(state(page)).not.toHaveAttribute("data-governance", "loading");
  });

  test(`governance design gate, empty state, ${name} wide`, async ({ page }) => {
    await page.route("**/api/v1/sites/*/transparency-log", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ site_id: "site-demo-mussafah", entries: [] }) }),
    );
    await page.route("**/api/v1/sites/*/data-requests", (route) =>
      route.fulfill({ status: 403, contentType: "application/problem+json", body: JSON.stringify(REFUSED_BODY) }),
    );
    const errors = await open(page, viewport);
    await page.getByRole("button", { name: SEND }).click();
    await expect(state(page)).toHaveAttribute("data-governance", "empty");
    const report = await gateReport(page, { consoleErrors: withoutDataRequest(errors), hero: viewport === JUDGE, spine: true, locale: "en" });
    note(test.info().title, report);
    expect(report.failures).toEqual([]);
    await shot(page, "empty", viewport);
  });

  test(`governance design gate, error state, ${name} wide`, async ({ page }) => {
    await page.route("**/api/v1/sites/*/data-requests", (route) =>
      route.fulfill(problem(502, { type: "urn:stellar-blaze:problem:upstream-unavailable", title: "Upstream unavailable", request_id: "req-e02b61d9" })),
    );
    const errors = await open(page, viewport);
    await page.getByRole("button", { name: SEND }).click();
    await expect(state(page)).toHaveAttribute("data-governance", "failed");
    await expect(page.locator("[data-notice=failed]")).toContainText("req-e02b61d9");
    const report = await gateReport(page, { consoleErrors: withoutDataRequest(errors), hero: viewport === JUDGE, spine: true, locale: "en" });
    note(test.info().title, report);
    expect(report.failures).toEqual([]);
    await shot(page, "error", viewport);
  });

  test(`governance design gate, 401 state, ${name} wide`, async ({ page }) => {
    await page.route("**/api/v1/sites/*/data-requests", (route) => route.fulfill(problem(401, { type: "urn:stellar-blaze:problem:unauthorized", title: "Unauthorized" })));
    const errors = await open(page, viewport);
    await page.getByRole("button", { name: SEND }).click();
    await expect(state(page)).toHaveAttribute("data-governance", "unauthorized");
    const report = await gateReport(page, { consoleErrors: withoutDataRequest(errors), hero: viewport === JUDGE, spine: true, locale: "en" });
    note(test.info().title, report);
    expect(report.failures).toEqual([]);
    await shot(page, "401", viewport);
  });

  test(`governance design gate, 429 state, ${name} wide`, async ({ page }) => {
    await page.route("**/api/v1/sites/*/data-requests", (route) =>
      route.fulfill({ ...problem(429, { type: "urn:stellar-blaze:problem:rate-limited", title: "Rate limited" }), headers: { "retry-after": "60" } }),
    );
    const errors = await open(page, viewport);
    await page.getByRole("button", { name: SEND }).click();
    await expect(state(page)).toHaveAttribute("data-governance", "limited");
    const report = await gateReport(page, { consoleErrors: withoutDataRequest(errors), hero: viewport === JUDGE, spine: true, locale: "en" });
    note(test.info().title, report);
    expect(report.failures).toEqual([]);
    await shot(page, "429", viewport);
  });
}
