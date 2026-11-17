import type { components } from "@/api/schema";
import { alertWindow, crewHoursAsForecast, parseAlertParams } from "@/features/alert/alert-params";

/*
 * The alert card's two pure questions (F2 Task 17): which warning is this (the notification's own query), and which stretch of
 * the day does it cover (the run of hours at that level from `valid_from`, and the level before it).
 */

type HourForecast = components["schemas"]["HourForecast"];
type Level = NonNullable<HourForecast["site_level"]>;

const VALID_FROM = "2026-09-03T06:00:00Z";
const query = (overrides: Record<string, string | undefined> = {}) => {
  const base: Record<string, string> = { audience: "site", target: "site-demo-mussafah", level: "orange", valid_from: VALID_FROM };
  const merged = { ...base, ...overrides };
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(merged)) if (value !== undefined) params.set(key, value);
  return params;
};

describe("parseAlertParams", () => {
  it("reads the four values of a notification's target", () => {
    expect(parseAlertParams(query())).toEqual({ audience: "site", targetId: "site-demo-mussafah", level: "orange", validFrom: VALID_FROM });
    expect(parseAlertParams(query({ audience: "crew", target: "crew-b", level: "red", valid_from: "2026-09-03T13:00:00+04:00" }))).toEqual({
      audience: "crew",
      targetId: "crew-b",
      level: "red",
      validFrom: "2026-09-03T13:00:00+04:00",
    });
  });

  it("reads a Next.js searchParams record as well (the page is a server component)", () => {
    expect(parseAlertParams({ audience: "site", target: "s", level: "amber", valid_from: VALID_FROM })).toMatchObject({ level: "amber" });
    expect(parseAlertParams({ audience: ["site", "crew"], target: "s", level: "amber", valid_from: VALID_FROM })).toBeNull();
  });

  it.each([
    ["no audience", { audience: undefined }],
    ["an audience that is neither site nor crew", { audience: "worker" }],
    ["no target", { target: undefined }],
    ["an empty target", { target: "" }],
    ["a target with a path in it", { target: "../../etc" }],
    ["a target that is too long", { target: "x".repeat(129) }],
    ["no level", { level: undefined }],
    ["an unknown level", { level: "purple" }],
    ["a level in the wrong case", { level: "Orange" }],
    ["no valid_from", { valid_from: undefined }],
    ["a valid_from that is not a time", { valid_from: "soon" }],
    ["a date with no time", { valid_from: "2026-09-03" }],
    ["a time with no zone", { valid_from: "2026-09-03T06:00:00" }],
  ])("test_invalid_params_redirect_to_today: %s is null", (_name, overrides) => {
    expect(parseAlertParams(query(overrides))).toBeNull();
  });
});

function hour(localHour: number, level: Level | null): HourForecast {
  return {
    starts_at: new Date(Date.UTC(2026, 8, 3, localHour - 4)).toISOString(),
    wbgt_c: { p05: null, p50: null, p95: null },
    site_level: level,
    action_codes: [],
    ban_active: false,
  };
}

// 09:00 amber, 10:00 to 13:00 orange, 14:00 red, 15:00 orange, 16:00 amber (the last hour of the forecast)
const DAY = [hour(9, "amber"), hour(10, "orange"), hour(11, "orange"), hour(12, "orange"), hour(13, "orange"), hour(14, "red"), hour(15, "orange"), hour(16, "amber")];
const at = (hhmm: string) => new Date(`2026-09-03T${hhmm}:00+04:00`).toISOString();

describe("alertWindow", () => {
  it("test_alert_window_run_and_previous_level: the run of hours at that level from valid_from, and the level before it", () => {
    expect(alertWindow(DAY, VALID_FROM)).toEqual({ level: "orange", from: at("10:00"), to: at("14:00"), previous: "amber" });
  });

  it("a later run of the same level is its own window, with the red before it", () => {
    expect(alertWindow(DAY, at("15:00"))).toEqual({ level: "orange", from: at("15:00"), to: at("16:00"), previous: "red" });
  });

  it("a run that reaches the end of the forecast has no known end (it may go on)", () => {
    expect(alertWindow(DAY, at("16:00"))).toEqual({ level: "amber", from: at("16:00"), to: null, previous: "orange" });
  });

  it("the first hour of the forecast has no previous level", () => {
    expect(alertWindow(DAY, at("09:00"))).toEqual({ level: "amber", from: at("09:00"), to: at("10:00"), previous: null });
  });

  it("a valid_from inside an hour is that hour", () => {
    expect(alertWindow(DAY, "2026-09-03T06:25:00Z")?.from).toBe(at("10:00"));
  });

  it("a gap before the hour means there is no previous level to name", () => {
    expect(alertWindow([hour(10, "orange"), hour(11, "orange")], VALID_FROM)?.previous).toBeNull();
    expect(alertWindow([hour(8, "green"), hour(10, "orange")], VALID_FROM)?.previous).toBeNull();
  });

  it("is null when no hour covers valid_from, the hour has no level, the time is unreadable, or there are no hours", () => {
    expect(alertWindow(DAY, at("20:00"))).toBeNull();
    expect(alertWindow([hour(10, null)], VALID_FROM)).toBeNull();
    expect(alertWindow(DAY, "soon")).toBeNull();
    expect(alertWindow([], VALID_FROM)).toBeNull();
  });

  it("takes the level the forecast has now, not the one in the notification: the card tells the truth when the forecast moved", () => {
    expect(alertWindow([hour(10, "red"), hour(11, "red")], VALID_FROM)?.level).toBe("red");
  });
});

describe("crewHoursAsForecast", () => {
  it("lets a crew's hours (crew_level) be asked the same question as the site's", () => {
    const hours = crewHoursAsForecast([
      { starts_at: at("09:00"), crew_level: "amber", ban_active: false },
      { starts_at: at("10:00"), crew_level: "red", ban_active: false },
      { starts_at: at("11:00"), crew_level: "red", ban_active: false },
      { starts_at: at("12:00"), crew_level: "amber", ban_active: false },
    ]);
    expect(alertWindow(hours, at("10:00"))).toEqual({ level: "red", from: at("10:00"), to: at("12:00"), previous: "amber" });
  });
});
