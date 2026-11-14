import type { components } from "@/api/schema";

/*
 * The mock API's rule planner, validator and acknowledgement items: a small, readable stand-in for B3's
 * `domain/planner` and `domain/validator` so the supervisor plan, try-a-plan and sign-off screens can be built and
 * tested end to end before the real API exists. It is NOT the product's rule engine. What it copies, and from where:
 *
 *  - the 5 minute tick, and the 04:00 to 22:00 local day grid (B3 plan, Global Constraints "Time");
 *  - ADOSH Table 1 cycles for heavy work: Medium zone 45 work / 15 rest, High zone 20 work / 40 rest; light work in
 *    the High zone 45 / 15 (ruleset section adosh_cycles, B3 Task 2); moderate uses the heavy column (ADR 0046 item 6);
 *    light work in the Medium zone has no listed cycle, so the heavy column is used (protective, as the design
 *    prototype's crews.js does until the reviewed table lands);
 *  - the rolling 60 minute cap: work minutes in any 12 tick window stay at or under the cap of the most severe zone
 *    worked in it (Low 60, Medium 45, High 20, Red 0);
 *  - the midday ban 12:30 to 15:00 local on 15 Jun to 15 Sep inclusive (ADR 0011, ruleset labour.ban_*);
 *  - Red stops all work; a missing zone (no forecast hour) is treated as High on every on-shift tick (ADR 0058);
 *  - the validator's rule ids and its own tick scan; rule semantics from B3 Task 6 (P-H1, P-H2.daily, P-H2.weekly,
 *    P-H3, P-H7.cap60, P-H7.run, STOP.red). The other B3 rules (juveniles, acclimatisation, lone work, P-H10) need
 *    inputs the mock has no use for and are not evaluated, so they are not in `checked_rules` either.
 *
 * Loaded by scripts/mock-api.ts under Node's type stripping: only `import type` uses the "@/" alias (it is erased),
 * relative imports end in ".ts", and there are no enums or parameter properties.
 */

type Schemas = components["schemas"];
type Zone = Schemas["Zone"];
type Level = Schemas["Level"];
type Workload = "light" | "moderate" | "heavy";
export type TickState = Schemas["PlanSegment"]["state"];

/** Asia/Dubai is UTC+4 all year. */
const DUBAI_UTC_OFFSET_MIN = 240;

export const TICK_MIN = 5;
export const GRID_START_MIN = 4 * 60;
export const GRID_END_MIN = 22 * 60;
export const TICK_COUNT = (GRID_END_MIN - GRID_START_MIN) / TICK_MIN;

export const BAN_START_MIN = 12 * 60 + 30;
export const BAN_END_MIN = 15 * 60;

const ART18_MAX_RUN_MIN = 5 * 60;
const ART18_BREAK_MIN = 60;
const NORMAL_HOURS_PER_DAY = 8;
const NORMAL_HOURS_PER_WEEK = 48;
const TOTAL_HOURS_PER_3_WEEKS = 144;
const MAX_ATTENDANCE_H = 10;

/** Local 15 Jun to 15 Sep inclusive, any year (the ruleset's ban_season, "MM-DD" strings compare in order). */
export function inBanSeason(date: string): boolean {
  const monthDay = date.slice(5);
  return monthDay >= "06-15" && monthDay <= "09-15";
}

