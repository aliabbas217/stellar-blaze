import { expect, test, type Page } from "@playwright/test";
import en from "../../messages/en.json";
import { STOP_OUTBOX_DB } from "../../src/features/supervisor/stop-outbox.ts";
import { SITE_DEMO } from "../../src/mocks/fixtures.ts";
import { loadControlled } from "./helpers/service-worker.ts";

/*
 * F2 Task 23: offline behaviour and the service-worker proof, in a production build with the REAL service worker active
 * (`pnpm build && pnpm e2e -g "offline f2"`; every title contains "offline f2"). Unlike the crews and plan specs, which block the
 * worker so that a page route can hold a request, nothing here is blocked: the worker controls every page it visits.
 *
 * The decision (ADR 0060, ADR 0059, F2 decision D2): the runtime-cache allow-list is exactly the forecast of a site and the risk
 * policy. Every employer, token or write route is NetworkOnly; the supervisor views are online-only (their API data is never kept
 * on the phone), while the PAGES (documents, scripts, the precache) are the same for everyone and may be kept (ADR 0004).
 *
 * What is proved here, and how it can fail:
 *  - `no employer route is cached`: after a journey through every F2 operation with the worker active, nothing but the two allow-listed
 *    reads is in Cache Storage. The scan is proved able to fail (a planted canary entry is found and removed) and proved not to be
 *    looking at an empty store (the two allow-listed reads, a page, and the precache are there).
 *  - `judge pages render offline after one visit`: each judge page, visited once, renders from the worker's cache with no network;
 *    governance and try show their RECORDED result and their live controls fail calmly.
 *  - Today and the supervisor screen offline: the protective hero; the notice, no data, and the Stop outbox that survives a reload.
 *  - the alert card's shell is precached: it opens offline for a query never visited.
 */

const TODAY = `/en/worker?site=${SITE_DEMO}&crew=crew-b`;
const ALERT_UNVISITED = `/en/worker/alert?audience=site&target=${SITE_DEMO}&level=orange&valid_from=${encodeURIComponent("2026-09-03T06:00:00Z")}`;
const stopLabel = (crew: string) => en.supervisor.stop.button.replace("<bdi>{crew}</bdi>", crew);
const FORECAST = `/api/v1/sites/${SITE_DEMO}/forecast/today`;
const POLICY = "/api/v1/risk-policy";

test.beforeEach(() => {
  test.setTimeout(180_000);
});

/** The mock keeps stops and sign-offs in memory for the whole run: every test that acts leaves a new epoch behind. */
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
 * Pages of the tests that act on the demo site (a stop, a sign-off, a request): their state is reset in `afterEach`, so a failure half way
 * cannot leave stops and sign-offs in the shared mock state for the tests after it. (Reads need no reset, and a reset is rate limited.)
 */
const acted = new WeakSet<Page>();
test.afterEach(async ({ page }) => {
  if (acted.has(page)) await resetEpoch(page);
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

/**
 * Entries that must never be on a phone: any API URL other than the two allow-listed reads, and any URL that names an employer or
 * token route, wherever it is. (A page document such as `/en/supervisor/crews/crew-a` is not an API response and is allowed: the
 * pages are the same for everyone.)
 */
function forbidden(entries: readonly string[]): string[] {
  const named = /(day-plan|data-requests|\/stops|sign-off|transparency-log|demo-reset)/;
  return entries.filter((entry) => {
    const path = entry.slice(entry.indexOf(" ") + 1);
    if (named.test(path)) return true;
    if (!path.startsWith("/api/")) return false;
    return !(path === FORECAST || path === POLICY);
  });
}

/** True when any cached response body holds an employer bearer token or the demo token (a response must never carry one). */
async function cachedBodiesHoldToken(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        const response = await cache.match(request);
        if (response === undefined) continue;
        const type = response.headers.get("content-type") ?? "";
        if (!/json|text|html/.test(type)) continue;
        const text = await response.clone().text();
        if (/e2e-demo-employer-token|Bearer\s+[A-Za-z0-9._-]{8,}/.test(text)) return true;
      }
    }
    return false;
  });
}

