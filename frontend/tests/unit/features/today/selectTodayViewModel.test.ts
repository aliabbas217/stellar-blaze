import type { components } from "@/api/schema";
import { CONSENT_VERSION, type Profile } from "@/features/profile/profile-shape";
import { selectTodayViewModel } from "@/features/today/useSiteToday";
import { forecastToday, riskPolicy, SITE_DEMO } from "@/mocks/fixtures";

type HourForecast = components["schemas"]["HourForecast"];
type RiskPolicy = components["schemas"]["RiskPolicy"];
type SiteForecastToday = components["schemas"]["SiteForecastToday"];

/*
 * What the Today screen is told, from the four things it knows: the forecast, the policy, the on-device profile and the
 * clock. The cases are the plan's review focus 3 (a stale forecast must never look live) and ADR 0010 (personal risk
 * only under a policy whose config_version equals the forecast's), on the mock API's fixture day: 15 hours from 05:00
 * to 19:00 at Asia/Dubai on 2026-11-11, with the 13:00 hour orange.
 */

const NOW = new Date("2026-11-11T09:30:00Z"); // 13:30 at Asia/Dubai
const HOUR = 60 * 60 * 1000;

// The Task 9 vector: a moderate worker, 10 days into heat work (acclimatised), at the 13:00 hour {26, 28, 30}: orange.
const profile: Profile = {
  consentVersion: CONSENT_VERSION,
  consentedAt: "2026-11-11T08:30:00.000Z",
  siteId: SITE_DEMO,
  crewId: null,
  workloadClass: "moderate",
  heatWorkStartDate: "2026-11-01",
  clothingCode: "work_clothes",
};

function fixtureForecast(ageMs?: number): SiteForecastToday {
  const forecast = forecastToday(SITE_DEMO, { now: NOW, ...(ageMs === undefined ? {} : { ageMs }) });
  if (forecast === undefined) throw new Error("the fixture site has a forecast");
  return forecast;
}

function select(overrides: Partial<Parameters<typeof selectTodayViewModel>[0]> = {}) {
  return selectTodayViewModel({ forecast: fixtureForecast(), policy: riskPolicy, profile, now: NOW, ...overrides });
}

/** The fixture forecast with every hour replaced by `hours`. */
function withHours(hours: HourForecast[]): SiteForecastToday {
  return { ...fixtureForecast(), hours };
}

function hour(startsAt: string, level: HourForecast["site_level"], wbgt: HourForecast["wbgt_c"]): HourForecast {
  return { starts_at: startsAt, wbgt_c: wbgt, site_level: level, action_codes: [], ban_active: false };
}

const THIRTEEN_HUNDRED = "2026-11-11T09:00:00Z";

describe("selectTodayViewModel: a fresh forecast and the matching policy", () => {
  it("gives the worker's own level, and leads with it: the Task 9 vector reads orange from the person", () => {
    const view = select();

    expect(view.freshness).toBe("fresh");
    expect(view.currentHour?.starts_at).toBe(THIRTEEN_HUNDRED);
    expect(view.siteLevel).toBe("orange");
    expect(view.personal).toMatchObject({ status: "available", value: { level: "orange", acclimatised: true } });
    expect(view.displayed).toEqual({ level: "orange", source: "personal" });
    expect(view.needsPolicyRefetch).toBe(false);
  });

  it("carries the forecast itself, for the band and the banner", () => {
    const forecast = fixtureForecast();
    expect(select({ forecast }).forecast).toBe(forecast);
  });

  it("shows both versions as the API wrote them", () => {
    expect(select().versions).toEqual({
      forecast: { policyVersion: "mock-0", configVersion: 1 },
      policy: { version: "mock-0", configVersion: 1 },
    });
  });

  it("does not change its inputs", () => {
    const input = { forecast: fixtureForecast(), policy: structuredClone(riskPolicy), profile: { ...profile }, now: new Date(NOW) };
    const before = structuredClone(input);
    selectTodayViewModel(input);
    expect(input).toEqual(before);
  });
});

describe("selectTodayViewModel: which level leads (displayedLevel) and where it comes from", () => {
  it("leads with the site's level when it is the more severe one: a lighter personal level never hides it", () => {
    // A light, acclimatised worker: REL 30.6 is above the 95th percentile, so P is 0.05 and the level is green.
    const view = select({ profile: { ...profile, workloadClass: "light" } });

    expect(view.personal).toMatchObject({ status: "available", value: { level: "green" } });
    expect(view.siteLevel).toBe("orange");
    expect(view.displayed).toEqual({ level: "orange", source: "site" });
  });

  it("leads with the worker's own level when it is the more severe one", () => {
    // A moderate worker, 2 days in: the NIOSH RAL is 24.97, below the 5th percentile, so P is 0.95 and the level is red.
    const view = select({ profile: { ...profile, heatWorkStartDate: "2026-11-09" } });

    expect(view.personal).toMatchObject({ status: "available", value: { level: "red", acclimatised: false } });
    expect(view.siteLevel).toBe("orange");
    expect(view.displayed).toEqual({ level: "red", source: "personal" });
  });

  it("credits the worker's own level when both agree", () => {
    expect(select().displayed?.source).toBe("personal");
  });

  it("leads with the worker's own level when the site has none for this hour", () => {
    const forecast = withHours([hour(THIRTEEN_HUNDRED, null, { p05: 26, p50: 28, p95: 30 })]);
    const view = select({ forecast });

    expect(view.siteLevel).toBeNull();
    expect(view.displayed).toEqual({ level: "orange", source: "personal" });
  });
});

