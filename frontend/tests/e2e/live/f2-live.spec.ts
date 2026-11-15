import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import en from "../../../messages/en.json";
import type { components } from "../../../src/api/schema.d.ts";
import { watchConsole } from "../gate.ts";
import { liveApiOrigin, liveEmployerToken, LIVE_SKIP_MESSAGE, NO_TOKEN_SKIP_MESSAGE } from "./env.ts";

/*
 * F2 against the REAL B3 backend (replay mode), not the mock: `pnpm e2e:live` (README, "Running F2 against the real B3"). The
 * specs derive everything from the API's own answers: no site id, date, level or hour is written here, so they hold on any
 * replay snapshot. They cover what F2 has built: worker Today, the alert card, the governance refusal.
 *
 * They check the PAGE against the API: the level on screen equals the `site_level` of the forecast hour that contains the replay
 * clock (the API's date at 11:10 in the site's zone, which is the web app's own clock rule: src/features/demo). Where the page
 * and the API can legitimately differ (the app's three-hour freshness rule against a replay snapshot's old `generated_at`), the
 * spec records the observation as an annotation instead of failing on it: the run's report is the evidence.
 *
 * With E2E_API_ORIGIN unset every spec skips, with LIVE_SKIP_MESSAGE.
 */

type Schemas = components["schemas"];
type Site = Schemas["Site"];
type Forecast = Schemas["SiteForecastToday"];
type Hour = Forecast["hours"][number];

const ORIGIN = liveApiOrigin(process.env);
const HAS_TOKEN = liveEmployerToken(process.env) !== null;
const PHONE = { width: 390, height: 844 };
/** The replay clock's local time, as the app reads it (src/features/demo useClock). */
const REPLAY_LOCAL_HOUR = 11;

test.skip(ORIGIN === null, LIVE_SKIP_MESSAGE);

interface Replay {
  readonly site: Site;
  readonly forecast: Forecast;
  /** The forecast hour that contains the replay clock: the one the screen reads. */
  readonly hour: Hour | null;
}

/** The first synthetic site (the app's demo site), its forecast for the API's default date, and the hour the clock is in. */
async function readReplay(request: APIRequestContext): Promise<Replay> {
  const sitesResponse = await request.get(`${ORIGIN ?? ""}/api/v1/sites`);
  expect(sitesResponse.status(), "GET /api/v1/sites").toBe(200);
  const site = ((await sitesResponse.json()) as Site[]).find((candidate) => candidate.synthetic);
  if (site === undefined) throw new Error("the API serves no synthetic site: load backend/fixtures/demo_site.toml (sb-jobs site load)");

  const forecastResponse = await request.get(`${ORIGIN ?? ""}/api/v1/sites/${site.id}/forecast/today`);
  expect(forecastResponse.status(), "GET forecast/today").toBe(200);
  const forecast = (await forecastResponse.json()) as Forecast;

  const localHour = new Intl.DateTimeFormat("en-GB", { timeZone: site.timezone, hour: "2-digit", hourCycle: "h23" });
  const hour = forecast.hours.find((candidate) => Number(localHour.format(new Date(candidate.starts_at))) === REPLAY_LOCAL_HOUR) ?? null;
  return { site, forecast, hour };
}

