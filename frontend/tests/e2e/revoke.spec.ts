import { expect, test, type Page } from "@playwright/test";
import en from "../../messages/en.json";
import { SITE_DEMO } from "../../src/mocks/fixtures.ts";

/*
 * Taking a worker's data back ("Remove my data from this phone" on Alerts, rulings R7, R25, R31 to R33), against a
 * production build (`pnpm build && pnpm start`, API_ORIGIN pointing at `pnpm mock:api`, SB_MOCK_SCENARIOS=1; see pwa.spec.ts).
 * It runs with the real service worker active and controlling the page, because that is the case that matters: Serwist's
 * worker holds its IndexedDB connection open, so a deleteDatabase from the page would be blocked until the browser stops
 * the worker. Clearing the rows completes anyway, and these tests read the browser to prove it.
 */

const INSTALL_TIMEOUT_MS = 20_000;
const PROFILE_KEY = "sb-profile-v1";
const PENDING_KEY = "sb-push-pending-delete-v1";
const INCOMPLETE_KEY = "sb-revoke-incomplete-v1";
const FORECAST = `/api/v1/sites/${SITE_DEMO}/forecast/today`;
const POLICY = "/api/v1/risk-policy";
const SUBSCRIPTION_ID = "sub-e2e-1";

const PROFILE = {
  consentVersion: "2026-11-11",
  consentedAt: "2026-11-11T08:30:00.000Z",
  siteId: SITE_DEMO,
  crewId: null,
  workloadClass: "moderate",
  heatWorkStartDate: "2026-10-01",
  clothingCode: "work_clothes",
};

/** The same wait as pwa.spec.ts: the worker is active and the page, reloaded, is controlled by it. */
async function loadControlled(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect
    .poll(
      () => page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map((registration) => registration.active?.state)),
      { message: "the app registers a service worker and it activates", timeout: INSTALL_TIMEOUT_MS },
    )
    .toEqual(["activated"]);
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null), {
      message: "the page is controlled by the service worker after a reload",
      timeout: INSTALL_TIMEOUT_MS,
    })
    .toBe(true);
}

interface DeviceState {
  /** Every Cache Storage cache name. */
  readonly caches: string[];
  /** The URLs in the API cache. */
  readonly api: string[];
  /**
   * Rows of Serwist's expiration database that belong to a cache a removal clears (the URL and fetch time of each entry).
   * The rows of the static asset caches, which a removal keeps, are not counted: they must stay, or those entries would never expire.
   */
  readonly deviceRows: number;
  /** Of those, the rows that belong to the API cache. */
  readonly apiRows: number;
}

/** What the phone holds, read in the page. Opening the expiration database here does not keep a connection. */
function deviceState(page: Page): Promise<DeviceState> {
  return page.evaluate(async () => {
    const names = await caches.keys();
    const api = names.includes("sb-api") ? (await (await caches.open("sb-api")).keys()).map((request) => new URL(request.url).pathname).sort() : [];
    const cleared = ["sb-api", "apis", "pages", "pages-rsc", "pages-rsc-prefetch", "others"];
    const counts = await new Promise<{ deviceRows: number; apiRows: number }>((resolve, reject) => {
      const open = indexedDB.open("serwist-expiration");
      open.onerror = () => {
        reject(open.error ?? new Error("open failed"));
      };
      open.onsuccess = () => {
        const database = open.result;
        const stores = Array.from(database.objectStoreNames);
        if (stores.length === 0) {
          database.close();
          resolve({ deviceRows: 0, apiRows: 0 });
          return;
        }
        const index = database.transaction("cache-entries", "readonly").objectStore("cache-entries").index("cacheName");
        let deviceRows = 0;
        let apiRows = 0;
        let left = cleared.length;
        for (const name of cleared) {
          const count = index.count(name);
          count.onsuccess = () => {
            deviceRows += count.result;
            if (name === "sb-api") apiRows = count.result;
            left -= 1;
            if (left === 0) {
              database.close();
              resolve({ deviceRows, apiRows });
            }
          };
        }
      };
    });
    return { caches: names.sort(), api, ...counts };
  });
}

/** Puts a profile, and optionally the API's registration of a push subscription, where the app keeps them. */
function seedStore(page: Page, withPush: boolean): Promise<void> {
  return page.evaluate(
    ({ key, profile, push }) => {
      localStorage.setItem(key, JSON.stringify({ state: { profile, push }, version: 1 }));
    },
    {
      key: PROFILE_KEY,
      profile: PROFILE,
      push: withPush ? { serverId: SUBSCRIPTION_ID, endpoint: "https://push.example/send/e2e-revoke", siteId: SITE_DEMO } : null,
    },
  );
}

/**
 * What the app keeps in localStorage around a removal: the profile and push state (a removal empties them), the ids owed to
 * the API, and the marker that says a removal did not finish (written before it starts, removed only when it has).
 */
