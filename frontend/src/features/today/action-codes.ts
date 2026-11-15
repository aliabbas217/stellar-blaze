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
 */

import type { PictogramName } from "@/components/level/Pictogram";

/** What the worker is told to do now: one verb, with its numbers when the code has them. */
export type Lead =
  | { readonly kind: "stop" }
  | { readonly kind: "cycle"; readonly workMinutes: number; readonly restMinutes: number }
  | { readonly kind: "shade" }
  | { readonly kind: "siteRules" };

/**
 * The list under "Also now": only what a known code asks for. The last four are the ruleset's codes that had no wording until the
 * architect's ruling of 2026-11-15: each is the ADOSH Technical Guideline Table 1 text the ruleset's own clause cites, verbatim where
 * possible (messages `worker.today.also.*`; the (code, wording, clause) log is in the F2 Task 20 report for the clinical review pack).
 * They stay under the draft marker ("Draft wording, awaiting clinical review"): nothing here is reviewed.
 */
export type AlsoNow = "water" | "buddy" | "selfPaced" | "noUnacclimatised" | "induction" | "bottle";

/** The pictogram drawn beside an "Also now" line (decorative: the words carry the meaning). */
export function alsoPictogram(item: AlsoNow): PictogramName {
  switch (item) {
    case "water":
    case "bottle":
      return "water";
    case "selfPaced":
      return "clock";
    case "buddy":
    case "noUnacclimatised":
    case "induction":
      return "buddy";
  }
}

/** The lines that carry clinical wording of their own (everything but the two older, simpler prompts): the draft marker follows them. */
export const ALSO_NEEDS_DRAFT_MARKER: ReadonlySet<AlsoNow> = new Set<AlsoNow>(["selfPaced", "noUnacclimatised", "induction", "bottle"]);

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
  if (code === "no-lone-work") return "buddy";
  if (code === "self-paced-work") return "selfPaced";
  if (code === "no-unacclimatised") return "noUnacclimatised";
  if (code === "high-risk-induction") return "induction";
  if (code === "personal-water-bottle-2l") return "bottle";
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
