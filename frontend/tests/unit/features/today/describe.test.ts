import type { components } from "@/api/schema";
import { CONSENT_VERSION, type Profile } from "@/features/profile/profile-shape";
import { describeToday, type DescribeInput } from "@/features/today/describe";
import { selectWithProfile as selectTodayViewModel } from "./select-with-profile";
import { banWindow, riskPolicy, SITE_DEMO } from "@/mocks/fixtures";

/*
 * What the Today screen shows for a forecast, a clock and a connection (F2 Task 16): which level, as live or last known or
 * the site rules, how long it holds, what the spine draws. Pure: the view takes the answers and words them. The review focus
 * lines these pin: a stale or fallback forecast is never drawn as live (6), the forecast not covering now yields no personal
 * level (6), and out of season there is no slot (2).
 */

type Forecast = components["schemas"]["SiteForecastToday"];
type HourForecast = components["schemas"]["HourForecast"];
type Level = NonNullable<HourForecast["site_level"]>;
type Timeline = components["schemas"]["CrewTimeline"];

const ZONE = "Asia/Dubai";
const DATE = "2026-09-03";
const NOW = new Date("2026-09-03T07:10:00Z"); // 11:10 at the site, the replay moment

function hour(localHour: number, level: Level | null, codes: string[] = []): HourForecast {
  return {
    starts_at: new Date(Date.UTC(2026, 8, 3, localHour - 4)).toISOString(),
    wbgt_c: level === null ? { p05: null, p50: null, p95: null } : { p05: 28, p50: 30, p95: 32 },
    site_level: level,
    action_codes: codes,
    ban_active: false,
  };
}

const LEVELS: Level[] = ["green", "green", "amber", "amber", "orange", "orange", "orange", "orange", "red", "orange", "orange", "orange", "amber"];

function forecast(overrides: Partial<Forecast> = {}): Forecast {
  const status = overrides.forecast_status ?? "fresh";
  return {
    site_id: SITE_DEMO,
    date: DATE,
    generated_at: "2026-09-03T06:50:00Z",
    policy_version: "mock-0",
    config_version: 1,
    mode: "replay",
    forecast_status: status,
    model_id: status === "fallback" ? null : "mock",
    lead_days: 1,
    ban_window: banWindow(DATE),
    hours: LEVELS.map((level, index) => hour(6 + index, status === "fallback" ? null : level, index === 5 ? ["cycle.high.heavy.20-40", "fluids.over-1.2l", "no-lone-work"] : [])),
    ...overrides,
  };
}

const profile: Profile = {
  consentVersion: CONSENT_VERSION,
  consentedAt: "2026-09-01T08:30:00.000Z",
  siteId: SITE_DEMO,
  crewId: null,
  workloadClass: "moderate",
  heatWorkStartDate: "2026-09-01",
  clothingCode: "work_clothes",
};

function timeline(shift: Timeline["shift"], overrides: Partial<Timeline> = {}): Timeline {
  return {
    crew_id: "crew-b",
    crew_name: "Crew B",
    site_id: SITE_DEMO,
    date: DATE,
    forecast_status: "fresh",
    hours: [],
    k: 5,
    shift,
    signoff_state: "unsigned",
    suppressed: false,
    ban_window: banWindow(DATE),
    ...overrides,
  };
}

const SHIFT: Timeline["shift"] = [{ starts_at: "2026-09-03T02:00:00Z", ends_at: "2026-09-03T14:00:00Z" }]; // 06:00 to 18:00

function describeWith(overrides: Partial<DescribeInput> & { forecast?: Forecast; profile?: Profile | null; policy?: boolean } = {}) {
  const f = overrides.forecast ?? forecast();
  const view = selectTodayViewModel({
    forecast: f,
    policy: overrides.policy === false ? undefined : riskPolicy,
    profile: overrides.profile === undefined ? null : overrides.profile,
    now: overrides.now ?? NOW,
  });
  return describeToday({
    view,
    timeline: overrides.timeline === undefined ? timeline(SHIFT) : overrides.timeline,
    offline: overrides.offline ?? false,
    now: overrides.now ?? NOW,
    deviceNow: overrides.deviceNow ?? NOW,
    zone: ZONE,
    locale: "en",
  });
}

