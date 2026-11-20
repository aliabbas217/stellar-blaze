import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { watchConsole } from "./gate.ts";
import { INSTALL_TIMEOUT_MS } from "./helpers/service-worker.ts";

/*
 * The landing's forecast scene when a SERVICE WORKER is in the picture. Every title contains "landing" and "service worker".
 *
 * Why it exists: the landing's scene (landing-scene.ts, plain WebGL on the page's own thread) starts after first paint and fetches three files
 * of its own from /data/ (the terrain, the outline and the satellite image) and the forecast grid from /data/static/. A returning visitor has a
 * service worker that controls the page and may answer those requests; a first visitor's worker takes the page over while the scene starts. The
 * scene must go live in all of these, or leave the still image, and in no case log an error or break the page. (The earlier landing started a
 * terrain Web Worker whose bootstrap config the service worker's cache once stripped; that worker no longer exists, and this spec now guards the
 * scene's own requests instead of the worker's script.)
 *
 * The other landing specs never see it: each of their tests is a brand-new browser context, whose first load is not controlled.
 * These tests make the service worker take part, in the situations a visitor can be in:
 *   - returning visit:  the worker is active and controls the page when the landing opens (loadControlled), 20 loads;
 *   - first visit race: a brand-new context; the scene is held back (idle callbacks wait) until the worker has claimed the page, which is what
 *                       a slow page on a fast install does. The page records, when the scene asks for its first file, whether the service
 *                       worker already controlled it: the test fails if the race did not happen (not vacuous);
 *   - offline:          a returning visitor with no network gets the scene or the still image, never a broken page;
 *   - blocked file:     a scene file that cannot be fetched leaves the still image (the designed fallback) and no uncaught error.
 * Each load must report no console error, no uncaught error and no failed request, and, where the browser has WebGL, draw the live scene, not
 * the still image (SB_E2E_REQUIRE_WEBGL=1 makes a host without WebGL a failure, as in judge-landing.spec.ts).
 */

const LOADS = 20;
const REQUIRE_WEBGL = process.env.SB_E2E_REQUIRE_WEBGL === "1";
const WIDE = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

type SceneMode = "live" | "poster";

/** The page is whole: the chapter rail with its seven links, the map box, and nothing running sideways (the landing has no header or spine for the app's design gate). */
async function expectIntact(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), "nothing runs sideways").toBeLessThanOrEqual(0);
  await expect(page.locator("nav.rail a[href^='#']")).toHaveCount(7);
  await expect(page.locator("#forecast .mapwrap")).toBeVisible();
}

interface Load {
  readonly mode: SceneMode;
  readonly errors: readonly string[];
  /** For each request the page made for the scene's first file: was the page controlled by the service worker at that moment? */
  readonly controlledAtSceneStart: readonly boolean[];
}

/** Records, for the request of the scene's first data file, whether the service worker controlled the page then. Runs before any page script. */
async function recordSceneStarts(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __sceneStarts: boolean[] };
    w.__sceneStarts = [];
    const real = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/data/uae-geo.json")) w.__sceneStarts.push(navigator.serviceWorker.controller !== null);
      return real(input, init);
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

async function settle(page: Page): Promise<SceneMode> {
  const stage = page.locator("#forecast");
  await expect(stage).toHaveAttribute("data-scene", /^(live|poster)$/, { timeout: 30_000 });
  return (await stage.getAttribute("data-scene")) === "live" ? "live" : "poster";
}

/** Opens the landing in `page` and reads what happened. `errors` is collected by the caller's `watchConsole`. */
async function measure(page: Page, errors: string[], url: string): Promise<Load> {
  await page.goto(url);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const mode = await settle(page);
  await page.waitForTimeout(700); // a late warning shows up here
  const controlledAtSceneStart = await page.evaluate(() => (window as unknown as { __sceneStarts?: boolean[] }).__sceneStarts ?? []);
  return { mode, errors: [...errors], controlledAtSceneStart };
}

/** The project's base URL (a context made with `browser.newContext` does not inherit it). */
function requireBase(baseURL: string | undefined): string {
  if (baseURL === undefined) throw new Error("playwright.config.ts sets no baseURL");
  return baseURL;
}

