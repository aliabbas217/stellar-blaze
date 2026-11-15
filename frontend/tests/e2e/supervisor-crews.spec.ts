import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import en from "../../messages/en.json";
import { SITE_DEMO } from "../../src/mocks/fixtures.ts";
import { gateReport, watchConsole, type GateOptions } from "./gate.ts";
import { withScenario, type Scenario } from "./helpers/scenario.ts";

/*
 * The hero share (35 % of the first fold) is asserted at 390 x 844, the field main width; at 768 the phone column is 440 px inside a
 * wider fold, so the share is printed there, not asserted (the same rule as the worker views). The gate's loops reset the demo epoch
 * only where a stop was made.
 *
 * The supervisor's crews screen (F2 Task 19) in a production build against the mock API: which crew needs the supervisor first,
 * every crew across the day, and Stop work. Every title contains "supervisor crews", so `pnpm e2e -g "supervisor crews"` selects
 * them. The replay clock is 3 Sep 2026 at 11:10 (`?at=` moves it): at 11:10 every crew is off shift (the roster is 06:00 to 11:00
 * and 15:00 to 18:00), at 09:30 they are working. The mock server keeps stops in memory, so each test starts from a reset epoch.
 *
 * With GATE_SHOTS=1 the gate tests also write their PNGs to docs/design/f2/gate/supervisor-crews/ (the controller stages that folder).
 */

type Theme = "night" | "sun";
const PHONE = { width: 390, height: 844 };
const TABLET = { width: 768, height: 1024 };
const SHOTS = process.env["GATE_SHOTS"] === "1";
const SHOT_DIR = path.resolve(process.cwd(), "../docs/design/f2/gate/supervisor-crews");
const stopLabel = (crew: string) => en.supervisor.stop.button.replace("<bdi>{crew}</bdi>", crew);

interface Opening {
  readonly theme?: Theme;
  readonly scenario?: Scenario;
  readonly at?: string;
  readonly size?: { width: number; height: number };
  readonly offline?: boolean;
}

/**
 * Starts a new demo epoch (the mock keeps stops in memory). The BFF lets one client make 20 token-bearing requests in a minute,
 * so a run that resets often meets its own 429: it waits for the window and asks again.
 */
async function resetEpoch(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 14; attempt += 1) {
    const response = await page.request.post(`/api/v1/sites/${SITE_DEMO}/demo-reset`);
    if (response.ok()) return;
    expect(response.status(), "demo-reset is only ever refused for its limit").toBe(429);
    await page.waitForTimeout(5_000);
  }
  throw new Error("demo-reset kept answering 429");
}

/**
 * The day plan GET draws on that same budget (one per page load), and the gate loads the page dozens of times a minute. The first
 * answer for a crew is the real one through the BFF; later loads in this run are served the same body, so the measurements are
 * the screen's and not the limiter's. (The budget cost of one load, one request, is a finding in the report.)
 */
/** True when the mock API may hold a stop made by this run (and at the start, when it may hold anything): the next opening, or the end of the test, resets. */
let dirty = true;

/**
 * The BFF lets one client create or clear 10 stops a minute (its Stop work reserve, rate-limit.ts). The tests that act spend from
 * it, so each waits until the minute before it has left room: a stop refused for that limit would be the limiter's answer, not
 * the screen's. Requests are counted as the page makes them (a stubbed 429 counts too, which only waits a little longer).
 */
const STOP_WINDOW_MS = 62_000;
const STOP_PER_WINDOW = 9;
const stopRequests: number[] = [];

function watchStopRequests(page: Page): void {
  page.on("request", (request) => {
    if ((request.method() === "POST" || request.method() === "DELETE") && /\/api\/v1\/crews\/[^/]+\/stops/.test(request.url())) stopRequests.push(Date.now());
  });
}

async function awaitStopBudget(page: Page, needed: number): Promise<void> {
  for (;;) {
    const recent = stopRequests.filter((at) => Date.now() - at < STOP_WINDOW_MS).length;
    if (recent + needed <= STOP_PER_WINDOW) return;
    await page.waitForTimeout(2_000);
  }
}

const planBodies = new Map<string, string>();
async function cacheDayPlans(page: Page): Promise<void> {
  await page.route("**/api/v1/crews/*/day-plan*", async (route) => {
    const url = route.request().url();
    const held = planBodies.get(url);
    if (held !== undefined) return route.fulfill({ status: 200, contentType: "application/json", body: held });
    const response = await route.fetch();
    if (response.ok()) planBodies.set(url, await response.text());
    return route.fulfill({ response });
  });
}

