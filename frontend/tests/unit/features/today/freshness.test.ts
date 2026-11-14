import type { components } from "@/api/schema";
import { STALE_AFTER_MS, currentHour, freshness } from "@/features/today/freshness";
import { legacyForecastToday as forecastToday, SITE_DEMO } from "@/mocks/fixtures";

type HourForecast = components["schemas"]["HourForecast"];

/*
 * Review focus 3 of the plan: a forecast from yesterday must never look live. `freshness` says when the forecast was
 * made too long ago to trust without saying so; `currentHour` says whether the forecast covers the present at all.
 */

const NOW = new Date("2026-11-11T09:30:00Z"); // 13:30 at Asia/Dubai
const MINUTE = 60_000;

function ago(ms: number, now: Date = NOW): string {
  return new Date(now.getTime() - ms).toISOString();
}

describe("freshness", () => {
  it("is fresh when the forecast is 2 h 59 min old", () => {
    expect(freshness(ago(2 * 60 * MINUTE + 59 * MINUTE), NOW)).toBe("fresh");
  });

  it("is stale when the forecast is 3 h 01 min old", () => {
    expect(freshness(ago(3 * 60 * MINUTE + MINUTE), NOW)).toBe("stale");
  });

  it("is fresh at exactly 3 h and stale a millisecond later: stale means older than 3 h", () => {
    expect(STALE_AFTER_MS).toBe(3 * 60 * MINUTE);
    expect(freshness(ago(STALE_AFTER_MS), NOW)).toBe("fresh");
    expect(freshness(ago(STALE_AFTER_MS + 1), NOW)).toBe("stale");
  });

  it.each([
    ["just generated", 0],
    ["10 minutes old (the mock API's fresh forecast)", 10 * MINUTE],
  ])("is fresh when the forecast is %s", (_name, age) => {
    expect(freshness(ago(age), NOW)).toBe("fresh");
  });

  it.each([
    ["yesterday", 24 * 60 * MINUTE],
    ["26 hours old (the mock API's stale forecast)", 26 * 60 * MINUTE],
    ["a week old", 7 * 24 * 60 * MINUTE],
  ])("is stale when the forecast is %s", (_name, age) => {
    expect(freshness(ago(age), NOW)).toBe("stale");
  });

  it("is fresh for a forecast stamped a little ahead of the phone's clock (ordinary clock skew)", () => {
    expect(freshness(ago(-MINUTE), NOW)).toBe("fresh");
  });

  it.each(["", "not a date", "2026-13-45T00:00:00Z"])("is stale when the time %j cannot be read: freshness cannot be vouched for", (generatedAt) => {
    expect(freshness(generatedAt, NOW)).toBe("stale");
  });

  it("is stale when the phone's own time is not a valid date", () => {
    expect(freshness(ago(MINUTE), new Date(Number.NaN))).toBe("stale");
  });

  it("reads the instant, not the wall clock: an offset time and the same instant in UTC agree", () => {
    // 2026-11-11T09:30:00Z minus 2 h 59 min, written with the Dubai offset.
    expect(freshness("2026-11-11T10:31:00+04:00", NOW)).toBe("fresh");
    expect(freshness("2026-11-11T10:29:00+04:00", NOW)).toBe("stale");
  });

  it("marks the mock API's stale fixture stale and its fresh fixture fresh, at their own request time", () => {
    const fresh = forecastToday(SITE_DEMO, { now: NOW });
    const stale = forecastToday(SITE_DEMO, { ageMs: 26 * 60 * MINUTE, now: NOW });
    expect(freshness(fresh?.generated_at ?? "", NOW)).toBe("fresh");
    expect(freshness(stale?.generated_at ?? "", NOW)).toBe("stale");
  });
});

function hourAt(startsAt: string): HourForecast {
  return { starts_at: startsAt, wbgt_c: { p05: 26, p50: 28, p95: 30 }, site_level: "orange", action_codes: [], ban_active: false };
}

describe("currentHour", () => {
  const fixture = forecastToday(SITE_DEMO, { now: NOW })?.hours ?? [];

  it("has the 15 fixture hours to work with", () => {
    expect(fixture).toHaveLength(15);
  });

  it("finds the hour that contains now: 13:30 at Asia/Dubai is the 13:00 hour", () => {
    expect(currentHour(fixture, NOW)?.starts_at).toBe("2026-11-11T09:00:00Z");
  });

  it("includes the start of an hour and excludes its end, which belongs to the next hour", () => {
    expect(currentHour(fixture, new Date("2026-11-11T09:00:00.000Z"))?.starts_at).toBe("2026-11-11T09:00:00Z");
    expect(currentHour(fixture, new Date("2026-11-11T09:59:59.999Z"))?.starts_at).toBe("2026-11-11T09:00:00Z");
    expect(currentHour(fixture, new Date("2026-11-11T10:00:00.000Z"))?.starts_at).toBe("2026-11-11T10:00:00Z");
  });

  it("is null before the first hour and from the end of the last hour: the forecast does not cover those times", () => {
    expect(currentHour(fixture, new Date("2026-11-11T00:59:59.999Z"))).toBeNull(); // 04:59 at Dubai
    expect(currentHour(fixture, new Date("2026-11-11T01:00:00.000Z"))?.starts_at).toBe("2026-11-11T01:00:00Z"); // 05:00
    expect(currentHour(fixture, new Date("2026-11-11T15:59:59.999Z"))?.starts_at).toBe("2026-11-11T15:00:00Z"); // 19:59, the no-data hour
    expect(currentHour(fixture, new Date("2026-11-11T16:00:00.000Z"))).toBeNull(); // 20:00
  });

  it("is null on any other day: yesterday's forecast does not cover today", () => {
    expect(currentHour(fixture, new Date("2026-11-12T09:30:00Z"))).toBeNull();
    expect(currentHour(fixture, new Date("2026-11-10T09:30:00Z"))).toBeNull();
  });

  it("is null for an empty list of hours", () => {
    expect(currentHour([], NOW)).toBeNull();
  });

  it("does not need the hours in order", () => {
    const shuffled = [fixture[10], fixture[3], fixture[8], fixture[0]].filter((hour): hour is HourForecast => hour !== undefined);
    expect(currentHour(shuffled, NOW)?.starts_at).toBe("2026-11-11T09:00:00Z");
  });

  it("returns the very object it was given, so callers can compare it with `hours`", () => {
    const found = fixture[8];
    expect(currentHour(fixture, NOW)).toBe(found);
  });

  it("skips an hour whose starts_at cannot be read, and is null when now cannot be read", () => {
    expect(currentHour([hourAt("garbage"), hourAt("2026-11-11T09:00:00Z")], NOW)?.starts_at).toBe("2026-11-11T09:00:00Z");
    expect(currentHour([hourAt("garbage")], NOW)).toBeNull();
    expect(currentHour(fixture, new Date(Number.NaN))).toBeNull();
  });

  it("reads each hour's start as an instant, whatever offset it is written with", () => {
    const written = [hourAt("2026-11-11T13:00:00+04:00")];
    expect(currentHour(written, NOW)).toBe(written[0]);
    expect(currentHour(written, new Date("2026-11-11T08:59:59.999Z"))).toBeNull();
  });
});
