import { z } from "zod";

/*
 * The roster frontier (data/static/roster_frontier.json): for each commute time, how much of the heat exposure a
 * different roster would avoid against the legal default, and what it costs in sleep. It is a recorded analysis of
 * 2024-2026 station observations, not a scored 2026 result, so there is no generated API type for it (the OpenAPI
 * contract carries only the three exporter files). This hand-typed reader is the one place that knows its shape;
 * Task 8 draws from `RosterFrontier` and never reads the file itself.
 *
 * The schema lists the fields the screens use and ignores the rest, so a new exporter column does not break the page.
 * `exposure` figures are shares of working hours at or above a WBGT threshold (ge28, ge30, ge32); sleep is in hours.
 */

const exposure = z.object({
  ge28: z.number(),
  ge30: z.number(),
  ge32: z.number(),
});

const gatePoint = z.object({
  commute_min: z.number(),
  b1_sleep_h: z.number(),
  b1_passes_sleep_gate: z.boolean(),
  folds_no_change: z.number(),
  folds: z.number(),
  avoided_vs_legal_default_ge28: z.number(),
  avoided_vs_legal_default_ge30: z.number(),
  avoided_vs_legal_default_ge32: z.number(),
});

const sleepNeutralPoint = z.object({
  commute_min: z.number(),
  scenario: z.string(),
  vsB1_28: z.number(),
  vsB1_30: z.number(),
  vsB1_32: z.number(),
});

const rosterPoint = z.object({
  roster: z.string(),
  sleep_h: z.number(),
  e30_per_h: z.number(),
  e32_per_h: z.number(),
});

const baselinePoint = z.object({
  sleep_h: z.number(),
  e30_per_h: z.number(),
  e32_per_h: z.number(),
});

const rosterFrontierSchema = z.object({
  label: z.string(),
  generated_by: z.string(),
  assumptions: z.object({
    prep_h: z.number(),
    evening_buffer_h: z.number(),
    bedtime_floor: z.string(),
    sleep_gate_h: z.number(),
  }),
  baselines: z.object({
    B0_common_practice_non_compliant: z.string(),
    B1_legal_default: z.string(),
  }),
  legalisation_B0_to_B1_mean: exposure,
  frontier_absolute_gate: z.array(gatePoint),
  sleep_neutral_vs_legal_default: z.array(sleepNeutralPoint),
  pareto_e30_vs_sleep: z.array(
    z.object({
      commute_min: z.number(),
      pareto: z.array(rosterPoint),
      B0: baselinePoint,
      B1: baselinePoint,
    }),
  ),
  units: z.string(),
});

export type RosterFrontier = z.infer<typeof rosterFrontierSchema>;

/** Parses the contents of roster_frontier.json; throws a ZodError naming the field when the shape is not the one above. */
export function parseRosterFrontier(value: unknown): RosterFrontier {
  return rosterFrontierSchema.parse(value);
}