/** The instant of local `minutes` after midnight on `date` (YYYY-MM-DD), ISO 8601 UTC without milliseconds. */
export function instantAt(date: string, minutes: number): string {
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
  const at = new Date(Date.UTC(year, month - 1, day, 0, minutes - DUBAI_UTC_OFFSET_MIN));
  return at.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function tickStart(tick: number): number {
  return GRID_START_MIN + tick * TICK_MIN;
}

export function zoneOfLevel(level: Level | null): Zone | null {
  if (level === null) return null;
  return { green: "low", amber: "medium", orange: "high", red: "red" }[level] as Zone;
}

export function levelOfZone(zone: Zone | null): Level | null {
  if (zone === null) return null;
  return { low: "green", medium: "amber", high: "orange", red: "red" }[zone] as Level;
}

const ZONE_RANK: Record<Zone, number> = { low: 0, medium: 1, high: 2, red: 3 };
const ZONE_WORD: Record<Zone, string> = { low: "Low", medium: "Medium", high: "High", red: "Red" };
const CAP60: Record<Zone, number> = { low: 60, medium: 45, high: 20, red: 0 };

/** [work, rest] minutes of the ADOSH cycle for `zone` and `workload`, or null where the zone has no cycle. */
export function cycleOf(zone: Zone, workload: Workload): [number, number] | null {
  if (zone === "medium") return [45, 15];
  if (zone === "high") return workload === "light" ? [45, 15] : [20, 40];
  return null;
}

/** The text code of the acknowledgement item for a zone (the ruleset's action code vocabulary). */
export function textCodeOf(zone: Zone, workload: Workload): string {
  const cycle = cycleOf(zone, workload);
  if (cycle === null) return "stop-work";
  const column = zone === "high" && workload === "light" ? "light" : "heavy";
  return `cycle.${zone}.${column}.${String(cycle[0])}-${String(cycle[1])}`;
}

// --- Clauses -------------------------------------------------------------------------------------------------------------

/** Source ids of the rules (B3 ruleset `[[sources]]`; the ids here are the mock's own). */
const SOURCE_OF: Record<string, string> = {
  "P-H1": "mohre-mr-44-2022-art-3",
  "P-H2.daily": "decree-law-33-2021-art-17",
  "P-H2.weekly": "decree-law-33-2021-art-17",
  "P-H3": "decree-law-33-2021-art-18",
  "P-H7.cap60": "adosh-guideline-table-1",
  "P-H7.run": "adosh-guideline-table-1",
  "STOP.red": "adr-0011-stop-work",
  "FALLBACK.high": "adr-0058-fallback",
  "P-H10": "published-shift",
};

const CLAUSE_OF: Record<string, string> = {
  "P-H1": "Work under direct sunlight and in open areas is prohibited daily from 12:30 pm until 3:00 pm, 15 June to 15 September (MoHRE MR 44/2022 Art. 3; 2026 release).",
  "P-H2.daily":
    "The maximum normal working hours for workers shall be (8) eight hours per day or (48) forty-eight hours per week (Decree-Law 33/2021 Art. 17(1)). Overtime is at most 2 hours per day, and total hours at most 144 in 3 weeks (Art. 19(1)).",
  "P-H2.weekly": "The maximum normal working hours for workers shall be (8) eight hours per day or (48) forty-eight hours per week (Decree-Law 33/2021 Art. 17(1)).",
  "P-H3":
    "The worker may not work for more than (5) five consecutive hours without a break or breaks of not less than an hour in total, provided that these periods are not included in the working hours (Decree-Law 33/2021 Art. 18). The ban window and ADOSH rest are not credited as the break (our reading, an open question).",
  "STOP.red": "All work stops while the level is Red (a policy edge beyond the ADOSH table, ADR 0011 section 2.6). A stop never waits for sign-off.",
  "FALLBACK.high": "No fresh forecast: every on-shift hour is planned as High (protective).",
  "P-H10": "Outside the published shift.",
};

function clauseFor(ruleId: string, zone: Zone | null, workload: Workload): string {
  if (ruleId === "P-H7.cap60" || ruleId === "P-H7.run") {
    if (zone === null || zone === "red") return "ADOSH Technical Guideline Table 1: work minutes in any hour stay under the cap of the most severe zone worked.";
    const cycle = cycleOf(zone, workload);
    if (cycle === null) return "ADOSH Technical Guideline Table 1, Low zone: self-paced work.";
    const heavy = workload === "light" && zone === "high" ? "light" : "heavy";
    return `ADOSH Technical Guideline Table 1, ${ZONE_WORD[zone]} zone, ${heavy} work: ${String(cycle[0])} work / ${String(cycle[1])} rest.`;
  }
  return CLAUSE_OF[ruleId] ?? "";
}

// --- The planner ---------------------------------------------------------------------------------------------------------

export interface CrewShape {
  workload: Workload;
  /** Published shift blocks as [start, end) minutes after local midnight. */
  shift: [number, number][];
}

export interface PlanInputs {
  /** The zone of each local hour 0..23, null where the forecast has no hour. */
  zoneOfHour: (Zone | null)[];
  inBan: boolean;
  /** Minutes [from, to) covered by a crew-lead stop, as a predicate on the tick's start minute. */
  stopped: (minute: number) => boolean;
}

function onShift(shift: [number, number][], minute: number): boolean {
  return shift.some(([from, to]) => minute >= from && minute < to);
}

function zoneAt(inputs: PlanInputs, minute: number): Zone | null {
  return inputs.zoneOfHour[Math.floor(minute / 60)] ?? null;
}

function inBanMinute(inputs: PlanInputs, minute: number): boolean {
  return inputs.inBan && minute >= BAN_START_MIN && minute < BAN_END_MIN;
}

/** The tick states and the zone each tick was planned under (the fallback High included). */
export interface TickPlan {
  states: TickState[];
  zones: (Zone | null)[];
}

export function planCrew(crew: CrewShape, inputs: PlanInputs): TickPlan {
  const states: TickState[] = [];
  const zones: (Zone | null)[] = [];
  let mode: "work" | "rest" = "work";
  let run = 0;
  const workZones: (Zone | null)[] = [];
  for (let tick = 0; tick < TICK_COUNT; tick++) {
    const minute = tickStart(tick);
    const raw = zoneAt(inputs, minute);
    // A missing hour is planned as High on every on-shift tick (ADR 0058).
    const zone: Zone | null = raw ?? (onShift(crew.shift, minute) ? "high" : null);
    zones.push(zone);
    const reset = () => {
      mode = "work";
      run = 0;
    };
    if (!onShift(crew.shift, minute)) {
      states.push("off");
      reset();
      workZones.push(null);
      continue;
    }
    if (inBanMinute(inputs, minute)) {
      states.push("ban");
      reset();
      workZones.push(null);
      continue;
    }
    if (inputs.stopped(minute) || zone === "red") {
      states.push("stopped");
      reset();
      workZones.push(null);
      continue;
    }
    const cycle = zone === null ? null : cycleOf(zone, crew.workload);
    if (cycle === null) {
      mode = "work";
      run += TICK_MIN;
    } else if (mode === "work" && run >= cycle[0]) {
      mode = "rest";
      run = 0;
    } else if (mode === "rest" && run >= cycle[1]) {
      mode = "work";
      run = 0;
    }
    if (mode === "work" && zone !== null) {
      // The rolling 60 minute cap: this tick plus the work in the 11 ticks before it.
      const window = workZones.slice(-11).filter((z): z is Zone => z !== null);
      const worst = [zone, ...window].reduce((a, b) => (ZONE_RANK[b] > ZONE_RANK[a] ? b : a));
      if ((window.length + 1) * TICK_MIN > CAP60[worst]) {
        mode = "rest";
        run = 0;
      }
    }
    if (cycle !== null && mode === "rest") {
      states.push("adosh_rest");
      workZones.push(null);
      run += TICK_MIN;
    } else if (cycle === null && mode === "rest") {
      // A cap forced rest in a zone with no cycle (Low after a Medium run): rest one tick at a time.
      states.push("adosh_rest");
      workZones.push(null);
      mode = "work";
    } else {
      states.push("work");
      workZones.push(zone);
      if (cycle !== null) run += TICK_MIN;
    }
  }
  return { states, zones };
}

// --- Segments ------------------------------------------------------------------------------------------------------------

const RULE_OF_STATE: Record<TickState, string> = {
  work: "P-H7.cap60",
  adosh_rest: "P-H7.run",
  art18_break: "P-H3",
  ban: "P-H1",
  stopped: "STOP.red",
  off: "P-H10",
};

export function segmentsOf(date: string, plan: TickPlan, crew: CrewShape, fallback: boolean): Schemas["PlanSegment"][] {
  const out: Schemas["PlanSegment"][] = [];
  let startTick = 0;
  // Time off and the ban carry no zone, so they merge across hours of different zones.
  const zoneOf = (tick: number): Zone | null => {
    const state = plan.states[tick];
    return state === "off" || state === "ban" ? null : (plan.zones[tick] ?? null);
  };
  const key = (tick: number) => `${plan.states[tick] ?? ""}|${zoneOf(tick) ?? ""}`;
  for (let tick = 1; tick <= TICK_COUNT; tick++) {
    if (tick < TICK_COUNT && key(tick) === key(startTick)) continue;
    const state = plan.states[startTick] ?? "off";
    const zone = zoneOf(startTick);
    const ruleId = fallback && state === "stopped" ? "FALLBACK.high" : RULE_OF_STATE[state];
    out.push({
      starts_at: instantAt(date, tickStart(startTick)),
      ends_at: instantAt(date, tickStart(tick)),
      state,
      zone,
      rule_id: ruleId,
      clause: clauseFor(ruleId, zone, crew.workload),
    });
    startTick = tick;
  }
  return out;
}

function hhmm(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}${String(minute % 60).padStart(2, "0")}`;
}

/**
 * The items that need a per-item acknowledgement before sign-off: one per run of consecutive ticks in the same zone
 * above Low in which the crew is asked to work, rest in a cycle, or stop (B3 Task 17 note 1). Ticks of ban and off time
 * end a run.
 */
export function ackItemsOf(date: string, plan: TickPlan, crew: CrewShape): Schemas["AckItem"][] {
  const counted = (tick: number): Exclude<Zone, "low"> | null => {
    const state = plan.states[tick];
    const zone = plan.zones[tick] ?? null;
    if (zone === null || zone === "low") return null;
    return state === "work" || state === "adosh_rest" || state === "stopped" ? zone : null;
  };
  const items: Schemas["AckItem"][] = [];
  let tick = 0;
  while (tick < TICK_COUNT) {
    const zone = counted(tick);
    if (zone === null) {
      tick += 1;
      continue;
    }
    const first = tick;
    while (tick < TICK_COUNT && counted(tick) === zone) tick += 1;
    items.push({
      id: `ack-${zone}-${hhmm(tickStart(first))}`,
      zone,
      starts_at: instantAt(date, tickStart(first)),
      ends_at: instantAt(date, tickStart(tick)),
      text_code: textCodeOf(zone, crew.workload),
    });
  }
  return items;
}

// --- The validator -------------------------------------------------------------------------------------------------------

export interface ValidatorInputs {
  /** The state of each tick of the grid, as planned or as typed. */
  states: TickState[];
  zones: (Zone | null)[];
  workload: Workload;
  daysPerWeek: number;
  inBan: boolean;
}

export const CHECKED_RULES = ["P-H1", "P-H2.daily", "P-H2.weekly", "P-H3", "P-H7.cap60", "P-H7.run", "STOP.red"];

function rangesOf(date: string, ticks: number[]): Schemas["TimeRange"][] {
  const ranges: Schemas["TimeRange"][] = [];
  let first = ticks[0];
  let previous = ticks[0];
  for (const tick of ticks.slice(1).concat([-1])) {
    if (first !== undefined && previous !== undefined && tick === previous + 1) {
      previous = tick;
      continue;
    }
    if (first !== undefined && previous !== undefined) {
      ranges.push({ starts_at: instantAt(date, tickStart(first)), ends_at: instantAt(date, tickStart(previous + 1)) });
    }
    first = tick;
    previous = tick;
  }
  return ranges;
}

function violation(date: string, ruleId: string, ticks: number[], detail: string, zone: Zone | null, workload: Workload): Schemas["Violation"] {
  return {
    rule_id: ruleId,
    clause: clauseFor(ruleId, zone, workload),
    source_id: SOURCE_OF[ruleId] ?? "",
    ranges: rangesOf(date, ticks),
    detail,
  };
}

function minutesText(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${String(hours)} h` : `${String(hours)} h ${String(rest)} min`;
}