async function openCrews(page: Page, { theme = "night", scenario, at, size = PHONE, offline = false }: Opening = {}): Promise<string[]> {
  if (dirty) {
    await resetEpoch(page);
    dirty = false;
  }
  const errors = watchConsole(page);
  watchStopRequests(page);
  await page.setViewportSize(size);
  await withScenario(page, scenario ?? null);
  await cacheDayPlans(page);
  await page.addInitScript((chosen) => {
    localStorage.setItem("sb-theme", JSON.stringify({ theme: chosen, until: Date.now() + 6 * 3_600_000 }));
  }, theme);
  if (offline) {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
    });
  }
  await page.goto(`/en/supervisor${at === undefined ? "" : `?at=${at}`}`);
  return errors;
}

test.afterEach(async ({ page }) => {
  if (dirty) {
    await resetEpoch(page);
    dirty = false;
  }
});

// The crews screen is online-only (F2 decision D2: no supervisor route is cached), and a page route that holds or refuses a request
// is bypassed by a service worker that has taken the page over, so the worker stays out of these tests. Serwist's client then logs
// a registration it never got; the gate ignores that one line.
test.use({ serviceWorkers: "block" });

const bar = (page: Page) => page.locator("[data-emergency]");
const ready = (page: Page) => page.locator("[data-crew]").first().waitFor();

test("supervisor crews: leads with the worst crew in one sentence, lists all four, and has one primary action", async ({ page }) => {
  await openCrews(page);
  await ready(page);

  await expect(page.getByRole("heading", { level: 2 })).toHaveText("Crew A is off shift now. Back at 15:00 into Orange.");
  await expect(page.locator("[data-crew]")).toHaveCount(4);
  await expect(page.locator("[data-primary]")).toHaveCount(1);
  await expect(page.locator("[data-primary]")).toHaveText("Open Crew A plan");
  await expect(page.locator("[data-mode-stamp]")).toContainText(en.states.stamp.replay);
  await expect(page.getByText(en.shell.demo.banner)).toBeVisible();
  await expect(page.getByRole("button", { name: en.shell.demo.reset.button })).toBeVisible();
  await expect(page.locator("[data-suppressed-note]")).toHaveText(
    "Crew D has fewer than 5 people, so its health detail is hidden to protect privacy. Its level is shown.",
  );
});

test("supervisor crews: a working crew reads its cycle and the time to the midday break (at 09:30)", async ({ page }) => {
  await openCrews(page, { at: "09:30" });
  await ready(page);

  await expect(page.getByRole("heading", { level: 2 })).toHaveText("Crew A is Amber until 10:00 (work 45, rest 15); midday break in 3 h.");
  // One slot cut through all four rows, one now line.
  await expect(page.locator("[data-slot]")).toHaveCount(1);
  await expect(page.locator("[data-now]")).toHaveCount(1);
});

test("supervisor crews: each row is a link whose focus ring is 3 px in ink", async ({ page }) => {
  await openCrews(page);
  await ready(page);

  // Keyboard focus (so :focus-visible applies): tab until a crew row has it.
  for (let step = 0; step < 40; step += 1) {
    await page.keyboard.press("Tab");
    if (await page.evaluate(() => document.activeElement?.closest("[data-crew]") != null)) break;
  }
  const ring = await page.evaluate(() => {
    const el = document.activeElement;
    if (el === null || el.closest("[data-crew]") === null) return null;
    const style = getComputedStyle(el);
    const probe = document.createElement("span");
    probe.style.color = "var(--ink)";
    document.body.append(probe);
    const ink = getComputedStyle(probe).color;
    probe.remove();
    return { width: style.outlineWidth, style: style.outlineStyle, color: style.outlineColor, offset: style.outlineOffset, ink, href: el.getAttribute("href") };
  });
  expect(ring).not.toBeNull();
  expect(ring).toMatchObject({ width: "3px", style: "solid", offset: "2px", href: "/en/supervisor/crews/crew-a" });
  expect(ring?.color).toBe(ring?.ink);
});