describe("selectTodayViewModel: the policy does not match the forecast (ADR 0010)", () => {
  // Ruleset ids written so that parsing them as numbers would give a different answer than reading them as text.
  const forecast: SiteForecastToday = { ...fixtureForecast(), policy_version: "ae-heat-2026.9", config_version: 3 };
  const policy: RiskPolicy = { ...riskPolicy, version: "ae-heat-2026.10", config_version: 4 };

  it("gives no personal level, leads with the site's, and asks for the policy to be fetched again", () => {
    const view = select({ forecast, policy });

    expect(view.personal).toEqual({ status: "unavailable", reason: "version-mismatch" });
    expect(view.needsPolicyRefetch).toBe(true);
    expect(view.siteLevel).toBe("orange");
    expect(view.displayed).toEqual({ level: "orange", source: "site" });
  });

  it("exposes both versions verbatim, so the screen can show the pair it holds (offline, the cached one)", () => {
    expect(select({ forecast, policy }).versions).toEqual({
      forecast: { policyVersion: "ae-heat-2026.9", configVersion: 3 },
      policy: { version: "ae-heat-2026.10", configVersion: 4 },
    });
  });

  it("is a mismatch whichever side is newer: the ids are compared for equality and never ordered", () => {
    for (const configVersion of [riskPolicy.config_version + 1, riskPolicy.config_version - 1]) {
      const view = select({ policy: { ...riskPolicy, config_version: configVersion } });
      expect(view.personal).toEqual({ status: "unavailable", reason: "version-mismatch" });
      expect(view.needsPolicyRefetch).toBe(true);
    }
  });

  it("compares config_version only: a different ruleset id with the same config_version still matches", () => {
    const view = select({ forecast: { ...fixtureForecast(), policy_version: "ae-heat-2027.1" }, policy: { ...riskPolicy, version: "ae-heat-2026.3" } });

    expect(view.personal.status).toBe("available");
    expect(view.needsPolicyRefetch).toBe(false);
  });

  it("works out the personal level as soon as the pair matches", () => {
    expect(select({ forecast, policy: { ...policy, config_version: 3 } }).personal.status).toBe("available");
  });
});

describe("selectTodayViewModel: there is no policy yet", () => {
  it("gives no personal level and has nothing to refetch for: the policy is loading or could not be fetched", () => {
    const view = select({ policy: undefined });

    expect(view.personal).toEqual({ status: "unavailable", reason: "policy-unavailable" });
    expect(view.needsPolicyRefetch).toBe(false);
    expect(view.versions.policy).toBeNull();
    expect(view.versions.forecast).toEqual({ policyVersion: "mock-0", configVersion: 1 });
    expect(view.displayed).toEqual({ level: "orange", source: "site" });
  });
});

describe("selectTodayViewModel: no profile on this phone", () => {
  it("gives the site level and says why there is no personal one", () => {
    const view = select({ profile: null });

    expect(view.personal).toEqual({ status: "unavailable", reason: "no-profile" });
    expect(view.displayed).toEqual({ level: "orange", source: "site" });
    expect(view.needsPolicyRefetch).toBe(false);
  });

  it("still asks for the policy again on a mismatch: that is a fact about the pair, not about the worker", () => {
    const view = select({ profile: null, policy: { ...riskPolicy, config_version: 2 } });

    expect(view.personal).toEqual({ status: "unavailable", reason: "no-profile" });
    expect(view.needsPolicyRefetch).toBe(true);
  });
});

describe("selectTodayViewModel: a stale forecast (review focus 3)", () => {
  it("is marked stale at 26 hours, and still shows what it covers", () => {
    const view = select({ forecast: fixtureForecast(26 * HOUR) });

    expect(view.freshness).toBe("stale");
    expect(view.forecast.generated_at).toBe(new Date(NOW.getTime() - 26 * HOUR).toISOString());
  });

  it("is fresh at 2 h 59 min and stale at 3 h 01 min", () => {
    expect(select({ forecast: fixtureForecast(179 * 60_000) }).freshness).toBe("fresh");
    expect(select({ forecast: fixtureForecast(181 * 60_000) }).freshness).toBe("stale");
  });

  it("covering the present by its hours, it still gives the levels for the hour: the banner is how it is told", () => {
    const view = select({ forecast: fixtureForecast(5 * HOUR) });

    expect(view.freshness).toBe("stale");
    expect(view.displayed).toEqual({ level: "orange", source: "personal" });
  });

  it("is marked stale when generated_at cannot be read", () => {
    expect(select({ forecast: { ...fixtureForecast(), generated_at: "yesterday-ish" } }).freshness).toBe("stale");
  });
});