function storedKeys(page: Page): Promise<{ profile: string | null; pending: string | null; incomplete: string | null }> {
  return page.evaluate(
    ({ profile, pending, incomplete }) => ({
      profile: localStorage.getItem(profile),
      pending: localStorage.getItem(pending),
      incomplete: localStorage.getItem(incomplete),
    }),
    { profile: PROFILE_KEY, pending: PENDING_KEY, incomplete: INCOMPLETE_KEY },
  );
}

/** Opens Alerts for a site and removes the worker's data through the control: two taps, the second on "Yes". */
async function removeMyData(page: Page): Promise<void> {
  await page.getByRole("button", { name: en.alerts.removeData.button }).click();
  await page.getByRole("button", { name: en.alerts.removeData.confirm }).click();
}

/** The live region that carries the result of a removal (the last one on the page). */
const result = (page: Page) => page.getByRole("status").last();

/** From now on, remembers every text the result region holds, so that what it said on the way can be read afterwards. */
async function recordResultRegion(page: Page): Promise<void> {
  await page.evaluate(() => {
    const regions = document.querySelectorAll('[role="status"]');
    const region = regions[regions.length - 1];
    if (region === undefined) throw new Error("There is no live region on the page.");
    const texts = [region.textContent];
    new MutationObserver(() => {
      texts.push(region.textContent);
    }).observe(region, { childList: true, characterData: true, subtree: true });
    Object.defineProperty(window, "resultTexts", { value: texts, configurable: true });
  });
}

const recordedTexts = (page: Page) => page.evaluate(() => (window as unknown as { resultTexts: (string | null)[] }).resultTexts);

/** Fills the API cache and the expiration record with what a worker's visit leaves behind. */
async function visitLikeAWorker(page: Page): Promise<void> {
  await loadControlled(page, "/en/worker");
  await page.evaluate(async (urls) => {
    for (const url of urls) await (await fetch(url)).arrayBuffer();
  }, [FORECAST, POLICY]);
  await seedStore(page, true);
  // Alerts with a site in the URL: a page URL that carries the site id, which the catch-all cache keeps.
  await page.goto(`/en/worker/alerts?site=${SITE_DEMO}`);
  await expect
    .poll(() => deviceState(page), { message: "the worker's visit is cached: the API responses, a page cache and their URLs in IndexedDB" })
    .toMatchObject({ api: [FORECAST, POLICY].sort(), caches: expect.arrayContaining(["sb-api", "others"]) });
  const visited = await deviceState(page);
  expect(visited.deviceRows).toBeGreaterThanOrEqual(3);
  expect(visited.apiRows).toBe(2);
}

test("removing my data leaves no API entry, page URL or expiration row on the phone, with the service worker running", async ({ page, context }) => {
  await page.route("**/api/v1/push/subscriptions/*", (route) => route.fulfill({ status: 204 }));
  await visitLikeAWorker(page);
  expect((await storedKeys(page)).profile).not.toBeNull();

  await recordResultRegion(page);
  await removeMyData(page);

  await expect(result(page)).toHaveText(en.alerts.removeData.done);
  // On the way it never said the removal had failed or was only partly done: the marker is written when a removal begins,
  // naming every step as unfinished, and a screen that read it without knowing one was running would have announced that.
  const said = await recordedTexts(page);
  expect(said).toContain(en.alerts.removeData.done);
  expect(said).not.toContain(en.alerts.removeData.failed);
  expect(said).not.toContain(en.alerts.removeData.pending);
  const after = await deviceState(page);
  // Cache Storage: none of the API caches or the page caches. The precache stays, so the app still opens offline.
  for (const gone of ["sb-api", "apis", "pages", "pages-rsc", "pages-rsc-prefetch", "others"]) expect(after.caches, gone).not.toContain(gone);
  expect(after.caches.some((name) => name.startsWith("serwist-precache"))).toBe(true);
  // IndexedDB: Serwist's record of what it cached holds no row of those caches (the static assets' rows stay).
  expect(after.deviceRows).toBe(0);
  // Local storage: the profile and the push state are gone, and nothing is owed to the API.
  // The marker is gone too: everything finished.
  expect(await storedKeys(page)).toEqual({ profile: null, pending: null, incomplete: null });

  // Still an app: an unvisited route offline is answered by the precached offline page.
  await context.setOffline(true);
  await page.goto("/en/hse");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(en.offline.title);
});

