import type { components } from "@/api/schema";
import type { Level } from "@/components/level/level";
import { CONSENT_VERSION, type Profile } from "@/features/profile/profile-shape";
import { daysBetween, displayedLevel, personalLevel, policyMatchesForecast } from "@/features/risk/personal";
import { rel } from "@/features/risk/niosh";
import { forecastToday, riskPolicy, SITE_DEMO } from "@/mocks/fixtures";

type HourForecast = components["schemas"]["HourForecast"];
type RiskPolicy = components["schemas"]["RiskPolicy"];
type SiteForecastToday = components["schemas"]["SiteForecastToday"];

/*
 * On-device personal risk (Tier B, ADR 0004 and 0006): NIOSH limit for the worker's workload and acclimatisation, then the
 * probability that the hour's WBGT exceeds it, then the policy band. The policy is the mock one (src/mocks/fixtures.ts):
 * bands 0 / 0.10 / 0.30 / 0.60, 7 acclimatisation days, workloads 180 / 300 / 415 W, one clothing option with adjustment 0.
 */

const TODAY = "2026-11-11";

const profile: Profile = {
  consentVersion: CONSENT_VERSION,
  consentedAt: "2026-11-11T08:30:00.000Z",
  siteId: SITE_DEMO,
  crewId: null,
  workloadClass: "moderate",
  heatWorkStartDate: "2026-11-01",
  clothingCode: "work_clothes",
};

function hour(p05: number | null, p50: number | null, p95: number | null): HourForecast {
  return { starts_at: "2026-11-11T09:00:00Z", wbgt_c: { p05, p50, p95 }, site_level: null, action_codes: [], ban_active: false };
}

const mid = hour(26, 28, 30);

function fixtureForecast(): SiteForecastToday {
  const forecast = forecastToday(SITE_DEMO);
  if (forecast === undefined) throw new Error("the fixture site has a forecast");
  return forecast;
}

describe("daysBetween", () => {
  it("counts whole calendar days from the first date to the second", () => {
    expect(daysBetween("2026-11-01", "2026-11-11")).toBe(10);
    expect(daysBetween("2026-11-11", "2026-11-11")).toBe(0);
    expect(daysBetween("2026-11-09", "2026-11-11")).toBe(2);
  });

  it("is negative when the first date is after the second", () => {
    expect(daysBetween("2026-11-12", "2026-11-11")).toBe(-1);
  });

  it.each([
    ["a month boundary", "2026-01-30", "2026-02-02", 3],
    ["a year boundary", "2025-12-30", "2026-01-02", 3],
    ["a leap day", "2028-02-28", "2028-03-01", 2],
    ["no leap day", "2026-02-28", "2026-03-01", 1],
    ["US spring-forward week", "2026-03-07", "2026-03-09", 2],
    ["EU autumn-back week", "2026-10-24", "2026-10-26", 2],
    ["a full year", "2025-11-11", "2026-11-11", 365],
  ])("reads dates as calendar dates, with no hour or time zone drift: %s", (_name, from, to, expected) => {
    expect(daysBetween(from, to)).toBe(expected);
  });

  it.each(["", "2026-02-30", "2026-11-1", "2026-11-11T00:00:00Z", "11/11/2026", "0050-01-01"])("throws RangeError for %j", (bad) => {
    expect(() => daysBetween(bad, TODAY)).toThrow(RangeError);
    expect(() => daysBetween(TODAY, bad)).toThrow(RangeError);
  });
});

