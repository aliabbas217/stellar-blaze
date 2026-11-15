import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import en from "../../messages/en.json";
import { SITE_DEMO } from "../../src/mocks/fixtures.ts";
import { gateReport, watchConsole, type GateOptions } from "./gate.ts";
import { withScenario, type Scenario } from "./helpers/scenario.ts";

/*
 * The supervisor's plan screen with sign-off (F2 Task 20) in a production build against the mock API. Every title contains
 * "supervisor plan", so `pnpm e2e -g "supervisor plan"` selects them. The replay clock is 3 Sep 2026 at 11:10 (`?at=` moves it):
 * at 11:10 every crew is off shift, at 09:30 they are working. The mock server keeps stops and sign-offs in memory, so every test
 * that acts starts from, and ends with, a reset epoch.
 *
 * Two budgets of the BFF are respected, as the crews screen's spec does: the day-plan GET and every write draw on the general
 * budget (20 per client per minute), and Stop work has its own reserve (10 stop and undo requests a minute are spent at most).
 * Read-only tests and the gate serve the day plan from a per-run cache, so what is measured is the screen and not the limiter;
 * tests that sign or stop never use it, and wait for budget instead.
 *
 * With GATE_SHOTS=1 the gate tests also write their PNGs to docs/design/f2/gate/supervisor-plan/ (the controller stages that folder).
 * The hero share (35 % of the first fold) is asserted at 390 x 844, the field main width; at 768 the 440 px column sits inside a
 * wider fold, so the share is printed there, not asserted (the same rule as the worker views and the crews screen).
 */

type Theme = "night" | "sun";
const PHONE = { width: 390, height: 844 };
const TABLET = { width: 768, height: 1024 };
const SHOTS = process.env["GATE_SHOTS"] === "1";
const SHOT_DIR = path.resolve(process.cwd(), "../docs/design/f2/gate/supervisor-plan");
const stopLabel = (crew: string) => en.supervisor.stop.button.replace("<bdi>{crew}</bdi>", crew);
const NOTIFY = "Crews are notified within about six minutes.";

interface Opening {
  readonly crew?: string;
  readonly theme?: Theme;
  readonly scenario?: Scenario;
  readonly at?: string;
  readonly size?: { width: number; height: number };
  readonly offline?: boolean;
  /** Serve the day plan from the run's cache (read-only states only). */
  readonly cache?: boolean;
  /**
   * A crew no API knows: the day plan answers 404. A stub, because the BFF only puts the demo token on the demo crews (crew-a to
   * crew-d), so a real unknown id would reach the API with no token and read as 401, which is the error state, not not-found.
   */
  readonly missing?: boolean;
}

async function resetEpoch(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 14; attempt += 1) {
    const response = await page.request.post(`/api/v1/sites/${SITE_DEMO}/demo-reset`);
    if (response.ok()) return;
    expect(response.status(), "demo-reset is only ever refused for its limit").toBe(429);
    await page.waitForTimeout(5_000);
  }
  throw new Error("demo-reset kept answering 429");
}

let dirty = true;

// --- the BFF's budgets ----------------------------------------------------------------------------------------------------------
const WINDOW_MS = 62_000;
const GENERAL_PER_WINDOW = 14; // the BFF admits 20 a client; the rest is room for the resets
const STOP_PER_WINDOW = 9;
const generalRequests: number[] = [];
const stopRequests: number[] = [];

function watchBudgets(page: Page): void {
  page.on("request", (request) => {
    const url = request.url();
    const method = request.method();
    if (/\/api\/v1\/crews\/[^/]+\/day-plan/.test(url)) generalRequests.push(Date.now());
    if ((method === "POST" || method === "DELETE") && /\/api\/v1\/crews\/[^/]+\/stops/.test(url)) stopRequests.push(Date.now());
  });
}

async function awaitBudget(page: Page, general: number, stop = 0): Promise<void> {
  for (;;) {
    const g = generalRequests.filter((at) => Date.now() - at < WINDOW_MS).length;
    const s = stopRequests.filter((at) => Date.now() - at < WINDOW_MS).length;
    if (g + general <= GENERAL_PER_WINDOW && s + stop <= STOP_PER_WINDOW) return;
    await page.waitForTimeout(2_000);
  }
}

