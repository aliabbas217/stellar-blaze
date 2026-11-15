import { expect, test, type APIRequestContext } from "@playwright/test";
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

    // The header clock is the replay moment (the API's date at 11:10 at the site), not the machine's; and whether the app judged the
    // replay snapshot fresh is recorded, not assumed.
    await expect(page.getByRole("banner").locator('bdi[dir="ltr"]')).toContainText("11:10");
    const kind = await page.locator("[data-level-sign]").first().getAttribute("data-kind");
    test.info().annotations.push({
      type: "freshness",
      description: `API forecast_status ${forecast.forecast_status}; the sign is drawn as "${String(kind)}" (generated_at ${forecast.generated_at})`,
    });
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