describe("selectTodayViewModel: now is outside the hours the forecast covers (review focus 3)", () => {
  it.each([
    ["before the first hour (04:59 at Dubai)", "2026-11-11T00:59:59.999Z"],
    ["from the end of the last hour (20:00 at Dubai)", "2026-11-11T16:00:00.000Z"],
    ["the next day, with yesterday's forecast still in the cache", "2026-11-12T09:30:00Z"],
  ])("%s: no current hour, no level of any kind, no personal level", (_name, instant) => {
    const view = select({ now: new Date(instant), forecast: fixtureForecast() });

    expect(view.currentHour).toBeNull();
    expect(view.siteLevel).toBeNull();
    expect(view.personal).toEqual({ status: "unavailable", reason: "outside-forecast" });
    expect(view.displayed).toBeNull();
  });

  it("is no personal level for a forecast with no hours at all (the mock API's empty scenario)", () => {
    const view = select({ forecast: withHours([]) });

    expect(view.currentHour).toBeNull();
    expect(view.personal).toEqual({ status: "unavailable", reason: "outside-forecast" });
    expect(view.displayed).toBeNull();
  });

  it("is both: yesterday's forecast cached, so stale and not covering today", () => {
    const view = select({ now: new Date("2026-11-12T09:30:00Z") });

    expect(view.freshness).toBe("stale");
    expect(view.displayed).toBeNull();
  });

  it("comes before the version check: a mismatched pair that does not cover now says it does not cover now", () => {
    const view = select({ now: new Date("2026-11-12T09:30:00Z"), policy: { ...riskPolicy, config_version: 2 } });

    expect(view.personal).toEqual({ status: "unavailable", reason: "outside-forecast" });
    // The pair still disagrees, and the policy is still asked for again: that is about the policy, not the clock.
    expect(view.needsPolicyRefetch).toBe(true);
  });

  it("is no level when the phone's clock is not a valid date, and it does not throw", () => {
    const view = select({ now: new Date(Number.NaN) });

    expect(view.currentHour).toBeNull();
    expect(view.displayed).toBeNull();
    expect(view.freshness).toBe("stale");
  });
});

describe("selectTodayViewModel: the current hour has no forecast numbers", () => {
  it("gives the site's level only when the quantiles are null", () => {
    const forecast = withHours([hour(THIRTEEN_HUNDRED, "amber", { p05: null, p50: null, p95: null })]);
    const view = select({ forecast });

    expect(view.personal).toEqual({ status: "unavailable", reason: "no-hour-data" });
    expect(view.siteLevel).toBe("amber");
    expect(view.displayed).toEqual({ level: "amber", source: "site" });
  });

  it.each([
    ["p05", { p05: null, p50: 28, p95: 30 }],
    ["p50", { p05: 26, p50: null, p95: 30 }],
    ["p95", { p05: 26, p50: 28, p95: null }],
  ])("gives no personal level when only %s is null", (_name, wbgt) => {
    const view = select({ forecast: withHours([hour(THIRTEEN_HUNDRED, "orange", wbgt)]) });

    expect(view.personal).toEqual({ status: "unavailable", reason: "no-hour-data" });
    expect(view.displayed).toEqual({ level: "orange", source: "site" });
  });

  it("gives no level at all for the fixture's 19:00 hour, which has nothing", () => {
    const view = select({ now: new Date("2026-11-11T15:30:00Z") }); // 19:30 at Dubai

    expect(view.currentHour?.starts_at).toBe("2026-11-11T15:00:00Z");
    expect(view.siteLevel).toBeNull();
    expect(view.personal).toEqual({ status: "unavailable", reason: "no-hour-data" });
    expect(view.displayed).toBeNull();
  });
});

describe("selectTodayViewModel: the profile cannot be used with this policy", () => {
  it("gives no personal level when the policy lacks the worker's workload class or clothing option", () => {
    const noModerate: RiskPolicy = { ...riskPolicy, workload_classes: riskPolicy.workload_classes.filter((w) => w.code !== "moderate") };
    const view = select({ policy: noModerate });

    expect(view.personal).toEqual({ status: "unavailable", reason: "not-computable" });
    expect(view.displayed).toEqual({ level: "orange", source: "site" });
    expect(select({ profile: { ...profile, clothingCode: "unknown_suit" } }).personal).toEqual({ status: "unavailable", reason: "not-computable" });
  });

  it("gives no personal level, and does not throw, when the stored start date is not a calendar date", () => {
    const view = select({ profile: { ...profile, heatWorkStartDate: "2026-02-30" } });

    expect(view.personal).toEqual({ status: "unavailable", reason: "not-computable" });
    expect(view.displayed).toEqual({ level: "orange", source: "site" });
  });
});