test("supervisor crews: stop work then undo", async ({ page }) => {
  await awaitStopBudget(page, 2);
  await openCrews(page);
  dirty = true;
  await ready(page);

  await page.getByRole("button", { name: stopLabel("Crew A") }).click();

  // The architect's ruling (ADR 0058, second entry): a promise about WHEN (the default dispatch cadence), never "immediately", never a delivery.
  await expect(bar(page)).toContainText("Crew A stopped 11:10. Stop recorded. Crews are notified within about six minutes. Tell the crew now.");
  await expect(bar(page)).not.toContainText(/immediately|alerted|phones|delivered/i);
  await expect(page.getByRole("button", { name: /^Undo \(\d+ s\)$/ })).toBeVisible();
  // The API now has the stop: the list says so (the row names the time), and the focal sentence follows.
  await expect(page.getByRole("heading", { level: 2 })).toContainText("Crew A stopped work at 11:10");

  await page.getByRole("button", { name: /^Undo/ }).click();
  await expect(page.getByRole("button", { name: stopLabel("Crew A") })).toBeVisible();
  await expect(bar(page)).not.toContainText("Stop recorded");

  // Gone on the API too: a reload shows the idle bar and the first sentence again.
  await page.reload();
  await ready(page);
  await expect(page.getByRole("button", { name: stopLabel("Crew A") })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2 })).toHaveText("Crew A is off shift now. Back at 15:00 into Orange.");
});