const stopBar = (page: Page) => page.locator("[data-emergency]");

test("offline f2: no employer route is cached, after a journey through every F2 operation with the service worker active", async ({ page }) => {
  acted.add(page);
  // Today (the forecast and the policy are the only things that may stay), under the worker's control.
  await loadControlled(page, TODAY);
  await expect(page.locator('[data-level-sign][data-kind="live"]')).toHaveCount(1);

  // The alert card and the unwell sheet.
  await page.goto(ALERT_UNVISITED);
  await expect(page.getByRole("heading", { level: 1 })).toBeAttached();
  await page.goto("/en/worker/unwell");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  // Crews, Stop work and its undo (create_crew_stop, delete_crew_stop, list_site_crews, get_crew_timeline, list_sites).
  await page.goto("/en/supervisor");
  await page.locator("[data-crew]").first().waitFor();
  await page.getByRole("button", { name: stopLabel("Crew A") }).click();
  await expect(stopBar(page)).toContainText("Stop recorded");
  await page.getByRole("button", { name: /^Undo/ }).click();
  await expect(page.getByRole("button", { name: stopLabel("Crew A") })).toBeVisible();

  // A plan and its sign-off (get_crew_day_plan, sign_off_day_plan).
  await page.goto("/en/supervisor/crews/crew-b");
  await page.locator("[data-block]").first().waitFor();
  await page.getByRole("checkbox").first().waitFor();
  for (const box of await page.getByRole("checkbox").all()) await box.check();
  await page.getByRole("button", { name: "Sign off" }).click();
  await expect(page.locator("[data-signed]")).toBeVisible();

  // Governance: the refusal (create_data_request, get_site_transparency_log) and the reset control (reset_demo_site).
  await page.goto("/en/replay/governance");
  await expect(page.getByRole("button", { name: "Reset demo site" })).toBeVisible();
  await page.getByRole("button", { name: "Send the employer's request" }).click();
  await expect(page.locator("[data-governance]")).toHaveAttribute("data-governance", "live");
  await page.getByRole("button", { name: "Reset demo site" }).click();
  await expect(page.getByRole("status").filter({ hasText: /\S/ }).first()).toBeVisible();

  // Try a plan (validate_plan).
  await page.goto("/en/replay/try");
  await page.getByRole("button", { name: "Check this plan" }).click();
  await expect(page.locator("[data-try]")).toHaveAttribute("data-try", /answer|none/);

  // The page is still under the worker's control: the journey went through it.
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

  // Positive control: the cache machinery works, so an empty result is not "nothing was ever cached". Today reads the forecast, and the
  // risk policy is read once through the worker as well (Today does not need it); both are kept (the worker stores a response while it
  // hands it over, so wait for them). Pages are kept too (Serwist's defaultCache files documents under "others").
  await page.goto(TODAY);
  expect(await page.evaluate(async (url) => (await fetch(url)).status, POLICY)).toBe(200);
  await expect.poll(() => cacheEntries(page).then((entries) => entries.filter((entry) => entry.startsWith("sb-api ")))).toEqual(
    [`sb-api ${FORECAST}`, `sb-api ${POLICY}`].sort(),
  );
  const entries = await cacheEntries(page);
  expect(entries.filter((entry) => entry.startsWith("others /en")).length, "pages are kept (the same for everyone)").toBeGreaterThan(3);
  expect(entries.some((entry) => entry.startsWith("serwist-precache")), "the precache is there").toBe(true);

  // THE assertion.
  expect(forbidden(entries), "no employer, token or write route response is in Cache Storage").toEqual([]);
  expect(entries.filter((entry) => entry.includes("/api/")).sort()).toEqual([`sb-api ${FORECAST}`, `sb-api ${POLICY}`].sort());
  expect(await cachedBodiesHoldToken(page), "no cached response carries a token").toBe(false);

  // The scan can fail: a day plan cached by a (hypothetical) careless rule is found, and gone once removed.
  await page.evaluate(async () => {
    await (await caches.open("canary-probe")).put("/api/v1/crews/crew-a/day-plan", new Response("{}", { headers: { "content-type": "application/json" } }));
  });
  expect(forbidden(await cacheEntries(page)), "the scan finds a planted day plan").toEqual(["canary-probe /api/v1/crews/crew-a/day-plan"]);
  await page.evaluate(() => caches.delete("canary-probe"));
  expect(forbidden(await cacheEntries(page))).toEqual([]);
});