function expectGood(load: Load, label: string): void {
  expect(load.errors, `${label}: the browser reported`).toEqual([]);
  if (REQUIRE_WEBGL) expect(load.mode, `${label}: SB_E2E_REQUIRE_WEBGL=1, the live scene must run, not the still image`).toBe("live");
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

  test("landing service worker returning visit: the scene starts on every controlled load (20 loads)", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL: requireBase(baseURL), viewport: WIDE });
    await installServiceWorker(context);
    for (let i = 0; i < LOADS; i++) {
      const page = await context.newPage();
      await recordSceneStarts(page);
      const errors = watchConsole(page);
      const load = await measure(page, errors, "/en");
      expect(await page.evaluate(() => navigator.serviceWorker.controller !== null), `load ${String(i)}: the service worker controls the page`).toBe(true);
      expectGood(load, `returning visit, load ${String(i)}`);
      await page.close();
    }
    await context.close();
  });

  test("landing service worker first visit: the worker takes the page over before the scene starts (20 loads)", async ({ browser, baseURL }) => {
    for (let i = 0; i < LOADS; i++) {
      const context = await browser.newContext({ baseURL: requireBase(baseURL), viewport: i % 2 === 0 ? WIDE : PHONE });
      const page = await context.newPage();
      await recordSceneStarts(page);
      await holdIdleUntilClaimed(page);
      const errors = watchConsole(page);
      const load = await measure(page, errors, i % 4 < 2 ? "/en" : "/ar");
      if (load.mode === "live") {
        expect(load.controlledAtSceneStart, `load ${String(i)}: the race happened (the scene asked for its files under the service worker's control)`).toEqual([true]);
      }
      expectGood(load, `first visit, load ${String(i)}`);
      await context.close();
    }
  });

  test("landing service worker offline: a returning visitor gets the scene or the still image, never a broken page", async ({ browser, baseURL }) => {
    const context: BrowserContext = await browser.newContext({ baseURL: requireBase(baseURL), viewport: WIDE });
    await installServiceWorker(context);
    const warm = await context.newPage(); // one controlled visit stores the page itself, as any returning visitor has
    await warm.goto("/en");
    await settle(warm);
    await warm.close();
    await context.setOffline(true);
    const page = await context.newPage();
    const uncaught: string[] = [];
    page.on("pageerror", (error) => uncaught.push(error.message));
    await page.goto("/en");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const mode = await settle(page);
    await page.waitForTimeout(700);
    // Offline, the page comes from the precache; the scene's files come from the browser's caches where it has them. Where any is missing the scene
    // gives up and the still image is the page: both are right, a blank map or an uncaught error is not.
    expect(["live", "poster"]).toContain(mode);
    if (mode === "poster") await expect(page.locator("#forecast img.poster")).toBeVisible();
    expect(uncaught, "an uncaught error on the page").toEqual([]);
    await expectIntact(page);
    await context.setOffline(false);
    await context.close();
  });

  test("landing service worker: a scene file that cannot be fetched leaves the still image and no uncaught error", async ({ browser, baseURL }) => {
    const context: BrowserContext = await browser.newContext({ baseURL: requireBase(baseURL), viewport: WIDE });
    await installServiceWorker(context);
    const page = await context.newPage();
    // The page's own fetch of the terrain file fails (a request made on a controlled page goes to the service worker, which a page.route cannot see, so it fails here, before it leaves the page).
    await page.addInitScript(() => {
      const real = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        return url.includes("/data/uae-dem.bin") ? Promise.reject(new TypeError("Failed to fetch")) : real(input, init);
      };
    });
    const uncaught: string[] = [];
    page.on("pageerror", (error) => uncaught.push(error.message));
    await page.goto("/en");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const mode = await settle(page);
    await page.waitForTimeout(700);
    expect(mode, "the scene's terrain file cannot load: the still image of the same map is the page").toBe("poster");
    await expect(page.locator("#forecast img.poster")).toBeVisible();
    expect(uncaught, "an uncaught error on the page").toEqual([]);
    await expectIntact(page);
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