test("supervisor crews: after 10 s the bar reads Work stopped with Resume work behind a confirm dialog", async ({ page }) => {
  await awaitStopBudget(page, 2);
  test.setTimeout(60_000);
  await openCrews(page);
  dirty = true;
  await ready(page);
  await page.getByRole("button", { name: stopLabel("Crew A") }).click();
  await expect(page.getByRole("button", { name: /^Undo/ })).toBeVisible();

  await expect(bar(page)).toContainText("Work stopped 11:10", { timeout: 15_000 });
  await expect(page.getByRole("button", { name: /^Undo/ })).toHaveCount(0);

  await page.getByRole("button", { name: en.supervisor.stop.resume }).click();
  const dialog = page.getByRole("dialog", { name: "Resume work for Crew A?" });
  await expect(dialog).toBeVisible();
  // The least risky choice is the focused one, and Escape is the same as choosing it.
  await expect(dialog.getByRole("button", { name: en.supervisor.stop.resumeCancel })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(bar(page)).toContainText("Work stopped 11:10");

  await page.getByRole("button", { name: en.supervisor.stop.resume }).click();
  await dialog.getByRole("button", { name: en.supervisor.stop.resumeConfirm }).click();
  await expect(page.getByRole("button", { name: stopLabel("Crew A") })).toBeVisible();
});

test("supervisor crews: a stop pressed with no signal reads Not sent, is kept on the phone, and is sent when the signal returns", async ({
  page,
  context,
}) => {
  await awaitStopBudget(page, 1);
  await openCrews(page);
  dirty = true;
  await ready(page);
  await context.setOffline(true);

  await page.getByRole("button", { name: stopLabel("Crew A") }).click();

  await expect(bar(page)).toContainText("Not sent: no signal. Tell the crew now.");
  await expect(bar(page)).not.toContainText("Stop recorded");
  const rows = await page.evaluate(
    () =>
      new Promise<unknown[]>((resolve, reject) => {
        const open = indexedDB.open("sb-stop-outbox-v1");
        open.onerror = () => {
          reject(open.error ?? new Error("open failed"));
        };
        open.onsuccess = () => {
          const all = open.result.transaction("stops", "readonly").objectStore("stops").getAll();
          all.onsuccess = () => {
            open.result.close();
            resolve(all.result);
          };
        };
      }),
  );
  expect(rows).toHaveLength(1);
  expect(Object.keys(rows[0] as object).sort()).toEqual(["clientTime", "crewId", "key"]);

  await context.setOffline(false);
  await expect(bar(page)).toContainText("Work stopped", { timeout: 15_000 });
});

test("supervisor crews: a 429 on Stop reads Not sent and the button works again", async ({ page }) => {
  await awaitStopBudget(page, 1);
  await openCrews(page);
  dirty = true;
  await ready(page);
  let refuse = true;
  await page.route("**/api/v1/crews/*/stops", (route) => {
    if (route.request().method() === "POST" && refuse) {
      return route.fulfill({
        status: 429,
        contentType: "application/problem+json",
        body: JSON.stringify({ type: "urn:stellar-blaze:problem:rate-limited", title: "Too many requests", status: 429, request_id: "req-429" }),
      });
    }
    return route.continue();
  });

  await page.getByRole("button", { name: stopLabel("Crew A") }).click();
  await expect(bar(page)).toContainText("Not sent. Tell the crew now.");
  refuse = false;
  await page.getByRole("button", { name: stopLabel("Crew A") }).click();
  await expect(bar(page)).toContainText("Stop recorded");
});

test("supervisor crews: Stop work is there, and works, while the crew list is still loading", async ({ page }) => {
  await awaitStopBudget(page, 1);
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v1/sites/*/crews", async (route) => {
    await gate;
    await route.continue();
  });
  await openCrews(page);
  dirty = true;

  // The list has not come: the bar is live (the demo's own crew stands in) and a press records a stop.
  const press = page.getByRole("button", { name: en.supervisor.stop.buttonGeneric });
  await expect(press).toBeVisible();
  await expect(press).toBeEnabled();
  await press.click();
  await expect(bar(page)).toContainText("Stop recorded");
  release();
  await ready(page);
});

test("supervisor crews: an empty site is an actionable state, and the bar says there is no crew to stop", async ({ page }) => {
  await openCrews(page, { scenario: "empty" });

  await expect(page.getByText(en.supervisor.crews.empty.title)).toBeVisible();
  await expect(page.getByRole("link", { name: en.supervisor.crews.empty.primary })).toHaveAttribute("href", "/en");
  await expect(bar(page)).toHaveText(en.supervisor.stop.noCrews);
});

test("supervisor crews: a stale forecast says 'No fresh forecast: protective plan'", async ({ page }) => {
  await openCrews(page, { scenario: "stale" });
  await ready(page);

  await expect(page.getByText(en.supervisor.crews.stale.title)).toBeVisible();
  await expect(page.locator('[data-cell][data-heat="data"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: stopLabel("Crew A") })).toBeEnabled();
});

test("supervisor crews: the error state names the failure with its request id and keeps Stop work", async ({ page }) => {
  await openCrews(page, { scenario: "error" });

  await expect(page.getByText(en.supervisor.crews.error.title)).toBeVisible();
  await expect(page.getByText("mock-req-1").first()).toBeVisible();
  await expect(page.getByRole("button", { name: en.supervisor.stop.buttonGeneric })).toBeEnabled();
});

test("supervisor crews: Reset demo site starts a new epoch and the crews screen refreshes", async ({ page }) => {
  await awaitStopBudget(page, 1);
  await openCrews(page);
  dirty = true;
  await ready(page);
  await page.getByRole("button", { name: stopLabel("Crew A") }).click();
  await expect(bar(page)).toContainText("Stop recorded");

  await page.getByRole("button", { name: en.shell.demo.reset.button }).click();
  await expect(page.getByRole("status").filter({ hasText: /new epoch/ })).toBeVisible();
  await expect(page.getByRole("button", { name: stopLabel("Crew A") })).toBeVisible();
});

// --- the design gate: every state, 390 and 768, night and sun ------------------------------------------------------------------

async function gate(page: Page, errors: string[], options: Omit<GateOptions, "consoleErrors" | "field">, label: string): Promise<void> {
  // The API fails on purpose in the error state, a refused write is a 429, and offline aborts requests: those are the state.
  const consoleErrors = errors.filter(
    (message) =>
      !/^HTTP (500|429) .*\/api\/v1\//.test(message) &&
      !/net::ERR_INTERNET_DISCONNECTED/.test(message) &&
      !/Cannot read properties of undefined \(reading 'waiting'\)/.test(message),
  );
  await page.evaluate(() => document.fonts.ready);
  const report = await gateReport(page, { consoleErrors, field: true, ...options });
  await test.info().attach(`gate-${label}.json`, { body: JSON.stringify(report, null, 2), contentType: "application/json" });
  console.log(
    `gate ${label}: hero=${report.heroShare === null ? "-" : `${(report.heroShare * 100).toFixed(1)}%`} minText=${String(report.minTextPx)} minTarget=${report.minTargetPx.toFixed(0)} overflow=${String(report.overflowPx)} label=${String(report.minFieldLabelPx)} primaries=${String(report.primariesInFold)}`,
  );
  if (SHOTS) {
    mkdirSync(SHOT_DIR, { recursive: true });
    // The first fold as the phone shows it (the Stop bar pinned to the foot), then the whole page with the bar laid at the end of it:
    // a full-page capture would otherwise float the fixed bar in the middle of the image.
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
  readonly opening: Omit<Opening, "theme" | "size">;
  readonly options: Omit<GateOptions, "consoleErrors" | "field">;
  /** What proves the state is on screen before it is measured. */
  readonly settle: (page: Page) => Promise<void>;
}

const STATES: readonly GateState[] = [
  { name: "ideal", opening: {}, options: { spine: true }, settle: ready },
  { name: "working", opening: { at: "09:30" }, options: { spine: true }, settle: ready },
  { name: "partial", opening: { scenario: "suppressed" }, options: { spine: true }, settle: ready },
  { name: "stale", opening: { scenario: "stale" }, options: { spine: true }, settle: ready },
  { name: "offline", opening: { offline: true }, options: { spine: true }, settle: ready },
  { name: "empty", opening: { scenario: "empty" }, options: { hero: false }, settle: async (page) => page.getByText(en.supervisor.crews.empty.title).waitFor() },
  { name: "error", opening: { scenario: "error" }, options: { hero: false }, settle: async (page) => page.getByText(en.supervisor.crews.error.title).waitFor() },
];

for (const state of STATES) {
  test(`supervisor crews pass the design gate: ${state.name}, 390 and 768, night and sun`, async ({ page }) => {
    for (const [width, size] of SIZES) {
      for (const theme of ["night", "sun"] as const) {
        const errors = await openCrews(page, { ...state.opening, theme, size });
        await state.settle(page);
        await gate(page, errors, { locale: "en", ...state.options, ...(width === "390" ? {} : { hero: false }) }, `${state.name}-${width}-${theme}`);
      }
    }
  });
}

test("supervisor crews pass the design gate: loading, 390 and 768, night and sun", async ({ page }) => {
  for (const [width, size] of SIZES) {
    for (const theme of ["night", "sun"] as const) {
      let release: () => void = () => undefined;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.unroute("**/api/v1/sites/*/crews");
      await page.route("**/api/v1/sites/*/crews", async (route) => {
        await held;
        await route.continue();
      });
      const errors = await openCrews(page, { theme, size });
      await expect(page.locator('[aria-busy="true"] [data-skeleton]').first()).toBeVisible();
      await gate(page, errors, { locale: "en", hero: false }, `loading-${width}-${theme}`);
      release();
    }
  }
});

test("supervisor crews pass the design gate: the stop states (recorded with undo, stopped, queued, refused), 390 and 768, night and sun", async ({
  page,
  context,
}) => {
  test.setTimeout(420_000);
  for (const [width, size] of SIZES) {
    for (const theme of ["night", "sun"] as const) {
      await awaitStopBudget(page, 2);
      // recorded, in the undo window
      let errors = await openCrews(page, { theme, size });
      dirty = true;
      await ready(page);
      await page.getByRole("button", { name: stopLabel("Crew A") }).click();
      await expect(bar(page)).toContainText("Stop recorded");
      await gate(page, errors, { locale: "en", spine: true, ...(width === "390" ? {} : { hero: false }) }, `stop-recorded-${width}-${theme}`);

      // stopped for good (after the undo window)
      await expect(bar(page)).toContainText("Work stopped 11:10", { timeout: 15_000 });
      await gate(page, errors, { locale: "en", spine: true, ...(width === "390" ? {} : { hero: false }) }, `stop-stopped-${width}-${theme}`);

      // queued: no signal
      errors = await openCrews(page, { theme, size });
      dirty = true;
      await ready(page);
      await context.setOffline(true);
      await page.getByRole("button", { name: stopLabel("Crew A") }).click();
      await expect(bar(page)).toContainText("Not sent: no signal");
      await gate(page, errors, { locale: "en", spine: true, ...(width === "390" ? {} : { hero: false }) }, `stop-queued-${width}-${theme}`);
      await context.setOffline(false);
      await expect(bar(page)).toContainText("Work stopped", { timeout: 15_000 });

      // refused (429)
      errors = await openCrews(page, { theme, size });
      dirty = true;
      await ready(page);
      await page.route("**/api/v1/crews/*/stops", (route) =>
        route.request().method() === "POST"
          ? route.fulfill({
              status: 429,
              contentType: "application/problem+json",
              body: JSON.stringify({ type: "urn:stellar-blaze:problem:rate-limited", title: "Too many requests", status: 429, request_id: "req-429" }),
            })
          : route.continue(),
      );
      await page.getByRole("button", { name: stopLabel("Crew A") }).click();
      await expect(bar(page)).toContainText("Not sent. Tell the crew now.");
      await gate(page, errors, { locale: "en", spine: true, ...(width === "390" ? {} : { hero: false }) }, `stop-refused-${width}-${theme}`);
      await page.unroute("**/api/v1/crews/*/stops");
    }
  }
});
