import { expect, test, type Page } from "@playwright/test";
import ur from "../../messages/ur.json";
import { FIXTURE_DATE, SITE_DEMO, SITE_EMPTY } from "../../src/mocks/fixtures.ts";

/*
 * The installable-app contract, against the production build (`pnpm build && pnpm e2e`: playwright.config.ts starts the
 * mock API and the standalone server itself): the service worker controls the worker route, an offline Urdu worker
 * lands on the Urdu offline page, each locale's manifest is shaped for installation, and the forecast and the risk
 * policy outlive the connection. The service worker is built only by `next build`; `next dev` does not precache.
 *
 * The harness starts the server with SB_MOCK_SCENARIOS=1: a production build only forwards the `x-sb-mock-scenario`
 * header (used to make the API fail on purpose) when it is set.
 */

// The worker registers after hydration and activates once the precache is filled.
const INSTALL_TIMEOUT_MS = 20_000;

/** Waits for the app's service worker to be active, then reloads so that the page is loaded under its control. */
async function loadControlled(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect
    .poll(
      () =>
        page.evaluate(async () =>
          (await navigator.serviceWorker.getRegistrations()).map((registration) => registration.active?.state),
        ),
      { message: "the app registers a service worker and it activates", timeout: INSTALL_TIMEOUT_MS },
    )
    .toEqual(["activated"]);
  // Every registration of the origin, wherever its scope: a worker registered with the scope of its own URL
  // (/serwist/) shows up here, and would leave the worker routes uncontrolled with offline mode and push dead.
  const scopes = await page.evaluate(async () =>
    (await navigator.serviceWorker.getRegistrations()).map((registration) => registration.scope),
  );
  expect(scopes, "one registration, with the scope of the whole origin").toEqual([`${new URL(page.url()).origin}/`]);
  // A page that was already open when the worker activated is not controlled until it is loaded again.
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null), {
      message: "the page is controlled by the service worker after a reload",
      timeout: INSTALL_TIMEOUT_MS,
    })
    .toBe(true);
}

test("sw controls the worker route", async ({ page }) => {
  await loadControlled(page, "/en/worker");

  const state = await page.evaluate(async () => ({
    controlled: navigator.serviceWorker.controller !== null,
    scope: (await navigator.serviceWorker.getRegistration())?.scope,
    origin: location.origin,
  }));
  expect(state.controlled).toBe(true);
  expect(state.scope).toBe(`${state.origin}/`);
});

test("offline navigation shows localized fallback", async ({ page, context }) => {
  await loadControlled(page, "/ur/worker");

  // Installing fetched the offline page of all six locales. None of those requests may rewrite the visitor's own
  // locale cookie, or the next 404 or `/` visit would answer in another language (next-intl skips the cookie for
  // requests that are not documents; this pins that).
  expect((await context.cookies()).find((cookie) => cookie.name === "NEXT_LOCALE")?.value).toBe("ur");

  await context.setOffline(true);
  // /ur/supervisor was never visited: nothing is cached for it, so the worker answers with the offline page.
  await page.goto("/ur/supervisor");

  await expect(page.locator('html[lang="ur"][dir="rtl"]')).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(ur.offline.title);
  expect(new URL(page.url()).pathname).toBe("/ur/supervisor");
});

test("manifest is installable-shaped", async ({ page, request }) => {
  await page.goto("/ur/worker");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/ur/manifest.webmanifest");
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("href", "/icons/icon-192.png");

  const response = await request.get("/en/manifest.webmanifest");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/manifest+json");

  const manifest = (await response.json()) as {
    display: string;
    start_url: string;
    icons: { src: string; sizes: string; purpose?: string }[];
  };
  expect(manifest.display).toBe("standalone");
  expect(manifest.start_url).toBe("/en/worker?source=pwa");
  for (const sizes of ["192x192", "512x512"]) {
    const icon = manifest.icons.find((candidate) => candidate.sizes === sizes && candidate.purpose !== "maskable");
    expect(icon, `an icon of ${sizes}`).toBeDefined();
    const image = await request.get(icon?.src ?? "");
    expect(image.status()).toBe(200);
    expect(image.headers()["content-type"]).toBe("image/png");
  }
});

