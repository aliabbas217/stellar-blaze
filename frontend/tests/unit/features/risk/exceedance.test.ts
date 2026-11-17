import { exceedanceProbability } from "@/features/risk/exceedance";

/*
 * P(WBGT > limit) from the three published quantiles: the CDF is the polyline through (p05, 0.05), (p50, 0.50), (p95, 0.95),
 * so each of the two inner segments carries 0.45 of probability. Outside p05..p95 the answer is a bound, not an estimate.
 */

const q = { p05: 26, p50: 28, p95: 30 };

describe("exceedanceProbability", () => {
  describe("inside the published quantiles", () => {
    it.each([
      [28, 0.5],
      [27, 0.725],
      [29.5, 0.1625],
      [26.5, 0.8375],
      [29, 0.275],
    ])("limit %f gives %f", (limit, expected) => {
      expect(exceedanceProbability(q, limit)).toBeCloseTo(expected, 10);
    });

    it("is exactly 0.95 at p05 and 0.05 at p95, so it is continuous into the tails", () => {
      expect(exceedanceProbability(q, 26)).toBeCloseTo(0.95, 12);
      expect(exceedanceProbability(q, 30)).toBeCloseTo(0.05, 12);
    });
  });

  describe("outside the published quantiles", () => {
    it("is 0.95 at or below p05: a lower bound, the true probability is at least that", () => {
      expect(exceedanceProbability(q, 25)).toBe(0.95);
      expect(exceedanceProbability(q, -40)).toBe(0.95);
    });

    it("is 0.05 at or above p95: a conservative upper bound, the true probability is at most that", () => {
      expect(exceedanceProbability(q, 31)).toBe(0.05);
      expect(exceedanceProbability(q, 90)).toBe(0.05);
    });
  });

  describe("equal quantiles", () => {
    it("treats the median as the 0.50 point, with no NaN, when all three are equal", () => {
      expect(exceedanceProbability({ p05: 28, p50: 28, p95: 28 }, 28)).toBe(0.5);
    });

    it("still reads the tails of a collapsed forecast as bounds", () => {
      const collapsed = { p05: 28, p50: 28, p95: 28 };
      expect(exceedanceProbability(collapsed, 27.9)).toBe(0.95);
      expect(exceedanceProbability(collapsed, 28.1)).toBe(0.05);
    });

    it("handles p05 equal to p50 (the lower segment has no width)", () => {
      const lowerTie = { p05: 28, p50: 28, p95: 30 };
      expect(exceedanceProbability(lowerTie, 27)).toBe(0.95);
      expect(exceedanceProbability(lowerTie, 28)).toBe(0.5);
      expect(exceedanceProbability(lowerTie, 29)).toBeCloseTo(0.275, 10);
    });

    it("handles p50 equal to p95 (the upper segment has no width)", () => {
      const upperTie = { p05: 26, p50: 28, p95: 28 };
      expect(exceedanceProbability(upperTie, 27)).toBeCloseTo(0.725, 10);
      expect(exceedanceProbability(upperTie, 28)).toBe(0.5);
      expect(exceedanceProbability(upperTie, 28.1)).toBe(0.05);
    });

    it("never returns NaN for any limit around a tied forecast", () => {
      for (const tied of [
        { p05: 28, p50: 28, p95: 28 },
        { p05: 28, p50: 28, p95: 30 },
        { p05: 26, p50: 28, p95: 28 },
      ]) {
        for (let limit = 25; limit <= 31; limit += 0.25) {
          expect(Number.isNaN(exceedanceProbability(tied, limit))).toBe(false);
        }
      }
    });
  });

  describe("quantiles out of order", () => {
    it("sorts them first", () => {
      expect(exceedanceProbability({ p05: 30, p50: 26, p95: 28 }, 27)).toBeCloseTo(0.725, 10);
      expect(exceedanceProbability({ p05: 28, p50: 30, p95: 26 }, 29.5)).toBeCloseTo(0.1625, 10);
    });
  });

  describe("monotonicity", () => {
    it("never rises as the limit rises", () => {
      for (const quantiles of [q, { p05: 28, p50: 28, p95: 30 }, { p05: 26, p50: 28, p95: 28 }, { p05: 28, p50: 28, p95: 28 }]) {
        let previous = 1;
        for (let limit = 20; limit <= 35; limit += 0.1) {
          const probability = exceedanceProbability(quantiles, limit);
          expect(probability).toBeLessThanOrEqual(previous);
          previous = probability;
        }
      }
    });
  });

  describe("unusable numbers", () => {
    it.each([Number.NaN, Number.POSITIVE_INFINITY])("throws RangeError for a limit of %s", (limit) => {
      expect(() => exceedanceProbability(q, limit)).toThrow(RangeError);
    });

    it("throws RangeError for a non-finite quantile", () => {
      expect(() => exceedanceProbability({ p05: Number.NaN, p50: 28, p95: 30 }, 28)).toThrow(RangeError);
      expect(() => exceedanceProbability({ p05: 26, p50: 28, p95: Number.POSITIVE_INFINITY }, 28)).toThrow(RangeError);
    });
  });
});
