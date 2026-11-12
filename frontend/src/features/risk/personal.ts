import type { components } from "@/api/schema";
import { moreSevere, type Level } from "@/components/level/level";
import { isCalendarDate, type Profile } from "@/features/profile/profile-shape";
import { exceedanceProbability } from "./exceedance";
import { isMetabolicRate, ral, rel } from "./niosh";

/*
 * Tier B: the worker's personal level, worked out on the phone (ADR 0004: the profile and the result never leave the
 * device). It mirrors B3's engine; parity is pinned later by a shared vector file that B3 publishes, and until then the
 * tests use ADR 0006's NIOSH vectors.
 *
 *   1. NIOSH limit for the workload's metabolic rate: REL when acclimatised, RAL when not.
 *   2. The forecast quantiles are shifted up by the clothing option's adjustment (degrees C).
 *   3. P(WBGT > limit) from the shifted quantiles (exceedance.ts).
 *   4. The level is the band with the highest min_exceedance_probability at or below that probability.
 *
 * This module takes the policy and the hour as given. ADR 0010 says the caller computes only with a policy whose
 * config_version equals the forecast's (`policyMatchesForecast`, below) and refetches the policy on a mismatch.
 */

type HourForecast = components["schemas"]["HourForecast"];
type RiskPolicy = components["schemas"]["RiskPolicy"];
type ForecastVersion = Pick<components["schemas"]["SiteForecastToday"], "config_version">;
type PolicyVersion = Pick<RiskPolicy, "config_version">;

export interface PersonalLevel {
  readonly level: Level;
  /** P(WBGT > limit), in [0.05, 0.95]: see exceedance.ts for what the ends mean. */
  readonly probability: number;
  /** The NIOSH limit in degrees C WBGT, before the clothing adjustment (which shifts the forecast, not the limit). */
  readonly limitC: number;
  readonly acclimatised: boolean;
}

const MS_PER_DAY = 86_400_000;

/** The calendar date as a count of UTC days, so no clock, time zone or daylight-saving change can move it. */
function dayNumber(date: string): number {
  if (!isCalendarDate(date)) throw new RangeError(`not a calendar date (YYYY-MM-DD): ${JSON.stringify(date)}`);
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / MS_PER_DAY;
}

/**
 * Whole calendar days from `from` to `to`, both YYYY-MM-DD (negative when `to` is earlier). Both are dates, not instants:
 * the caller passes "today" (the phone's own calendar date), so nothing here reads the clock. Throws RangeError when
 * either is not a real calendar date.
 */
export function daysBetween(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from);
}

/** The level of the band with the highest minimum at or below `probability`; the more severe one when minimums tie. */
function bandLevel(bands: RiskPolicy["bands"], probability: number): Level | null {
  let level: Level | null = null;
  let highestMin = Number.NEGATIVE_INFINITY;
  for (const { level: candidate, min_exceedance_probability: min } of bands) {
    if (min > probability) continue;
    if (min > highestMin) {
      highestMin = min;
      level = candidate;
    } else if (min === highestMin && level !== null) {
      level = moreSevere(level, candidate);
    }
  }
  return level;
}

/**
 * The worker's level for one forecast hour, or null when it cannot be worked out honestly: a quantile is missing or not
 * a finite number, the workload class or clothing code is not in the policy, the policy's metabolic rate or adjustment
 * is unusable, or no band of the policy covers the probability. Null is "no personal level"; it is never a guess, and
 * the screen still shows the site level.
 *
 * A start date after `today` (a phone clock set back) counts as not acclimatised: the stricter RAL applies.
 * Throws RangeError when `today` or the profile's start date is not a calendar date; both are validated before this.
 */
export function personalLevel(input: {
  hour: HourForecast;
  profile: Profile;
  policy: RiskPolicy;
  today: string;
}): PersonalLevel | null {
  const { hour, profile, policy, today } = input;
  const { p05, p50, p95 } = hour.wbgt_c;
  if (p05 === null || p50 === null || p95 === null) return null;

  const workload = policy.workload_classes.find((candidate) => candidate.code === profile.workloadClass);
  const clothing = policy.clothing_options.find((candidate) => candidate.code === profile.clothingCode);
  if (workload === undefined || clothing === undefined) return null;

  const { metabolic_rate_w: metabolicRateW } = workload;
  const { adjustment_c: adjustmentC } = clothing;
  if (!isMetabolicRate(metabolicRateW) || ![p05, p50, p95, adjustmentC].every(Number.isFinite)) return null;

  const acclimatised = daysBetween(profile.heatWorkStartDate, today) >= policy.acclimatisation_days_required;
  const limitC = acclimatised ? rel(metabolicRateW) : ral(metabolicRateW);
  const probability = exceedanceProbability({ p05: p05 + adjustmentC, p50: p50 + adjustmentC, p95: p95 + adjustmentC }, limitC);
  const level = bandLevel(policy.bands, probability);
  if (level === null) return null;
  return { level, probability, limitC, acclimatised };
}

/**
 * ADR 0010: whether `policy` is the one the forecast was made under, which is the only case the device may compute personal
 * risk. Integer ids compared for equality, never parsed or ordered: the ruleset id (`policy_version`, `version`) is not
 * part of the check. On false the caller refetches the policy; offline it keeps the cached pair and shows both versions.
 */
export function policyMatchesForecast(forecast: ForecastVersion, policy: PolicyVersion): boolean {
  return forecast.config_version === policy.config_version;
}

/**
 * The level the screen leads with: the more severe of the site's and the worker's own, either of which may be absent.
 * Safety-first; flagged for B3 to confirm.
 */
export function displayedLevel(site: Level | null, personal: Level | null): Level | null {
  if (site === null) return personal;
  if (personal === null) return site;
  return moreSevere(site, personal);
}