const planBodies = new Map<string, string>();
async function cachePlans(page: Page): Promise<void> {
  await page.route("**/api/v1/crews/*/day-plan*", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const key = `${route.request().url()}|${route.request().headers()["x-sb-mock-scenario"] ?? ""}`;
    const held = planBodies.get(key);
    if (held !== undefined) {
      const [status, body, type] = JSON.parse(held) as [number, string, string];
      return route.fulfill({ status, contentType: type, body });
    }
    const response = await route.fetch();
    planBodies.set(key, JSON.stringify([response.status(), await response.text(), response.headers()["content-type"] ?? "application/json"]));
    return route.fulfill({ response });
  });
}

async function openPlan(page: Page, { crew = "crew-b", theme = "night", scenario, at, size = PHONE, offline = false, cache = false, missing = false }: Opening = {}): Promise<string[]> {
  if (dirty) {
    await resetEpoch(page);
    dirty = false;
  }
  const errors = watchConsole(page);
  watchBudgets(page);
  await page.setViewportSize(size);
  await withScenario(page, scenario ?? null);
  if (missing) {
    await page.route("**/api/v1/crews/*/day-plan*", (route) =>
      route.fulfill({
        status: 404,
        contentType: "application/problem+json",
        body: JSON.stringify({ type: "about:blank", title: "Not Found", status: 404, request_id: "req-404" }),
      }),
    );
  } else if (cache) await cachePlans(page);
  await page.addInitScript((chosen) => {
    localStorage.setItem("sb-theme", JSON.stringify({ theme: chosen, until: Date.now() + 6 * 3_600_000 }));
  }, theme);
  if (offline) {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
    });
  }
  await page.goto(`/en/supervisor/crews/${crew}${at === undefined ? "" : `?at=${at}`}`);
  return errors;
}

// Waiting for the BFF's budget can take most of a minute when the tests before spent it: the default 30 s would be the limiter's timeout.
test.beforeEach(() => {
  test.setTimeout(120_000);
});

test.afterEach(async ({ page }) => {
  if (dirty) {
    await resetEpoch(page);
    dirty = false;
  }
});

// Online-only (F2 decision D2: no supervisor route is cached), and a page route that holds or refuses a request is bypassed by a
// service worker that has taken the page over: the worker stays out of these tests (see the crews screen's spec).
test.use({ serviceWorkers: "block" });

const bar = (page: Page) => page.locator("[data-emergency]");
const ready = (page: Page) => page.locator("[data-block]").first().waitFor();
// The form is loaded on demand: wait for it before ticking, or a tick-all of nothing signs nothing.
const tickAll = async (page: Page) => {
  await page.getByRole("checkbox").first().waitFor();
  for (const box of await page.getByRole("checkbox").all()) await box.check();
};
const formReady = (page: Page) => page.getByRole("checkbox").first().waitFor();
const readyWithForm = async (page: Page) => {
  await ready(page);
  await formReady(page);
};

// --- behaviour ------------------------------------------------------------------------------------------------------------------

test("supervisor plan: leads with the crew's level, draws the plan with the slot and a now line, and lists every block as a 44 px row", async ({ page }) => {
  await awaitBudget(page, 2);
  await openPlan(page, { cache: true });
  await ready(page);

  await expect(page.getByRole("heading", { level: 2, name: "Crew B plan" })).toBeVisible();
  await expect(page.locator("[data-focal], #focal")).toContainText("Crew B is off shift now. Back at 15:00 into Orange.");
  await expect(page.locator("[data-hero] [data-slot='in-force']")).toHaveCount(1);
  await expect(page.locator("[data-hero] [data-now]")).toHaveCount(1);
  await expect(page.locator("[data-mode-stamp]")).toContainText(en.states.stamp.replay);
  await expect(page.getByText(en.shell.demo.banner)).toBeVisible();
  await expect(page.getByRole("button", { name: en.shell.demo.reset.button })).toBeVisible();
  await expect(page.getByText(en.supervisor.plan.floorBanner)).toBeVisible();
  // the blocks are native buttons at least 44 px tall (measured, not assumed), and nothing in the chart is a control
  const heights = await page.locator("[data-block] > button").evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().height));
  expect(heights.length).toBeGreaterThan(5);
  expect(Math.min(...heights)).toBeGreaterThanOrEqual(44);
  await expect(page.locator("[data-plan-bars] button, [data-plan-bars] a, [data-plan-bars] [role=button]")).toHaveCount(0);
  // the way back and the primary action
  await expect(page.getByRole("link", { name: en.supervisor.plan.back }).first()).toHaveAttribute("href", "/en/supervisor");
  await expect(page.locator("[data-primary]")).toHaveCount(1);
  await expect(page.locator("[data-primary]")).toHaveText("Sign off");
  // unsigned at shift start says it, in the words of the ruling
  await expect(page.getByText("Not signed. Crews see the rule plan, labelled unsigned fallback. Alerts and Stop work do not wait for you.")).toBeVisible();
  await expect(page.getByRole("button", { name: stopLabel("Crew B") })).toBeEnabled();
});