/** An independent scan of the ticks: it shares with the planner only the zones and the cycle table. */
export function validate(date: string, input: ValidatorInputs): Schemas["ValidatorResult"] {
  const { states, zones, workload } = input;
  const violations: Schemas["Violation"][] = [];
  const stateAt = (tick: number): TickState => states[tick] ?? "off";
  const ticksWhere = (predicate: (tick: number) => boolean) => Array.from({ length: TICK_COUNT }, (_, tick) => tick).filter(predicate);

  // P-H1: work in a ban tick. A tick typed as work inside the ban stays work in the typed plan (the planner never does it).
  const banWork = ticksWhere((tick) => {
    const minute = tickStart(tick);
    return input.inBan && stateAt(tick) === "work" && minute >= BAN_START_MIN && minute < BAN_END_MIN;
  });
  if (banWork.length > 0) violations.push(violation(date, "P-H1", banWork, "Work inside the midday ban, 12:30 to 15:00.", null, workload));

  // STOP.red: work in a Red tick.
  const redWork = ticksWhere((tick) => stateAt(tick) === "work" && zones[tick] === "red");
  if (redWork.length > 0) violations.push(violation(date, "STOP.red", redWork, "Work while the level is Red.", "red", workload));

  // P-H7.cap60: a 12 tick window whose work exceeds the cap of the most severe zone worked in it.
  const capTicks = new Set<number>();
  for (let start = 0; start + 12 <= TICK_COUNT; start++) {
    const worked: number[] = [];
    for (let tick = start; tick < start + 12; tick++) if (stateAt(tick) === "work") worked.push(tick);
    if (worked.length === 0) continue;
    const worst = worked.map((tick) => zones[tick] ?? "high").reduce((a, b) => (ZONE_RANK[b] > ZONE_RANK[a] ? b : a));
    if (worked.length * TICK_MIN > CAP60[worst]) for (const tick of worked) capTicks.add(tick);
  }
  if (capTicks.size > 0) {
    const sorted = [...capTicks].sort((a, b) => a - b);
    const detail = "More work in an hour than the cap of the most severe zone worked in it.";
    violations.push(violation(date, "P-H7.cap60", sorted, detail, zones[sorted[0] ?? 0] ?? null, workload));
  }

  // P-H7.run: a work run longer than the cycle's work length of the strictest zone in the run.
  const runTicks: number[] = [];
  let tick = 0;
  while (tick < TICK_COUNT) {
    if (stateAt(tick) !== "work") {
      tick += 1;
      continue;
    }
    const first = tick;
    while (tick < TICK_COUNT && stateAt(tick) === "work") tick += 1;
    const lengths = Array.from({ length: tick - first }, (_, k) => {
      const zone = zones[first + k] ?? "high";
      return cycleOf(zone, workload)?.[0] ?? Number.POSITIVE_INFINITY;
    });
    if ((tick - first) * TICK_MIN > Math.min(...lengths)) for (let k = first; k < tick; k++) runTicks.push(k);
  }
  if (runTicks.length > 0) {
    violations.push(violation(date, "P-H7.run", runTicks, "A work run longer than the cycle's work length.", zones[runTicks[0] ?? 0] ?? null, workload));
  }

  // P-H3: an attendance run over 5 h without a credited 60 minute break. Ban and ADOSH rest are not credited.
  const attends = (t: number) => ["work", "adosh_rest", "stopped", "ban"].includes(stateAt(t));
  const inStretch = (t: number) => attends(t) || stateAt(t) === "art18_break";
  const longRuns: number[] = [];
  const flush = (from: number, to: number) => {
    if ((to - from) * TICK_MIN <= ART18_MAX_RUN_MIN) return;
    for (let k = from; k < to; k++) if (attends(k)) longRuns.push(k);
  };
  let cursor = 0;
  while (cursor < TICK_COUNT) {
    if (!inStretch(cursor)) {
      cursor += 1;
      continue;
    }
    // One stretch of attendance, split wherever a credited break of 60 minutes or more sits.
    let runStart = cursor;
    while (cursor < TICK_COUNT && inStretch(cursor)) {
      if (stateAt(cursor) !== "art18_break") {
        cursor += 1;
        continue;
      }
      let end = cursor;
      while (end < TICK_COUNT && stateAt(end) === "art18_break") end += 1;
      if ((end - cursor) * TICK_MIN >= ART18_BREAK_MIN) {
        flush(runStart, cursor);
        runStart = end;
      }
      cursor = end;
    }
    flush(runStart, cursor);
  }
  if (longRuns.length > 0) {
    violations.push(violation(date, "P-H3", longRuns, "More than 5 hours at work without a break of an hour.", null, workload));
  }

  // P-H2: attendance is work, ADOSH rest and stopped time, never the ban or an Art. 18 break.
  const attendance = ticksWhere((t) => ["work", "adosh_rest", "stopped"].includes(stateAt(t)));
  const attendanceMin = attendance.length * TICK_MIN;
  const attendanceH = attendanceMin / 60;
  const dayCap = input.daysPerWeek * 3 * attendanceH > TOTAL_HOURS_PER_3_WEEKS ? NORMAL_HOURS_PER_DAY : MAX_ATTENDANCE_H;
  if (attendanceH > dayCap) {
    const detail = `${minutesText(attendanceMin)} of attendance in the day; the limit is ${String(dayCap)} h.`;
    violations.push(violation(date, "P-H2.daily", attendance, detail, null, workload));
  }
  if (input.daysPerWeek * attendanceH > NORMAL_HOURS_PER_WEEK) {
    const detail = `${String(input.daysPerWeek)} days of ${minutesText(attendanceMin)} is over ${String(NORMAL_HOURS_PER_WEEK)} h a week.`;
    violations.push(violation(date, "P-H2.weekly", attendance, detail, null, workload));
  }

  violations.sort((a, b) => CHECKED_RULES.indexOf(a.rule_id) - CHECKED_RULES.indexOf(b.rule_id));
  return { passed: violations.length === 0, violations, checked_rules: [...CHECKED_RULES] };
}

