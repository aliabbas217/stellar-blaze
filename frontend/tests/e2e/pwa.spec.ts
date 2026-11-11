import { expect, test, type Page } from "@playwright/test";
import ur from "../../messages/ur.json";
import { SITE_DEMO } from "../../src/mocks/fixtures.ts";

/*
 * The installable-app contract, against a production build (`pnpm build && pnpm start`, API_ORIGIN pointing at
 * `pnpm mock:api`): the service worker controls the worker route, an offline Urdu worker lands on the Urdu
 * offline page, each locale's manifest is shaped for installation, and the forecast and the risk policy outlive
 * the connection. The service worker is built only by `next build`; `next dev` does not precache.
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