test("supervisor plan: a block opens to its clause and rule, by keyboard too", async ({ page }) => {
  await awaitBudget(page, 1);
  await openPlan(page, { cache: true });
  await ready(page);

  const ban = page.locator("[data-block='ban']");
  const opener = ban.getByRole("button");
  await opener.focus();
  await page.keyboard.press("Enter");
  await expect(opener).toHaveAttribute("aria-expanded", "true");
  await expect(ban).toContainText("Ministerial Resolution 44 of 2022");
  await expect(ban.locator("code")).toHaveText("P-H1");
});

test("supervisor plan: the block at the replay time is marked current (at 09:30)", async ({ page }) => {
  await awaitBudget(page, 1);
  await openPlan(page, { at: "09:30", cache: true });
  await ready(page);

  await expect(page.locator("[data-current]")).toHaveCount(1);
  await expect(page.locator("[data-current]")).toContainText("09:15 to 10:00");
  await expect(page.locator("#focal")).toContainText("Crew B is Amber until 10:00");
});

test("supervisor plan: sign off a plan: tick each run then Sign off, then Stop work", async ({ page }) => {
  test.setTimeout(90_000);
  await awaitBudget(page, 5, 2);
  await openPlan(page);
  dirty = true;
  await ready(page);
  let body: { acknowledged_items?: string[] } | null = null;
  let posts = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/day-plan/sign-off")) {
      posts += 1;
      body = request.postDataJSON() as { acknowledged_items?: string[] };
    }
  });

  // one tick per run of Medium or High work; the message names them
  await expect(page.getByRole("checkbox")).toHaveCount(4);
  await expect(page.locator("[data-sign-off-items]")).toContainText("4 items need a tick");
  await tickAll(page);
  await page.getByRole("button", { name: "Sign off" }).click();

  await expect(page.locator("[data-signed]")).toContainText("by the site supervisor. Crews see this plan.");
  // one press, one request: a second would be answered with the recorded sign-off of the first (the seed time), never a new one
  expect(posts).toBe(1);
  await expect(page.locator("[data-signed]")).toContainText("Signed 11:10");
  expect(body).toEqual({ acknowledged_items: ["medium-0800", "high-1000", "high-1500", "medium-1700"] });
  await expect(page.getByRole("button", { name: "Sign off" })).toHaveCount(0);
  await expect(page.getByText(/^Not signed/)).toHaveCount(0);

  // then Stop work, which was never waiting for any of it
  await page.getByRole("button", { name: stopLabel("Crew B") }).click();
  await expect(bar(page)).toContainText(`Crew B stopped 11:10. Stop recorded. ${NOTIFY} Tell the crew now.`);
  await expect(bar(page)).not.toContainText(/immediately|alerted|phones|delivered/i);
  // the signed row and the plan stay: the stop is the crew's, the signature is the plan's
  await expect(page.locator("[data-signed]")).toBeVisible();
});