// --- Typed rosters (try-a-plan) --------------------------------------------------------------------------------------------

export interface RosterSegment {
  line: number;
  start: number;
  end: number;
  state: "work" | "rest" | "break";
}

export interface RosterError {
  line: number;
  message: string;
}

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

function minuteOf(text: string): number | null {
  const match = TIME.exec(text);
  return match === null ? null : Number(match[1]) * 60 + Number(match[2]);
}

/** One segment per non-blank line `HH:MM-HH:MM work|rest|break`, `#` comments allowed (B3 Task 6 parse_roster). */
export function parseRoster(text: string): { segments: RosterSegment[] } | { errors: RosterError[] } {
  const segments: RosterSegment[] = [];
  const errors: RosterError[] = [];
  const lines = text.split(/\r?\n/);
  let used = 0;
  lines.forEach((raw, index) => {
    const line = index + 1;
    const content = (raw.split("#")[0] ?? "").trim();
    if (content === "") return;
    used += 1;
    const match = /^(\d{2}:\d{2})-(\d{2}:\d{2})\s+(\S+)$/.exec(content);
    if (match === null) {
      errors.push({ line, message: "Write each line as HH:MM-HH:MM work, rest or break." });
      return;
    }
    const start = minuteOf(match[1] ?? "");
    const end = minuteOf(match[2] ?? "");
    const state = (match[3] ?? "").toLowerCase();
    if (start === null || end === null) {
      errors.push({ line, message: "That is not a time of day." });
    } else if (state !== "work" && state !== "rest" && state !== "break") {
      errors.push({ line, message: "The state is work, rest or break." });
    } else if (start >= end) {
      errors.push({ line, message: "The start must be before the end." });
    } else if (start < GRID_START_MIN || end > GRID_END_MIN) {
      errors.push({ line, message: "Times are between 04:00 and 22:00." });
    } else {
      segments.push({ line, start, end, state });
    }
  });
  if (used > 40) errors.push({ line: 41, message: "At most 40 lines." });
  const sorted = [...segments].sort((a, b) => a.start - b.start);
  for (let k = 1; k < sorted.length; k++) {
    const previous = sorted[k - 1];
    const current = sorted[k];
    if (previous !== undefined && current !== undefined && current.start < previous.end) {
      errors.push({ line: current.line, message: "This segment overlaps the one before it." });
    }
  }
  return errors.length > 0 ? { errors } : { segments };
}

/** The ticks of a typed roster: uncovered ticks are off, ban ticks stay as typed so P-H1 can fire. */
export function ticksOfRoster(segments: RosterSegment[]): TickState[] {
  const mapped = { work: "work", rest: "adosh_rest", break: "art18_break" } as const;
  return Array.from({ length: TICK_COUNT }, (_, tick) => {
    const minute = tickStart(tick);
    const found = segments.find((segment) => minute >= segment.start && minute < segment.end);
    return found === undefined ? "off" : mapped[found.state];
  });
}
