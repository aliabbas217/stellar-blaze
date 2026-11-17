/*
 * "Where this number comes from": the plain-language story of a number, built from the STRUCTURED fields of its record (the
 * station, the season, the number of days, the policy, the metric, the interval) by fixed templates, never from the technical
 * record's strings (a path, a function name, a hash) and never from the scoring export's verbatim sentences. That is the
 * structural fix for a data-driven leak (docs/design/redesign-2026-11-17/02b-information-layers.md section 2): the story cannot
 * contain a file path because it is not built from one.
 *
 * Pure and framework-free. It returns message KEYS and their values, not sentences: the words live in the catalogue under
 * `states.proof.story.*` (Tier 2: English by design, like the rest of `states.proof.`), and `StoryRows` renders them. Every number in
 * a line is a value this function was given, formatted here; the unit tests render each family and assert that the numbers equal
 * their source fields (and, for the committed 2026 files, the submission ledger).
 */

/** A catalogue line: the key under `states.proof.story` and the values of its placeholders. */
export interface StoryLine {
  readonly key: string;
  readonly values?: Readonly<Record<string, string>>;
}

export type StoryRowId = "madeBy" | "about" | "howCounted" | "shows" | "doesNotShow";

export interface StoryRow {
  readonly id: StoryRowId;
  /** One or more sentences, in order. */
  readonly lines: readonly StoryLine[];
}

export interface ProofStory {
  readonly family: StoryFamily;
  readonly rows: readonly StoryRow[];
  /**
   * One plain sentence about what the number IS, for a number that is not a scored result (a count made from a recorded
   * forecast file, an analysis of recorded data, a map). `null` for a scored number: its test is told by the stamp and the
   * lock, never by a sentence that says "not scored".
   */
  readonly note: StoryLine | null;
}

/** An interval, already formatted by the caller exactly as the table cell shows it (same formatter, same scale). */
export interface StoryRange {
  readonly lo: string;
  readonly hi: string;
  readonly unit: "hours" | "minutes" | "share";
}

export type StoryFamily = "policy" | "plan" | "day" | "rule" | "forecast" | "frontier" | "level" | "truth" | "evaluation" | "verdict" | "field";

/** The season a scored file covers: the station code, its first and last day (ISO), and how many days were scored. */
export interface Season {
  /** The station's ICAO code (`OMAA`); it is turned into a name here and never printed. */
  readonly station: string;
  readonly seasonStart: string;
  readonly seasonEnd: string;
  readonly nDays: number;
}

export interface PolicyStoryParams extends Season {
  readonly policy: "P0" | "P1" | "P2" | "P3_protect" | "P3_balanced";
  readonly metric: "missed_danger_hours" | "false_alarm_hours" | "pod" | "far";
  readonly lead: 1 | 2;
  /** The heat margin the danger-hour definition assumes (W/m2), or null when the file has none. */
  readonly marginWm2: number | null;
  readonly range: StoryRange | null;
}

export interface PlanStoryParams extends Season {
  readonly plan: "naive" | "ban_only" | "rule_raw" | "rule_corrected" | "merged";
  readonly metric: "violation_minutes_per_season" | "high_cycled_share" | "missed_protection_ticks" | "rest_minutes_added_vs_naive";
  /** The simulated crew's size. */
  readonly headcount: number;
  readonly range: StoryRange | null;
}

export interface DayStoryParams {
  readonly id: "high" | "outside" | "p1" | "raw" | "ours" | "balanced";
  readonly station: string;
  /** The scored day, ISO. */
  readonly date: string;
  /** The hours this counter counts (a count, possibly with a fraction from a partly banned hour). */
  readonly n: number;
  /** The hours the station recorded in the High or Red zone that day, for the three "warned" counters. */
  readonly total: number | null;
  readonly candidates: number | null;
  /** The midday break, site-local HH:MM. */
  readonly breakStart: string;
  readonly breakEnd: string;
}