describe("personalLevel", () => {
  describe("moderate work (300 W) from ADR 0006's vectors", () => {
    it("acclimatised (10 days, 7 required): the REL, 28.21, gives p of about 0.452 and orange", () => {
      const result = personalLevel({ hour: mid, profile, policy: riskPolicy, today: TODAY });
      expect(result).not.toBeNull();
      expect(result?.acclimatised).toBe(true);
      expect(result?.limitC).toBeCloseTo(28.21, 2);
      expect(result?.probability).toBeCloseTo(0.452, 3);
      expect(result?.level).toBe("orange");
    });

    it("not acclimatised (2 days): the RAL, 24.97, is below p05, so p is 0.95 and red", () => {
      const result = personalLevel({ hour: mid, profile: { ...profile, heatWorkStartDate: "2026-11-09" }, policy: riskPolicy, today: TODAY });
      expect(result?.acclimatised).toBe(false);
      expect(result?.limitC).toBeCloseTo(24.97, 2);
      expect(result?.probability).toBe(0.95);
      expect(result?.level).toBe("red");
    });
  });

  describe("workload and acclimatisation, every combination of the mock policy", () => {
    const acclimatisedStart = "2026-11-01";
    const newStart = "2026-11-09";
    it.each<[string, "light" | "moderate" | "heavy", string, number, Level]>([
      ["light, acclimatised", "light", acclimatisedStart, 0.05, "green"],
      ["light, new", "light", newStart, 0.4774, "orange"],
      ["moderate, acclimatised", "moderate", acclimatisedStart, 0.4521, "orange"],
      ["moderate, new", "moderate", newStart, 0.95, "red"],
      ["heavy, acclimatised", "heavy", acclimatisedStart, 0.8167, "red"],
      ["heavy, new", "heavy", newStart, 0.95, "red"],
    ])("%s against q {26, 28, 30}", (_name, workloadClass, heatWorkStartDate, probability, level) => {
      const result = personalLevel({ hour: mid, profile: { ...profile, workloadClass, heatWorkStartDate }, policy: riskPolicy, today: TODAY });
      expect(result?.probability).toBeCloseTo(probability, 3);
      expect(result?.level).toBe(level);
    });
  });

  describe("acclimatisation", () => {
    const at = (heatWorkStartDate: string) =>
      personalLevel({ hour: mid, profile: { ...profile, heatWorkStartDate }, policy: riskPolicy, today: TODAY })?.acclimatised;

    it("starts on the required day: 7 days is acclimatised, 6 is not", () => {
      expect(at("2026-11-04")).toBe(true);
      expect(at("2026-11-05")).toBe(false);
    });

    it("uses the policy's requirement, not a constant", () => {
      const strict: RiskPolicy = { ...riskPolicy, acclimatisation_days_required: 14 };
      const result = personalLevel({ hour: mid, profile, policy: strict, today: TODAY });
      expect(result?.acclimatised).toBe(false);
    });

    it("counts a start date in the future (a phone clock set back) as not acclimatised", () => {
      expect(at("2026-11-20")).toBe(false);
    });

    it("counts today as 'today' the caller gives, not the system clock", () => {
      const later = personalLevel({ hour: mid, profile: { ...profile, heatWorkStartDate: "2026-11-09" }, policy: riskPolicy, today: "2026-11-16" });
      expect(later?.acclimatised).toBe(true);
    });
  });

  describe("clothing adjustment", () => {
    const withGear: RiskPolicy = {
      ...riskPolicy,
      clothing_options: [...riskPolicy.clothing_options, { code: "test_adjustment_plus_one", adjustment_c: 1, source: "test" }],
    };

    it("shifts every quantile up by adjustment_c, which moves orange to red", () => {
      const plain = personalLevel({ hour: mid, profile, policy: withGear, today: TODAY });
      const adjusted = personalLevel({ hour: mid, profile: { ...profile, clothingCode: "test_adjustment_plus_one" }, policy: withGear, today: TODAY });
      expect(plain?.level).toBe("orange");
      expect(adjusted?.probability).toBeCloseTo(0.6771, 3);
      expect(adjusted?.level).toBe("red");
    });

    it("leaves the NIOSH limit itself unadjusted", () => {
      const adjusted = personalLevel({ hour: mid, profile: { ...profile, clothingCode: "test_adjustment_plus_one" }, policy: withGear, today: TODAY });
      expect(adjusted?.limitC).toBeCloseTo(28.21, 2);
    });
  });

  describe("bands", () => {
    it("picks the band with the highest minimum at or below p, whatever order the policy lists them in", () => {
      const shuffled: RiskPolicy = { ...riskPolicy, bands: [...riskPolicy.bands].reverse() };
      expect(personalLevel({ hour: mid, profile, policy: shuffled, today: TODAY })?.level).toBe("orange");
    });

    it("includes a band whose minimum equals p exactly", () => {
      const exactly = hour(26, rel(300), 31);
      const policy: RiskPolicy = {
        ...riskPolicy,
        bands: [
          { level: "green", min_exceedance_probability: 0 },
          { level: "amber", min_exceedance_probability: 0.25 },
          { level: "orange", min_exceedance_probability: 0.5 },
          { level: "red", min_exceedance_probability: 0.75 },
        ],
      };
      const result = personalLevel({ hour: exactly, profile, policy, today: TODAY });
      expect(result?.probability).toBe(0.5);
      expect(result?.level).toBe("orange");
    });

    it("reads the lowest probability, 0.05, as green under the mock bands", () => {
      const result = personalLevel({ hour: hour(20, 21, 22), profile, policy: riskPolicy, today: TODAY });
      expect(result?.probability).toBe(0.05);
      expect(result?.level).toBe("green");
    });

    it("takes the more severe level when two bands share a minimum", () => {
      const clash: RiskPolicy = {
        ...riskPolicy,
        bands: [
          { level: "red", min_exceedance_probability: 0.3 },
          { level: "orange", min_exceedance_probability: 0.3 },
          { level: "green", min_exceedance_probability: 0 },
        ],
      };
      expect(personalLevel({ hour: mid, profile, policy: clash, today: TODAY })?.level).toBe("red");
    });

    it.each([
      ["no band", []],
      ["no band at or below p", [{ level: "red", min_exceedance_probability: 0.99 }]],
    ] as const)("is null, not green, when the policy has %s that applies", (_name, bands) => {
      const policy: RiskPolicy = { ...riskPolicy, bands: [...bands] };
      expect(personalLevel({ hour: mid, profile, policy, today: TODAY })).toBeNull();
    });
  });

  describe("returns null instead of guessing", () => {
    it.each([
      ["p05", hour(null, 28, 30)],
      ["p50", hour(26, null, 30)],
      ["p95", hour(26, 28, null)],
      ["all three", hour(null, null, null)],
    ])("when %s is null", (_name, h) => {
      expect(personalLevel({ hour: h, profile, policy: riskPolicy, today: TODAY })).toBeNull();
    });

    it("when a quantile is not a finite number", () => {
      expect(personalLevel({ hour: hour(26, Number.NaN, 30), profile, policy: riskPolicy, today: TODAY })).toBeNull();
    });

    it("when the workload class is not in the policy", () => {
      const policy: RiskPolicy = { ...riskPolicy, workload_classes: riskPolicy.workload_classes.filter((w) => w.code !== "moderate") };
      expect(personalLevel({ hour: mid, profile, policy, today: TODAY })).toBeNull();
    });

    it("when the clothing code is not in the policy", () => {
      expect(personalLevel({ hour: mid, profile: { ...profile, clothingCode: "not_a_clothing_option" }, policy: riskPolicy, today: TODAY })).toBeNull();
    });

    it.each([0, -300, Number.NaN])("when the policy's metabolic rate for the workload is %s", (metabolicRateW) => {
      const policy: RiskPolicy = {
        ...riskPolicy,
        workload_classes: riskPolicy.workload_classes.map((w) => (w.code === "moderate" ? { ...w, metabolic_rate_w: metabolicRateW } : w)),
      };
      expect(personalLevel({ hour: mid, profile, policy, today: TODAY })).toBeNull();
    });
  });

  it("does not change its inputs", () => {
    const input = { hour: hour(26, 28, 30), profile: { ...profile }, policy: structuredClone(riskPolicy), today: TODAY };
    const before = structuredClone(input);
    personalLevel(input);
    expect(input).toEqual(before);
  });

  describe("with the mock forecast and policy pair (ADR 0010)", () => {
    const forecast = fixtureForecast();

    function hourAt(startsAt: string): HourForecast {
      const found = forecast.hours.find((candidate) => candidate.starts_at === startsAt);
      if (found === undefined) throw new Error(`the fixture has no hour at ${startsAt}`);
      return found;
    }

    it("reads the 13:00 local hour (quantiles 26, 28, 30) as orange", () => {
      const result = personalLevel({ hour: hourAt("2026-11-11T09:00:00Z"), profile, policy: riskPolicy, today: TODAY });
      expect(result?.level).toBe("orange");
    });

    it("has no personal level for the 19:00 local hour, which has no data", () => {
      expect(personalLevel({ hour: hourAt("2026-11-11T15:00:00Z"), profile, policy: riskPolicy, today: TODAY })).toBeNull();
    });
  });
});

