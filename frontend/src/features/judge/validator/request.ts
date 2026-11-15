import type { components } from "@/api/schema";
import { runsToSegments, type Run } from "./runs";

/*
 * The one place the validator request is built. The site is the demo site and the date is the one the API's own forecast for
 * that site reports (the replay day in replay mode, today in live mode; the contract REQUIRES a date, so live mode cannot omit it);
 * neither is a constant here. The crew is the hypothetical crew of the roster analysis (20 people, heavy work). The two assumptions the contract REQUIRES (`acclimatised`,
 * `days_per_week`) are the visitor's: the form starts them at the protective values and shows them as editable.
 */

type PlanValidateRequest = components["schemas"]["PlanValidateRequest"];

export const REPLAY_HEADCOUNT = 20;
/** `acclimatised = false` (everyone new to the heat: the protective default) and `days_per_week = 6` (the contract's default). */
export const DEFAULT_ACCLIMATISED = false;
export const DEFAULT_DAYS_PER_WEEK = "6";

/** A whole number of days from 1 to 7, or null. */
export function parseDays(text: string): number | null {
  const trimmed = text.trim();
  if (!/^[1-7]$/.test(trimmed)) return null;
  return Number(trimmed);
}

export function buildRequest(input: { readonly siteId: string; readonly date: string; readonly runs: readonly Run[]; readonly acclimatised: boolean; readonly days: number }): PlanValidateRequest {
  return {
    site_id: input.siteId,
    date: input.date,
    crew: { workload: "heavy", headcount: REPLAY_HEADCOUNT, acclimatised: input.acclimatised, days_per_week: input.days },
    segments: runsToSegments(input.runs),
  };
}
