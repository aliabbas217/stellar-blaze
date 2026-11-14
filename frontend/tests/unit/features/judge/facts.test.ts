import { readFileSync } from "node:fs";
import path from "node:path";
import { cumulativeTally, parseHourlySeries, seasonFacts, type SeasonBan } from "@/features/judge/facts";
import { HEAVY_WORK_LIMIT_WBGT_C } from "@/features/judge/limit";
import { banWindow } from "@/mocks/fixtures";

const file = path.resolve(import.meta.dirname, "../../../../data/static/omaa_2026_ifs_d1_wbgt_hourly.json");
const series = parseHourlySeries(JSON.parse(readFileSync(file, "utf8")) as unknown);

// The ban the API serves for a date inside the season (the mock follows the frozen contract). The facts module takes it
// as an argument and holds no date or hour of its own.
const BAN: SeasonBan = banWindow("2026-07-01");

describe("seasonFacts", () => {
  const facts = seasonFacts(series, BAN, HEAVY_WORK_LIMIT_WBGT_C);

  it("test_season_facts_match_prototype_counts", () => {
    // The numbers the approved prototype shows, derived there from the same committed file.
    expect(facts.n).toBe(1807);
    expect(facts.over).toBe(1624);
    expect(facts.inBan).toBe(279);
    expect(facts.daysOver).toBe(139);
    expect(series.days).toHaveLength(139);
  });

  it("finds the hottest and the coolest day and the hour of the peak", () => {
    expect(facts.pk).toBe(Math.max(...facts.peaks));
    expect(facts.peaks[facts.pkI]).toBe(facts.pk);
    expect(facts.lo).toBe(Math.min(...facts.peaks));
    expect(facts.peaks[facts.loI]).toBe(facts.lo);
    expect(series.wbgt_c_by_local_hour[facts.pkI]?.[facts.pkH]).toBe(facts.pk);
  });

  it("takes the ban days from the window it is given, not from a literal", () => {
    expect(series.days[facts.ban?.fromIndex ?? -1]).toBe("2026-06-15");
    expect(series.days[facts.ban?.toIndex ?? -1]).toBe("2026-09-15");
    const shifted = seasonFacts(series, { ...BAN, season_start: "07-01", season_end: "07-31" }, HEAVY_WORK_LIMIT_WBGT_C);
    expect(series.days[shifted.ban?.fromIndex ?? -1]).toBe("2026-07-01");
    expect(series.days[shifted.ban?.toIndex ?? -1]).toBe("2026-07-31");
    expect(shifted.inBan).toBeLessThan(facts.inBan);
  });

  it("counts a half-covered hour as inside the break (12:30 to 15:00 touches the 12:00 hour)", () => {
    const noBan = seasonFacts(series, { ...BAN, season_start: "01-01", season_end: "01-02" }, HEAVY_WORK_LIMIT_WBGT_C);
    expect(noBan.inBan).toBe(0);
    const whole = seasonFacts(series, { ...BAN, start: "13:00" }, HEAVY_WORK_LIMIT_WBGT_C);
    expect(whole.inBan).toBeLessThan(facts.inBan);
  });

  it("skips a missing hour instead of counting it", () => {
    const hours = series.wbgt_c_by_local_hour.map((day) => day.slice());
    const first = hours[0];
    if (first === undefined) throw new Error("no day");
    for (let h = 6; h < 19; h++) first[h] = null;
    const gap = seasonFacts({ ...series, wbgt_c_by_local_hour: hours }, BAN, HEAVY_WORK_LIMIT_WBGT_C);
    expect(gap.n).toBe(1807 - 13);
  });
});

describe("cumulativeTally", () => {
  const facts = seasonFacts(series, BAN, HEAVY_WORK_LIMIT_WBGT_C);
  const tally = cumulativeTally(series, BAN, HEAVY_WORK_LIMIT_WBGT_C);

  it("has one entry per day and ends at the season totals", () => {
    expect(tally).toHaveLength(139);
    expect(tally.at(-1)).toEqual({ days: facts.daysOver, hours: facts.over, inBan: facts.inBan });
  });

  it("never decreases", () => {
    for (let i = 1; i < tally.length; i++) {
      expect(tally[i]?.hours).toBeGreaterThanOrEqual(tally[i - 1]?.hours ?? 0);
    }
  });
});

describe("parseHourlySeries", () => {
  it("rejects a file whose days and hours do not line up", () => {
    expect(() => parseHourlySeries({ days: ["2026-05-15"], wbgt_c_by_local_hour: [] })).toThrow();
  });
});
