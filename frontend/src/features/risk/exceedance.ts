/*
 * P(WBGT > limit) from the three quantiles the forecast publishes.
 *
 * The CDF is taken as the polyline through (p05, 0.05), (p50, 0.50) and (p95, 0.95): each of the two inner segments
 * carries 0.45 of the probability, spread evenly. Outside p05..p95 the forecast says nothing about the shape, so the
 * answer is a bound and is documented as one:
 *
 *   limit <= p05  ->  0.95, a LOWER bound: the true P(WBGT > limit) is at least 0.95.
 *   limit >= p95  ->  0.05, a conservative UPPER bound: the true P(WBGT > limit) is at most 0.05.
 *
 * The lower bound is the one that under-states risk. It cannot change a level while the policy's top band starts at or
 * below 0.95; a policy that placed a band above 0.95 would see this function under-classify limits far below p05.
 *
 * Equal quantiles: the median is the 0.50 point of any distribution, so `limit === p50` is 0.50 first, whatever the tails
 * do. That also settles the all-equal forecast, which the tail rules alone would answer 0.95. After it, the segment a
 * limit falls into is only entered when the limit is strictly inside it, so no segment of zero width is ever divided by.
 */

export interface WbgtQuantiles {
  readonly p05: number;
  readonly p50: number;
  readonly p95: number;
}

const OUTER_MASS = 0.45;
const BELOW_P05 = 0.95;
const ABOVE_P95 = 0.05;
const AT_MEDIAN = 0.5;

/** P(WBGT > limit), in [0.05, 0.95]. Quantiles given out of order are sorted first. Throws RangeError on a non-finite number. */
export function exceedanceProbability(q: WbgtQuantiles, limit: number): number {
  if (![q.p05, q.p50, q.p95, limit].every(Number.isFinite)) {
    throw new RangeError("quantiles and limit must be finite numbers");
  }
  const p05 = Math.min(q.p05, q.p50, q.p95);
  const p95 = Math.max(q.p05, q.p50, q.p95);
  const p50 = Math.max(Math.min(q.p05, q.p50), Math.min(Math.max(q.p05, q.p50), q.p95)); // median of three, exact
  if (limit === p50) return AT_MEDIAN;
  if (limit <= p05) return BELOW_P05;
  if (limit >= p95) return ABOVE_P95;
  // Strictly between p05 and p95, and not equal to p50: p05 < limit < p50 or p50 < limit < p95, so each width is above 0.
  if (limit < p50) return BELOW_P05 - (OUTER_MASS * (limit - p05)) / (p50 - p05);
  return AT_MEDIAN - (OUTER_MASS * (limit - p50)) / (p95 - p50);
}