test("supervisor plan: Sign off pressed with items unticked says how many are left, focuses the first box, and sends nothing", async ({ page }) => {
  await awaitBudget(page, 1);
  await openPlan(page, { cache: true });
  await ready(page);
  let posts = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/day-plan/sign-off")) posts += 1;
  });
  const submit = page.getByRole("button", { name: "Sign off" });

  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.locator("[data-sign-off-message]")).toHaveText("Tick 4 more items to sign");
  await expect(page.getByRole("checkbox").first()).toBeFocused();
  await page.getByRole("checkbox").first().check();
  await submit.click();
  await expect(page.locator("[data-sign-off-message]")).toHaveText("Tick 3 more items to sign");
  await expect(page.getByRole("checkbox").nth(1)).toBeFocused();
  expect(posts).toBe(0);
  // the tick boxes are 44 px targets (the label), the box itself 24 px
  const sizes = await page.locator("[data-sign-off] label").evaluateAll((labels) => labels.map((label) => label.getBoundingClientRect().height));
  expect(Math.min(...sizes)).toBeGreaterThanOrEqual(44);
});

test("supervisor plan: a signed plan (Crew A) shows who and when, and no form", async ({ page }) => {
  await awaitBudget(page, 1);
  await openPlan(page, { crew: "crew-a", cache: true });
  await ready(page);

  await expect(page.locator("[data-signed]")).toContainText("Signed 05:40 by the site supervisor. Crews see this plan.");
  await expect(page.getByRole("button", { name: "Sign off" })).toHaveCount(0);
  await expect(page.locator("[data-crew-subtitle]")).toContainText("restrictions declared for 2 members");
  await expect(page.locator("body")).not.toContainText(/protected/i);
});

test("supervisor plan: a plan changed since it was signed says so and offers the form (Crew C)", async ({ page }) => {
  await awaitBudget(page, 1);
  await openPlan(page, { crew: "crew-c", cache: true });
  await ready(page);

  await expect(page.getByText(/^Changed since signed at 05:40\. Crews see the current rule plan/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign off" })).toBeVisible();
});

test("supervisor plan: a crew below k shows its level and 'fewer than 5 people, health detail hidden', and nothing about restrictions (Crew D)", async ({ page }) => {
  await awaitBudget(page, 1);
  await openPlan(page, { crew: "crew-d", cache: true });
  await ready(page);

  await expect(page.locator("[data-crew-subtitle]")).toContainText("fewer than 5 people, health detail hidden");
  await expect(page.locator("#focal")).toContainText("Crew D is");
  await expect(page.locator("body")).not.toContainText(/restrict/i);
});

test("supervisor plan: a stale forecast says 'No fresh forecast: protective plan' and draws no heat", async ({ page }) => {
  await awaitBudget(page, 1);
  await openPlan(page, { scenario: "stale", cache: true });
  await ready(page);

  await expect(page.getByText(en.supervisor.crews.stale.title)).toBeVisible();
  await expect(page.locator("[data-plan-heat] span[style*='--heat-night']")).toHaveCount(0);
  await expect(page.getByRole("button", { name: stopLabel("Crew B") })).toBeEnabled();
});

test("supervisor plan: a plan that failed the rule check is not shown, sign-off is off, and Stop work stays", async ({ page }) => {
  await awaitBudget(page, 1);
  await openPlan(page, { scenario: "plan-invalid", cache: true });

  await expect(page.getByText(en.supervisor.plan.invalid.title)).toBeVisible();
  await expect(page.getByText(/Sign-off is off until a plan passes/)).toBeVisible();
  await expect(page.getByText("mock-req-1").first()).toBeVisible();
  await expect(page.locator("[data-block]")).toHaveCount(0);
  await expect(page.locator("[data-plan-bars]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sign off" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: stopLabel("Crew B") })).toBeEnabled();
});

test("supervisor plan: a shift that is not legal is an informative result listing the violated rules, not an error", async ({ page }) => {
  await awaitBudget(page, 1);
  await openPlan(page, { scenario: "shift-not-legal", cache: true });

  const result = page.locator("[data-shift-not-legal]");
  await expect(result).toBeVisible();
  await expect(result).toHaveAttribute("role", "status");
  await expect(result.getByRole("heading", { name: "This shift is not legal as planned" })).toBeVisible();
  await expect(result.locator("[data-violation]").first()).toContainText("P-H");
  await expect(result.locator("[role=alert]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sign off" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: stopLabel("Crew B") })).toBeEnabled();
});

