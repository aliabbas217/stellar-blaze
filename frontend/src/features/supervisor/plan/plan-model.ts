import type { Problem, ShiftViolation } from "@/api/problem";
import type { components } from "@/api/schema";
import type { HeatCell, PlanBlockState } from "@/components/plan/PlanBars";
import { heatColor } from "@/lib/heat/ramp";
import { hourOfDay } from "@/lib/time/zone";

/*
 * The plan screen's pure parts (F2 Task 20): the plan's segments as blocks on the site's day, the axis they need, the heat of each
 * hour, and what kind of failure a refused plan request is. Nothing here reads a clock or a locale: `now` and the zone are inputs.
 */

type DayPlan = components["schemas"]["DayPlan"];
type SiteForecastToday = components["schemas"]["SiteForecastToday"];

export interface PlanBlock {
  readonly index: number;
  readonly startsAt: string;
  readonly endsAt: string;
  /** Site-local minutes since midnight. */
  readonly fromMin: number;
  readonly toMin: number;
  readonly state: PlanBlockState;
  readonly zone: components["schemas"]["PlanZone"] | null;
  readonly ruleId: string;
  /** The clause text the API sent for the rule; may be empty. */
  readonly clause: string;
}

/** The plan's segments in time order, as blocks. An `off` stretch is not a block of the day (nothing to read or act on). */
export function planBlocks(plan: Pick<DayPlan, "segments">, zone: string): PlanBlock[] {
  return plan.segments
    .filter((segment) => segment.state !== "off")
    .map((segment, index) => {
      const fromMin = Math.round(hourOfDay(new Date(segment.starts_at), zone) * 60);
      const minutes = Math.round((Date.parse(segment.ends_at) - Date.parse(segment.starts_at)) / 60_000);
      return {
        index,
        startsAt: segment.starts_at,
        endsAt: segment.ends_at,
        fromMin,
        toMin: fromMin + minutes,
        state: segment.state,
        zone: segment.zone,
        ruleId: segment.rule_id,
        clause: segment.clause,
      };
    });
}

/** The whole hours the chart spans: the first block's hour to the end of the last block's hour, two hours at least. */
export function planAxis(blocks: readonly PlanBlock[]): { readonly from: number; readonly to: number } {
  if (blocks.length === 0) return { from: 6, to: 18 };
  const from = Math.max(0, Math.floor(Math.min(...blocks.map((block) => block.fromMin)) / 60));
  const to = Math.min(24, Math.ceil(Math.max(...blocks.map((block) => block.toMin)) / 60));
  return to - from >= 2 ? { from, to } : { from, to: Math.min(24, from + 2) };
}

/**
 * One heat per local hour 0 to 23 from the site forecast's WBGT p50, for the chart's strip. Heat colour appears on live data
 * only: with `live` false (a stale or fallback forecast) every hour is null and the strip stays bare.
 */
export function heatCells(forecast: Pick<SiteForecastToday, "hours"> | undefined, zone: string, live: boolean): (HeatCell | null)[] {
  const cells: (HeatCell | null)[] = Array.from({ length: 24 }, () => null);
  if (!live || forecast === undefined) return cells;
  for (const hour of forecast.hours) {
    const wbgt = hour.wbgt_c.p50;
    if (wbgt === null || !Number.isFinite(wbgt)) continue;
    const local = Math.floor(hourOfDay(new Date(hour.starts_at), zone));
    cells[local] = { night: heatColor(wbgt, "night"), sun: heatColor(wbgt, "sun") };
  }
  return cells;
}

/** What a refused plan request is, for the screen: each kind has its own words and its own next step. */
export type PlanFailure =
  | { readonly kind: "not-found" }
  /** 422 `shift-not-legal`: the shift itself breaks a rule; informative, not an error. */
  | { readonly kind: "not-legal"; readonly violations: readonly ShiftViolation[] }
  /** 500 `plan-invalid`: the independent validator rejected the planner's own plan. */
  | { readonly kind: "invalid" }
  | { readonly kind: "error" };

const SHIFT_NOT_LEGAL = /(^|[:/])shift-not-legal$/;
const PLAN_INVALID = /(^|[:/])plan-invalid$/;

export function planFailureOf(problem: Problem): PlanFailure {
  if (problem.status === 404) return { kind: "not-found" };
  if (problem.status === 422 && SHIFT_NOT_LEGAL.test(problem.type)) return { kind: "not-legal", violations: problem.violations ?? [] };
  if (problem.status === 500 && PLAN_INVALID.test(problem.type)) return { kind: "invalid" };
  return { kind: "error" };
}

/** Whether a sign-off 422 is the shift-not-legal problem (the plan loaded; the shift changed or was already illegal). */
export function isShiftNotLegal(problem: Problem): boolean {
  return problem.status === 422 && SHIFT_NOT_LEGAL.test(problem.type);
}
