import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { gateReport, watchConsole } from "./gate.ts";
import { INSTALL_TIMEOUT_MS } from "./helpers/service-worker.ts";

/*
 * The landing's WebGL scene when a SERVICE WORKER is in the picture. Every title contains "landing" and "service worker".
 *
 * Why it exists: "Missing worker bootstrap config" was logged once in a production gate run (a first load), and was then
 * reproduced on EVERY load a service worker controlled (a returning visit: 9 of 9). Turbopack hands the terrain worker its
 * config in the `#params=` fragment of the worker script's URL and the worker reads it back from its own `self.location`; the
 * location of a worker is the URL of the response that delivered its script, and a response the service worker serves from
 * Cache Storage (the precache holds every `_next/static` chunk) has the URL it was stored under, without the fragment. The
 * worker threw, and the page fell back to the 2D field with a console error. The fix is in src/features/pwa/worker-scripts.ts
 * (the service worker does not answer worker scripts); the unit test there runs Serwist's real listeners.
 *
 * The other landing specs never see it: each of their tests is a brand-new browser context, whose first load is not controlled.
 * These tests make the service worker take part, in the three situations a visitor can be in:
 *   - returning visit:  the worker is active and controls the page when the landing opens (loadControlled), 20 loads;
 *   - first visit race: a brand-new context; the scene is held back (idle callbacks wait) until the worker has claimed the page,
 *                       which is what a slow page on a fast install does. The page records, when the scene's worker is created,
 *                       whether the service worker already controlled it: the test fails if the race did not happen (not vacuous);
 *   - offline:          a returning visitor with no network gets the scene (its worker script comes from the browser's own HTTP
 *                       cache, which the service worker no longer shadows) or the 2D field, never a broken page;
 *   - blocked script:   a worker script that cannot be fetched leaves the 2D field (the designed fallback) and no uncaught error.
 * Each load must: report no console error, no uncaught error and no failed request; start the scene's worker with its
 * `#params=` config intact in `self.location` (read from the worker itself); and, where the browser has WebGL, draw the scene on
 * the WebGL path, not the 2D fallback (SB_E2E_REQUIRE_WEBGL=1 makes a host without WebGL a failure, as in judge-landing.spec.ts).
 * To prove the tests are not vacuous, revert src/app/sw.ts to `serwist.addEventListeners()`, rebuild, and run them: the returning
 * visit and first visit tests fail on every load.
 */

const LOADS = 20;
const REQUIRE_WEBGL = process.env.SB_E2E_REQUIRE_WEBGL === "1";
const WIDE = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

interface Load {
  readonly path: string;
  readonly errors: readonly string[];
  /** `self.location.href` of every worker the page started, read from the workers themselves. */
  readonly workerLocations: readonly string[];
  /** For each `new Worker(...)`: was the page controlled by the service worker at that moment? */
  readonly controlledAtWorkerStart: readonly boolean[];
}

/** Records, for every worker the page creates, whether the service worker controlled the page then. Runs before any page script. */
async function recordWorkerStarts(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __workerStarts: boolean[]; Worker: typeof Worker };
    w.__workerStarts = [];
    const Real = w.Worker;
    w.Worker = class extends Real {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        w.__workerStarts.push(navigator.serviceWorker.controller !== null);
      }
    };
  });
}

/** The first-visit race: idle callbacks (what starts the scene) wait for the service worker to take the page over, at most 15 s. */
async function holdIdleUntilClaimed(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const original = window.requestIdleCallback.bind(window);
    const originalCancel = window.cancelIdleCallback.bind(window);
    const held = new Map<number, () => void>();
    let next = 1_000_000;
    const claimed = new Promise<void>((resolve) => {
      if (navigator.serviceWorker.controller !== null) resolve();
      else {
        navigator.serviceWorker.addEventListener("controllerchange", () => { resolve(); }, { once: true });
      }
      setTimeout(resolve, 15_000);
    });
    window.requestIdleCallback = (callback, options) => {
      const id = next++;
      held.set(id, () => {
        original(callback, options);
      });
      void claimed.then(() => held.get(id)?.());
      return id;
    };
    window.cancelIdleCallback = (id) => {
      if (!held.delete(id)) originalCancel(id);
    };
  });
}

