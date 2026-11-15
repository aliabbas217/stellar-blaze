// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import type { components } from "@/api/schema";
import { exceedanceProbability } from "@/features/risk/exceedance";
import { bandLevel } from "@/features/risk/personal";

/*
 * Parity with B3's personal-level engine (ADR 0049 decision 6): B3 publishes the vectors, this device-side mirror must
 * reproduce them. The file is copied byte for byte from D:\dev\stellar-blaze-b3\backend\tests\fixtures\risk\
 * personal_level_vectors.json (B3 generates it from stellar_blaze.domain.risk.personal; never edit it here, and when a
 * vector disagrees with our math report it, do not bend the vector).
 *
 *   - exceedance_vectors: P(WBGT > limit) from three quantiles (in any order) to `probability_tolerance`, and the level
 *     those probabilities take under `default_bands`;
 *   - band_vectors: the band selection for a probability, including equal minimums and a probability below every band.
 */

type RiskBand = components["schemas"]["RiskPolicy"]["bands"][number];
type Level = RiskBand["level"] | null;

interface ExceedanceVector {
  name: string;
  p05: number;
  p50: number;
  p95: number;
  limit: number;
  expected_probability: number;
  expected_level: Level;
}

interface BandVector {
  name: string;
  bands: RiskBand[];
  probability: number;
  expected_level: Level;
}

interface Vectors {
  format_version: number;
  probability_tolerance: number;
  default_bands: RiskBand[];
  exceedance_vectors: ExceedanceVector[];
  band_vectors: BandVector[];
}

const vectors = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../../fixtures/risk/personal_level_vectors.json"), "utf8")) as Vectors;

describe("B3 personal-level parity vectors (ADR 0049 section 6)", () => {
  it("is the format this test reads, and is not empty", () => {
    expect(vectors.format_version).toBe(1);
    expect(vectors.exceedance_vectors.length).toBeGreaterThan(40);
    expect(vectors.band_vectors.length).toBeGreaterThan(10);
  });

  it("states a tolerance of 1e-9, which is what the comparison below uses", () => {
    expect(vectors.probability_tolerance).toBe(1e-9);
  });

  it("covers the ends of the range on both sides, tied quantiles and every order of the three quantiles (the vectors are not vacuous)", () => {
    const names = vectors.exceedance_vectors.map((vector) => vector.name);

    expect(names.some((name) => name.includes("limit_below_p05"))).toBe(true);
    expect(names.some((name) => name.includes("limit_above_p95"))).toBe(true);
    expect(names.some((name) => name.startsWith("tied_"))).toBe(true);
    expect(names.some((name) => name.startsWith("unsorted_"))).toBe(true);
    expect(new Set(vectors.exceedance_vectors.map((vector) => vector.expected_level))).toEqual(new Set(["green", "amber", "orange", "red"]));
  });

  describe("exceedance probability", () => {
    it.each(vectors.exceedance_vectors.map((vector) => [vector.name, vector] as const))("%s", (_name, vector) => {
      const probability = exceedanceProbability({ p05: vector.p05, p50: vector.p50, p95: vector.p95 }, vector.limit);

      expect(Math.abs(probability - vector.expected_probability)).toBeLessThanOrEqual(vectors.probability_tolerance);
    });
  });

  describe("level of that probability under the default bands", () => {
    it("serves the bands the live policy serves: 0, 0.10, 0.50, 0.90", () => {
      expect(vectors.default_bands.map((band) => band.min_exceedance_probability)).toEqual([0, 0.1, 0.5, 0.9]);
    });

    it.each(vectors.exceedance_vectors.map((vector) => [vector.name, vector] as const))("%s", (_name, vector) => {
      const probability = exceedanceProbability({ p05: vector.p05, p50: vector.p50, p95: vector.p95 }, vector.limit);

      expect(bandLevel(vectors.default_bands, probability)).toBe(vector.expected_level);
    });
  });

  describe("band selection", () => {
    it.each(vectors.band_vectors.map((vector) => [vector.name, vector] as const))("%s", (_name, vector) => {
      expect(bandLevel(vector.bands, vector.probability)).toBe(vector.expected_level);
    });
  });
});