test("supervisor plan: the error state names the failure with its request id and keeps Stop work", async ({ page }) => {
  await awaitBudget(page, 1);
  await openPlan(page, { scenario: "error", cache: true });

  await expect(page.getByText(en.supervisor.plan.error.title)).toBeVisible();
  await expect(page.getByText("mock-req-1").first()).toBeVisible();
  await expect(page.getByRole("button", { name: en.states.retry })).toBeEnabled();
  await expect(page.getByRole("button", { name: /^Stop work/ })).toBeEnabled();
});

test("supervisor plan: an empty plan and an unknown crew are calm, actionable states", async ({ page }) => {
  await awaitBudget(page, 2);
  await openPlan(page, { scenario: "empty", cache: true });
  await expect(page.getByText(en.supervisor.plan.empty.title)).toBeVisible();
  await expect(page.getByRole("link", { name: en.supervisor.plan.empty.primary }).last()).toHaveAttribute("href", "/en/supervisor");
  await openPlan(page, { crew: "crew-zzz", missing: true });
  await expect(page.getByText(en.supervisor.plan.notFound.title)).toBeVisible();
  await expect(bar(page)).toHaveText(en.supervisor.stop.noCrews);
});

test("supervisor plan: Stop work works while the sign-off request is in flight, and while it has failed", async ({ page }) => {
  test.setTimeout(90_000);
  await awaitBudget(page, 4, 1);
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/day-plan/sign-off*", async (route) => {
    await gate;
    return route.fulfill({
      status: 500,
      contentType: "application/problem+json",
      body: JSON.stringify({ type: "urn:x", title: "Boom", status: 500, request_id: "req-so-1" }),
    });
  });
  await openPlan(page);
  dirty = true;
  await ready(page);
  await tickAll(page);
  await page.getByRole("button", { name: "Sign off" }).click();
  await expect(page.getByRole("button", { name: "Sign off" })).toHaveAttribute("aria-busy", "true");

  await page.getByRole("button", { name: stopLabel("Crew B") }).click();
  await expect(bar(page)).toContainText("Stop recorded.");
  release();
  await expect(page.locator("[data-sign-off-message]")).toHaveText(en.supervisor.plan.signOff.failed);
  await expect(bar(page)).toContainText("Stop recorded.");
  await expect(page.getByRole("button", { name: /^Undo/ })).toBeEnabled();
});

test("supervisor plan: the plan is read once for a page load (the BFF's general budget)", async ({ page }) => {
  await awaitBudget(page, 2);
  let gets = 0;
  page.on("request", (request) => {
    if (request.method() === "GET" && /\/day-plan/.test(request.url())) gets += 1;
  });
  await openPlan(page);
  await ready(page);
  await page.waitForTimeout(1_500);
  expect(gets).toBe(1);
});

// --- the design gate: every state, 390 and 768, night and sun -----------------------------------------------------------------------

async function gate(page: Page, errors: string[], options: Omit<GateOptions, "consoleErrors" | "field">, label: string): Promise<void> {
  // A refusal, a failed plan and an offline load are the states under test: their API answers and aborts are not console noise.
  const consoleErrors = errors.filter(
    (message) =>
      !/^HTTP (4\d\d|5\d\d) .*\/api\/v1\//.test(message) &&
      !/net::ERR_INTERNET_DISCONNECTED/.test(message) &&
      !/Cannot read properties of undefined \(reading 'waiting'\)/.test(message),
  );
  await page.evaluate(() => document.fonts.ready);
  const report = await gateReport(page, { consoleErrors, field: true, ...options });
  await test.info().attach(`gate-${label}.json`, { body: JSON.stringify(report, null, 2), contentType: "application/json" });
  // The hero is the plan with its state (notices, level sentence, chart, blocks); the chart alone is printed beside it for the record.
  const chart = await page.evaluate(() => {
    const el = document.querySelector("[data-plan-strip]");
    if (el === null) return null;
    const r = el.getBoundingClientRect();
    const h = Math.max(0, Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0));
    return (Math.max(0, Math.min(r.right, window.innerWidth) - Math.max(r.left, 0)) * h) / (window.innerWidth * window.innerHeight);
  });
  console.log(
    `gate ${label}: chart=${chart === null ? "-" : `${(chart * 100).toFixed(1)}%`} hero=${report.heroShare === null ? "-" : `${(report.heroShare * 100).toFixed(1)}%`} minText=${String(report.minTextPx)} minTarget=${report.minTargetPx.toFixed(0)} overflow=${String(report.overflowPx)} label=${String(report.minFieldLabelPx)} primaries=${String(report.primariesInFold)}`,
  );
  if (SHOTS) {
    mkdirSync(SHOT_DIR, { recursive: true });
    if (label.includes("-390-")) await page.screenshot({ path: path.join(SHOT_DIR, `${label}-fold.png`) });
    await page.evaluate(() => {
      for (const el of document.querySelectorAll<HTMLElement>("[data-emergency]")) el.style.position = "static";
    });
    await page.screenshot({ path: path.join(SHOT_DIR, `${label}.png`), fullPage: true });
    await page.evaluate(() => {
      for (const el of document.querySelectorAll<HTMLElement>("[data-emergency]")) el.style.position = "";
    });
  }
  expect(report.failures, label).toEqual([]);
}

