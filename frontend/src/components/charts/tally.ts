/** The running totals through one day of the season: days over the limit, working hours over it, and of those, hours inside the midday break. */
export interface TallyPoint {
  readonly days: number;
  readonly hours: number;
  readonly inBan: number;
}