test.describe("F2 against the real B3 (replay)", () => {
  test("the API is in replay mode and serves the demo site and a forecast for its default date", async ({ request }) => {
    const { site, forecast } = await readReplay(request);

    expect(site.synthetic).toBe(true);
    expect(forecast.mode).toBe("replay");
    expect(forecast.site_id).toBe(site.id);
    expect(forecast.hours.length).toBeGreaterThan(0);
    test.info().annotations.push({
      type: "forecast",
      description: `date ${forecast.date}, status ${forecast.forecast_status}, generated_at ${forecast.generated_at}, config_version ${String(forecast.config_version)}`,
    });
  });

  test("worker Today shows the level of the real forecast hour the replay clock is in", async ({ page, request }) => {
    const { site, forecast, hour } = await readReplay(request);
    test.skip(hour === null, "the forecast has no hour at the replay clock's local hour (11:00)");

    const errors = watchConsole(page);
    await page.setViewportSize(PHONE);
    await page.goto(`/en/worker?site=${site.id}`);
    await expect(page.getByRole("heading", { level: 1, name: en.worker.today.title })).toBeAttached();

    if (forecast.forecast_status === "fallback" || hour?.site_level === null || hour === null) {
      // No level of its own to read: the screen says so in words and shows the site rules, never a guessed level.
      await expect(page.getByRole("heading", { name: en.levels.siteRules, level: 2 })).toBeVisible();
    } else {
      await expect(page.getByRole("heading", { name: en.levels.name[hour.site_level], level: 2 })).toBeVisible();
    }

    // The lead is the hour's most protective work-rest cycle: the real orange hour carries one cycle per workload (light 45-15 first,
    // heavy 20-40 second), so the first code in the array must not decide it.
    const cycles = (hour?.action_codes ?? [])
      .map((code) => /^cycle\.[a-z]+\.[a-z]+\.(\d+)-(\d+)$/.exec(code))
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match) => ({ work: Number(match[1]), rest: Number(match[2]) }));
    if (forecast.forecast_status === "fresh" && cycles.length > 0) {
      const strictest = cycles.reduce((best, next) => (next.work < best.work ? next : best));
      await expect(page.getByText(en.worker.today.lead.cycle.replace("{work}", String(strictest.work)).replace("{rest}", String(strictest.rest))).first()).toBeVisible();
    }
    test.info().annotations.push({ type: "action_codes", description: JSON.stringify(hour?.action_codes ?? []) });
    // The header clock is the replay moment (the API's date at 11:10 at the site), not the machine's; and whether the app judged the
    // replay snapshot fresh is recorded, not assumed.
    await expect(page.getByRole("banner").locator('bdi[dir="ltr"]')).toContainText("11:10");
    const kind = await page.locator("[data-level-sign]").first().getAttribute("data-kind");
    test.info().annotations.push({
      type: "freshness",
      description: `API forecast_status ${forecast.forecast_status}; the sign is drawn as "${String(kind)}" (generated_at ${forecast.generated_at})`,
    });
    // The replay freshness rule (src/lib/forecast/freshness.ts): a replay forecast's `generated_at` is about a day before the replay
    // date, so the 3 hour rule would draw every replay day as stale; the API's own `forecast_status` decides instead. A fresh replay
    // forecast with a level is drawn live, with the Replay stamp, and without the "No fresh forecast" banner.
    if (forecast.forecast_status === "fresh" && hour?.site_level != null) {
      expect(kind, "a fresh replay forecast must not be drawn as stale").toBe("live");
      await expect(page.locator("[data-level-sign] [data-mode-stamp]").first()).toContainText(en.states.stamp.replay);
      await expect(page.getByText(en.states.staleBanner.title)).toHaveCount(0);
    }
    expect(errors).toEqual([]);
  });

  test("the alert card for the current warning names the level the API forecasts", async ({ page, request }) => {
    const { site, hour } = await readReplay(request);
    test.skip(hour === null || hour.site_level === null || hour.site_level === "green", "no warning (Amber or above) at the replay clock's hour");
    if (hour === null || hour.site_level === null) return;

    const errors = watchConsole(page);
    await page.setViewportSize(PHONE);
    const query = new URLSearchParams({ audience: "site", target: site.id, level: hour.site_level, valid_from: hour.starts_at });
    await page.goto(`/en/worker/alert?${query.toString()}`);

    await expect(page.getByRole("heading", { name: en.levels.name[hour.site_level], level: 2 })).toBeVisible();
    await expect(page.getByText(en.worker.alert.kicker.site)).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("the governance refusal: an employer's request for individual data is refused, and the audit row shows in the worker log", async ({ page }) => {
    test.skip(!HAS_TOKEN, NO_TOKEN_SKIP_MESSAGE);

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/en/replay/governance");
    await expect(page.getByRole("button", { name: "Reset demo site" })).toBeVisible();
    const rows = page.locator("[data-access-row]");
    const before = await rows.count();

    await page.getByRole("button", { name: "Send the employer's request" }).click();

    await expect(page.locator("[data-governance]")).toHaveAttribute("data-governance", "live");
    const answer = page.locator("[data-answer=shown]");
    await expect(answer.locator("[data-status]")).toHaveText("403");
    await expect(answer).toContainText("urn:stellar-blaze:problem:individual-data-refused");
    await expect(page.locator("[data-audit=shown]")).toContainText("Refused");
    // The API's own log: at least the row just written, and the worker-facing sentence is the site's.
    await expect.poll(() => rows.count()).toBeGreaterThanOrEqual(Math.max(1, before));
    await expect(rows.first()).toContainText("An employer request for individual health data at this site was refused");
  });
});

/*
 * The rest of what F2 has built, live: the unwell sheet, the supervisor's crews and Stop work, the demo reset. The employer token is the
 * web server's (the BFF injects it); the specs also hold it, only to read the API's own state and compare it with the screen. It is
 * sent to the API alone, never written to an annotation, a log line or a screenshot.
 */