/** The judge pages: each is visited once with the worker in control, then opened with no network. */
const JUDGE_PAGES = [
  { name: "landing", path: "/en" },
  { name: "scoreboard", path: "/en/replay" },
  { name: "day zoom", path: "/en/replay/day" },
  { name: "proof sheet", path: "/en/replay/proof/forecast.hours_over_limit" },
  { name: "governance", path: "/en/replay/governance" },
  { name: "try a plan", path: "/en/replay/try" },
] as const;

test("offline f2: judge pages render offline after one visit", async ({ page, context }) => {
  await loadControlled(page, "/en/replay");

  // One visit each, online, under the worker. Record what each page's title says: offline it must say the same, not the offline page's.
  const titles = new Map<string, string>();
  for (const { name, path } of JUDGE_PAGES) {
    await page.goto(path);
    const heading = page.getByRole("heading", { level: 1 }).first();
    await expect(heading, `${name} online`).toBeVisible();
    titles.set(name, (await heading.innerText()).trim());
    await page.evaluate(() => document.fonts.ready);
    // The worker keeps a page after it has handed it over: wait until this one is in the cache.
    await expect
      .poll(() => cacheEntries(page).then((entries) => entries.some((entry) => entry === `others ${path}`)), { message: `${name} is cached`, timeout: 15_000 })
      .toBe(true);
  }
  expect(titles.get("landing")).not.toBe(en.offline.title);

  await context.setOffline(true);

  for (const { name, path } of JUDGE_PAGES) {
    await page.goto(path);
    expect(new URL(page.url()).pathname, name).toBe(path);
    const heading = page.getByRole("heading", { level: 1 }).first();
    await expect(heading, `${name} renders from the cache with no network`).toBeVisible();
    expect((await heading.innerText()).trim(), `${name}: its own title, not the offline page's`).toBe(titles.get(name));
    expect((await heading.innerText()).trim(), name).not.toBe(en.offline.title);
  }

  // Governance: the RECORDED run is the first paint, with nothing sent. The live control says it is OFFLINE (the demo site cannot be
  // looked up with no network, which is a settled state, not a wait), sends nothing, keeps the recorded run in view and never claims a
  // live run.
  const posts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") posts.push(request.url());
  });
  await page.goto("/en/replay/governance");
  await expect(page.locator("[data-governance]")).toHaveAttribute("data-governance", "recorded");
  await expect(page.locator("[data-answer=shown] [data-status]")).toHaveText("403");
  await page.getByRole("button", { name: "Send the employer's request" }).click();
  await expect(page.locator("[data-notice=offline]")).toContainText(en.states.offlineBanner.title);
  await expect(page.getByText("The demo site is still loading. Try again in a moment.")).toHaveCount(0);
  await expect(page.locator("[data-governance]")).toHaveAttribute("data-governance", "recorded");
  await expect(page.locator("[data-answer=shown] [data-status]")).toHaveText("403");
  await expect(page.getByText("Live.")).toHaveCount(0);
  await expect(page.getByText("Recorded", { exact: true })).toBeVisible();
  expect(posts, "nothing was sent").toEqual([]);

  // Try a plan: a check cannot reach the validator (and offline the demo site cannot be looked up), so the page says it is offline,
  // sends nothing, and OFFERS the RECORDED result (the same label as after a failed validator call); the recorded result opens.
  await page.goto("/en/replay/try");
  await page.getByRole("button", { name: "Check this plan" }).click();
  await expect(page.locator("[data-try]")).toHaveAttribute("data-try", "offline");
  await expect(page.locator("[data-notice=offline]")).toContainText(en.states.offlineBanner.title);
  await expect(page.getByText("The demo site is still loading. Try again in a moment.")).toHaveCount(0);
  await expect(page.locator("[data-recorded]")).toHaveCount(0);
  await page.getByRole("button", { name: "Show a recorded result" }).click();
  await expect(page.locator("[data-recorded] [data-answer]")).toBeVisible();
  expect(posts, "nothing was sent").toEqual([]);

  // Back online the page resumes without a reload: the offline notice goes and the check is idle again (the unit test runs the next check).
  await context.setOffline(false);
  await expect(page.locator("[data-notice=offline]")).toHaveCount(0);
  await expect(page.locator("[data-try]")).toHaveAttribute("data-try", "idle");
});

