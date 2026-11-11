import { randomUUID } from "node:crypto";
import { expect, test, type Page, type Request } from "@playwright/test";
import ar from "../../messages/ar.json";
import en from "../../messages/en.json";
import ur from "../../messages/ur.json";
import { SITE_DEMO } from "../../src/mocks/fixtures.ts";

/*
 * The Alerts screen and the service worker's push handling, against a production build (`pnpm build && pnpm start`,
 * API_ORIGIN pointing at `pnpm mock:api`, VAPID_PUBLIC_KEY set to a valid base64url P-256 public key, for example one
 * from `pnpm exec web-push generate-vapid-keys`: the page decodes it before it calls the stubbed subscribe, so an arbitrary
 * string fails the subscribe tests). There is no real push service in CI: the
 * browser's push calls are stubbed in the page (`addInitScript`), the API is the mock one, and a push is delivered to
 * the real service worker through the DevTools protocol.
 *
 * The server must be started with SB_MOCK_SCENARIOS=1 (see pwa.spec.ts) for the failing-API test.
 */

// Playwright's default headless build (chromium-headless-shell) answers "denied" to every notification permission,
// whatever grantPermissions says, so the worker's showNotification would reject. The full Chromium honours the grant.
// `channel` forces a new worker, so it applies to the whole file (it cannot be set in a describe group).
test.use({ channel: "chromium" });

const ENDPOINT = "https://push.example/send/e2e-endpoint";
const SUBSCRIBED_TIMEOUT_MS = 20_000;

interface PushStubs {
  /** What the permission prompt answers when the worker taps Enable. */
  readonly answer: "granted" | "denied";
}

/** Makes the page think it can do push: a permission prompt that answers `answer` and a PushManager that "subscribes". */
async function stubPush(page: Page, stubs: PushStubs): Promise<void> {
  await page.addInitScript(
    ({ answer, endpoint }) => {
      let permission: NotificationPermission = "default";
      Object.defineProperty(Notification, "permission", { get: () => permission, configurable: true });
      Notification.requestPermission = () => {
        permission = answer;
        return Promise.resolve(answer);
      };

      let current: unknown = null;
      const fake = {
        endpoint,
        toJSON: () => ({ endpoint, expirationTime: null, keys: { p256dh: "e2e-p256dh", auth: "e2e-auth" } }),
        unsubscribe: () => {
          current = null;
          return Promise.resolve(true);
        },
      };
      PushManager.prototype.subscribe = () => {
        current = fake;
        return Promise.resolve(fake as unknown as PushSubscription);
      };
      PushManager.prototype.getSubscription = () => Promise.resolve(current as PushSubscription | null);
    },
    { answer: stubs.answer, endpoint: ENDPOINT },
  );
}

/** Errors the page raises: uncaught exceptions and console errors. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

const enable = (page: Page) => page.getByRole("button", { name: en.alerts.enable });

/** Waits until the service worker controls the page, so the page's own requests pass through the worker. */
async function untilControlled(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null), { timeout: SUBSCRIBED_TIMEOUT_MS })
    .toBe(true);
}

/** The path of every request kept in any Cache Storage cache. */
function cachedPaths(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const paths: string[] = [];
    for (const name of await caches.keys()) {
      for (const request of await (await caches.open(name)).keys()) paths.push(new URL(request.url).pathname);
    }
    return paths;
  });
}