const SIZES = [
  ["390", PHONE],
  ["768", TABLET],
] as const;

interface GateState {
  readonly name: string;
  readonly opening: Omit<Opening, "theme" | "size" | "cache">;
  readonly options: Omit<GateOptions, "consoleErrors" | "field">;
  readonly settle: (page: Page) => Promise<void>;
}

const STATES: readonly GateState[] = [
  { name: "ideal", opening: {}, options: { spine: true }, settle: readyWithForm },
  { name: "working", opening: { at: "09:30" }, options: { spine: true }, settle: readyWithForm },
  { name: "signed", opening: { crew: "crew-a" }, options: { spine: true }, settle: ready },
  { name: "changed", opening: { crew: "crew-c" }, options: { spine: true }, settle: readyWithForm },
  { name: "partial", opening: { crew: "crew-d" }, options: { spine: true }, settle: ready },
  { name: "stale", opening: { scenario: "stale" }, options: { spine: true }, settle: readyWithForm },
  { name: "offline", opening: { offline: true }, options: { spine: true }, settle: readyWithForm },
  { name: "empty", opening: { scenario: "empty" }, options: { hero: false }, settle: async (page) => page.getByText(en.supervisor.plan.empty.title).waitFor() },
  { name: "error", opening: { scenario: "error" }, options: { hero: false }, settle: async (page) => page.getByText(en.supervisor.plan.error.title).waitFor() },
  { name: "validator-failed", opening: { scenario: "plan-invalid" }, options: { hero: false }, settle: async (page) => page.getByText(en.supervisor.plan.invalid.title).waitFor() },
  { name: "shift-not-legal", opening: { scenario: "shift-not-legal" }, options: { hero: false }, settle: async (page) => page.locator("[data-shift-not-legal]").waitFor() },
  { name: "not-found", opening: { crew: "crew-zzz", missing: true }, options: { hero: false }, settle: async (page) => page.getByText(en.supervisor.plan.notFound.title).waitFor() },
];

for (const state of STATES) {
  test(`supervisor plan passes the design gate: ${state.name}, 390 and 768, night and sun`, async ({ page }) => {
    test.setTimeout(120_000);
    for (const [width, size] of SIZES) {
      for (const theme of ["night", "sun"] as const) {
        await awaitBudget(page, 1);
        const errors = await openPlan(page, { ...state.opening, theme, size, cache: true });
        await state.settle(page);
        await gate(page, errors, { locale: "en", ...state.options, ...(width === "390" ? {} : { hero: false }) }, `${state.name}-${width}-${theme}`);
      }
    }
  });
}

test("supervisor plan passes the design gate: loading, 390 and 768, night and sun", async ({ page }) => {
  test.setTimeout(120_000);
  for (const [width, size] of SIZES) {
    for (const theme of ["night", "sun"] as const) {
      let release: () => void = () => undefined;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.unroute("**/api/v1/crews/*/day-plan*");
      await page.route("**/api/v1/crews/*/day-plan*", async (route) => {
        await held;
        await route.fulfill({ status: 200, contentType: "application/json", body: "{}" }).catch(() => undefined);
      });
      const errors = await openPlan(page, { theme, size });
      await expect(page.locator('[aria-busy="true"] [data-skeleton]').first()).toBeVisible();
      await gate(page, errors, { locale: "en", hero: false }, `loading-${width}-${theme}`);
      release();
    }
  }
});

