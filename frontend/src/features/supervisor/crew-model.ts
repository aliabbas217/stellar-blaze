import type { components } from "@/api/schema";
import { levelIndex, type Level } from "@/components/level/level";
import { localDate, hourOfDay } from "@/lib/time/zone";
import { replayInstant } from "@/lib/time/clock";

/*
 * The crews screen's model, pure (F2 Task 19): the crews of the site, each with its level now, whether it is working, when
 * that holds until, and an hour-by-hour strip, ranked worst first. Nothing here reads a clock or a locale: `now` and the
 * site's zone are inputs, and every label is a message the view fills.
 *
 * A crew's level is the API's `crew_level` (the site level raised to red by a stop). It carries no member data, so a
 * k-suppressed crew keeps it; what suppression hides (the restricted head count, the restrictions) is never read here.
 */

type Crew = components["schemas"]["Crew"];
type CrewTimeline = components["schemas"]["CrewTimeline"];
type DayPlan = components["schemas"]["DayPlan"];

const HOUR_MS = 60 * 60 * 1000;

export interface CrewCell {
  /** Hour of the site's day, 6 for 06:00 to 07:00. */
  readonly hour: number;
  readonly level: Level | null;
  /** The middle of the hour is inside a shift block: only shift hours are drawn. */
  readonly onShift: boolean;
}

/** The work and rest minutes of the crew's next cycle, read from its plan's own segments (never from a table here). */
export interface CrewCycle {
  readonly workMinutes: number;
  readonly restMinutes: number;
}

export interface CrewStripModel {
  readonly crew: Crew;
  /** The level that matters now: the current hour's while working or stopped, the first shift hour's while off. Null: no data. */
  readonly level: Level | null;
  /** On shift now and not stopped. */
  readonly working: boolean;
  /** ISO instant the current level holds until (the end of the run, held inside the shift block); null when not working. */
  readonly until: string | null;
  /** ISO instant the crew's next shift block starts; null when it is working, or has none left today. */
  readonly startsAt: string | null;
  readonly planState: "signed" | "unsigned" | "changed";
  /** Fewer than k people: level and strip are shown, nothing member-derived is. */
  readonly suppressed: boolean;
  readonly cells: readonly CrewCell[];
  /** A crew-lead stop is active (the API's `stopped`), and when it was recorded. */
  readonly stopped: boolean;
  readonly stoppedAt: string | null;
  readonly cycle: CrewCycle | null;
  /** The sort key: level index times 10, plus one when working. */
  readonly rank: number;
}

/** The sentence-level reading of a crew's sign-off state. */
function planStateOf(state: Crew["signoff_state"]): CrewStripModel["planState"] {
  return state === "changed_since_signed" ? "changed" : state;
}

interface Range {
  readonly from: number;
  readonly to: number;
}

/** The crew's shift blocks as UTC instants: the timeline's own when it has them, else the list's site-local blocks on today's date. */
function shiftRanges(crew: Crew, timeline: CrewTimeline | undefined, now: Date, zone: string): Range[] {
  if (timeline !== undefined) {
    return timeline.shift.map((range) => ({ from: Date.parse(range.starts_at), to: Date.parse(range.ends_at) })).filter((range) => range.to > range.from);
  }
  const date = localDate(now, zone);
  return crew.shift
    .map((block) => ({ from: replayInstant(date, block.start, zone).getTime(), to: replayInstant(date, block.end, zone).getTime() }))
    .filter((range) => range.to > range.from);
}

/**
 * The work and rest minutes of the cycle the crew is in, or next goes into. The zone of the first run of `work` or `adosh_rest`
 * that has not ended (a ban or an off run is skipped) names the cycle; the cycle is the nearest `work` run directly followed by
 * an `adosh_rest` run in that same zone, at or after now, else the last one before it. A rest run takes the zone of the hour it
 * falls in, so a work run's own rest can sit in the next zone: a pair across two zones is not a cycle of either.
 *
 * Null when that run is not in a cycle zone (a low-zone day is self-paced work: the plan states no cycle) or the plan has no such
 * pair. Minutes of the segments themselves: no table is read here.
 */
