import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import en from "../../../messages/en.json";
import type { components } from "../../../src/api/schema.d.ts";
import { sanitizeClause } from "../../../src/lib/copy/sanitize-clause.ts";
import { watchConsole } from "../gate.ts";
import { liveApiOrigin, liveEmployerToken, LIVE_SKIP_MESSAGE, NO_TOKEN_SKIP_MESSAGE } from "./env.ts";

/*
 * F2 against the REAL B3 backend (replay mode), not the mock: `pnpm e2e:live` (README, "Running F2 against the real B3"). The
 * specs derive everything from the API's own answers: no site id, date, level or hour is written here, so they hold on any
 * replay snapshot. They cover what F2 has built: worker Today, the alert card, the governance refusal.
 *
 * They check the PAGE against the API: the level on screen equals the `site_level` of the forecast hour that contains the replay
 * clock (the API's own clock, the `now` of its forecast: the web app has no replay moment of its own, src/features/demo). Where the page
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
test.skip(ORIGIN === null, LIVE_SKIP_MESSAGE);

interface Replay {
  readonly site: Site;
  readonly forecast: Forecast;
  /** The forecast hour that contains the API's clock (`forecast.now`): the one the screen reads. */
  readonly hour: Hour | null;
}

/** Minutes after local midnight (the site's zone) of `instant`. */
function minutesOfDay(instant: Date, zone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(instant);
  const part = (type: string): number => Number(parts.find((candidate) => candidate.type === type)?.value);
  return part("hour") * 60 + part("minute");
}

/** The API's clock now, from its forecast response, in the site's zone (minutes after midnight). */
async function apiClockMinutes(request: APIRequestContext, site: Site): Promise<number> {
  const response = await request.get(`${ORIGIN ?? ""}/api/v1/sites/${site.id}/forecast/today`);
  expect(response.status(), "GET forecast/today").toBe(200);
  const { now } = (await response.json()) as Forecast;
  expect(now, "the forecast carries the API's clock").toBeTruthy();
  return minutesOfDay(new Date(now ?? ""), site.timezone);
}

/** What the page's header clock shows, as minutes after midnight. */
async function headerClockMinutes(page: Page): Promise<number> {
  const text = (await page.getByRole("banner").locator('bdi[dir="ltr"]').first().textContent()) ?? "";
  const match = /(\d{2}):(\d{2})/.exec(text);
  if (match === null) throw new Error(`the header clock reads "${text}", not a time`);
  return Number(match[1]) * 60 + Number(match[2]);
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
  // The hour the API's own clock is in (never a constant of this spec: the clock moves, and a deployment sets its own SB_REPLAY_NOW).
  const apiHour = Number(localHour.format(new Date(forecast.now ?? "")));
  const hour = forecast.hours.find((candidate) => Number(localHour.format(new Date(candidate.starts_at))) === apiHour) ?? null;
  return { site, forecast, hour };
}