test("supervisor plan passes the design gate: sign-off in progress, review required, and not recorded, 390 and 768, night and sun", async ({ page }) => {
  test.setTimeout(420_000);
  for (const [width, size] of SIZES) {
    for (const theme of ["night", "sun"] as const) {
      await awaitBudget(page, 3);
      const refuse = (status: number, body: Record<string, unknown>) =>
        page.route("**/day-plan/sign-off*", (route) =>
          route.fulfill({ status, contentType: "application/problem+json", body: JSON.stringify({ title: "x", request_id: "req-gate-1", ...body }) }),
        );
      // in progress: two of four ticked, pressed once
      let errors = await openPlan(page, { theme, size, cache: true });
      await ready(page);
      await page.getByRole("checkbox").nth(0).check();
      await page.getByRole("checkbox").nth(1).check();
      await page.getByRole("button", { name: "Sign off" }).click();
      await expect(page.locator("[data-sign-off-message]")).toHaveText("Tick 2 more items to sign");
      // the focus on the first box scrolled the page to the form: the hero is out of the first fold by design here
      await gate(page, errors, { locale: "en", spine: true, hero: false }, `signoff-ticks-${width}-${theme}`);

      // the server says an item is still missing
      await refuse(409, { type: "urn:stellar-blaze:problem:review-required", status: 409, missing_items: ["high-1500"] });
      await tickAll(page);
      await page.getByRole("button", { name: "Sign off" }).click();
      await expect(page.locator("[data-sign-off-message]")).toContainText("These items still need a tick");
      await gate(page, errors, { locale: "en", spine: true, hero: false }, `signoff-review-${width}-${theme}`);
      await page.unroute("**/day-plan/sign-off*");

      // not recorded
      errors = await openPlan(page, { theme, size, cache: true });
      await ready(page);
      await refuse(429, { type: "urn:stellar-blaze:problem:rate-limited", status: 429 });
      await tickAll(page);
      await page.getByRole("button", { name: "Sign off" }).click();
      await expect(page.locator("[data-sign-off-message]")).toHaveText(en.supervisor.plan.signOff.failed);
      await gate(page, errors, { locale: "en", spine: true, hero: false }, `signoff-failed-${width}-${theme}`);
      await page.unroute("**/day-plan/sign-off*");
    }
  }
});

test("supervisor plan passes the design gate: stopped (recorded, then Work stopped), and stopped offline, 390 and 768, night and sun", async ({ page, context }) => {
  test.setTimeout(420_000);
  for (const [width, size] of SIZES) {
    for (const theme of ["night", "sun"] as const) {
      await awaitBudget(page, 4, 3);
      // a stop on the plan: recorded in the undo window, then stopped (the plan shows the Red run the server serves)
      let errors = await openPlan(page, { theme, size });
      dirty = true;
      await ready(page);
      await page.getByRole("button", { name: stopLabel("Crew B") }).click();
      await expect(bar(page)).toContainText("Stop recorded.");
      await gate(page, errors, { locale: "en", spine: true, ...(width === "390" ? {} : { hero: false }) }, `stop-recorded-${width}-${theme}`);
      await expect(bar(page)).toContainText("Work stopped 11:10", { timeout: 15_000 });
      await expect(page.locator("[data-block='stopped']").first()).toBeVisible();
      await gate(page, errors, { locale: "en", spine: true, ...(width === "390" ? {} : { hero: false }) }, `stopped-${width}-${theme}`);
      await resetEpoch(page);
      dirty = false;

      // no signal: kept on the phone, never "recorded"
      errors = await openPlan(page, { theme, size });
      dirty = true;
      await ready(page);
      await context.setOffline(true);
      await page.getByRole("button", { name: stopLabel("Crew B") }).click();
      await expect(bar(page)).toContainText("Not sent: no signal. Tell the crew now.");
      await expect(bar(page)).not.toContainText("six minutes");
      await gate(page, errors, { locale: "en", spine: true, ...(width === "390" ? {} : { hero: false }) }, `stopped-offline-${width}-${theme}`);
      await context.setOffline(false);
      await expect(bar(page)).toContainText("Work stopped", { timeout: 15_000 });
      await resetEpoch(page);
      dirty = false;
    }
  }
});