test("offline f2: offline Today shows the stale protective hero, first, with no live level", async ({ page, context }) => {
  await loadControlled(page, TODAY);
  await expect(page.locator('[data-level-sign][data-kind="live"]')).toHaveCount(1);
  // The forecast is in the sb-api cache, so the phone does hold a forecast: offline must still not read it as live.
  await expect.poll(() => cacheEntries(page).then((entries) => entries.includes(`sb-api ${FORECAST}`))).toBe(true);

  await context.setOffline(true);
  await page.reload();

  const lead = page.locator("[data-protective-lead]");
  await expect(lead).toBeVisible();
  await expect(lead.getByRole("heading", { name: en.worker.today.kicker.fallback })).toBeVisible();
  await expect(lead).toContainText(en.states.offlineBanner.title);
  await expect(page.locator('[data-level-sign][data-kind="live"]')).toHaveCount(0);
  const first = await page.evaluate(() => {
    const walker = document.createTreeWalker(document.querySelector("main") as HTMLElement, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const text = (node.textContent ?? "").trim();
      if (text !== "" && node.parentElement?.closest(".sr-only") === null) return text;
    }
    return "";
  });
  expect(first, "the protective lead is the first text").toBe(en.worker.today.kicker.fallback);
  // The unwell sheet is one tap from the dock, offline too (its own spec proves the cold start).
  await expect(page.getByRole("link", { name: en.worker.nav.unwell })).toBeVisible();
});