export interface RuleStoryParams {
  readonly station: string;
  /** The picked day (ISO) and the number of candidate days, or null while no day has been scored. */
  readonly date: string | null;
  readonly candidates: number | null;
}

export interface ForecastStoryParams {
  readonly id: "days_over_limit" | "hours_over_limit" | "hours_in_break";
  readonly station: string;
  /** First and last day of the recorded forecast (ISO) and how many days it has. */
  readonly firstDay: string;
  readonly lastDay: string;
  readonly nDays: number;
  /** The heavy-work limit, degrees C WBGT. */
  readonly limit: number;
  readonly breakStart: string;
  readonly breakEnd: string;
}

export interface FrontierStoryParams {
  readonly id: "best" | "legalisation";
  /** The one-way commute of a `best` claim, in minutes. */
  readonly commuteMinutes: number | null;
  /** The least sleep a roster may leave, hours. */
  readonly sleepGateHours: number;
}

/** A worker's level story has no parameters: it says what a level is, never which site or which forecast (the stamp says "demo site"). */
export type LevelStoryParams = Readonly<Record<string, never>>;

export interface TruthStoryParams extends Season {
  readonly marginWm2: number | null;
  readonly range: StoryRange | null;
}

export interface EvaluationStoryParams extends Season {
  /** How many amendments the held-out run lists, or null when there is no record of the run. */
  readonly amendments: number | null;
}

export type VerdictStoryParams = Season;

export interface FieldStoryParams {
  /** The day the map shows, ISO. */
  readonly day: string;
}

export interface StoryParamsMap {
  readonly policy: PolicyStoryParams;
  readonly plan: PlanStoryParams;
  readonly day: DayStoryParams;
  readonly rule: RuleStoryParams;
  readonly forecast: ForecastStoryParams;
  readonly frontier: FrontierStoryParams;
  readonly level: LevelStoryParams;
  readonly truth: TruthStoryParams;
  readonly evaluation: EvaluationStoryParams;
  readonly verdict: VerdictStoryParams;
  readonly field: FieldStoryParams;
}

// ---- formatting: English, Western digits, no locale (the claims surfaces are English by design) ----

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})/;

function dayParts(iso: string): { year: string; month: string; day: string } {
  const match = ISO_DAY.exec(iso);
  const year = match?.[1];
  const month = MONTHS[Number(match?.[2]) - 1];
  if (match === null || year === undefined || month === undefined) throw new RangeError(`not an ISO date: ${iso}`);
  return { year, month, day: String(Number(match[3])) };
}

/** "14 June 2026". */
export function longDate(iso: string): string {
  const { year, month, day } = dayParts(iso);
  return `${day} ${month} ${year}`;
}

/** "15 May to 30 September 2026" (the year once when both ends share it). */
export function period(startIso: string, endIso: string): string {
  const a = dayParts(startIso);
  const b = dayParts(endIso);
  return a.year === b.year ? `${a.day} ${a.month} to ${b.day} ${b.month} ${b.year}` : `${longDate(startIso)} to ${longDate(endIso)}`;
}

/** The station's plain name. A code is never printed: an unknown station is "the weather station". */
export function stationName(code: string): string {
  return code.trim().toUpperCase().startsWith("OMAA") ? "Abu Dhabi airport" : "the weather station";
}

const count = (value: number): string => (Number.isInteger(value) ? String(value) : value.toFixed(1));

function seasonValues(s: Season): Record<string, string> {
  return { station: stationName(s.station), period: period(s.seasonStart, s.seasonEnd), nDays: String(s.nDays) };
}

const rangeLine = (range: StoryRange | null): StoryLine[] => (range === null ? [] : [{ key: `range.${range.unit}`, values: { lo: range.lo, hi: range.hi } }]);

const line = (key: string, values?: Record<string, string>): StoryLine => (values === undefined ? { key } : { key, values });
const row = (id: StoryRowId, ...lines: StoryLine[]): StoryRow => ({ id, lines });

// ---- the families ----

