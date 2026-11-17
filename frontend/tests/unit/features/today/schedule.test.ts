import type { components } from "@/api/schema";
import { banStateFrom, type BanState } from "@/components/spine/ban-state";
import { ageParts, formatMonthDay, hourOfDay, levelRun, localDate, waypointSpecs } from "@/features/today/schedule";

type HourForecast = components["schemas"]["HourForecast"];
type Level = NonNullable<HourForecast["site_level"]>;

const ZONE = "Asia/Dubai";

/** An hour of 3 September 2026 (local), as the API writes it: UTC, four hours behind the site. */
function hour(localHour: number, level: Level | null): HourForecast {
  const start = new Date(Date.UTC(2026, 8, 3, localHour - 4));
  return {
    starts_at: start.toISOString(),
    wbgt_c: { p05: null, p50: null, p95: null },
    site_level: level,
    action_codes: [],
    ban_active: false,
  };
}

const at = (hhmm: string): Date => new Date(`2026-09-03T${hhmm}:00+04:00`);

describe("hourOfDay and localDate", () => {
  it("read the site's wall clock, not the machine's", () => {
    expect(hourOfDay(new Date("2026-09-03T07:10:00Z"), ZONE)).toBeCloseTo(11 + 10 / 60, 6);
    expect(hourOfDay(new Date("2026-09-03T20:30:00Z"), ZONE)).toBeCloseTo(0.5, 6);
    expect(localDate(new Date("2026-09-03T20:30:00Z"), ZONE)).toBe("2026-09-04");
    expect(localDate(new Date("2026-09-03T07:10:00Z"), ZONE)).toBe("2026-09-03");
  });
});

describe("formatMonthDay", () => {
  it("writes the day first, 'Sep' for September in English, Western digits", () => {
    expect(formatMonthDay("09-15", "en")).toBe("15 Sep");
    expect(formatMonthDay("06-15", "en")).toBe("15 Jun");
    expect(formatMonthDay("02-29", "en")).toBe("29 Feb");
  });

  it("keeps Western digits in the Arabic-script and Indic languages", () => {
    for (const locale of ["ar", "ur", "hi", "bn", "ne"]) expect(formatMonthDay("09-15", locale)).toMatch(/15/);
  });

  it("returns what it cannot read, unchanged", () => {
    expect(formatMonthDay("soon", "en")).toBe("soon");
  });
});

describe("levelRun", () => {
  const day = [hour(9, "amber"), hour(10, "orange"), hour(11, "orange"), hour(12, "orange"), hour(13, "red"), hour(14, "orange")];

  it("is the consecutive hours at the current level, ending at the end of the last one", () => {
    const run = levelRun(day, at("11:10"));
    expect(run?.level).toBe("orange");
    expect(run?.endsAt.toISOString()).toBe(at("13:00").toISOString());
  });

  it("a run that reaches the end of the forecast ends where the forecast does", () => {
    expect(levelRun(day, at("14:20"))?.endsAt.toISOString()).toBe(at("15:00").toISOString());
  });

  it("a gap in the forecast ends the run", () => {
    const gappy = [hour(10, "orange"), hour(12, "orange")];
    expect(levelRun(gappy, at("10:30"))?.endsAt.toISOString()).toBe(at("11:00").toISOString());
  });

  it("is null when no hour covers now, or the current hour has no level (a fallback hour)", () => {
    expect(levelRun(day, at("08:30"))).toBeNull();
    expect(levelRun(day, at("15:00"))).toBeNull();
    expect(levelRun([hour(11, null)], at("11:10"))).toBeNull();
    expect(levelRun([], at("11:10"))).toBeNull();
  });
});

describe("ageParts", () => {
  it("is whole hours and minutes, rounded down", () => {
    expect(ageParts(90 * 60_000)).toEqual({ hours: 1, minutes: 30 });
    expect(ageParts(26 * 3_600_000)).toEqual({ hours: 26, minutes: 0 });
    expect(ageParts(59_999)).toEqual({ hours: 0, minutes: 0 });
  });

  it("a stamp ahead of the clock reads as no age, never negative", () => {
    expect(ageParts(-5 * 60_000)).toEqual({ hours: 0, minutes: 0 });
  });
});

describe("waypointSpecs", () => {
  const window = {
    start: "12:30",
    end: "15:00",
    starts_at: "2026-09-03T08:30:00Z",
    ends_at: "2026-09-03T11:00:00Z",
    season_start: "06-15",
    season_end: "09-15",
    timezone: ZONE,
    active_on_date: true,
  };
  const inForce: BanState = banStateFrom(window, ZONE, "2026-09-03");
  const outOfSeason: BanState = banStateFrom({ ...window, starts_at: null, ends_at: null, active_on_date: false }, ZONE, "2026-09-24");
  const base = { from: 6, to: 18 } as const;

  it("before the break: Now, Break in X, Back to work, Shift ends, in time order", () => {
    const specs = waypointSpecs({ ...base, nowHour: 11 + 10 / 60, ban: inForce, shiftEndHour: 18 });
    expect(specs.map((s) => s.kind)).toEqual(["now", "breakIn", "backToWork", "shiftEnds"]);
    expect(specs.find((s) => s.kind === "breakIn")).toMatchObject({ at: 12.5, minutes: 80 });
    expect(specs.find((s) => s.kind === "backToWork")?.at).toBe(15);
  });

  it("during the break there is no 'Break in', only the way back to work", () => {
    const specs = waypointSpecs({ ...base, nowHour: 13.5, ban: inForce, shiftEndHour: 18 });
    expect(specs.map((s) => s.kind)).toEqual(["now", "backToWork", "shiftEnds"]);
  });

  it("after the break only Now and the end of the shift remain", () => {
    const specs = waypointSpecs({ ...base, nowHour: 16, ban: inForce, shiftEndHour: 18 });
    expect(specs.map((s) => s.kind)).toEqual(["now", "shiftEnds"]);
  });

  it("test_out_of_season_has_no_slot: no break waypoints, a note instead", () => {
    expect(outOfSeason.kind).toBe("not-in-force");
    const specs = waypointSpecs({ ...base, nowHour: 11 + 10 / 60, ban: outOfSeason, shiftEndHour: 18 });
    expect(specs.map((s) => s.kind)).toEqual(["now", "noBreak", "shiftEnds"]);
    expect(specs.some((s) => s.kind === "breakIn" || s.kind === "backToWork")).toBe(false);
  });

  it("Shift ends only when the crew has a shift (nothing is invented)", () => {
    const specs = waypointSpecs({ ...base, nowHour: 11, ban: inForce, shiftEndHour: null });
    expect(specs.some((s) => s.kind === "shiftEnds")).toBe(false);
  });

  it("with no 'now' on this day (the forecast is for another date) there are no waypoints to count from", () => {
    expect(waypointSpecs({ ...base, nowHour: null, ban: inForce, shiftEndHour: 18 })).toEqual([]);
  });

  it("Now is left out when it is outside the drawn span", () => {
    expect(waypointSpecs({ ...base, nowHour: 5, ban: inForce, shiftEndHour: 18 }).some((s) => s.kind === "now")).toBe(false);
  });
});