async function settle(page: Page): Promise<string> {
  const stage = page.locator("[data-field-stage][data-field-path]");
  await expect(stage).toBeAttached({ timeout: 20_000 });
  try {
    await expect(stage).toHaveAttribute("data-field-path", "webgl", { timeout: 9_000 });
  } catch {
    // the scene did not take over: the 2D field is the page
  }
  return (await stage.getAttribute("data-field-path")) ?? "";
}

/** Opens the landing in `page` and reads what happened. `errors` is collected by the caller's `watchConsole`. */
async function measure(page: Page, errors: string[], url: string): Promise<Load> {
  const locations: string[] = [];
  page.on("worker", (worker) => {
    void worker.evaluate(() => self.location.href).then((href) => locations.push(href), () => undefined);
  });
  await page.goto(url);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const path = await settle(page);
  await page.waitForTimeout(700); // a worker's bootstrap error or a late warning shows up here
  const controlledAtWorkerStart = await page.evaluate(() => (window as unknown as { __workerStarts?: boolean[] }).__workerStarts ?? []);
  return { path, errors: [...errors], workerLocations: locations, controlledAtWorkerStart };
}

/** The project's base URL (a context made with `browser.newContext` does not inherit it). */
function requireBase(baseURL: string | undefined): string {
  if (baseURL === undefined) throw new Error("playwright.config.ts sets no baseURL");
  return baseURL;
}

function expectGood(load: Load, label: string, origin: string): void {
  expect(load.errors, `${label}: the browser reported`).toEqual([]);
  if (REQUIRE_WEBGL) expect(load.path, `${label}: SB_E2E_REQUIRE_WEBGL=1, the WebGL scene must run, not fall back to 2D`).toBe("webgl");
  if (load.path === "webgl") {
    expect(load.workerLocations.length, `${label}: the scene started a worker`).toBeGreaterThan(0);
    for (const href of load.workerLocations) {
      expect(href, `${label}: the worker kept its bootstrap config in its own location`).toContain("#params=");
      expect(href.startsWith(`${origin}/_next/static/`), `${label}: a same-origin chunk`).toBe(true);
    }
  }
}

/** Waits until the app's worker is active (the page that did it is then closed by the caller). */
async function installServiceWorker(context: BrowserContext): Promise<void> {
  const page = await context.newPage();
  await page.goto("/en");
  await expect
    .poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map((registration) => registration.active?.state)), {
      message: "the app registers a service worker and it activates",
      timeout: INSTALL_TIMEOUT_MS,
    })
    .toEqual(["activated"]);
  await page.close();
}