test("forecast and risk policy are served offline from the sb-api cache", async ({ page, context }) => {
  await loadControlled(page, "/en/worker");

  const forecast = `/api/v1/sites/${SITE_DEMO}/forecast/today`;
  const policy = "/api/v1/risk-policy";
  const read = (path: string) =>
    page.evaluate(async (url) => {
      const response = await fetch(url);
      return { status: response.status, body: (await response.json()) as unknown };
    }, path);

  const online = { forecast: await read(forecast), policy: await read(policy) };
  expect(online.forecast.status).toBe(200);
  expect(online.policy.status).toBe(200);

  // The worker stores a response while it hands it over; wait until both copies are in the cache.
  await expect
    .poll(() =>
      page.evaluate(async () => (await (await caches.open("sb-api")).keys()).map((request) => new URL(request.url).pathname).sort()),
    )
    .toEqual([forecast, policy].sort());

  await context.setOffline(true);
  expect({ forecast: await read(forecast), policy: await read(policy) }).toEqual(online);
});

/** Every entry of every Cache Storage cache, as "<cache> <path+query>". */
async function cacheEntries(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const entries: string[] = [];
    for (const name of await caches.keys()) {
      for (const request of await (await caches.open(name)).keys()) {
        const url = new URL(request.url);
        entries.push(`${name} ${url.pathname}${url.search}`);
      }
    }
    return entries.sort();
  });
}

test("no API response outside the allow-list is kept in any cache", async ({ page }) => {
  await loadControlled(page, "/en/worker");

  // Workers can share a phone: only the forecast and the policy may stay on it (ADR 0004/0009). These all answer 200,
  // the kind of response a cache would keep if a rule let it.
  const others = [
    "/api/v1/sites",
    `/api/v1/sites/${SITE_DEMO}/crews`,
    `/api/v1/crews/crew-a/timeline?date=${FIXTURE_DATE}`,
    "/api/healthz",
  ];
  for (const path of others) {
    expect(await page.evaluate(async (url) => (await fetch(url)).status, path), path).toBe(200);
  }

  // The worker stores a response after it has handed it over, so a check straight after the requests could pass too
  // early. The allow-listed policy goes last: once its copy is in the cache, the worker has also finished the
  // requests before it, and only that one entry may be there.
  expect(await page.evaluate(async () => (await fetch("/api/v1/risk-policy")).status)).toBe(200);
  await expect.poll(() => cacheEntries(page).then((entries) => entries.filter((entry) => entry.includes("/api/")))).toEqual([
    "sb-api /api/v1/risk-policy",
  ]);
});

test("a 5xx from the server falls through to the cached forecast", async ({ page }) => {
  await loadControlled(page, "/en/worker");

  const forecast = `/api/v1/sites/${SITE_DEMO}/forecast/today`;
  const read = (path: string, headers: Record<string, string> = {}) =>
    page.evaluate(
      async ({ url, extra }) => {
        const response = await fetch(url, { headers: extra });
        return { status: response.status, type: response.headers.get("content-type"), body: (await response.json()) as unknown };
      },
      { url: path, extra: headers },
    );
  // The mock API answers any request that carries this header with a 500 problem+json (request_id "mock-req-1").
  const failing = { "x-sb-mock-scenario": "error" };

  // A control: where nothing is cached, the failure reaches the page as the problem it is.
  const control = await read("/api/v1/sites", failing);
  expect(control.status).toBe(500);

  const fresh = await read(forecast);
  expect(fresh.status).toBe(200);
  await expect.poll(() => cacheEntries(page)).toContain(`sb-api ${forecast}`);

  // The server fails while the phone is online: the page gets the copy it already holds, not the error.
  expect(await read(forecast, failing)).toEqual(fresh);

  // And with no copy to fall back to, the page still gets the server's own error, problem body and request id
  // included (the error screen shows it), not an anonymous network failure.
  const noCopy = await read(`/api/v1/sites/${SITE_EMPTY}/forecast/today`, failing);
  expect(noCopy.status).toBe(500);
  expect(noCopy.type).toContain("application/problem+json");
  expect(noCopy.body).toMatchObject({ request_id: "mock-req-1" });
});