test("offline f2: offline supervisor shows the notice, no data, and a Stop outbox that survives a reload and reports Not sent", async ({ page, context }) => {
  acted.add(page);
  await loadControlled(page, "/en/supervisor");
  await page.locator("[data-crew]").first().waitFor();

  await context.setOffline(true);
  await page.reload();

  // No data: the crews list is online-only (D2), so there are no crews, and the screen says so rather than showing old numbers.
  await expect(stopBar(page)).toBeVisible();
  await expect(page.locator("[data-crew]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Stop work/ })).toBeEnabled();
  // The screen tells the supervisor it cannot reach the API: the crews list's own error state (the crews view's "ready" state is the
  // only one with an offline banner, and offline there is no ready state), worded from the catalogue.
  await expect(page.locator("main")).toContainText(en.supervisor.crews.error.title);

  // Stop work pressed with no signal: kept, and never reported as sent.
  await page.getByRole("button", { name: /^Stop work/ }).click();
  await expect(stopBar(page)).toContainText("Not sent: no signal. Tell the crew now.");
  await expect(stopBar(page)).not.toContainText(/Stop recorded|Work stopped/);

  // A reload with no signal (the document comes from the worker's cache): the stop is still kept, still "Not sent".
  await page.reload();
  await expect(stopBar(page)).toContainText("Not sent: no signal. Tell the crew now.");
  await expect(stopBar(page)).not.toContainText(/Stop recorded|Work stopped/);
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
  expect(rows, "one row survived the reload").toHaveLength(1);

  // The signal returns: it is sent, and only then recorded.
  await context.setOffline(false);
  await expect(stopBar(page)).toContainText("Work stopped", { timeout: 20_000 });
  expect(forbidden(await cacheEntries(page))).toEqual([]);
});

/**
 * Seeds the Stop outbox the way an earlier visit would have left it. The database and store names are stop-outbox.ts's
 * (`STOP_OUTBOX_DB`, store `stops`, auto-increment `key`); a row is the crew id, the crew's name as the button showed it, and the phone's time.
 */
async function seedOutbox(page: Page, rows: readonly { crewId: string; crewName: string; clientTime: string }[]): Promise<void> {
  await page.evaluate(
    ({ name, seeded }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open(name, 1);
        open.onupgradeneeded = () => {
          open.result.createObjectStore("stops", { keyPath: "key", autoIncrement: true });
        };
        open.onerror = () => {
          reject(open.error ?? new Error("open failed"));
        };
        open.onsuccess = () => {
          const transaction = open.result.transaction("stops", "readwrite");
          for (const row of seeded) transaction.objectStore("stops").add(row);
          transaction.oncomplete = () => {
            open.result.close();
            resolve();
          };
          transaction.onerror = () => {
            reject(transaction.error ?? new Error("write failed"));
          };
        };
      }),
    { name: STOP_OUTBOX_DB, seeded: rows },
  );
}

const minutesAgoIso = (minutes: number): string => new Date(Date.now() - minutes * 60_000).toISOString();
const minutesAheadIso = (minutes: number): string => new Date(Date.now() + minutes * 60_000).toISOString();
const expiredNotice = (crew: string): string => en.supervisor.stop.expired.replace("<bdi>{crew}</bdi>", crew);
const clockNotice = (crew: string): string => en.supervisor.stop.expiredClock.replace("<bdi>{crew}</bdi>", crew);

/** Every stop request the page makes (the mock records a stop on `POST .../stops`). */
function watchStopRequests(page: Page): string[] {
  const seen: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && /\/stops$/.test(new URL(request.url()).pathname)) seen.push(request.url());
  });
  return seen;
}

test("offline f2: a stop kept 61 minutes ago is never sent: the page says it expired, Stop work is idle, the notice outlives a reload until it is closed", async ({ page }) => {
  const stopRequests = watchStopRequests(page);
  await page.goto("/en/replay");
  await seedOutbox(page, [{ crewId: "crew-a", crewName: "Crew A", clientTime: minutesAgoIso(61) }]);

  await page.goto("/en/supervisor");
  await page.locator("[data-crew]").first().waitFor();
  const notice = page.locator('[data-expired-stop="crew-a"]');
  await expect(notice).toContainText(expiredNotice("Crew A"));
  await expect(stopBar(page)).toHaveAttribute("data-stop-state", "idle");
  await expect(stopBar(page)).not.toContainText(/Not sent|kept on this phone/);
  await expect(page.getByRole("button", { name: stopLabel("Crew A") })).toBeEnabled();

  // Durable: a reload does not lose it. Closing it removes it for good.
  await page.reload();
  await page.locator("[data-crew]").first().waitFor();
  await expect(notice).toContainText(expiredNotice("Crew A"));
  await expect(notice).not.toContainText("looked wrong");
  // Closed with the keyboard: the focused Close button leaves the page, and focus must land on the Stop button, not on <body> (real browser).
  await notice.getByRole("button", { name: en.shell.close }).focus();
  await page.keyboard.press("Enter");
  await expect(notice).toHaveCount(0);
  await expect(page.getByRole("button", { name: stopLabel("Crew A") })).toBeFocused();
  await page.reload();
  await page.locator("[data-crew]").first().waitFor();
  await expect(notice).toHaveCount(0);

  expect(stopRequests, "an expired stop is never sent, not at app open and not later").toEqual([]);
});

