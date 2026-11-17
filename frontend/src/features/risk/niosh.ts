/*
 * NIOSH 2016 criteria document (Criteria for a Recommended Standard: Occupational Exposure to Heat and Hot Environments),
 * chapter 8.1, as written in ADR 0006: the whole-body metabolic rate M, in watts, sets the WBGT limit in degrees C.
 *
 *   REL (recommended exposure limit, for acclimatised workers)   = 56.7 - 11.5 * log10(M)
 *   RAL (recommended alert limit, for unacclimatised workers)    = 59.9 - 14.1 * log10(M)
 *
 * The backend's engine computes the same two numbers (B3); parity is pinned later by a shared vector file. Until it
 * exists, tests/unit/features/risk/niosh.test.ts uses ADR 0006's vectors.
 */

/** Whether `value` can be a metabolic rate: a finite number of watts above 0. `rel` and `ral` throw RangeError when it is not. */
export function isMetabolicRate(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function requireMetabolicRate(metabolicRateW: number): void {
  if (!isMetabolicRate(metabolicRateW)) {
    throw new RangeError(`metabolic rate must be a finite number of watts above 0, got ${String(metabolicRateW)}`);
  }
}

/** The recommended exposure limit, degrees C WBGT, for an acclimatised worker doing work of `metabolicRateW` watts. */
export function rel(metabolicRateW: number): number {
  requireMetabolicRate(metabolicRateW);
  return 56.7 - 11.5 * Math.log10(metabolicRateW);
}

/** The recommended alert limit, degrees C WBGT, for an unacclimatised worker doing work of `metabolicRateW` watts. */
export function ral(metabolicRateW: number): number {
  requireMetabolicRate(metabolicRateW);
  return 59.9 - 14.1 * Math.log10(metabolicRateW);
}