test.describe("landing and the service worker", () => {
  test.setTimeout(8 * 60_000);

  test("landing service worker returning visit: the scene starts with its config on every controlled load (20 loads)", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL: requireBase(baseURL), viewport: WIDE });
    await installServiceWorker(context);
    for (let i = 0; i < LOADS; i++) {
      const page = await context.newPage();
      await recordWorkerStarts(page);
      const errors = watchConsole(page);
      const load = await measure(page, errors, "/en");
      expect(await page.evaluate(() => navigator.serviceWorker.controller !== null), `load ${String(i)}: the service worker controls the page`).toBe(true);
      expectGood(load, `returning visit, load ${String(i)}`, requireBase(baseURL));
      await page.close();
    }
    await context.close();
  });

  test("landing service worker first visit: the worker takes the page over before the scene starts (20 loads)", async ({ browser, baseURL }) => {
    for (let i = 0; i < LOADS; i++) {
      const context = await browser.newContext({ baseURL: requireBase(baseURL), viewport: i % 2 === 0 ? WIDE : PHONE });
      const page = await context.newPage();
      await recordWorkerStarts(page);
      await holdIdleUntilClaimed(page);
      const errors = watchConsole(page);
      const load = await measure(page, errors, i % 4 < 2 ? "/en" : "/ar");
      if (load.path === "webgl") {
        expect(load.controlledAtWorkerStart, `load ${String(i)}: the race happened (the scene's worker was created under the service worker's control)`).toEqual([true]);
      }
      expectGood(load, `first visit, load ${String(i)}`, requireBase(baseURL));
      await context.close();
    }
  });

  test("landing service worker offline: a returning visitor gets the scene from the browser's own cache or the 2D field, never a broken page", async ({ browser, baseURL }) => {
    const context: BrowserContext = await browser.newContext({ baseURL: requireBase(baseURL), viewport: WIDE });
    await installServiceWorker(context);
    const warm = await context.newPage(); // one controlled visit stores the page itself, as any returning visitor has
    await warm.goto("/en");
    await settle(warm);
    await warm.close();
    await context.setOffline(true);
    const page = await context.newPage();
    const uncaught: string[] = [];
    const locations: string[] = [];
    page.on("pageerror", (error) => uncaught.push(error.message));
    page.on("worker", (worker) => {
      void worker.evaluate(() => self.location.href).then((href) => locations.push(href), () => undefined);
    });
    await page.goto("/en");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const path = await settle(page);
    await page.waitForTimeout(700);
    // The service worker leaves the worker script alone, so offline it comes from the browser's HTTP cache (the chunk is immutable and
    // the warm visit loaded it): the scene runs with its config. Where that cache is empty the script fails and the 2D field is the page.
    expect(["webgl", "2d"]).toContain(path);
    if (path === "webgl") for (const href of locations) expect(href).toContain("#params=");
    expect(uncaught, "an uncaught error on the page").toEqual([]);
    const report = await gateReport(page, { consoleErrors: [], spine: true, hero: false });
    expect(report.failures).toEqual([]);
    await context.setOffline(false);
    await context.close();
  });

  test("landing service worker: a worker script that cannot be fetched leaves the 2D field and no uncaught error", async ({ browser, baseURL }) => {
    const context: BrowserContext = await browser.newContext({ baseURL: requireBase(baseURL), viewport: WIDE });
    await installServiceWorker(context);
    const page = await context.newPage(); // controlled: the service worker passes the script request on, so the route below sees it
    await page.route(/\/turbopack-worker-[^/]*\.js/, (route) => route.abort("failed"));
    const uncaught: string[] = [];
    page.on("pageerror", (error) => uncaught.push(error.message));
    await page.goto("/en");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const path = await settle(page);
    await page.waitForTimeout(700);
    expect(path, "the scene's worker cannot start: the 2D field of the same data is the page").toBe("2d");
    expect(uncaught, "an uncaught error on the page").toEqual([]);
    const report = await gateReport(page, { consoleErrors: [], spine: true, hero: false });
    expect(report.failures).toEqual([]);
    await context.close();
  });

  /*
   * The page asks the browser to look for a newer service worker once per page load (src/features/pwa/update-check.ts, mounted by
   * LocalePrefs in the root layout): a returning visitor would otherwise keep the old worker for up to a day. Counted at
   * `ServiceWorkerRegistration.prototype.update`, the one call the page makes (the browser's own check is not a page call).
   */
  test("service worker update check: every page load asks once, after the first install, and the console stays clean", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL: requireBase(baseURL), viewport: WIDE });
    await context.addInitScript(() => {
      const counts = { update: 0 };
      (window as unknown as { __swUpdateCalls: { update: number } }).__swUpdateCalls = counts;
      const original = Object.getOwnPropertyDescriptor(ServiceWorkerRegistration.prototype, "update")?.value as (this: ServiceWorkerRegistration) => Promise<ServiceWorkerRegistration>;
      ServiceWorkerRegistration.prototype.update = function (this: ServiceWorkerRegistration) {
        counts.update += 1;
        return original.call(this);
      };
    });
    await installServiceWorker(context);
    for (const [i, path] of ["/en", "/en/replay", "/en"].entries()) {
      const page = await context.newPage();
      const errors = watchConsole(page);
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect.poll(() => page.evaluate(() => (window as unknown as { __swUpdateCalls: { update: number } }).__swUpdateCalls.update), {
        message: `load ${String(i)} (${path}): update() is called once`,
        timeout: 15_000,
      }).toBe(1);
      await page.waitForTimeout(1500);
      expect(await page.evaluate(() => (window as unknown as { __swUpdateCalls: { update: number } }).__swUpdateCalls.update), `load ${String(i)} (${path}): and not again`).toBe(1);
      expect(errors, "no console error or unhandled rejection from the check").toEqual([]);
      await page.close();
    }
    await context.close();
  });
});