test("with the API out of reach it says the registration is still owed, keeps only its id, and settles it when Alerts opens again", async ({ page }) => {
  await page.route("**/api/v1/push/subscriptions/*", (route) => route.abort("failed"));
  await visitLikeAWorker(page);

  await removeMyData(page);

  await expect(result(page)).toHaveText(en.alerts.removeData.pending);
  await expect(page.getByText(en.alerts.removeData.done, { exact: true })).toHaveCount(0);
  // The local data is gone, and what the phone still holds about the subscription is its id and nothing else.
  const owed = await storedKeys(page);
  expect(owed.profile).toBeNull();
  expect(owed.pending).toBe(JSON.stringify([SUBSCRIPTION_ID]));
  // And the marker says so across a reload: it names no step, only the API's confirmation is outstanding.
  expect(JSON.parse(owed.incomplete ?? "null")).toMatchObject({ v: 1, steps: [] });
  // The caches and the expiration record were cleared all the same: only the API's answer is missing.
  const after = await deviceState(page);
  expect(after.api).toEqual([]);
  expect(after.deviceRows).toBe(0);

  // After a reload, with the API still out of reach, the screen still says so (from the marker alone).
  await page.reload();
  await expect(result(page)).toHaveText(en.alerts.removeData.pending);

  // The API is reachable again: opening Alerts asks it, and its answer clears the id.
  const deleted: string[] = [];
  await page.unroute("**/api/v1/push/subscriptions/*");
  await page.route("**/api/v1/push/subscriptions/*", (route) => {
    deleted.push(new URL(route.request().url()).pathname);
    return route.fulfill({ status: 204 });
  });
  await page.goto("/en/worker/alerts");
  await expect.poll(() => storedKeys(page)).toEqual({ profile: null, pending: null, incomplete: null });
  expect(deleted).toEqual([`/api/v1/push/subscriptions/${SUBSCRIPTION_ID}`]);
  // Nothing outstanding any more: the screen says the data was removed, in the same live region.
  await expect(result(page)).toHaveText(en.alerts.removeData.done);
});

test("when the expiration record cannot be cleared it says it could not finish, and never that the data was removed", async ({ page }) => {
  await page.route("**/api/v1/push/subscriptions/*", (route) => route.fulfill({ status: 204 }));
  await visitLikeAWorker(page);
  // The page's IndexedDB refuses the expiration database (the worker's own connection is a different context).
  await page.evaluate(() => {
    const open = indexedDB.open.bind(indexedDB);
    indexedDB.open = (name: string, version?: number) => {
      if (name === "serwist-expiration") throw new DOMException("simulated failure", "UnknownError");
      return open(name, version);
    };
  });

  await removeMyData(page);

  await expect(result(page)).toHaveText(en.alerts.removeData.failed);
  await expect(page.getByText(en.alerts.removeData.done, { exact: true })).toHaveCount(0);
  // The profile is gone from the phone all the same, and the marker names the step that did not finish.
  const stored = await storedKeys(page);
  expect(stored.profile).toBeNull();
  expect(JSON.parse(stored.incomplete ?? "null")).toMatchObject({ steps: ["cache"] });
});

test("a removal that could not finish is still said after a reload, is retried each time Alerts opens, and says 'removed' only when it has finished", async ({ page }) => {
  await page.route("**/api/v1/push/subscriptions/*", (route) => route.fulfill({ status: 204 }));
  // The page's IndexedDB refuses the expiration database for as long as a flag in localStorage says so, on every load.
  await page.addInitScript(() => {
    const open = indexedDB.open.bind(indexedDB);
    indexedDB.open = (name: string, version?: number) => {
      if (name === "serwist-expiration" && localStorage.getItem("e2e-break-idb") === "1") throw new DOMException("simulated failure", "UnknownError");
      return open(name, version);
    };
  });
  await visitLikeAWorker(page);
  await page.evaluate(() => {
    localStorage.setItem("e2e-break-idb", "1");
  });

  await removeMyData(page);
  await expect(result(page)).toHaveText(en.alerts.removeData.failed);

  // Reloaded, with the fault still there: the page opens saying the data may remain, and its retry fails the same way.
  await page.reload();
  await expect(result(page)).toHaveText(en.alerts.removeData.failed);
  await expect(page.getByText(en.alerts.removeData.done, { exact: true })).toHaveCount(0);
  expect(JSON.parse((await storedKeys(page)).incomplete ?? "null")).toMatchObject({ steps: ["cache"] });

  // The fault is gone. Opening Alerts finishes the clearing on its own, checks it, and only then says it is done.
  await page.evaluate(() => {
    localStorage.removeItem("e2e-break-idb");
  });
  await page.reload();
  await expect(result(page)).toHaveText(en.alerts.removeData.done);
  expect(await storedKeys(page)).toEqual({ profile: null, pending: null, incomplete: null });
  // What the failed removal left, the retry took: the API responses and the rows that recorded them. (The page itself,
  // visited again after the removal, is cached again by the worker, as any visit is; that is not what was removed.)
  const after = await deviceState(page);
  expect(after.api).toEqual([]);
  expect(after.apiRows).toBe(0);
  expect(after.caches).not.toContain("sb-api");
});
