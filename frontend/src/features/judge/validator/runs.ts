import type { components } from "@/api/schema";
import { SITE_TZ } from "@/features/judge/ban";

/*
 * The plan a visitor types or picks, as runs of work (`06:00` to `12:30`), and how it becomes the request the independent
 * validator takes. NOTHING here judges a plan: the verdict is the API's answer. This file only reads the times, checks that
 * each is a clock time on the 5-minute grid, and builds `segments` (state `work`; the gaps between runs are simply not
 * scheduled, which is how the contract's own example sends its roster: "06:00-12:30 work" and "15:00-17:00 work").
 */

export type RosterSegmentInput = components["schemas"]["RosterSegmentInput"];

export interface Run {
  readonly start: string;
  readonly end: string;
}

/** The grid of the plan clock (ADR 0011: 5-minute ticks). */
export const STEP_MINUTES = 5;
/** The contract takes at most 40 segments; the form offers three runs. */
export const MAX_RUNS = 3;

export type TimeProblem = "format" | "grid";
export type RunProblem = TimeProblem | "order";

/** Minutes since midnight of `HH:MM` (also `H:MM`, `HHMM`, `HMM`), or why it is not a time. Paste-friendly: spaces are ignored. */
export function parseTime(text: string): { readonly minutes: number } | { readonly problem: TimeProblem } {
  const match = /^(\d{1,2}):?(\d{2})$/.exec(text.replace(/\s+/g, ""));
  if (match === null) return { problem: "format" };
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return { problem: "format" };
  if (minutes % STEP_MINUTES !== 0) return { problem: "grid" };
  return { minutes: hours * 60 + minutes };
}

/** `HH:MM` for minutes since midnight. */
export function clockOf(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** The text normalised to `HH:MM`, or null when it is not a time on the grid. */
export function normalizeTime(text: string): string | null {
  const parsed = parseTime(text);
  return "minutes" in parsed ? clockOf(parsed.minutes) : null;
}

/** What is wrong with one run, or null. A run that is entirely blank is not a run (see `filledRuns`). */
export function runProblem(run: Run): { readonly field: "start" | "end" | "order"; readonly problem: RunProblem } | null {
  const start = parseTime(run.start);
  if ("problem" in start) return { field: "start", problem: start.problem };
  const end = parseTime(run.end);
  if ("problem" in end) return { field: "end", problem: end.problem };
  return end.minutes > start.minutes ? null : { field: "order", problem: "order" };
}

/** The runs padded with blank rows to the rows the form offers (a blank row is an unused row). */
export function padRuns(runs: readonly Run[]): Run[] {
  const out = runs.map((run) => ({ ...run }));
  while (out.length < MAX_RUNS) out.push({ start: "", end: "" });
  return out;
}

/** The runs with something typed in them: a blank row is simply an unused row. */
export function filledRuns(runs: readonly Run[]): Run[] {
  return runs.filter((run) => run.start.trim() !== "" || run.end.trim() !== "");
}

/**
 * The request's `segments` for runs that all read as times (`runProblem` is null for each): `work` segments in the order given,
 * times normalised to `HH:MM`. Throws a RangeError for a run that does not read, so a caller that skipped the check fails loudly
 * instead of sending a roster the visitor did not write.
 */
export function runsToSegments(runs: readonly Run[]): RosterSegmentInput[] {
  return runs.map((run) => {
    const start = parseTime(run.start);
    const end = parseTime(run.end);
    if ("problem" in start || "problem" in end || end.minutes <= start.minutes) throw new RangeError(`not a run: ${run.start} to ${run.end}`);
    return { start: clockOf(start.minutes), end: clockOf(end.minutes), state: "work" };
  });
}

/** The work runs of a list of segments (the inverse of `runsToSegments`; rest and break segments are not runs). */
export function segmentsToRuns(segments: readonly RosterSegmentInput[]): Run[] {
  return segments.filter((segment) => segment.state === "work").map((segment) => ({ start: segment.start, end: segment.end }));
}

export type TemplateId = "common" | "legal" | "straight";

/**
 * The three rosters of the roster analysis (data/static/roster_frontier.json `baselines`: common practice 06:00-12:30 and
 * 15:00-17:00, the legal default 06:00-11:00 and 15:00-18:00) and "every shift minute outside the ban" (the published shift,
 * 06:00 to 17:00, worked straight through). The names are messages; the times are the plan.
 */
export const TEMPLATES: readonly { readonly id: TemplateId; readonly runs: readonly Run[] }[] = [
  { id: "common", runs: [{ start: "06:00", end: "12:30" }, { start: "15:00", end: "17:00" }] },
  { id: "legal", runs: [{ start: "06:00", end: "11:00" }, { start: "15:00", end: "18:00" }] },
  { id: "straight", runs: [{ start: "06:00", end: "17:00" }] },
];

export function templateRuns(id: TemplateId): Run[] {
  return padRuns(TEMPLATES.find((template) => template.id === id)?.runs ?? []);
}

/** The template whose runs these are, or null when they were edited. */
export function templateOf(runs: readonly Run[]): TemplateId | null {
  const filled = filledRuns(runs);
  const same = (a: readonly Run[], b: readonly Run[]): boolean => a.length === b.length && a.every((run, i) => {
      const other = b[i];
      return other !== undefined && run.start === other.start && run.end === other.end;
    });
  return TEMPLATES.find((template) => same(template.runs, filled.map((run) => ({ start: normalizeTime(run.start) ?? run.start, end: normalizeTime(run.end) ?? run.end }))))?.id ?? null;
}

const LOCAL_CLOCK = new Intl.DateTimeFormat("en-US", { timeZone: SITE_TZ, hourCycle: "h23", hour: "2-digit", minute: "2-digit" });

/** Site-local minutes since midnight of an instant (the API answers in UTC instants). */
export function localMinutesOf(instant: string): number {
  const at = new Date(instant);
  if (Number.isNaN(at.getTime())) throw new RangeError(`not an instant: ${instant}`);
  const parts = LOCAL_CLOCK.formatToParts(at);
  const get = (type: "hour" | "minute"): number => Number(parts.find((part) => part.type === type)?.value ?? "NaN");
  return get("hour") * 60 + get("minute");
}
