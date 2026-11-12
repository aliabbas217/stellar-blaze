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
  /** Rows across every object store of Serwist's expiration database (0 when there is none). */
  readonly rows: number;
}

/** What the phone holds, read in the page. Opening the expiration database here does not keep a connection. */
function deviceState(page: Page): Promise<DeviceState> {
  return page.evaluate(async () => {
    const names = await caches.keys();
    const api = names.includes("sb-api") ? (await (await caches.open("sb-api")).keys()).map((request) => new URL(request.url).pathname).sort() : [];
    const rows = await new Promise<number>((resolve, reject) => {
      const open = indexedDB.open("serwist-expiration");
      open.onerror = () => {
        reject(open.error ?? new Error("open failed"));
      };
      open.onsuccess = () => {
        const database = open.result;
        const stores = Array.from(database.objectStoreNames);
        if (stores.length === 0) {
          database.close();
          resolve(0);
          return;
        }
        const transaction = database.transaction(stores, "readonly");
        let total = 0;
        let left = stores.length;
        for (const store of stores) {
          const count = transaction.objectStore(store).count();
          count.onsuccess = () => {
            total += count.result;
            left -= 1;
            if (left === 0) {
              database.close();
              resolve(total);
            }
          };
        }
      };
    });
    return { caches: names.sort(), api, rows };
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

/** What the app keeps in localStorage that a removal must empty: the profile and push state, and the ids owed to the API. */
function storedKeys(page: Page): Promise<{ profile: string | null; pending: string | null }> {
  return page.evaluate(({ profile, pending }) => ({ profile: localStorage.getItem(profile), pending: localStorage.getItem(pending) }), {
    profile: PROFILE_KEY,
    pending: PENDING_KEY,
  });
}

/** Opens Alerts for a site and removes the worker's data through the control: two taps, the second on "Yes". */
async function removeMyData(page: Page): Promise<void> {
  await page.getByRole("button", { name: en.alerts.removeData.button }).click();
  await page.getByRole("button", { name: en.alerts.removeData.confirm }).click();
}

/** The live region that carries the result of a removal (the last one on the page). */
const result = (page: Page) => page.getByRole("status").last();

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
  expect((await deviceState(page)).rows).toBeGreaterThanOrEqual(3);
}

test("removing my data leaves no API entry, page URL or expiration row on the phone, with the service worker running", async ({ page, context }) => {
  await page.route("**/api/v1/push/subscriptions/*", (route) => route.fulfill({ status: 204 }));
  await visitLikeAWorker(page);
  expect((await storedKeys(page)).profile).not.toBeNull();

  await removeMyData(page);

  await expect(result(page)).toHaveText(en.alerts.removeData.done);
  const after = await deviceState(page);
  // Cache Storage: none of the API caches or the page caches. The precache stays, so the app still opens offline.
  for (const gone of ["sb-api", "apis", "pages", "pages-rsc", "pages-rsc-prefetch", "others"]) expect(after.caches, gone).not.toContain(gone);
  expect(after.caches.some((name) => name.startsWith("serwist-precache"))).toBe(true);
  // IndexedDB: Serwist's record of what it cached holds no URL.
  expect(after.rows).toBe(0);
  // Local storage: the profile and the push state are gone, and nothing is owed to the API.
  expect(await storedKeys(page)).toEqual({ profile: null, pending: null });

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
  expect(await storedKeys(page)).toEqual({ profile: null, pending: JSON.stringify([SUBSCRIPTION_ID]) });
  // The caches and the expiration record were cleared all the same: only the API's answer is missing.
  const after = await deviceState(page);
  expect(after.api).toEqual([]);
  expect(after.rows).toBe(0);

  // The API is reachable again: opening Alerts asks it, and its answer clears the id.
  const deleted: string[] = [];
  await page.unroute("**/api/v1/push/subscriptions/*");
  await page.route("**/api/v1/push/subscriptions/*", (route) => {
    deleted.push(new URL(route.request().url()).pathname);
    return route.fulfill({ status: 204 });
  });
  await page.goto("/en/worker/alerts");
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), PENDING_KEY)).toBeNull();
  expect(deleted).toEqual([`/api/v1/push/subscriptions/${SUBSCRIPTION_ID}`]);
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
  // The profile is gone from the phone all the same.
  expect((await storedKeys(page)).profile).toBeNull();
});