test("offline f2: a stop that expired for Crew A is told on Crew B's page too, and nothing is sent", async ({ page }) => {
  const stopRequests = watchStopRequests(page);
  await page.goto("/en/replay");
  await seedOutbox(page, [{ crewId: "crew-a", crewName: "Crew A", clientTime: minutesAgoIso(61) }]);

  await page.goto("/en/supervisor/crews/crew-b");
  await expect(page.getByRole("button", { name: stopLabel("Crew B") })).toBeEnabled();
  await expect(page.locator('[data-expired-stop="crew-a"]')).toContainText(expiredNotice("Crew A"));
  await expect(stopBar(page)).toHaveAttribute("data-stop-state", "idle");
  await expect(stopBar(page)).not.toContainText(/Not sent|kept on this phone/);
  expect(stopRequests, "an expired stop is never sent").toEqual([]);
});

test("offline f2: a stop whose time is 10 minutes AHEAD of the phone's clock reads the clock text (never '60 minutes'), is never sent, and focus walks from one Close to the next, then to Stop", async ({ page }) => {
  const stopRequests = watchStopRequests(page);
  await page.goto("/en/replay");
  // Crew A truly waited 61 minutes; Crew D's stored time is in the phone's future (its clock was wrong when it was pressed).
  await seedOutbox(page, [
    { crewId: "crew-a", crewName: "Crew A", clientTime: minutesAgoIso(61) },
    { crewId: "crew-d", crewName: "Crew D", clientTime: minutesAheadIso(10) },
  ]);

  await page.goto("/en/supervisor");
  await page.locator("[data-crew]").first().waitFor();
  const lapsed = page.locator('[data-expired-stop="crew-a"]');
  const ahead = page.locator('[data-expired-stop="crew-d"]');
  await expect(lapsed).toContainText(expiredNotice("Crew A"));
  await expect(ahead).toContainText(clockNotice("Crew D"));
  await expect(ahead).not.toContainText("60 minutes");
  await expect(lapsed).not.toContainText("looked wrong");
  await expect(stopBar(page)).toHaveAttribute("data-stop-state", "idle");

  // Durable, both kinds, across a reload.
  await page.reload();
  await page.locator("[data-crew]").first().waitFor();
  await expect(lapsed).toContainText(expiredNotice("Crew A"));
  await expect(ahead).toContainText(clockNotice("Crew D"));

  // Oldest first: Crew A's Close, then Crew D's, then the Stop button.
  await lapsed.getByRole("button", { name: en.shell.close }).focus();
  await page.keyboard.press("Enter");
  await expect(lapsed).toHaveCount(0);
  await expect(ahead.getByRole("button", { name: en.shell.close })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(ahead).toHaveCount(0);
  await expect(page.getByRole("button", { name: stopLabel("Crew A") })).toBeFocused();
  expect(stopRequests, "neither an expired nor an ahead-of-clock stop is ever sent").toEqual([]);
});

/** The path of a Cache Storage entry listed as "<cache> <path+query>" (no query). */
const entryPath = (entry: string): string => (entry.slice(entry.indexOf(" ") + 1).split("?")[0]) ?? "";

test("offline f2: the alert card's shell is precached: it opens offline for a warning this phone never opened", async ({ page, context }) => {
  await loadControlled(page, "/en/worker");
  // The exact path: `/en/worker/alerts` (the list) must not stand in for `/en/worker/alert` (the card).
  await expect.poll(() => cacheEntries(page).then((entries) => entries.some((entry) => entryPath(entry) === "/en/worker/alert"))).toBe(true);

  await context.setOffline(true);
  await page.goto(ALERT_UNVISITED);

  await expect(page.getByRole("heading", { level: 1 })).toBeAttached();
  await expect(page.getByText(en.states.offlineBanner.title)).toBeVisible();
  // The page is the alert card, not the offline fallback.
  await expect(page.getByRole("heading", { level: 1 })).not.toHaveText(en.offline.title);
});