function policyStory(p: PolicyStoryParams): ProofStory {
  const forecastTiming = p.policy === "P0" ? [] : [line(`policy.lead.${String(p.lead)}`)];
  return {
    family: "policy",
    rows: [
      row("madeBy", line(`policy.madeBy.${p.policy}`), ...forecastTiming),
      row("about", line("seasonAbout", seasonValues(p))),
      row("howCounted", line(`policy.howCounted.${p.metric}`)),
      row("shows", line(`policy.shows.${p.metric}`), ...rangeLine(p.range)),
      row("doesNotShow", p.marginWm2 === null ? line("policy.doesNotShow") : line("policy.doesNotShowMargin", { margin: count(p.marginWm2) })),
    ],
    note: null,
  };
}

function planStory(p: PlanStoryParams): ProofStory {
  const made = p.plan === "rule_raw" ? "rule_raw" : p.plan === "rule_corrected" ? "rule_corrected" : "baseline";
  return {
    family: "plan",
    rows: [
      row("madeBy", line(`plan.madeBy.${made}`)),
      row("about", line("plan.about", { ...seasonValues(p), headcount: String(p.headcount) })),
      row("howCounted", line(`plan.howCounted.${p.metric}`)),
      row("shows", line(`plan.shows.${p.metric}`), ...rangeLine(p.range)),
      row("doesNotShow", line("plan.doesNotShow")),
    ],
    note: null,
  };
}

function dayStory(p: DayStoryParams): ProofStory {
  const warned = p.id === "p1" || p.id === "raw" || p.id === "ours" || p.id === "balanced";
  const total = p.total === null ? null : count(p.total);
  const stationAndDate = { station: stationName(p.station), date: longDate(p.date) };
  const about =
    p.candidates === null ? line("day.aboutOne", stationAndDate) : line("day.about", { ...stationAndDate, candidates: String(p.candidates) });
  const howCounted = warned
    ? line("day.howCounted.warned", { total: total ?? count(p.n) })
    : p.id === "outside"
      ? line("day.howCounted.outside", { start: p.breakStart, end: p.breakEnd })
      : line("day.howCounted.high");
  const shows = warned ? line("day.shows.warned", { n: count(p.n), total: total ?? count(p.n) }) : line("day.shows.high");
  return {
    family: "day",
    rows: [row("madeBy", line(`day.madeBy.${p.id}`)), row("about", about), row("howCounted", howCounted), row("shows", shows), row("doesNotShow", line("day.doesNotShow"))],
    note: null,
  };
}

function ruleStory(p: RuleStoryParams): ProofStory {
  const station = stationName(p.station);
  const about =
    p.date === null || p.candidates === null
      ? line("rule.aboutPending", { station })
      : line("rule.about", { station, date: longDate(p.date), candidates: String(p.candidates) });
  return {
    family: "rule",
    rows: [row("madeBy", line("rule.madeBy")), row("about", about), row("howCounted", line("rule.howCounted")), row("shows", line("rule.shows")), row("doesNotShow", line("rule.doesNotShow"))],
    note: null,
  };
}

function forecastStory(p: ForecastStoryParams): ProofStory {
  const limit = String(p.limit);
  const howCounted =
    p.id === "hours_in_break"
      ? line("forecast.howCounted.hours_in_break", { limit, start: p.breakStart, end: p.breakEnd })
      : line(`forecast.howCounted.${p.id}`, { limit });
  return {
    family: "forecast",
    rows: [
      row("madeBy", line("forecast.madeBy")),
      row("about", line("seasonAbout", { station: stationName(p.station), period: period(p.firstDay, p.lastDay), nDays: String(p.nDays) })),
      row("howCounted", howCounted),
      row("shows", line("forecast.shows")),
      row("doesNotShow", line("forecast.doesNotShow")),
    ],
    note: line("note.recordedCount"),
  };
}