test.describe("F2 against the real B3 (replay)", () => {
  test("the API is in replay mode and serves the demo site and a forecast for its default date", async ({ request }) => {
    const { site, forecast } = await readReplay(request);

    expect(site.synthetic).toBe(true);
    expect(forecast.mode).toBe("replay");
    expect(forecast.date, "the recipe's replay day (LIVE_REPLAY_DATE)").toBe(process.env["E2E_EXPECT_REPLAY_DATE"] ?? forecast.date);
    expect(forecast.site_id).toBe(site.id);
    expect(forecast.hours.length).toBeGreaterThan(0);
    test.info().annotations.push({
      type: "forecast",
      description: `date ${forecast.date}, status ${forecast.forecast_status}, generated_at ${forecast.generated_at}, config_version ${String(forecast.config_version)}`,
    });
  });

  // B3 7242151: the seed pins the released model, and the demo day is the real OMAA day of 2026-06-14 (README "Run recipe"): corrected, not
  // flat (the 24b finding was a Green-all-day demo with no model). B3's own check of that day: green 06-07, amber 08, orange 09-16, amber 17,
  // green 18-19 (Asia/Dubai).
  test("the demo day, with the seed's model pin, is not flat and names its model", async ({ request }) => {
    const { forecast } = await readReplay(request);

    expect(forecast.model_id, "the seed pins a model").not.toBeNull();
    expect(forecast.forecast_status).toBe("fresh");
    const levels = forecast.hours.map((hour) => hour.site_level).filter((level): level is NonNullable<typeof level> => level !== null);
    expect(levels.length).toBeGreaterThan(0);
    expect(new Set(levels).size, `site levels of ${forecast.date}: ${levels.join(", ")}`).toBeGreaterThanOrEqual(3);
    expect(levels, "the day reaches Orange").toContain("orange");
    test.info().annotations.push({ type: "demo day", description: `${forecast.date} model ${String(forecast.model_id)}: ${levels.join(",")}` });
  });

  test("worker Today shows the level of the real forecast hour the replay clock is in", async ({ page, request }) => {
    const { site, forecast, hour } = await readReplay(request);
    test.skip(hour === null, "the forecast has no hour at the API clock's local hour");

    const errors = watchConsole(page);
    await page.setViewportSize(PHONE);
    const before = await apiClockMinutes(request, site);
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
    // The header clock is the API's own clock (the regression guard of the 11:10 / 10:10 split): the page's HH:MM lies between the API's
    // reading before the page was opened and its reading after the header drew, whatever SB_REPLAY_NOW is.
    await expect(page.getByRole("banner").locator('bdi[dir="ltr"]').first()).toContainText(/\d{2}:\d{2}/);
    const shown = await headerClockMinutes(page);
    const after = await apiClockMinutes(request, site);
    expect(shown, `header ${String(shown)} min, API clock ${String(before)} to ${String(after)} min`).toBeGreaterThanOrEqual(before);
    expect(shown).toBeLessThanOrEqual(after);
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
    await expect(rows.first()).toContainText("A request for a worker's health data was refused");
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

type DayPlan = Schemas["DayPlan"];

/** The level the API gives `crewId` in the hour that contains `instantIso`, from the (unauthenticated) crew timeline. */
async function crewLevelAt(request: APIRequestContext, crewId: string, instantIso: string): Promise<string | null> {
  const { status, body } = await apiGet(request, `/api/v1/crews/${crewId}/timeline`, false);
  expect(status, `GET timeline ${crewId}`).toBe(200);
  const at = Date.parse(instantIso);
  const hour = (body as CrewTimeline).hours.find((candidate) => Date.parse(candidate.starts_at) <= at && at < Date.parse(candidate.starts_at) + 3_600_000);
  return hour?.crew_level ?? null;
}

/** 10:10 in Asia/Dubai (UTC+4) on the API's replay date, as an instant. */
const stopInstant = (date: string): string => `${date}T06:10:00Z`;

async function readDayPlan(request: APIRequestContext, crewId: string): Promise<{ status: number; body: unknown }> {
  return apiGet(request, `/api/v1/crews/${crewId}/day-plan`, true);
}

async function apiSend(
  request: APIRequestContext,
  method: "POST" | "DELETE",
  path: string,
  body?: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  const response = await request.fetch(`${ORIGIN ?? ""}${path}`, {
    method,
    headers: TOKEN === null ? {} : { Authorization: `Bearer ${TOKEN}` },
    ...(body === undefined ? {} : { data: body }),
  });
  const text = await response.text();
  return { status: response.status(), body: text === "" ? null : (JSON.parse(text) as unknown) };
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
    await page.getByRole("button", { name: en.worker.join.demo }).click();
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

  // The 11:10 / 10:10 split: the web app used to say 11:10 (every crew off shift) while the API's replay clock said 10:10 (every crew working).
  // No `?at=` here: the first load must agree with the API's own clock, whatever SB_REPLAY_NOW is (run it with a shifted one to prove it).
  test("the first load, with no ?at=, agrees with the API's clock: the header time and who is on shift", async ({ page, request }) => {
    const site = await demoSite(request);
    const crews = await readCrews(request, site.id);
    const before = await apiClockMinutes(request, site);
    const errors = watchConsole(page);
    await page.setViewportSize(PHONE);
    await page.goto("/en/supervisor");
    await page.locator("[data-crew]").first().waitFor();
    await expect(page.getByRole("banner").locator('bdi[dir="ltr"]').first()).toContainText(/\d{2}:\d{2}/);
    const shown = await headerClockMinutes(page);
    const after = await apiClockMinutes(request, site);
    expect(shown, `header ${String(shown)} min, API clock ${String(before)} to ${String(after)} min`).toBeGreaterThanOrEqual(before);
    expect(shown).toBeLessThanOrEqual(after);

    // Who is on shift at the API's clock, from the API's own timelines (the shift is in UTC instants).
    const onShift: boolean[] = [];
    for (const crew of crews) {
      const timeline = (await apiGet(request, `/api/v1/crews/${crew.id}/timeline`, false)).body as CrewTimeline;
      onShift.push(timeline.shift.some((range) => minutesOfDay(new Date(range.starts_at), site.timezone) <= after && after < minutesOfDay(new Date(range.ends_at), site.timezone)));
    }
    const text = (await page.locator("main").textContent()) ?? "";
    test.info().annotations.push({ type: "API clock", description: `${String(before)}-${String(after)} min; crews on shift: ${onShift.join(",")}` });
    if (onShift.every(Boolean)) expect(text, "every crew is on shift at the API's clock").not.toMatch(/off shift now/);
    if (onShift.every((value) => !value)) expect(text, "no crew is on shift at the API's clock").toMatch(/off shift now/);
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
    // What the API says about this crew's 10:10 hour and its plan before any stop: an undone stop must leave exactly this.
    const baselineTimeline = (await apiGet(request, `/api/v1/crews/${crew.id}/timeline`, false)).body as CrewTimeline;
    const timelineDate = baselineTimeline.date;
    const heatIsRed = baselineTimeline.hours.some((hour) => hour.crew_level === "red");
    const baselineLevel = await crewLevelAt(request, crew.id, stopInstant(timelineDate));
    const baselinePlan = await readDayPlan(request, crew.id);
    expect(baselinePlan.status, "the crew's plan before the stop").toBe(200);
    const baselineItems = (baselinePlan.body as DayPlan).ack_items.map((item) => item.id);

    // Stop, then Undo inside 10 s.
    await stopButton(page).click();
    await expect(bar(page)).toContainText(`${crewName} stopped 10:`);
    await expect(bar(page)).toContainText("Stop recorded");
    await expect(bar(page)).toContainText("Crews are notified within about six minutes.");
    await expect(bar(page)).not.toContainText(/immediately|alerted|phones|delivered/i);
    const afterStop = (await readCrews(request, site.id)).find((candidate) => candidate.id === crew.id);
    expect(afterStop?.stopped, "the API records the stop").toBe(true);
    expect(afterStop?.active_stop_id, "and names it").toBeTruthy();
    await expect(page.getByRole("heading", { level: 2 })).toContainText(`${crewName} stopped work at`);
    await page.getByRole("button", { name: /^Undo/ }).click();
    await expect(stopButton(page)).toBeVisible();
    await expect.poll(() => stoppedOf(crew.id), { message: "Undo clears the stop on the API" }).toBe(false);
    // The undone-stop fix (B3 ba912f3): a stop cleared inside the 10 s undo window leaves NO trace in levels or plans. The crew's hour is
    // what it was before the stop (so it is not Red because of it), its acknowledgement items are the same ids, and the supervisor
    // screen does not say Red unless the heat itself did.
    const afterUndoLevel = await crewLevelAt(request, crew.id, stopInstant(timelineDate));
    expect(afterUndoLevel, "an undone stop leaves the crew's hour as it was").toBe(baselineLevel);
    if (baselineLevel !== "red") expect(afterUndoLevel, "an undone stop never leaves the hour Red").not.toBe("red");
    const afterUndoPlan = await readDayPlan(request, crew.id);
    expect(afterUndoPlan.status).toBe(200);
    expect((afterUndoPlan.body as DayPlan).ack_items.map((item) => item.id), "the plan's acknowledgement items are unchanged").toEqual(baselineItems);
    await page.reload();
    await page.locator("[data-crew]").first().waitFor();
    const focalAfterUndo = (await page.getByRole("heading", { level: 2 }).textContent()) ?? "";
    test.info().annotations.push({ type: "focal after undo", description: focalAfterUndo });
    if (!heatIsRed) expect(focalAfterUndo, "the supervisor screen does not say Red after an Undo").not.toContain(en.levels.name.red);

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
 * The supervisor's plan and sign-off screen (Task 20), live. The ids ticked are the SERVER's `ack_items` ids (`<zone>-<HHMM>`): the spec reads
 * them from the API first and compares them with the page. The sign-off and the plan read go through the BFF, which holds the token.
 */
test.describe("F2 against the real B3: the supervisor's plan and sign-off", () => {
  test.skip(!HAS_TOKEN, NO_TOKEN_SKIP_MESSAGE);

  const planPath = (crewId: string) => `/en/supervisor/crews/${crewId}?at=${STOP_AT}`;
  const ACK_ID = /^(medium|high|red)-\d{4}$/;

  // The suite above has spent the BFF's per-minute budget for token-bearing requests (a sign-off then reads 429 from the BFF, which is
  // the BFF protecting the demo token, not B3): let the window pass so these requests are real.
  test.beforeAll(async () => {
    test.setTimeout(90_000);
    await new Promise((resolve) => setTimeout(resolve, 62_000));
  });
  test.beforeEach(() => {
    test.setTimeout(60_000);
  });

  async function openPlan(page: Page, crewId: string): Promise<string[]> {
    const errors = watchConsole(page);
    await page.setViewportSize(PHONE);
    await page.goto(planPath(crewId));
    await page.locator("[data-sign-off]").waitFor();
    return errors;
  }

  test("a crew's plan is read from the real planner and signed by ticking the server's own ack_items: 201, then the plan says signed", async ({ page, request }) => {
    recordWrites(page);
    const before = await readDayPlan(request, "crew-b");
    expect(before.status, "GET day-plan crew-b").toBe(200);
    const plan = before.body as DayPlan;
    test.skip(plan.signoff_state === "signed", "crew-b is already signed in this epoch");
    expect(plan.ack_items.length, "the demo day has items that need a tick").toBeGreaterThan(0);
    for (const item of plan.ack_items) expect(item.id, "the id format is <zone>-<HHMM>").toMatch(ACK_ID);
    test.info().annotations.push({ type: "ack_items", description: plan.ack_items.map((item) => `${item.id} (${item.text_code})`).join(", ") });
    test.info().annotations.push({ type: "plan mode", description: `DayPlan.mode = ${String(plan.mode)}; segments ${String(plan.segments.length)}; status ${plan.status}` });

    const errors = await openPlan(page, "crew-b");
    // The screen lists exactly the server's items, by id.
    const boxes = page.getByRole("checkbox");
    await expect(boxes).toHaveCount(plan.ack_items.length);
    expect(await boxes.evaluateAll((nodes) => nodes.map((node) => (node as HTMLInputElement).value))).toEqual(plan.ack_items.map((item) => item.id));
    await expect(page.locator("[data-mode-stamp]")).toContainText(en.states.stamp.replay);
    await expect(page.locator("[data-block]").first()).toBeVisible();

    // Pressed with nothing ticked: it says how many are left and sends nothing.
    const posts: string[] = [];
    page.on("request", (candidate) => {
      if (candidate.method() === "POST" && candidate.url().includes("/day-plan/sign-off")) posts.push(candidate.url());
    });
    await page.getByRole("button", { name: en.supervisor.plan.signOff.submit }).click();
    await expect(page.locator("[data-sign-off-message]")).toContainText(`Tick ${String(plan.ack_items.length)} more item`);
    expect(posts, "nothing is sent while items are unticked").toEqual([]);

    for (const box of await boxes.all()) await box.check();
    const answered = page.waitForResponse((response) => response.request().method() === "POST" && response.url().includes("/day-plan/sign-off"));
    await page.getByRole("button", { name: en.supervisor.plan.signOff.submit }).click();
    const response = await answered;
    expect(response.status(), "the real sign-off").toBe(201);
    test.info().annotations.push({ type: "sign-off response", description: JSON.stringify(await response.json()) });
    await expect(page.locator("[data-signed]")).toContainText("by the site supervisor");
    await expect(page.getByRole("button", { name: en.supervisor.plan.signOff.submit })).toHaveCount(0);

    const after = (await readDayPlan(request, "crew-b")).body as DayPlan;
    expect(after.signoff_state, "the API's own state").toBe("signed");
    expect(after.signed_by_role).toBe("supervisor");
    expect(errors).toEqual([]);
  });

  test("a sign-off that leaves an item out is the real 409 review-required, naming the items still missing (API shapes)", async ({ request }) => {
    const planResponse = await readDayPlan(request, "crew-c");
    expect(planResponse.status).toBe(200);
    const plan = planResponse.body as DayPlan;
    test.skip(plan.signoff_state === "signed", "crew-c is already signed in this epoch");
    test.skip(plan.ack_items.length < 2, "crew-c's plan has fewer than two items");
    const ids = plan.ack_items.map((item) => item.id);
    const left = ids.slice(0, -1);
    const missed = ids[ids.length - 1] ?? "";

    const partial = await apiSend(request, "POST", "/api/v1/crews/crew-c/day-plan/sign-off", { acknowledged_items: left });
    expect(partial.status, "an item left out").toBe(409);
    const body = partial.body as Record<string, unknown>;
    test.info().annotations.push({ type: "409 body", description: JSON.stringify(body) });
    expect(body["type"]).toBe("urn:stellar-blaze:problem:review-required");
    expect(body["missing_items"]).toEqual([missed]);

    const none = await apiSend(request, "POST", "/api/v1/crews/crew-c/day-plan/sign-off", { acknowledged_items: [] });
    expect(none.status, "nothing ticked").toBe(409);
    expect((none.body as Record<string, unknown>)["missing_items"]).toEqual(ids);

    // An id that is not an item of the plan changes nothing: with an item still missing it is the same 409 ...
    const unknownAndMissing = await apiSend(request, "POST", "/api/v1/crews/crew-c/day-plan/sign-off", { acknowledged_items: [...left, "high-9999"] });
    expect(unknownAndMissing.status, "an unknown id does not hide a missing item").toBe(409);
    expect((unknownAndMissing.body as Record<string, unknown>)["missing_items"]).toEqual([missed]);
    // ... and nothing was recorded by any of the refusals.
    expect(((await readDayPlan(request, "crew-c")).body as DayPlan).signoff_state).not.toBe("signed");

    // With every real item present, the unknown id is ignored: 201, recording the plan's own items only (the mock used to answer 422).
    const unknown = await apiSend(request, "POST", "/api/v1/crews/crew-c/day-plan/sign-off", { acknowledged_items: ["high-9999", ...ids] });
    test.info().annotations.push({ type: "unknown ack id with every real item", description: `${String(unknown.status)} ${JSON.stringify(unknown.body)}` });
    expect(unknown.status).toBe(201);
    expect((unknown.body as { acknowledged_items: string[] }).acknowledged_items).toEqual(ids);
  });

  test("the screen's real 409: a stop that outlives the undo window and is then cleared changes the plan under the supervisor, the screen re-reads it", async ({ page, request }) => {
    test.setTimeout(90_000);
    recordWrites(page);
    const before = await readDayPlan(request, "crew-a");
    expect(before.status).toBe(200);
    test.skip((before.body as DayPlan).signoff_state === "signed", "crew-a is already signed in this epoch");

    // A stop that outlives the 10 s undo window removes the work after it from the plan, items included (B3 ba912f3: an active stop
    // covers the plan from its start to the end of the crew's shift). The page reads that plan.
    const stop = await apiSend(request, "POST", "/api/v1/crews/crew-a/stops", { reason_code: "heat" });
    expect(stop.status, "the stop the plan changes under").toBe(201);
    const stopId = (stop.body as { id: string }).id;
    let cleared = false;
    try {
      await page.waitForTimeout(11_000);
      const whileStopped = ((await readDayPlan(request, "crew-a")).body as DayPlan).ack_items.map((item) => item.id);
      await openPlan(page, "crew-a");
      const boxes = page.getByRole("checkbox");
      await expect(boxes).toHaveCount(whileStopped.length);
      for (const box of await boxes.all()) await box.check();

      // The stop is cleared: the plan gets its work back, and the items the screen never listed.
      const gone = await apiSend(request, "DELETE", `/api/v1/crews/crew-a/stops/${stopId}`);
      expect(gone.status, "the stop is cleared").toBe(204);
      cleared = true;
      const afterClear = ((await readDayPlan(request, "crew-a")).body as DayPlan).ack_items.map((item) => item.id);
      const gained = afterClear.filter((id) => !whileStopped.includes(id));
      test.info().annotations.push({ type: "items", description: `while stopped [${whileStopped.join(", ")}], after the clear [${afterClear.join(", ")}]` });
      expect(gained.length, "clearing the stop brings items the screen did not list").toBeGreaterThan(0);

      const answered = page.waitForResponse((response) => response.request().method() === "POST" && response.url().includes("/day-plan/sign-off"));
      await page.getByRole("button", { name: en.supervisor.plan.signOff.submit }).click();
      const response = await answered;
      const refusal = (await response.json()) as { missing_items?: string[] };
      test.info().annotations.push({ type: "409 via the screen", description: `${String(response.status())} ${JSON.stringify(refusal)}` });
      expect(response.status(), "the plan changed since it was read").toBe(409);
      expect(refusal.missing_items, "the server names the items that were not ticked").toEqual(gained);
      await expect(page.locator("[data-sign-off-message]")).toContainText("still need a tick");

      // The screen read the plan again: every item of the new plan has a box, the new ones unticked, the old ones still ticked.
      await expect(boxes).toHaveCount(afterClear.length);
      expect(await boxes.evaluateAll((nodes) => nodes.map((node) => (node as HTMLInputElement).value))).toEqual(afterClear);
      for (const id of gained) await expect(page.locator(`input[name=ack][value="${id}"]`)).not.toBeChecked();
      await expect(page.locator("[data-signed]")).toHaveCount(0);

      // Tick what is new and sign again: the real 201.
      for (const id of gained) await page.locator(`input[name=ack][value="${id}"]`).check();
      const signed = page.waitForResponse((candidate) => candidate.request().method() === "POST" && candidate.url().includes("/day-plan/sign-off"));
      await page.getByRole("button", { name: en.supervisor.plan.signOff.submit }).click();
      expect((await signed).status(), "signed once the new items are ticked").toBe(201);
      await expect(page.locator("[data-signed]")).toBeVisible();
    } finally {
      if (!cleared) await apiSend(request, "DELETE", `/api/v1/crews/crew-a/stops/${stopId}`);
    }
  });

  test("a crew whose published shift is not legal answers the real 422 shift-not-legal, and the screen shows it as a result, not an error", async ({ page, request }) => {
    const planResponse = await readDayPlan(request, "crew-b");
    test.skip(planResponse.status !== 422, "the demo crews' shifts are legal; this runs against a site whose crew-b shift is not (report, section 4)");
    const body = planResponse.body as Record<string, unknown>;
    test.info().annotations.push({ type: "shift-not-legal body", description: JSON.stringify(body) });
    expect(body["type"]).toBe("urn:stellar-blaze:problem:shift-not-legal");
    const violations = body["violations"] as { rule_id: string; clause: string; source_id: string }[];
    expect(violations.length).toBeGreaterThan(0);

    const signOff = await apiSend(request, "POST", "/api/v1/crews/crew-b/day-plan/sign-off", { acknowledged_items: [] });
    test.info().annotations.push({ type: "sign-off of an illegal shift", description: `${String(signOff.status)} ${JSON.stringify(signOff.body)}` });
    expect(signOff.status).toBe(422);

    await page.setViewportSize(PHONE);
    await page.goto(planPath("crew-b"));
    const result = page.locator("[data-shift-not-legal]");
    await expect(result).toBeVisible();
    for (const violation of violations) await expect(result.locator(`[data-violation="${violation.rule_id}"]`)).toBeVisible();
    await expect(result.locator("[role=alert]")).toHaveCount(0);
    await expect(page.getByRole("button", { name: en.supervisor.plan.signOff.submit })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Stop work, / })).toBeEnabled();
  });
});

/*
 * Try a plan against the real validator: the three templates through the page (no token: the validator is public), and the page's
 * answer compared with the API's own body. Clause text, rule ids and 422 shapes are recorded as annotations (the report compares them
 * with the mock's).
 */
test.describe("F2 against the real B3: try a plan", () => {
  const TEMPLATE_NAMES = { common: /^Common roster/, legal: /^Legal default/, straight: /^Straight through/ } as const;

  for (const id of ["common", "legal", "straight"] as const) {
    test(`the ${id} template: the real validator's answer is what the page shows`, async ({ page }) => {
      const errors = watchConsole(page);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto("/en/replay/try");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await page.getByRole("button", { name: TEMPLATE_NAMES[id] }).click();
      const answered = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/api/v1/plans/validate"));
      const sent = page.waitForRequest((candidate) => candidate.method() === "POST" && candidate.url().endsWith("/api/v1/plans/validate"));
      await page.getByRole("button", { name: "Check this plan" }).click();
      const response = await answered;
      const request = await sent;
      test.info().annotations.push({ type: `${id} request`, description: request.postData() ?? "" });
      const text = await response.text();
      test.info().annotations.push({ type: `${id} response`, description: `${String(response.status())} ${text.slice(0, 7000)}` });
      expect(response.status(), "the real validator answers the page's request").toBe(200);
      const body = JSON.parse(text) as Schemas["PlanValidateResponse"];

      await expect(page.locator("[data-try]")).toHaveAttribute("data-try", body.validator.violations.length === 0 ? "none" : "answer");
      await expect(page.getByText(`${String(body.validator.violations.length)} rule${body.validator.violations.length === 1 ? "" : "s"} broken`)).toBeVisible();
      for (const violation of body.validator.violations) {
        await expect(page.locator("[data-violations]").getByText(violation.rule_id, { exact: true })).toBeVisible();
        // The page draws the clause as product copy (F2 W5): the ruleset's own internal ADR references are taken out and the label
        // "PROTECTIVE READING" reads "Protective reading", so the raw API text is not on screen. The page must show exactly that
        // sanitised text (its rules are pinned in tests/unit/lib/copy/sanitize-clause.test.ts), and never an ADR reference.
        if (violation.clause !== "") {
          await expect(page.locator("[data-violations]")).toContainText(sanitizeClause(violation.clause, { sourceId: violation.source_id }));
        }
      }
      await expect(page.locator("[data-violations]")).not.toContainText(/ADR\s+\d{4}/);
      expect(errors.filter((message) => !/plans\/validate/.test(message))).toEqual([]);
    });
  }

  test("06:00 to 18:00 on a six-day week is rejected by the real validator with its rule ids and clause text (API shape)", async ({ request }) => {
    const site = await demoSite(request);
    const forecast = (await apiGet(request, `/api/v1/sites/${site.id}/forecast/today`, false)).body as Forecast;
    const send = (date: string) =>
      request.post(`${ORIGIN ?? ""}/api/v1/plans/validate`, {
        data: {
          site_id: site.id,
          date,
          crew: { workload: "heavy", headcount: 20, acclimatised: false, days_per_week: 6 },
          segments: [{ start: "06:00", end: "18:00", state: "work" }],
        },
      });
    const response = await send(forecast.date);
    const text = await response.text();
    test.info().annotations.push({ type: "06:00-18:00 six days", description: `${String(response.status())} ${text.slice(0, 7000)}` });
    expect(response.status()).toBe(200);
    const body = JSON.parse(text) as Schemas["PlanValidateResponse"];
    expect(body.validator.passed).toBe(false);
    expect(body.validator.violations.length).toBeGreaterThan(0);
    // The app's own constant date (the mock's replay day) against a snapshot that does not hold it: recorded, not asserted.
    const appDate = await send("2026-09-03");
    test.info().annotations.push({ type: "the app's REPLAY_DATE on this snapshot", description: `${String(appDate.status())} ${(await appDate.text()).slice(0, 7000)}` });
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
    // The specs before this one stopped crews (a stop that outlives the undo window leaves its hour Red, B3's design) and signed plans: a new
    // demo epoch (the reset is allowed again after the wait above) gives the pictures the site as a visitor first finds it.
    const reset = await apiSend(request, "POST", `/api/v1/sites/${site.id}/demo-reset`);
    expect(reset.status, "the demo reset before the screenshots").toBe(200);
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