export function cycleOf(plan: DayPlan, nowMs: number): CrewCycle | null {
  const segments = plan.segments;
  const current = segments.find((segment) => (segment.state === "work" || segment.state === "adosh_rest") && Date.parse(segment.ends_at) > nowMs);
  const zone = current?.zone;
  if (zone !== "medium" && zone !== "high") return null;

  const pairs: CrewCycle[] = [];
  const after: boolean[] = [];
  for (let index = 0; index + 1 < segments.length; index += 1) {
    const work = segments[index];
    const rest = segments[index + 1];
    if (work === undefined || rest === undefined) continue;
    if (work.state !== "work" || rest.state !== "adosh_rest" || work.ends_at !== rest.starts_at || work.zone !== zone || rest.zone !== zone) continue;
    pairs.push({
      workMinutes: Math.round((Date.parse(work.ends_at) - Date.parse(work.starts_at)) / 60_000),
      restMinutes: Math.round((Date.parse(rest.ends_at) - Date.parse(rest.starts_at)) / 60_000),
    });
    after.push(Date.parse(rest.ends_at) > nowMs);
  }
  const next = after.indexOf(true);
  return pairs[next === -1 ? pairs.length - 1 : next] ?? null;
}

function buildOne(
  crew: Crew,
  timeline: CrewTimeline | undefined,
  plan: DayPlan | undefined,
  now: Date,
  zone: string,
): CrewStripModel {
  const nowMs = now.getTime();
  const ranges = shiftRanges(crew, timeline, now, zone);
  const levelAt = new Map<number, Level | null>((timeline?.hours ?? []).map((hour) => [Date.parse(hour.starts_at), hour.crew_level]));
  const starts = [...levelAt.keys()].sort((a, b) => a - b);
  // The API's own hour containing `ms` (its `starts_at`), whatever the zone's offset: never a guess from the clock's arithmetic.
  const hourStart = (ms: number): number | null => starts.find((start) => start <= ms && ms < start + HOUR_MS) ?? null;
  const levelOf = (ms: number): Level | null => {
    const start = hourStart(ms);
    return start === null ? null : (levelAt.get(start) ?? null);
  };

  const block = ranges.find((range) => range.from <= nowMs && nowMs < range.to);
  const working = block !== undefined && !crew.stopped;
  const next = ranges.filter((range) => range.from > nowMs).sort((a, b) => a.from - b.from)[0];

  let level: Level | null;
  let until: string | null = null;
  let startsAt: string | null = null;
  if (working || crew.stopped) {
    level = levelOf(nowMs);
    const current = hourStart(nowMs);
    if (working && level !== null && current !== null) {
      // The run: the following hours at the same level, held inside the shift block.
      let end = current + HOUR_MS;
      while (levelAt.get(end) === level && end < block.to) end += HOUR_MS;
      until = new Date(Math.min(end, block.to)).toISOString();
    }
  } else {
    level = next === undefined ? null : levelOf(next.from);
    startsAt = next === undefined ? null : new Date(next.from).toISOString();
  }

  const cells: CrewCell[] = starts.map((ms) => {
    const middle = ms + HOUR_MS / 2;
    return {
      hour: Math.floor(hourOfDay(new Date(ms), zone)),
      level: levelAt.get(ms) ?? null,
      onShift: ranges.some((range) => range.from <= middle && middle < range.to),
    };
  });

  return {
    crew,
    level,
    working,
    until,
    startsAt,
    planState: planStateOf(crew.signoff_state),
    suppressed: timeline?.suppressed ?? false,
    cells,
    stopped: crew.stopped,
    stoppedAt: crew.stopped_at,
    cycle: plan === undefined ? null : cycleOf(plan, nowMs),
    rank: (level === null ? 0 : levelIndex(level)) * 10 + (working ? 1 : 0),
  };
}

/**
 * The crews of the site as strip models, worst first: rank is the level index times 10 plus one when the crew is working,
 * so a working Orange crew outranks an Orange crew that is off shift, and any Red outranks any Orange. A crew with no level
 * (no timeline yet, or a fallback day) ranks last. Equal ranks keep the order the API listed them in.
 */
export function buildCrewModels(
  crews: readonly Crew[],
  timelines: Readonly<Record<string, CrewTimeline | undefined>>,
  dayPlans: Readonly<Record<string, DayPlan | undefined>> | undefined,
  now: Date,
  zone: string,
): CrewStripModel[] {
  const models = crews.map((crew) => buildOne(crew, timelines[crew.id], dayPlans?.[crew.id], now, zone));
  // Array.prototype.sort is stable: equal ranks keep the API's order.
  return models.sort((a, b) => b.rank - a.rank);
}
