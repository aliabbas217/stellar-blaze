/*
 * The made-up morning of slide 02, "A morning on site": four rests, one level each, drawn as four real states of the worker's sign. It is a PICTURE
 * of the product, labelled Demo like the demo site it stands on, never a reading or a forecast: the levels, their start times and the cycles
 * are constants of the picture, fixed here in one place so the markup and the tests agree (tests/unit/features/judge/landing/landing-day.test.ts).
 * A card's `until` is the time its sign says the level holds to; the last level holds to the end of the strip. The work and rest minutes are the
 * demo prop of each level (the judge pages may not import worker code, ADR 0009 section 7). The strip under the cards colours each hour of the
 * field day's own recorded forecast at the airport (omaa), with the same classes as the map: that part is data.
 */

export type DayLevel = "green" | "amber" | "orange" | "red";
export type DayLead = { readonly kind: "siteRules" } | { readonly kind: "cycle"; readonly work: number; readonly rest: number } | { readonly kind: "stop" };

export interface DayStep {
  readonly level: DayLevel;
  /** The minute of the day the card's moment is (0 to 1439). */
  readonly minute: number;
  readonly until: string;
  readonly lead: DayLead;
}

export const DAY_STRIP = { from: 6, to: 18 } as const;
/** The midday break, in hours of the day: the recessed slot of the strip. */
export const MIDDAY_BREAK = { from: 12.5, to: 15 } as const;

export const DAY_STEPS: readonly DayStep[] = [
  { level: "green", minute: 6 * 60, until: "07:20", lead: { kind: "siteRules" } },
  { level: "amber", minute: 8 * 60 + 40, until: "10:00", lead: { kind: "cycle", work: 45, rest: 15 } },
  { level: "orange", minute: 11 * 60 + 20, until: "12:40", lead: { kind: "cycle", work: 20, rest: 40 } },
  { level: "red", minute: 14 * 60, until: "17:00", lead: { kind: "stop" } },
] as const;

export const clockText = (minute: number): string => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
export const hoursOf = (hhmm: string): number => {
  const [h, m] = hhmm.split(":");
  return Number(h) + Number(m) / 60;
};
