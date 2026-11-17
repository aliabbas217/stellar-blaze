import { isMetabolicRate, ral, rel } from "@/features/risk/niosh";

/*
 * NIOSH 2016 criteria document, chapter 8.1, as written in ADR 0006: REL = 56.7 - 11.5 log10(M), RAL = 59.9 - 14.1 log10(M),
 * M in whole-body watts, results in degrees C WBGT. The vectors are the ADR's; they were recomputed independently for this task.
 */

describe("rel (acclimatised limit)", () => {
  it.each([
    [180, 30.76],
    [300, 28.21],
    [415, 26.59],
  ])("rel(%d W) = %f", (metabolicRateW, expected) => {
    expect(rel(metabolicRateW)).toBeCloseTo(expected, 2);
  });

  it("falls as the work gets harder", () => {
    expect(rel(180)).toBeGreaterThan(rel(300));
    expect(rel(300)).toBeGreaterThan(rel(415));
  });
});

describe("ral (unacclimatised limit)", () => {
  it.each([
    [180, 28.1],
    [300, 24.97],
    [415, 22.99],
  ])("ral(%d W) = %f", (metabolicRateW, expected) => {
    expect(ral(metabolicRateW)).toBeCloseTo(expected, 2);
  });

  it("is stricter than rel at every rate the policy uses", () => {
    for (const metabolicRateW of [180, 300, 415]) {
      expect(ral(metabolicRateW)).toBeLessThan(rel(metabolicRateW));
    }
  });
});

describe("metabolic rate validation", () => {
  const unusable = [0, -1, -300, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];

  it("isMetabolicRate agrees with what rel and ral accept", () => {
    expect([180, 300, 415, 0.5].every(isMetabolicRate)).toBe(true);
    expect(unusable.some(isMetabolicRate)).toBe(false);
  });

  it.each(unusable)("rel throws RangeError for %s", (metabolicRateW) => {
    expect(() => rel(metabolicRateW)).toThrow(RangeError);
  });

  it.each(unusable)("ral throws RangeError for %s", (metabolicRateW) => {
    expect(() => ral(metabolicRateW)).toThrow(RangeError);
  });
});