describe("describeToday", () => {
  it("a fresh forecast covering now: the site level, live, until the end of its run, with the hour's action", () => {
    const shown = describeWith();
    expect(shown.level).toBe("orange");
    expect(shown.levelKind).toBe("live");
    expect(shown.kicker).toBe("site");
    expect(shown.untilAt?.toISOString()).toBe("2026-09-03T10:00:00.000Z"); // 14:00: hours 11, 12 and 13 are orange, 14 is red
    expect(shown.protective).toBe(false);
    expect(shown.banner).toBeNull();
  });

  it("test_stale_and_fallback_are_not_live: a stale forecast is the last known level, with its time and age, never a live one", () => {
    const shown = describeWith({ forecast: forecast({ forecast_status: "stale", generated_at: "2026-09-02T05:00:00Z" }) });
    expect(shown.levelKind).toBe("stale");
    expect(shown.kicker).toBe("stale");
    expect(shown.banner).toMatchObject({ kind: "stale" });
    expect(shown.banner?.updatedAt.toISOString()).toBe("2026-09-02T05:00:00.000Z");
  });

  it("a forecast older than three hours is stale on its own account, whatever the API's status says", () => {
    const shown = describeWith({ forecast: forecast({ generated_at: "2026-09-03T03:00:00Z" }) });
    expect(shown.levelKind).toBe("stale");
    expect(shown.banner?.kind).toBe("stale");
  });

  it("test_stale_and_fallback_are_not_live: a fallback forecast has no level at all, only the site rules", () => {
    const shown = describeWith({ forecast: forecast({ forecast_status: "fallback" }) });
    expect(shown.level).toBeNull();
    expect(shown.levelKind).toBe("fallback");
    expect(shown.kicker).toBe("fallback");
    expect(shown.protective).toBe(true);
    expect(shown.untilAt).toBeNull();
  });

  it("offline with a level in hand: last known level and the offline banner, with the time and age of the forecast", () => {
    const shown = describeWith({ offline: true, deviceNow: new Date("2026-09-03T08:20:00Z") });
    expect(shown.levelKind).toBe("stale");
    expect(shown.banner).toMatchObject({ kind: "offline" });
    expect(shown.banner?.updatedAt.toISOString()).toBe("2026-09-03T06:50:00.000Z");
    expect(shown.banner?.ageMs).toBe(90 * 60_000);
  });

  describe("test_stale_and_fallback_are_not_live (I2): nothing is drawn from a forecast that is not live as if it were current", () => {
    const NOT_LIVE: readonly [string, Partial<DescribeInput> & { forecast?: Forecast }][] = [
      ["stale by the API's status", { forecast: forecast({ forecast_status: "stale", generated_at: "2026-09-03T05:00:00Z" }) }],
      ["stale by age", { forecast: forecast({ generated_at: "2026-09-03T03:00:00Z" }) }],
      ["offline", { offline: true }],
      ["fallback", { forecast: forecast({ forecast_status: "fallback" }) }],
    ];

    it("control: the live day has the hour's cycle lead, the extra lines, heat in the cells and a line at now", () => {
      const shown = describeWith();
      expect(shown.plan.lead).toEqual({ kind: "cycle", workMinutes: 20, restMinutes: 40 });
      expect(shown.plan.also.length).toBeGreaterThan(0);
      expect(shown.cells.some((cell) => cell.wbgtC !== null)).toBe(true);
      expect(shown.nowHour).not.toBeNull();
      expect(shown.waypoints.some((spec) => spec.kind === "now")).toBe(true);
      expect(shown.lastKnown).toBe(false);
    });

    it.each(NOT_LIVE)("%s: the lead is the protective site rules, with no current-hour cycle and no extra lines", (_name, input) => {
      const shown = describeWith(input);
      expect(shown.protective).toBe(true);
      expect(shown.plan.lead).toEqual({ kind: "siteRules" });
      expect(shown.plan.also).toEqual([]);
    });

    it.each(NOT_LIVE)("%s: no cell carries heat colour (full heat is for live data only)", (_name, input) => {
      const shown = describeWith(input);
      expect(shown.cells.length).toBeGreaterThan(0);
      expect(shown.cells.every((cell) => cell.wbgtC === null)).toBe(true);
    });

    it.each(NOT_LIVE.filter(([name]) => name !== "fallback"))("%s: last known, no line at now, no Now waypoint, no promise of how long it holds", (_name, input) => {
      const shown = describeWith(input);
      expect(shown.lastKnown).toBe(true);
      expect(shown.levelKind).toBe("stale");
      expect(shown.nowHour).toBeNull();
      expect(shown.waypoints.some((spec) => spec.kind === "now")).toBe(false);
      expect(shown.untilAt).toBeNull();
      // The sign still says the last known level, dimmed: that is the secondary information.
      expect(shown.level).not.toBeNull();
    });

    it("the clock's own waypoints (the break, the shift's end) stay on a last known day: they do not come from the forecast", () => {
      const shown = describeWith({ offline: true });
      expect(shown.waypoints.map((spec) => spec.kind)).toEqual(expect.arrayContaining(["breakIn", "backToWork"]));
    });

    it("a stale forecast never lets a personal level lead or be announced as higher", () => {
      const shown = describeWith({
        forecast: forecast({ forecast_status: "stale", generated_at: "2026-09-02T05:00:00Z" }),
        profile: { ...profile, heatWorkStartDate: "2026-09-03" },
      });
      expect(shown.personalHigher).toBe(false);
    });
  });

  it("the age counts from the phone's clock, not the replay clock (a replayed day is months before the forecast was written)", () => {
    const shown = describeWith({ forecast: forecast({ forecast_status: "stale", generated_at: "2026-09-02T05:00:00Z" }), deviceNow: new Date("2026-09-03T07:10:00Z") });
    expect(shown.banner?.ageMs).toBe(26 * 3_600_000 + 10 * 60_000);
  });

  it("test_personal_level_never_shown_when_forecast_does_not_cover_now: no hour covers now, so neither a site nor a personal level", () => {
    const shown = describeWith({ profile, now: new Date("2026-09-04T07:10:00Z"), deviceNow: new Date("2026-09-04T07:10:00Z"), forecast: forecast({ generated_at: "2026-09-04T06:50:00Z" }) });
    expect(shown.level).toBeNull();
    expect(shown.kicker).toBe("noHour");
    expect(shown.personalHigher).toBe(false);
    expect(shown.protective).toBe(true);
    expect(shown.nowHour).toBeNull();
  });

  it("an empty forecast (no hours) is the protective site rules, not a blank", () => {
    const shown = describeWith({ forecast: forecast({ hours: [] }) });
    expect(shown.level).toBeNull();
    expect(shown.protective).toBe(true);
    expect(shown.kicker).toBe("noHour");
  });

  it("a personal level above the site's leads and says so; below or equal it does not", () => {
    const higher = describeWith({ profile: { ...profile, heatWorkStartDate: "2026-09-03" } });
    expect(higher.kicker).toBe("personal");
    expect(higher.personalHigher).toBe(true);
    expect(higher.untilAt).toBeNull(); // the run of a personal level is not forecast
    const none = describeWith();
    expect(none.personalHigher).toBe(false);
  });

  it("a profile whose level cannot be worked out keeps the site level and says why (partial)", () => {
    expect(describeWith({ profile, policy: false }).personalUnavailable).toBe(true);
    expect(describeWith({ profile: null }).personalUnavailable).toBe(false);
  });

  it("the action comes from the current hour's codes", () => {
    const shown = describeWith(); // 11:10: the 11:00 hour carries the codes
    expect(shown.plan.lead).toEqual({ kind: "cycle", workMinutes: 20, restMinutes: 40 });
    expect(shown.plan.also).toEqual(["water", "buddy"]);
  });

  it("test_unknown_action_code_falls_back_to_site_rules", () => {
    const unknown = forecast({ hours: LEVELS.map((level, index) => hour(6 + index, level, index === 5 ? ["wibble"] : [])) });
    expect(describeWith({ forecast: unknown }).plan.lead).toEqual({ kind: "siteRules" });
  });

  it("the spine covers the shift, with a cell per forecast hour and the break where the window says", () => {
    const shown = describeWith();
    expect([shown.from, shown.to]).toEqual([6, 18]);
    expect(shown.cells.find((cell) => cell.hour === 11)).toEqual({ hour: 11, wbgtC: 30 });
    expect(shown.ban).toMatchObject({ kind: "in-force", fromHour: 12.5, toHour: 15 });
    expect(shown.nowHour).toBeCloseTo(11 + 10 / 60, 6);
    expect(shown.waypoints.map((w) => w.kind)).toEqual(["now", "breakIn", "backToWork", "shiftEnds"]);
  });

  it("test_out_of_season_has_no_slot: a date after the ban season draws no slot and adds the note instead", () => {
    const date = "2026-09-24";
    const shown = describeWith({
      forecast: forecast({
        date,
        ban_window: { ...banWindow(date), active_on_date: false, starts_at: null, ends_at: null },
        hours: LEVELS.map((level, index) => ({ ...hour(6 + index, level), starts_at: new Date(Date.UTC(2026, 8, 24, 2 + index)).toISOString() })),
        generated_at: "2026-09-24T06:50:00Z",
      }),
      now: new Date("2026-09-24T07:10:00Z"),
      deviceNow: new Date("2026-09-24T07:10:00Z"),
      timeline: timeline(SHIFT, { date }),
    });
    expect(shown.ban.kind).toBe("not-in-force");
    expect(shown.waypoints.map((w) => w.kind)).toEqual(["now", "noBreak", "shiftEnds"]);
    expect(shown.banNote).toEqual({ phase: "after", seasonEnd: "09-15", resumes: "15 Jun" });
  });

  it("no shift: a loaded timeline without a shift says so, and a timeline still loading says nothing", () => {
    expect(describeWith({ timeline: timeline([]) }).noShift).toBe(true);
    expect(describeWith({ timeline: null }).noShift).toBe(false);
    expect(describeWith({ timeline: null }).waypoints.some((w) => w.kind === "shiftEnds")).toBe(false);
  });

  it("a timeline of another day than the forecast is not used (no shift is drawn from yesterday)", () => {
    const shown = describeWith({ timeline: timeline(SHIFT, { date: "2026-09-02" }) });
    expect(shown.noShift).toBe(false);
    expect(shown.waypoints.some((w) => w.kind === "shiftEnds")).toBe(false);
    expect([shown.from, shown.to]).toEqual([6, 18]);
  });
});