const TOKEN = liveEmployerToken(process.env);
/** The replay clock the supervisor screen reads: 10:10, inside crew shifts (the API's replay clock starts near it too), not the 11:10 break. */
const STOP_AT = "10:10";

type Crew = Schemas["Crew"];
type CrewTimeline = Schemas["CrewTimeline"];

async function apiGet(request: APIRequestContext, path: string, authorized: boolean): Promise<{ status: number; body: unknown }> {
  const response = await request.get(`${ORIGIN ?? ""}${path}`, authorized && TOKEN !== null ? { headers: { Authorization: `Bearer ${TOKEN}` } } : {});
  return { status: response.status(), body: (await response.json()) as unknown };
}

async function readCrews(request: APIRequestContext, siteId: string): Promise<Crew[]> {
  const { status, body } = await apiGet(request, `/api/v1/sites/${siteId}/crews`, true);
  expect(status, "GET crews (the demo employer token)").toBe(200);
  return body as Crew[];
}

async function demoSite(request: APIRequestContext): Promise<Site> {
  const sites = await apiGet(request, "/api/v1/sites", false);
  const site = (sites.body as Site[]).find((candidate) => candidate.synthetic);
  if (site === undefined) throw new Error("the API serves no synthetic site");
  return site;
}

/** Records, as annotations, the status and request id of every write the page makes (never a header that carries a credential). */
function recordWrites(page: Page): void {
  page.on("response", (response) => {
    const request = response.request();
    if (request.method() === "GET" || !response.url().includes("/api/v1/")) return;
    const id = response.headers()["x-request-id"] ?? "none";
    test.info().annotations.push({
      type: "write",
      description: `${request.method()} ${new URL(response.url()).pathname} -> ${String(response.status())} (x-request-id ${id})`,
    });
  });
}

test.describe("F2 against the real B3: the worker's unwell sheet", () => {
  test("the unwell sheet opens from Today on the real site's numbers and sends no request", async ({ page, request }) => {
    const site = await demoSite(request);

    const errors = watchConsole(page);
    await page.setViewportSize(PHONE);
    // The way a visitor really gets a site: no pin, one tap on the demo yard (which reads the site list), then Today.
    await page.goto("/en/worker");
    await page.getByRole("button", { name: en.worker.today.entry.demo }).click();
    await expect(page.getByRole("heading", { level: 1, name: en.worker.today.title })).toBeAttached();
    await expect(page.locator("[data-level-sign]").first()).toBeVisible();

    // Navigating client-side keeps the page's data; from here on nothing may be sent to the API (the sheet is local: personal and
    // contact data never leave the phone, and it must open with no signal).
    const calls: string[] = [];
    page.on("request", (candidate) => {
      if (candidate.url().includes("/api/")) calls.push(`${candidate.method()} ${new URL(candidate.url()).pathname}`);
    });
    await page.locator("[data-emergency]").click();
    await expect(page.getByRole("heading", { level: 1, name: en.worker.unwell.title })).toBeAttached();
    await expect(page.getByRole("timer")).toBeVisible();

    // The numbers are the real site's (Site.supervisor_phone), shown, and in the demo build never dialled.
    expect(site.supervisor_phone, "the demo site carries a supervisor number").toBeTruthy();
    const supervisor = page.getByRole("button", { name: new RegExp(en.worker.unwell.calls.supervisor.title) });
    await expect(supervisor).toContainText(String(site.supervisor_phone));
    await expect(page.locator('a[href^="tel:"]')).toHaveCount(0);
    await supervisor.click();
    await expect(page.getByText(en.worker.unwell.calls.demo.supervisor)).toBeVisible();
    expect(calls, "the unwell sheet sends nothing to the API").toEqual([]);
    expect(errors).toEqual([]);
  });
});