describe("policyMatchesForecast (ADR 0010)", () => {
  const forecast = fixtureForecast();

  it("is true when the policy's config_version equals the forecast's", () => {
    expect(policyMatchesForecast(forecast, riskPolicy)).toBe(true);
  });

  it("is false when the policy is older or newer than the forecast", () => {
    expect(policyMatchesForecast(forecast, { ...riskPolicy, config_version: forecast.config_version + 1 })).toBe(false);
    expect(policyMatchesForecast(forecast, { ...riskPolicy, config_version: forecast.config_version - 1 })).toBe(false);
  });

  it("compares the numbers only: the ruleset id (policy_version / version) plays no part", () => {
    const otherForecastRuleset: SiteForecastToday = { ...forecast, policy_version: "ae-heat-2027.1" };
    const otherPolicyRuleset: RiskPolicy = { ...riskPolicy, version: "ae-heat-2026.3" };
    expect(policyMatchesForecast(otherForecastRuleset, otherPolicyRuleset)).toBe(true);
  });
});

describe("displayedLevel (safety-first: the more severe of site and personal)", () => {
  it("returns the more severe of the two", () => {
    expect(displayedLevel("amber", "green")).toBe("amber");
    expect(displayedLevel("green", "amber")).toBe("amber");
    expect(displayedLevel("orange", "red")).toBe("red");
  });

  it("returns the other when one is null", () => {
    expect(displayedLevel(null, "red")).toBe("red");
    expect(displayedLevel("green", null)).toBe("green");
  });

  it("returns null when both are null", () => {
    expect(displayedLevel(null, null)).toBeNull();
  });

  it("returns the level when both are equal", () => {
    expect(displayedLevel("orange", "orange")).toBe("orange");
  });
});