function frontierStory(p: FrontierStoryParams): ProofStory {
  const best = p.id === "best";
  return {
    family: "frontier",
    rows: [
      row("madeBy", line("frontier.madeBy")),
      row("about", p.commuteMinutes === null ? line("frontier.aboutLegal") : line("frontier.about", { minutes: String(p.commuteMinutes) })),
      row("howCounted", best ? line("frontier.howCounted.best", { gate: count(p.sleepGateHours) }) : line("frontier.howCounted.legal")),
      row("shows", line(best ? "frontier.shows.best" : "frontier.shows.legal")),
      row("doesNotShow", line("frontier.doesNotShow")),
    ],
    note: line("note.analysis"),
  };
}

function levelStory(): ProofStory {
  return {
    family: "level",
    rows: [
      row("madeBy", line("level.madeBy")),
      row("about", line("level.about")),
      row("doesNotShow", line("level.doesNotShow")),
    ],
    note: null,
  };
}

function truthStory(p: TruthStoryParams): ProofStory {
  return {
    family: "truth",
    rows: [
      row("madeBy", line("truth.madeBy", { station: stationName(p.station) })),
      row("about", line("seasonAbout", seasonValues(p))),
      row("howCounted", p.marginWm2 === null ? line("truth.howCounted") : line("truth.howCountedMargin", { margin: count(p.marginWm2) })),
      row("shows", line("truth.shows"), ...rangeLine(p.range)),
      row("doesNotShow", line("truth.doesNotShow")),
    ],
    note: null,
  };
}

function evaluationStory(p: EvaluationStoryParams): ProofStory {
  const changes = p.amendments === null || p.amendments === 0 ? [] : [line("evaluation.amendments", { amendments: String(p.amendments) })];
  return {
    family: "evaluation",
    rows: [
      row("madeBy", line("evaluation.madeBy")),
      row("about", line("seasonAbout", seasonValues(p))),
      row("howCounted", line("evaluation.howCounted"), ...changes),
      row("shows", line("evaluation.shows")),
      row("doesNotShow", line("evaluation.doesNotShow")),
    ],
    note: null,
  };
}

function verdictStory(p: VerdictStoryParams): ProofStory {
  return {
    family: "verdict",
    rows: [
      row("madeBy", line("verdict.madeBy")),
      row("about", line("seasonAbout", seasonValues(p))),
      row("howCounted", line("verdict.howCounted")),
      row("shows", line("verdict.shows")),
      row("doesNotShow", line("verdict.doesNotShow")),
    ],
    note: null,
  };
}

function fieldStory(p: FieldStoryParams): ProofStory {
  return {
    family: "field",
    rows: [
      row("madeBy", line("field.madeBy")),
      row("about", line("field.about", { date: longDate(p.day) })),
      row("shows", line("field.shows")),
      row("doesNotShow", line("field.doesNotShow")),
    ],
    note: line("note.map"),
  };
}

/**
 * The story of a number of `family`, from its structured `params`. Total: every family returns a story with a "madeBy" and a
 * "doesNotShow" row (the limit is mandatory, never empty). Throws a RangeError for a date that is not ISO: a caller that passes a
 * display string is a bug, and a wrong date in a proof is worse than a failed render.
 */
export function buildStory<F extends StoryFamily>(family: F, params: StoryParamsMap[F]): ProofStory {
  // The union is narrowed by `family`; the cast per branch keeps the public signature exact without a second dispatch table.
  switch (family) {
    case "policy":
      return policyStory(params as PolicyStoryParams);
    case "plan":
      return planStory(params as PlanStoryParams);
    case "day":
      return dayStory(params as DayStoryParams);
    case "rule":
      return ruleStory(params as RuleStoryParams);
    case "forecast":
      return forecastStory(params as ForecastStoryParams);
    case "frontier":
      return frontierStory(params as FrontierStoryParams);
    case "level":
      return levelStory();
    case "truth":
      return truthStory(params as TruthStoryParams);
    case "evaluation":
      return evaluationStory(params as EvaluationStoryParams);
    case "verdict":
      return verdictStory(params as VerdictStoryParams);
    case "field":
      return fieldStory(params as FieldStoryParams);
  }
}