test.describe("F2 against the real B3: the supervisor's crews and Stop work", () => {
  test.skip(!HAS_TOKEN, NO_TOKEN_SKIP_MESSAGE);

  const stopButton = (page: Page) => page.getByRole("button", { name: /^Stop work, / });
  const bar = (page: Page) => page.locator("[data-emergency]");

  async function openCrews(page: Page): Promise<string[]> {
    const errors = watchConsole(page);
    await page.setViewportSize(PHONE);
    await page.goto(`/en/supervisor?at=${STOP_AT}`);
    await page.locator("[data-crew]").first().waitFor();
    return errors;
  }

  test("crews, ranking, the suppressed crew and the focal sentence come from the real plan", async ({ page, request }) => {
    const site = await demoSite(request);
    const crews = await readCrews(request, site.id);
    const timelines = new Map<string, CrewTimeline>();
    for (const crew of crews) {
      const { status, body } = await apiGet(request, `/api/v1/crews/${crew.id}/timeline`, false);
      expect(status, `GET timeline ${crew.id} (no credential needed)`).toBe(200);
      timelines.set(crew.id, body as CrewTimeline);
    }

    const errors = await openCrews(page);
    const rows = page.locator("[data-crew]");
    await expect(rows).toHaveCount(crews.length);
    const texts = await rows.evaluateAll((nodes) => nodes.map((node) => node.textContent));
    for (const crew of crews) expect(texts.some((text) => text.includes(crew.name)), `${crew.name} is listed`).toBe(true);
    const order = texts.map((text) => crews.find((crew) => text.includes(crew.name))?.name ?? "?");
    test.info().annotations.push({ type: "ranking", description: `strips, top to bottom: ${order.join(", ")}` });

    // The privacy footnote names exactly the crews the API suppresses (a crew with fewer than k members), and k is the API's.
    const suppressed = crews.filter((crew) => timelines.get(crew.id)?.suppressed === true);
    expect(suppressed.length, "the demo site has a crew below k").toBeGreaterThan(0);
    const note = page.locator("[data-suppressed-note]");
    await expect(note).toBeVisible();
    for (const crew of suppressed) await expect(note).toContainText(crew.name);
    await expect(note).toContainText(`fewer than ${String(timelines.get(suppressed[0]?.id ?? "")?.k)} people`);

    // The focal sentence is about the top strip's crew, and names the level the API gives that crew at the replay clock (10:10).
    const focal = crews.find((crew) => (texts[0] ?? "").includes(crew.name));
    expect(focal, "the top strip is a crew of the API").toBeDefined();
    const sentence = page.getByRole("heading", { level: 2 });
    await expect(sentence).toContainText(focal?.name ?? "");
    const timeline = focal === undefined ? undefined : timelines.get(focal.id);
    const instant = Date.parse(`${timeline?.date ?? ""}T06:10:00Z`); // 10:10 in Asia/Dubai (UTC+4)
    const hour = timeline?.hours.find((candidate) => Date.parse(candidate.starts_at) <= instant && instant < Date.parse(candidate.starts_at) + 3_600_000);
    if (hour?.crew_level != null) await expect(sentence).toContainText(en.levels.name[hour.crew_level]);
    test.info().annotations.push({ type: "focal", description: (await sentence.textContent()) ?? "" });

    await expect(page.locator("[data-primary]")).toHaveCount(1);
    await expect(page.locator("[data-mode-stamp]")).toContainText(en.states.stamp.replay);
    await expect(page.getByText(en.shell.demo.banner)).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("Stop work at 10:10 is recorded by the API, Undo clears it (DELETE), a second Stop reads Work stopped, Resume ends it", async ({ page, request }) => {
    recordWrites(page);
    const site = await demoSite(request);
    await openCrews(page);
    const crewName = (await stopButton(page).innerText()).replace(/^Stop work,\s*/, "").trim();
    const stoppedOf = async (id: string) => (await readCrews(request, site.id)).find((candidate) => candidate.id === id)?.stopped;
    const crew = (await readCrews(request, site.id)).find((candidate) => candidate.name === crewName);
    if (crew === undefined) throw new Error(`the Stop work bar names "${crewName}", which is not a crew of the API`);
    expect(crew.stopped, "no stop is active before the test").toBe(false);

    // Stop, then Undo inside 10 s.
    await stopButton(page).click();
    await expect(bar(page)).toContainText(`${crewName} stopped 10:`);
    await expect(bar(page)).toContainText("Stop recorded");
    await expect(bar(page)).not.toContainText(/alerted|phones|notified/i);
    const afterStop = (await readCrews(request, site.id)).find((candidate) => candidate.id === crew.id);
    expect(afterStop?.stopped, "the API records the stop").toBe(true);
    expect(afterStop?.active_stop_id, "and names it").toBeTruthy();
    await expect(page.getByRole("heading", { level: 2 })).toContainText(`${crewName} stopped work at`);
    await page.getByRole("button", { name: /^Undo/ }).click();
    await expect(stopButton(page)).toBeVisible();
    await expect.poll(() => stoppedOf(crew.id), { message: "Undo clears the stop on the API" }).toBe(false);
    // The API keeps the cleared stop's interval in the crew's plan and timeline (its hour stays Red after an Undo): recorded, not asserted.
    await page.reload();
    await page.locator("[data-crew]").first().waitFor();
    test.info().annotations.push({ type: "focal after undo", description: (await page.getByRole("heading", { level: 2 }).textContent()) ?? "" });

    // Stop again and let the undo window pass.
    await stopButton(page).click();
    await expect(bar(page)).toContainText("Work stopped 10:", { timeout: 20_000 });
    await expect(page.getByRole("button", { name: /^Undo/ })).toHaveCount(0);
    expect(await stoppedOf(crew.id)).toBe(true);

    // Resume work (a confirm dialog) is the same DELETE.
    await page.getByRole("button", { name: en.supervisor.stop.resume }).click();
    await page.getByRole("dialog").getByRole("button", { name: en.supervisor.stop.resumeConfirm }).click();
    await expect(stopButton(page)).toBeVisible();
    await expect.poll(() => stoppedOf(crew.id), { message: "Resume clears the stop on the API" }).toBe(false);
  });

  test("Reset demo site starts a new epoch: the API's epoch moves on and a recorded stop is gone", async ({ page, request }) => {
    recordWrites(page);
    const site = await demoSite(request);
    await openCrews(page);
    await stopButton(page).click();
    await expect(bar(page)).toContainText("Stop recorded");
    expect((await readCrews(request, site.id)).some((crew) => crew.stopped), "a stop is active").toBe(true);

    await page.getByRole("button", { name: en.shell.demo.reset.button }).click();
    await expect(page.getByRole("status").filter({ hasText: /new epoch/ })).toBeVisible();
    const after = await demoSite(request);
    expect(site.epoch_id, "the site has an epoch").not.toBeNull();
    expect(after.epoch_id, "the epoch advanced").toBe((site.epoch_id ?? 0) + 1);
    expect((await readCrews(request, site.id)).some((crew) => crew.stopped), "no stop survives the reset").toBe(false);
    await expect(stopButton(page)).toBeVisible();

    // B3 allows one reset a minute: a second at once is a 429 (Retry-After 60), and the screen says so in words.
    await page.getByRole("button", { name: en.shell.demo.reset.button }).click();
    await expect(page.getByText(en.shell.demo.reset.rateLimited)).toBeVisible();
  });
});

/*
 * Real-API screenshots for the design record (GATE_SHOTS=1): the phone's first fold of Today, the supervisor's crews and the
 * governance refusal, each as the real B3 served it. They carry no credential: the token lives in the BFF and in these specs, never on
 * a page.
 */
test.describe("F2 against the real B3: screenshots", () => {
  test.skip(process.env["GATE_SHOTS"] !== "1", "GATE_SHOTS=1 writes the real-API screenshots");
  test.skip(!HAS_TOKEN, NO_TOKEN_SKIP_MESSAGE);
  const SHOT_DIR = path.resolve(process.cwd(), "../docs/design/f2/gate/live");

  test("Today, crews and the governance refusal at 390 px", async ({ page, request }) => {
    // The suite before this test has spent the BFF's per-minute budget for token-bearing requests (the governance page then reads
    // "limited", which is the BFF protecting the demo token, not B3): let the window pass so the live send is real.
    test.setTimeout(120_000);
    await page.waitForTimeout(62_000);
    const site = await demoSite(request);
    mkdirSync(SHOT_DIR, { recursive: true });
    await page.setViewportSize(PHONE);
    await page.addInitScript(() => {
      localStorage.setItem("sb-theme", JSON.stringify({ theme: "night", until: Date.now() + 6 * 3_600_000 }));
    });

    await page.goto(`/en/worker?site=${site.id}`);
    await expect(page.locator("[data-level-sign]").first()).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(SHOT_DIR, "today-390-night.png") });

    await page.goto(`/en/supervisor?at=${STOP_AT}`);
    await page.locator("[data-crew]").first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(SHOT_DIR, "crews-390-night.png") });

    await page.goto("/en/replay/governance");
    // The page opens on its recorded run; the live send needs the demo site, which it reads first (the reset button appears with it).
    await expect(page.getByRole("button", { name: "Reset demo site" })).toBeVisible();
    await page.getByRole("button", { name: "Send the employer's request" }).click();
    await expect(page.locator("[data-governance]")).toHaveAttribute("data-governance", "live");
    await expect(page.locator("[data-answer=shown]")).toContainText("urn:stellar-blaze:problem:individual-data-refused");
    await expect(page.locator("[data-answer=shown]")).not.toContainText("mock-req");
    await expect(page.locator("[data-access-row]").first()).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(SHOT_DIR, "governance-390-night.png"), fullPage: true, scale: "css" });
  });
});
