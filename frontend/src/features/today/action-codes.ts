/*
 * What the hour's `action_codes` mean on the Today screen. The API sends the ruleset's codes and "the client holds the
 * words" (HourForecast.action_codes): this is the one place a code becomes a message key and a number. Nothing here makes up
 * wording or a quantity: a number appears only when the code itself carries it (a work-rest cycle `45-15`), and a code this
 * table does not know is dropped, so a screen never shows text for a code nobody has reviewed. When the hour has no code the
 * table knows, the lead is "Follow the site rules".
 *
 * The code vocabulary is the ruleset's and still moves (B3 builds it); the shapes below are the ones its plan names
 * (`cycle.<zone>.<workload>.<work>-<rest>`, `no-lone-work`, `fluids.*`, `stop-work`) plus the two the contract's example uses
 * (`rest_in_shade`, `water_every_15_min`). Water is only ever "Drink water": no litres, no interval (clinical review pending).
 * A code that is an employer's duty (`EMPLOYER_DUTY_CODES`) is known and deliberately dropped, like an unknown one.
 */

import type { PictogramName } from "@/components/level/Pictogram";

/** What the worker is told to do now: one verb, with its numbers when the code has them. */
export type Lead =
  | { readonly kind: "stop" }
  | { readonly kind: "cycle"; readonly workMinutes: number; readonly restMinutes: number }
  | { readonly kind: "shade" }
  | { readonly kind: "siteRules" };

/**
 * The list under "Also now": only what a known code asks of THE WORKER, at most three lines (water, never alone, self-paced work).
 * One glyph, one meaning (redesign 04, section 3): each line has its own glyph, and a rule that has no honest glyph of its own
 * must be given none rather than another rule's (the buddy glyph used to stand for three different rules).
 */
export type AlsoNow = "water" | "buddy" | "selfPaced";

/**
 * The ruleset's codes that are the EMPLOYER's duty, not an action of the worker who reads Today (the text is the ADOSH Technical
 * Guideline's, written for duty holders: a worker cannot hold an induction or provide a bottle). They are NOT shown on the worker's
 * screens (Today, the alert card) and have no wording in the catalogues any more; the codes stay in the data and are parked until the
 * crew lead's plan has a "Site duties today" place for them (redesign 04 section 3.2; the controller's ADR lists the verbatim wording).
 */
export const EMPLOYER_DUTY_CODES: ReadonlySet<string> = new Set(["no-unacclimatised", "high-risk-induction", "personal-water-bottle-2l"]);

/** The pictogram drawn beside an "Also now" line (decorative: the words carry the meaning). One per rule, never shared. */
export function alsoPictogram(item: AlsoNow): PictogramName {
  switch (item) {
    case "water":
      return "water";
    case "selfPaced":
      return "clock";
    case "buddy":
      // The two-figure glyph means "never work alone" and nothing else.
      return "buddy";
  }
}

export interface ActionPlan {
  readonly lead: Lead;
  readonly also: readonly AlsoNow[];
}

// `cycle.high.heavy.20-40`: minutes of work, minutes of rest in shade, in each hour.
const CYCLE = /^cycle\.[a-z]+\.[a-z]+\.(\d{1,2})-(\d{1,2})$/;

function cycle(code: string): Lead | null {
  const match = CYCLE.exec(code);
  if (match === null) return null;
  const workMinutes = Number(match[1]);
  const restMinutes = Number(match[2]);
  // A cycle is one hour: anything else is a code this table does not understand, never a guess at what it meant.
  return workMinutes + restMinutes === 60 && restMinutes > 0 ? { kind: "cycle", workMinutes, restMinutes } : null;
}

function alsoOf(code: string): AlsoNow | null {
  // Parked, not mapped: an employer's duty is never a line of the worker's screen (and "personal-water-bottle-2l" must not read as water).
  if (EMPLOYER_DUTY_CODES.has(code)) return null;
  if (code === "no-lone-work") return "buddy";
  if (code === "self-paced-work") return "selfPaced";
  if (code.startsWith("fluids.") || code.startsWith("water")) return "water";
  return null;
}

/** The lead and the "Also now" list for an hour's codes. Total: any input gives a plan, an unknown code gives the site rules. */
export function actionPlan(codes: readonly string[]): ActionPlan {
  const leads: Lead[] = [];
  const also = new Set<AlsoNow>();
  for (const code of codes) {
    if (code === "stop-work") leads.push({ kind: "stop" });
    else if (code === "rest_in_shade") leads.push({ kind: "shade" });
    else {
      const timed = cycle(code);
      if (timed !== null) leads.push(timed);
      else {
        const extra = alsoOf(code);
        if (extra !== null) also.add(extra);
      }
    }
  }
  // The most protective lead wins: a stop over a cycle over plain shade. An hour carries one cycle per workload (B3's orange hour:
  // light 45-15 and heavy 20-40) and Today has no workload at site level, so of several cycles the one with the least work leads,
  // whatever their order in the array.
  const strictest = leads
    .filter((l): l is Extract<Lead, { kind: "cycle" }> => l.kind === "cycle")
    .reduce<Extract<Lead, { kind: "cycle" }> | undefined>((best, next) => (best === undefined || next.workMinutes < best.workMinutes ? next : best), undefined);
  const lead = leads.find((l) => l.kind === "stop") ?? strictest ?? leads.find((l) => l.kind === "shade");
  return { lead: lead ?? { kind: "siteRules" }, also: [...also] };
}
