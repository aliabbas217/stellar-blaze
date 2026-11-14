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

/** What the worker is told to do now: one verb, with its numbers when the code has them. */
export type Lead =
  | { readonly kind: "stop" }
  | { readonly kind: "cycle"; readonly workMinutes: number; readonly restMinutes: number }
  | { readonly kind: "shade" }
  | { readonly kind: "siteRules" };

/** The list under "Also now": only what a known code asks for. */
export type AlsoNow = "water" | "buddy";

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
  // The most protective lead wins: a stop over a cycle over plain shade.
  const lead = leads.find((l) => l.kind === "stop") ?? leads.find((l) => l.kind === "cycle") ?? leads.find((l) => l.kind === "shade");
  return { lead: lead ?? { kind: "siteRules" }, also: [...also] };
}