test.describe("alerts page states", () => {
  test("a browser without PushManager gets the unsupported message and no exception", async ({ page }) => {
    const errors = watchErrors(page);
    await page.addInitScript(() => {
      Reflect.deleteProperty(window, "PushManager");
    });

    await page.goto("/en/worker/alerts");

    await expect(page.getByRole("heading", { name: en.alerts.unsupported.title })).toBeVisible();
    await expect(page.getByText(en.alerts.unsupported.body)).toBeVisible();
    await expect(page.getByRole("button", { name: en.alerts.enable })).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("blocking the permission prompt ends in the denied explanation", async ({ page }) => {
    await stubPush(page, { answer: "denied" });

    await page.goto("/en/worker/alerts?debug=push");
    await enable(page).click();

    await expect(page.getByRole("heading", { name: en.alerts.denied.title })).toBeVisible();
    await expect(page.getByText(en.alerts.denied.body)).toBeVisible();
    await expect(enable(page)).toHaveCount(0);
  });

  test("allowing it subscribes, registers exactly the contract body, and shows the subscription JSON", async ({ page }) => {
    await stubPush(page, { answer: "granted" });

    await page.goto("/en/worker/alerts?debug=push");
    await untilControlled(page);
    const posted = page.waitForRequest((request) => request.method() === "POST" && request.url().endsWith("/api/v1/push/subscriptions"));
    await enable(page).click();

    await expect(page.getByText(en.alerts.state.subscribed)).toBeVisible({ timeout: SUBSCRIBED_TIMEOUT_MS });
    await expect(page.getByRole("button", { name: en.alerts.disable })).toBeVisible();

    // Governance (ADR 0004): the body is the subscription, the site and the crew, and nothing about the worker.
    const body = (await posted).postDataJSON() as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["crew_id", "site_id", "subscription"]);
    expect(body).toMatchObject({ site_id: SITE_DEMO, crew_id: null, subscription: { endpoint: ENDPOINT } });

    // The spike's debug view: the browser's subscription, selectable, with Copy.
    await expect(page.getByRole("textbox", { name: en.alerts.debug.heading })).toHaveValue(new RegExp(ENDPOINT));
    await expect(page.getByRole("button", { name: en.alerts.debug.copy })).toBeVisible();

    // The subscription's endpoint and keys went to the API and nowhere else: the worker never stores a push request.
    expect((await cachedPaths(page)).filter((path) => path.includes("/push"))).toEqual([]);

    // The API's registration id is kept on the device, so the next app open can tell whether it is still current.
    const stored = await page.evaluate(() => localStorage.getItem("sb-profile-v1"));
    expect(JSON.parse(stored ?? "null")).toMatchObject({ state: { push: { serverId: "sub-mock-1", endpoint: ENDPOINT, siteId: SITE_DEMO } } });
  });

  test("a failing API still leaves the worker the subscription, and a request id to quote", async ({ page }) => {
    await stubPush(page, { answer: "granted" });
    await page.setExtraHTTPHeaders({ "x-sb-mock-scenario": "error" });

    await page.goto("/en/worker/alerts?debug=push");
    await enable(page).click();

    await expect(page.getByText(en.alerts.state.error)).toBeVisible({ timeout: SUBSCRIBED_TIMEOUT_MS });
    await expect(page.getByText(en.states.error.requestId.replace("{id}", "mock-req-1"))).toBeVisible();
    // What the real-phone spike relies on: the browser's subscription is there even though the API said no.
    await expect(page.getByRole("textbox", { name: en.alerts.debug.heading })).toHaveValue(new RegExp(ENDPOINT));
    await expect(enable(page)).toBeVisible();
  });

  test("turning alerts off deletes the registration and forgets it", async ({ page }) => {
    await stubPush(page, { answer: "granted" });

    await page.goto("/en/worker/alerts");
    // Without ?debug=push there is no site: Enable is off and the screen says why.
    await expect(enable(page)).toBeDisabled();
    await expect(page.getByText(en.alerts.noSite)).toBeVisible();

    await page.goto(`/en/worker/alerts?site=${SITE_DEMO}`);
    await enable(page).click();
    await expect(page.getByText(en.alerts.state.subscribed)).toBeVisible({ timeout: SUBSCRIBED_TIMEOUT_MS });

    const deleted: Request[] = [];
    page.on("request", (request) => {
      if (request.method() === "DELETE") deleted.push(request);
    });
    await page.getByRole("button", { name: en.alerts.disable }).click();

    await expect(page.getByText(en.alerts.state.idle)).toBeVisible();
    expect(deleted.map((request) => new URL(request.url()).pathname)).toEqual(["/api/v1/push/subscriptions/sub-mock-1"]);
    expect(JSON.parse((await page.evaluate(() => localStorage.getItem("sb-profile-v1"))) ?? "null")).toMatchObject({ state: { push: null } });
  });
});

test.describe("limitation copy visible", () => {
  test("en", async ({ page }) => {
    await page.goto("/en/worker/alerts");
    await expect(page.getByText(en.alerts.limitation)).toBeVisible();
  });

  test("ar, in a right-to-left page", async ({ page }) => {
    await page.goto("/ar/worker/alerts");
    await expect(page.locator('html[lang="ar"][dir="rtl"]')).toHaveCount(1);
    await expect(page.getByText(ar.alerts.limitation)).toBeVisible();
  });

  test("it stays visible when the browser cannot do push at all", async ({ page }) => {
    await page.addInitScript(() => {
      Reflect.deleteProperty(window, "PushManager");
    });
    await page.goto("/en/worker/alerts");
    await expect(page.getByRole("heading", { name: en.alerts.unsupported.title })).toBeVisible();
    await expect(page.getByText(en.alerts.limitation)).toBeVisible();
  });
});

test.describe("service worker push handling", () => {
  // The neutral notification has one fixed tag, and on a Windows host every browser shares the system notification
  // centre, which replaces a notification by origin and tag across browsers: two runs of this describe at the same
  // time (`--repeat-each` with several workers, or several Playwright projects on one host) can make the neutral one
  // vanish from the other's list. A normal run, and a serial repeat (`--workers=1`), are stable.
  interface Shown {
    title: string;
    body: string;
    tag: string;
    lang: string;
    data: unknown;
    vibrate: unknown;
  }

  const shown = (page: Page): Promise<Shown[]> =>
    page.evaluate(async () =>
      (await (await navigator.serviceWorker.ready).getNotifications()).map((notification) => ({
        title: notification.title,
        body: notification.body,
        tag: notification.tag,
        lang: notification.lang,
        data: notification.data as unknown,
        vibrate: Reflect.get(notification, "vibrate") as unknown,
      })),
    );

  test("shows a notification in the worker's own language, and a neutral one for a payload it cannot read", async ({ page, context }) => {
    await context.grantPermissions(["notifications"]);
    await page.goto("/ur/worker/alerts");

    // The page leaves its language where the worker can read it (Cache Storage), and the worker must be active.
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const response = await (await caches.open("sb-prefs")).match("/__sb/prefs");
          const registration = await navigator.serviceWorker.getRegistration();
          return { prefs: (await response?.json()) as unknown, state: registration?.active?.state };
        }),
      )
      .toEqual({ prefs: { locale: "ur" }, state: "activated" });

    // Deliver pushes to the real worker through the DevTools protocol.
    const cdp = await context.newCDPSession(page);
    const registrations = new Map<string, string>();
    cdp.on("ServiceWorker.workerRegistrationUpdated", ({ registrations: list }) => {
      for (const registration of list) registrations.set(registration.scopeURL, registration.registrationId);
    });
    await cdp.send("ServiceWorker.enable");
    const origin = new URL(page.url()).origin;
    await expect.poll(() => registrations.has(`${origin}/`)).toBe(true);
    const registrationId = registrations.get(`${origin}/`) ?? "";
    const deliverRaw = (data: string) => cdp.send("ServiceWorker.deliverPushMessage", { origin, registrationId, data });
    const deliver = (payload: unknown) => deliverRaw(JSON.stringify(payload));

    const tags = async () => (await shown(page)).map((notification) => notification.tag).sort();
    // Ids unique to this run: on a Windows host the notification centre is shared by every browser, so two runs of this
    // test at once (--repeat-each, several projects) would replace each other's notifications that have the same tag.
    const run = randomUUID().slice(0, 8);
    const siteTag = `site:${SITE_DEMO}-${run}`;
    const crewTag = `crew:crew-${run}`;
    const valid = { v: 1, audience: "site", target_id: `${SITE_DEMO}-${run}`, level: "red", template_id: "level-change", valid_from: "2026-11-11T09:00:00Z" };

    await deliver(valid);
    await expect.poll(tags).toEqual([siteTag]);

    // An extra key (a worker id) is outside the contract. Every push must show exactly one notification (a push that
    // shows none gets an installed iPhone app's subscription revoked), so the worker shows its neutral one: the app's
    // name and the generic line, a fixed tag, no level, and nothing the payload said.
    await deliver({ ...valid, worker_id: "w-1", target_id: "site-not-shown" });
    await expect.poll(tags).toEqual(["fallback", siteTag].sort());

    // The next push, delivered after it, is shown too: the worker survived the bad one.
    await deliver({ ...valid, audience: "crew", target_id: `crew-${run}`, level: "amber" });
    await expect.poll(tags).toEqual([crewTag, "fallback", siteTag].sort());

    const notifications = await shown(page);
    const site = notifications.find((notification) => notification.tag === siteTag);
    expect(site).toMatchObject({
      title: ur.push.title.site.replace("{level}", ur.push.level.red),
      body: ur.push.body,
      lang: "ur",
      data: { url: "/ur/worker?from=push&level=red" },
      vibrate: [400, 100, 400, 100, 400],
    });
    const crew = notifications.find((notification) => notification.tag === crewTag);
    expect(crew).toMatchObject({
      title: ur.push.title.crew.replace("{level}", ur.push.level.amber),
      data: { url: "/ur/worker?from=push&level=amber" },
      vibrate: [200],
    });

    const neutral = notifications.find((notification) => notification.tag === "fallback");
    expect(neutral).toMatchObject({
      title: ur.common.appName,
      body: ur.push.body,
      lang: "ur",
      data: { url: "/ur/worker?from=push" },
      vibrate: [100],
    });
    const neutralText = `${neutral?.title ?? ""} ${neutral?.body ?? ""}`;
    expect(Object.values(ur.push.level).some((word) => neutralText.includes(word))).toBe(false);
    expect(JSON.stringify(neutral)).not.toMatch(/w-1|site-not-shown/);

    // A body that is not JSON takes the same path: close the neutral notification, send garbage, it comes back.
    await page.evaluate(async () => {
      for (const notification of await (await navigator.serviceWorker.ready).getNotifications({ tag: "fallback" })) notification.close();
    });
    await expect.poll(tags).toEqual([crewTag, siteTag].sort());
    await deliverRaw("this is not json");
    await expect.poll(tags).toEqual([crewTag, "fallback", siteTag].sort());
  });
});
