import type { components } from "@/api/schema";

/*
 * CANNED, SIMULATED data behind the mock API (ADR 0057): a synthetic yard, four crews that exist only in the crew
 * fixture, and one recorded forecast day. Typed from the generated schema (the real B3 v1 contract, openapi/
 * stellar-blaze.openapi.json), so `pnpm typecheck` fails when this file drifts from the contract.
 *
 * Nothing here is a rule engine. Day plans and validator answers are written out by hand; they are NOT what the
 * product's planner or validator would say, and every response carries `model_id: "mock"` (or `policy_version:
 * "mock-0"`) so a screen can show it is simulated. Where the contract's own text or examples give a clause, a rule id
 * or a source id, that text is used verbatim; where the contract gives none, the clause is empty and the id is left
 * as the contract names it (the gaps are listed in the Task 2 report).
 *
 * The forecast day is the design replay day, Thu 3 Sep 2026 at Asia/Dubai (UTC+4, no daylight saving), inside the
 * midday-ban season. The hourly WBGT numbers are REAL: the Open-Meteo ECMWF IFS 0.25 day-1 forecast ("issued the day
 * before") at OMAA with Liljegren WBGT, copied from docs/design/v2/prototype/data/omaa_2026_ifs_d1_wbgt_hourly.json,
 * entry "2026-09-03". The LEVELS are a documented placeholder, not the product rule (B3 derives them from the ADOSH
 * zone of the effective TWL, ADR 0046): the design prototype's heavy-work band on WBGT p50 (assets/crews.js,
 * BANDS.heavy), amber from 30, orange from 34, red from 39 degrees C, for the site and every crew alike. The 5 % and
 * 95 % quantiles are p50 minus and plus 2 degrees C, a placeholder spread.
 *
 * The mock serves this one day for any requested date, re-dated; the ban window follows the requested date, so a
 * November date has none. Nothing here claims to be a forecast for that date.
 *
 * State: crew stops, plan sign-offs, the demo epoch and the transparency log live in memory of the process that
 * imports this module (Vitest: one file; `pnpm mock:api`: the server). `resetDemoState()` is what reset_demo_site calls.
 *
 * Loaded by scripts/mock-api.ts under Node's type stripping: only `import type` from the "@/" alias (it is erased),
 * relative imports end in ".ts", and no enums or parameter properties.
 */

type Schemas = components["schemas"];
type Level = Schemas["AlertLevel"];
type Zone = Schemas["PlanZone"];
type State = Schemas["PlanState"];
type Workload = Schemas["Crew"]["workload"];
export type ForecastStatus = Schemas["SiteForecastToday"]["forecast_status"];

export const SITE_DEMO = "site-demo-mussafah";
export const SITE_EMPTY = "site-demo-empty";
export const REPLAY_DATE = "2026-09-03";
export const FIXTURE_DATE = REPLAY_DATE;

export const MOCK_MODEL_ID = "mock";
export const MOCK_POLICY_VERSION = "mock-0";
export const MOCK_CONFIG_VERSION = 1;

/** Asia/Dubai is UTC+4 all year. */
const DUBAI_UTC_OFFSET_MIN = 240;

/** The instant of local `minutes` after midnight on `date` (YYYY-MM-DD), ISO 8601 UTC without milliseconds. */
export function instantAt(date: string, minutes: number): string {
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 0, minutes - DUBAI_UTC_OFFSET_MIN)).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function minutesOf(hhmm: string): number {
  const [hours = 0, minutes = 0] = hhmm.split(":").map(Number);
  return hours * 60 + minutes;
}

function clock(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** The replay clock: the API date at 11:10 Asia/Dubai (the F2 plan's demo clock). */
export const REPLAY_INSTANT = instantAt(REPLAY_DATE, minutesOf("11:10"));

// --- The ban window --------------------------------------------------------------------------------------------------------

const BAN_START = "12:30";
const BAN_END = "15:00";
const SEASON_START = "06-15";
const SEASON_END = "09-15";

/** Local 15 Jun to 15 Sep inclusive, any year ("MM-DD" strings compare in order). */
function inBanSeason(date: string): boolean {
  const monthDay = date.slice(5);
  return monthDay >= SEASON_START && monthDay <= SEASON_END;
}

/** The ban window of `date`: always an object; its instants are null when the ban is not in force that day. */
export function banWindow(date: string): Schemas["BanWindow"] {
  const active = inBanSeason(date);
  return {
    start: BAN_START,
    end: BAN_END,
    season_start: SEASON_START,
    season_end: SEASON_END,
    timezone: "Asia/Dubai",
    active_on_date: active,
    starts_at: active ? instantAt(date, minutesOf(BAN_START)) : null,
    ends_at: active ? instantAt(date, minutesOf(BAN_END)) : null,
  };
}

// --- The forecast ----------------------------------------------------------------------------------------------------------

/** WBGT in degrees C at local hour 0 to 23 on 2026-09-03 (REAL, see the header). */
const REPLAY_WBGT_C_BY_LOCAL_HOUR = [
  30.6, 30.3, 29.5, 28.4, 27.6, 27.4, 27.5, 28.7, 31, 33, 34.5, 35.4, 35.8, 36.7, 39.4, 35.9, 34.6, 33.5, 32.5, 31.4, 31, 30.9, 30.7, 30.4,
];

/** The forecast covers 06:00 to 19:00 local, 14 hours (B3 Task 10, `get_site_forecast_today`). */
const FIRST_HOUR = 6;
const LAST_HOUR = 19;
const SPREAD_C = 2;
const HOURS = Array.from({ length: LAST_HOUR - FIRST_HOUR + 1 }, (_, index) => FIRST_HOUR + index);

/** The placeholder level rule (see the header): lower bounds of amber, orange and red on WBGT p50. */
const LEVEL_BOUNDS_C = [30, 34, 39] as const;
const LEVELS: Level[] = ["green", "amber", "orange", "red"];
const ZONE_OF_LEVEL: Record<Level, Zone> = { green: "low", amber: "medium", orange: "high", red: "red" };

export function placeholderLevel(wbgtC: number): Level {
  return LEVELS[LEVEL_BOUNDS_C.filter((bound) => wbgtC >= bound).length] ?? "green";
}

function wbgtAt(hour: number): number {
  return REPLAY_WBGT_C_BY_LOCAL_HOUR[hour] ?? Number.NaN;
}

function hourLevel(hour: number, fallback: boolean): Level | null {
  return fallback ? null : placeholderLevel(wbgtAt(hour));
}

/** True for an hour that overlaps the ban: 12:00 only in part (12:30), 13:00 and 14:00 wholly. */
function banActive(date: string, hour: number): boolean {
  return inBanSeason(date) && (hour + 1) * 60 > minutesOf(BAN_START) && hour * 60 < minutesOf(BAN_END);
}

function hourForecast(date: string, hour: number, fallback: boolean): Schemas["HourForecast"] {
  const p50 = wbgtAt(hour);
  return {
    starts_at: instantAt(date, hour * 60),
    wbgt_c: fallback ? { p05: null, p50: null, p95: null } : { p05: p50 - SPREAD_C, p50, p95: p50 + SPREAD_C },
    site_level: hourLevel(hour, fallback),
    // The backend ruleset owns the codes and none exists yet (ADR 0009).
    action_codes: [],
    ban_active: banActive(date, hour),
  };
}

export const FRESH_AGE_MS = 10 * 60 * 1000;
export const STALE_AGE_MS = 26 * 60 * 60 * 1000;

/** A date written YYYY-MM-DD that is a real calendar date ("2026-02-30" is not one). */
export function isIsoDate(value: string | null): value is string {
  if (value === null || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  // Round-tripping catches a day that overflows its month ("2026-02-30" parses as 2 March).
  return !Number.isNaN(time) && new Date(time).toISOString().startsWith(value);
}

export interface ForecastOptions {
  ageMs?: number;
  now?: Date;
  date?: string;
  status?: ForecastStatus;
}

/** The forecast of `siteId`, generated `ageMs` before `now`. Unknown site: undefined. */
export function forecastToday(
  siteId: string,
  { ageMs = FRESH_AGE_MS, now = new Date(), date = REPLAY_DATE, status }: ForecastOptions = {},
): Schemas["SiteForecastToday"] | undefined {
  if (!sites.some((site) => site.id === siteId)) return undefined;
  const forecastStatus: ForecastStatus = status ?? (ageMs >= STALE_AGE_MS ? "stale" : "fresh");
  return {
    site_id: siteId,
    date,
    generated_at: new Date(now.getTime() - ageMs).toISOString(),
    policy_version: MOCK_POLICY_VERSION,
    config_version: MOCK_CONFIG_VERSION,
    mode: "replay",
    forecast_status: forecastStatus,
    model_id: MOCK_MODEL_ID,
    lead_days: 1,
    ban_window: banWindow(date),
    hours: HOURS.map((hour) => hourForecast(date, hour, forecastStatus === "fallback")),
  };
}

export const riskPolicy: Schemas["RiskPolicy"] = {
  version: MOCK_POLICY_VERSION,
  config_version: MOCK_CONFIG_VERSION,
  k_suppression: 5,
  k_health: 10,
  // The placeholder: Task 9's on-device tests count 10 days since heat-work start as acclimatised and 2 days as not.
  acclimatisation_days_required: 7,
  // Placeholders until the real API's cut-offs arrive (ADR 0049: 0.10, 0.50, 0.90); F1's vectors are pinned to these.
  bands: [
    { level: "green", min_exceedance_probability: 0 },
    { level: "amber", min_exceedance_probability: 0.1 },
    { level: "orange", min_exceedance_probability: 0.3 },
    { level: "red", min_exceedance_probability: 0.6 },
  ],
  // ADR 0006 test-vector metabolic rates.
  workload_classes: [
    { code: "light", metabolic_rate_w: 180 },
    { code: "moderate", metabolic_rate_w: 300 },
    { code: "heavy", metabolic_rate_w: 415 },
  ],
  // The other clothing classes wait for B3's NIOSH Table 3-2 values (ADR 0006); the frontend invents none.
  clothing_options: [{ code: "work_clothes", adjustment_c: 0, source: "baseline" }],
};

// --- Stateful in-memory rows -----------------------------------------------------------------------------------------------

type SignoffState = Schemas["Crew"]["signoff_state"];

interface StopRow {
  id: string;
  crewId: string;
  startedAt: string;
  clearedAt: string | null;
}

interface LogRow {
  siteId: string;
  epoch: number;
  entry: Schemas["TransparencyEntry"];
}

const SEED_SIGNED_AT = instantAt(REPLAY_DATE, minutesOf("05:40"));

let stops: StopRow[] = [];
let log: LogRow[] = [];
let epoch = 1;
/** Monotonic across demo resets, so a stop id never repeats and an old undo cannot clear a newer stop. */
let stopCounter = 0;

// --- Sites -----------------------------------------------------------------------------------------------------------------

const SITE_SEEDS: Omit<Schemas["Site"], "epoch_id">[] = [
  {
    id: SITE_DEMO,
    name: "Mussafah M-14 yard (synthetic)",
    timezone: "Asia/Dubai",
    synthetic: true,
    // SYNTHETIC numbers: the contract's own examples (+1 202 555 01xx is reserved for fiction).
    supervisor_phone: "+12025550143",
    first_aider_phone: "+12025550144",
  },
  {
    id: SITE_EMPTY,
    name: "Demo yard B (synthetic, no crews)",
    timezone: "Asia/Dubai",
    synthetic: true,
    supervisor_phone: null,
    first_aider_phone: null,
  },
];

/** The sites as the API lists them now (the epoch of a synthetic site is the current demo epoch). */
export function listSites(): Schemas["Site"][] {
  return SITE_SEEDS.map((seed) => ({ ...seed, epoch_id: seed.synthetic ? epoch : null }));
}

/** The site ids and whether each is synthetic, for membership checks that must not depend on the epoch. */
export const sites: { id: string; synthetic: boolean }[] = SITE_SEEDS.map(({ id, synthetic }) => ({ id, synthetic }));

// --- Crews (ADR 0057, the crew fixture) -------------------------------------------------------------------------------------

interface CrewSeed {
  id: string;
  name: string;
  task_label: string;
  workload: Workload;
  member_count: number;
  /** Members limited by acclimatisation or a return from absence (member-derived: hidden when suppressed). */
  restrictedHeadcount: number;
  restrictions: string[];
  seedSignoff: SignoffState;
}

/** Roster L1 for every crew (ADR 0057): 06:00 to 11:00 and 15:00 to 18:00 local. */
const L1_SHIFT: Schemas["ShiftWindow"][] = [
  { start: "06:00", end: "11:00" },
  { start: "15:00", end: "18:00" },
];

const CREW_SEEDS: CrewSeed[] = [
  {
    id: "crew-a",
    name: "Crew A",
    task_label: "Rebar fixing",
    workload: "heavy",
    member_count: 12,
    restrictedHeadcount: 2,
    restrictions: ["P-H8.ramp"],
    seedSignoff: "signed",
  },
  { id: "crew-b", name: "Crew B", task_label: "Concrete pour", workload: "heavy", member_count: 20, restrictedHeadcount: 0, restrictions: [], seedSignoff: "unsigned" },
  {
    id: "crew-c",
    name: "Crew C",
    task_label: "Formwork",
    workload: "moderate",
    member_count: 9,
    restrictedHeadcount: 1,
    restrictions: ["P-H7.unacclimatised"],
    seedSignoff: "changed_since_signed",
  },
  {
    id: "crew-d",
    name: "Crew D",
    task_label: "Survey and inspection",
    workload: "light",
    member_count: 4,
    restrictedHeadcount: 0,
    restrictions: [],
    seedSignoff: "signed",
  },
];

function seedSignoffs(): Map<string, SignoffState> {
  return new Map(CREW_SEEDS.map((seed) => [seed.id, seed.seedSignoff]));
}

let signoffs: Map<string, SignoffState> = seedSignoffs();

function seedOf(crewId: string): CrewSeed | undefined {
  return CREW_SEEDS.find((seed) => seed.id === crewId);
}

export function crewExists(crewId: string): boolean {
  return seedOf(crewId) !== undefined;
}

export interface DayOptions {
  forecastStatus?: ForecastStatus;
  /** The `suppressed` scenario: every crew is below k. */
  forceSuppressed?: boolean;
}

function isSuppressed(seed: CrewSeed, options: DayOptions): boolean {
  return options.forceSuppressed === true || seed.member_count < riskPolicy.k_suppression;
}

function activeStop(crewId: string): StopRow | undefined {
  return stops.find((row) => row.crewId === crewId && row.clearedAt === null);
}

function planStatus(options: DayOptions): Schemas["Crew"]["plan_status"] {
  return options.forecastStatus === "fallback" || options.forecastStatus === "stale" ? "fallback" : "rule";
}

/** The crews of a site as the API lists them now: stop and sign-off state included. Unknown site: undefined. */
export function listCrews(siteId: string, options: DayOptions = {}): Schemas["Crew"][] | undefined {
  if (!sites.some((site) => site.id === siteId)) return undefined;
  if (siteId !== SITE_DEMO) return [];
  return CREW_SEEDS.map((seed) => {
    const stop = activeStop(seed.id);
    return {
      id: seed.id,
      site_id: SITE_DEMO,
      name: seed.name,
      task_label: seed.task_label,
      workload: seed.workload,
      member_count: seed.member_count,
      shift: L1_SHIFT,
      signoff_state: signoffs.get(seed.id) ?? "unsigned",
      plan_status: planStatus(options),
      stopped: stop !== undefined,
      active_stop_id: stop?.id ?? null,
      stopped_at: stop?.startedAt ?? null,
    };
  });
}

/** The crew table without live state, for code that only needs ids and member counts. */
export const crews: { id: string; site_id: string; member_count: number }[] = CREW_SEEDS.map((seed) => ({
  id: seed.id,
  site_id: SITE_DEMO,
  member_count: seed.member_count,
}));

// --- Stops, epochs, the log --------------------------------------------------------------------------------------------------

function stopOf(row: StopRow): Schemas["CrewStop"] {
  return { id: row.id, crew_id: row.crewId, started_at: row.startedAt, cleared_at: row.clearedAt };
}

export function crewStops(crewId: string): Schemas["CrewStop"][] {
  return stops.filter((row) => row.crewId === crewId).map(stopOf);
}

/** Records a stop at the replay clock. The mock never alerts anyone and says nothing of the kind. */
export function createStop(crewId: string): Schemas["CrewStop"] {
  stopCounter += 1;
  const row: StopRow = { id: `stop-${String(stopCounter).padStart(4, "0")}`, crewId, startedAt: REPLAY_INSTANT, clearedAt: null };
  stops.push(row);
  return stopOf(row);
}

/** Clears a stop at the replay clock. Idempotent: an unknown or cleared stop changes nothing. */
export function clearStop(crewId: string, stopId: string): void {
  const row = stops.find((candidate) => candidate.id === stopId && candidate.crewId === crewId);
  if (row !== undefined && row.clearedAt === null) row.clearedAt = REPLAY_INSTANT;
}

/**
 * Starts a new demo epoch: stops and sign-offs revert to the seed. The transparency log is append-only and keeps
 * every row (ADR 0054); each row remembers the epoch it was written in. The stop counter is NOT reset.
 */
export function resetDemoState(siteId: string, now: Date = new Date()): Schemas["DemoReset"] {
  const previous = epoch;
  stops = [];
  signoffs = seedSignoffs();
  epoch += 1;
  return { site_id: siteId, epoch_id: epoch, previous_epoch_id: previous, reset_at: now.toISOString() };
}

/** Test helper: back to epoch 1, stop ids from 0001 and an empty log, as a fresh process. Not reachable through the API. */
export function resetDemoStateHard(): void {
  stops = [];
  signoffs = seedSignoffs();
  epoch = 1;
  stopCounter = 0;
  log = [];
}

export function currentEpoch(): number {
  return epoch;
}

/** One refusal row per data request; `at` is the real clock. Rows are never removed. */
export function appendRefusal(siteId: string, now: Date = new Date()): void {
  log.push({
    siteId,
    epoch,
    entry: {
      at: now.toISOString(),
      kind: "data_request.refused",
      outcome: "refused",
      actor_role: "employer",
      rule: "ADR 0004; PDPL purpose limitation",
      policy_version: MOCK_POLICY_VERSION,
      config_version: MOCK_CONFIG_VERSION,
      model_id: MOCK_MODEL_ID,
    },
  });
}

/** Every row of the site, never deleted, newest first, at most 50 (ADR 0054 item 3). The epoch stays internal. */
export function transparencyLog(siteId: string): Schemas["TransparencyLog"] | undefined {
  if (!sites.some((site) => site.id === siteId)) return undefined;
  const entries = log
    .filter((row) => row.siteId === siteId)
    .map((row) => row.entry)
    .reverse()
    .slice(0, 50);
  return { site_id: siteId, entries };
}

// --- Crew timeline ---------------------------------------------------------------------------------------------------------

/** True when a stop of the crew covers part of [fromMs, toMs): from its start to its clear, or to the day's end. */
function stoppedBetween(crewId: string, fromMs: number, toMs: number): boolean {
  return stops.some((row) => {
    if (row.crewId !== crewId) return false;
    const start = Date.parse(row.startedAt);
    const end = row.clearedAt === null ? Number.POSITIVE_INFINITY : Date.parse(row.clearedAt);
    // A stop cleared at its own start (the 10 second undo, on the replay clock) covered nothing.
    return end > start && toMs > start && fromMs < end;
  });
}

function statusOf(options: DayOptions): ForecastStatus {
  return options.forecastStatus ?? "fresh";
}

/**
 * The crew's aggregate timeline for `date`. The crew level is the site's level of the hour, raised to red by a
 * crew-lead stop (ADR 0050); it uses no member data, so a suppressed crew keeps it. Unknown crew: undefined.
 */
export function crewTimeline(crewId: string, date: string, options: DayOptions = {}): Schemas["CrewTimeline"] | undefined {
  const seed = seedOf(crewId);
  if (seed === undefined) return undefined;
  const fallback = options.forecastStatus === "fallback";
  return {
    crew_id: seed.id,
    crew_name: seed.name,
    site_id: SITE_DEMO,
    date,
    suppressed: isSuppressed(seed, options),
    k: riskPolicy.k_suppression,
    forecast_status: statusOf(options),
    ban_window: banWindow(date),
    shift: L1_SHIFT.map(({ start, end }) => ({ starts_at: instantAt(date, minutesOf(start)), ends_at: instantAt(date, minutesOf(end)) })),
    signoff_state: signoffs.get(seed.id) ?? "unsigned",
    hours: HOURS.map((hour) => {
      const from = Date.parse(instantAt(date, hour * 60));
      const stopped = stoppedBetween(seed.id, from, from + 60 * 60 * 1000);
      return { starts_at: instantAt(date, hour * 60), crew_level: stopped ? "red" : hourLevel(hour, fallback), ban_active: banActive(date, hour) };
    }),
  };
}

// --- Canned day plans ------------------------------------------------------------------------------------------------------

/** One canned block of a plan: local from and to, the state, and the zone it was planned under. */
type Row = [from: string, to: string, state: State, zone: Zone | null];

const BAN_ROW: Row = [BAN_START, BAN_END, "ban", null];

/** Heavy and moderate crews (moderate uses the heavy column, ADR 0046 item 6): Medium 45/15, High 20/40. */
const HEAVY_ROWS: Row[] = [
  ["06:00", "08:00", "work", "low"],
  ["08:00", "08:15", "adosh_rest", "medium"],
  ["08:15", "09:00", "work", "medium"],
  ["09:00", "09:15", "adosh_rest", "medium"],
  ["09:15", "10:00", "work", "medium"],
  ["10:00", "10:40", "adosh_rest", "high"],
  ["10:40", "11:00", "work", "high"],
  BAN_ROW,
  ["15:00", "15:20", "work", "high"],
  ["15:20", "16:00", "adosh_rest", "high"],
  ["16:00", "16:20", "work", "high"],
  ["16:20", "17:00", "adosh_rest", "high"],
  ["17:00", "17:45", "work", "medium"],
  ["17:45", "18:00", "adosh_rest", "medium"],
];

/** The light crew: High is 45/15 for light work, Medium falls back to the heavy column. */
const LIGHT_ROWS: Row[] = [
  ["06:00", "08:00", "work", "low"],
  ["08:00", "08:15", "adosh_rest", "medium"],
  ["08:15", "09:00", "work", "medium"],
  ["09:00", "09:15", "adosh_rest", "medium"],
  ["09:15", "10:00", "work", "medium"],
  ["10:00", "10:45", "work", "high"],
  ["10:45", "11:00", "adosh_rest", "high"],
  BAN_ROW,
  ["15:00", "15:45", "work", "high"],
  ["15:45", "16:00", "adosh_rest", "high"],
  ["16:00", "16:45", "work", "high"],
  ["16:45", "17:00", "adosh_rest", "high"],
  ["17:00", "17:45", "work", "medium"],
  ["17:45", "18:00", "adosh_rest", "medium"],
];

/** The protective fallback (ADR 0058): every on-shift block High, laid out as the High cycle of the workload. */
function fallbackRows(workload: Workload): Row[] {
  const [work, rest] = workload === "light" ? [45, 15] : [20, 40];
  const rows: Row[] = [];
  for (const { start, end } of L1_SHIFT) {
    if (start === "15:00") rows.push(BAN_ROW);
    let at = minutesOf(start);
    while (at < minutesOf(end)) {
      const workEnd = Math.min(at + work, minutesOf(end));
      const restEnd = Math.min(workEnd + rest, minutesOf(end));
      rows.push([clock(at), clock(workEnd), "work", "high"]);
      if (restEnd > workEnd) rows.push([clock(workEnd), clock(restEnd), "adosh_rest", "high"]);
      at = restEnd;
    }
  }
  return rows;
}

// Clause texts: ONLY what the contract itself says (the examples of PlanValidateResponse and DayPlan in
// openapi/stellar-blaze.openapi.json). A rule the contract gives no text for has an empty clause.
const CLAUSE_BAN = "Ministerial Resolution 44 of 2022: no outdoor work 12:30-15:00 from 15 June to 15 September.";
const CLAUSE_ART18 = "Labour Art. 18: a break of one hour after five hours of work.";
const CLAUSE_HIGH_HEAVY = "ADOSH Technical Guideline Table 1, High zone, heavy work: 20 minutes of work, 40 minutes of rest.";
const SOURCE_ART18 = "ae-labour-art-18";

function segmentOf(date: string, [from, to, state, zone]: Row, workload: Workload, fallback: boolean): Schemas["PlanSegment"] {
  const cycle = state === "work" || state === "adosh_rest";
  let ruleId = "P-H7.cap60";
  if (state === "ban") ruleId = "P-H1";
  else if (fallback) ruleId = "FALLBACK.high";
  else if (cycle && zone !== "low") ruleId = "P-H7.cycle";
  let clause = "";
  if (state === "ban") clause = CLAUSE_BAN;
  else if (!fallback && cycle && zone === "high" && workload !== "light") clause = CLAUSE_HIGH_HEAVY;
  return { starts_at: instantAt(date, minutesOf(from)), ends_at: instantAt(date, minutesOf(to)), state, zone, rule_id: ruleId, clause };
}

function isoOf(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Replaces the part of each segment a stop covers with a `stopped` run (Red), then merges equal neighbours. */
function overlayStops(segments: Schemas["PlanSegment"][], crewId: string): Schemas["PlanSegment"][] {
  const covering = stops.filter((row) => row.crewId === crewId);
  if (covering.length === 0) return segments;
  const pieces: Schemas["PlanSegment"][] = [];
  for (const segment of segments) {
    const from = Date.parse(segment.starts_at);
    const to = Date.parse(segment.ends_at);
    const cuts = [from, to];
    for (const row of covering) {
      const end = row.clearedAt === null ? Number.POSITIVE_INFINITY : Date.parse(row.clearedAt);
      for (const edge of [Date.parse(row.startedAt), end]) if (edge > from && edge < to) cuts.push(edge);
    }
    cuts.sort((a, b) => a - b);
    for (let index = 1; index < cuts.length; index += 1) {
      const a = cuts[index - 1] ?? from;
      const b = cuts[index] ?? to;
      if (b <= a) continue;
      const piece = { ...segment, starts_at: isoOf(a), ends_at: isoOf(b) };
      const stopped = segment.state !== "ban" && stoppedBetween(crewId, a, b);
      pieces.push(stopped ? { ...piece, state: "stopped", zone: "red", rule_id: "STOP.red", clause: "" } : piece);
    }
  }
  const merged: Schemas["PlanSegment"][] = [];
  for (const segment of pieces) {
    const last = merged.at(-1);
    const same =
      last !== undefined && last.ends_at === segment.starts_at && last.state === segment.state && last.zone === segment.zone && last.rule_id === segment.rule_id;
    if (same) last.ends_at = segment.ends_at;
    else merged.push({ ...segment });
  }
  return merged;
}

/** The text code of an acknowledgement item (the ruleset's action-code vocabulary; Red is the stop code). */
function textCodeOf(zone: "medium" | "high" | "red", workload: Workload): string {
  if (zone === "red") return "stop-work";
  if (zone === "medium") return "cycle.medium.heavy.45-15";
  return workload === "light" ? "cycle.high.light.45-15" : "cycle.high.heavy.20-40";
}

/** One acknowledgement per run of consecutive blocks in the same zone above Low; ids are `<zone>-<HHMM local start>`. */
function ackItemsOf(date: string, segments: Schemas["PlanSegment"][], workload: Workload): Schemas["AckItem"][] {
  const dayStart = Date.parse(instantAt(date, 0));
  const items: Schemas["AckItem"][] = [];
  for (const segment of segments) {
    const { zone } = segment;
    const counted = segment.state === "work" || segment.state === "adosh_rest" || segment.state === "stopped";
    if (!counted || (zone !== "medium" && zone !== "high" && zone !== "red")) continue;
    const last = items.at(-1);
    if (last !== undefined && last.zone === zone && last.ends_at === segment.starts_at) {
      last.ends_at = segment.ends_at;
      continue;
    }
    const localStart = Math.round((Date.parse(segment.starts_at) - dayStart) / 60_000);
    items.push({
      id: `${zone}-${clock(localStart).replace(":", "")}`,
      zone,
      starts_at: segment.starts_at,
      ends_at: segment.ends_at,
      text_code: textCodeOf(zone, workload),
    });
  }
  return items;
}

const CHECKED_RULES = ["P-H1", "P-H2.daily", "P-H3", "P-H7.cap60", "P-H7.run", "STOP.red"];

function zoneHours(date: string, fallback: boolean): Schemas["ZoneHour"][] {
  return HOURS.map((hour) => {
    const level = hourLevel(hour, fallback);
    return { starts_at: instantAt(date, hour * 60), zone: level === null ? null : ZONE_OF_LEVEL[level], level };
  });
}

/** The crew's canned day plan for `date`. Unknown crew: undefined. */
export function crewDayPlan(crewId: string, date: string, options: DayOptions = {}): Schemas["DayPlan"] | undefined {
  const seed = seedOf(crewId);
  if (seed === undefined) return undefined;
  const fallback = planStatus(options) === "fallback";
  let rows = seed.workload === "light" ? LIGHT_ROWS : HEAVY_ROWS;
  if (fallback) rows = fallbackRows(seed.workload);
  const inSeason = inBanSeason(date);
  const segments = overlayStops(
    rows.filter((row) => row !== BAN_ROW || inSeason).map((row) => segmentOf(date, row, seed.workload, fallback)),
    seed.id,
  );
  const suppressed = isSuppressed(seed, options);
  const state = signoffs.get(seed.id) ?? "unsigned";
  let label: Schemas["DayPlan"]["signoff_label_code"] = null;
  if (state === "unsigned") label = "plan.unsigned_fallback";
  else if (state === "changed_since_signed") label = "plan.changed_since_signed";
  return {
    crew_id: seed.id,
    date,
    status: fallback ? "fallback" : "rule",
    signoff_state: state,
    signoff_label_code: label,
    banner_code: "plan.floor_banner",
    segments,
    zone_hours: zoneHours(date, options.forecastStatus === "fallback"),
    validator: { passed: true, violations: [], checked_rules: CHECKED_RULES },
    ack_items: ackItemsOf(date, segments, seed.workload),
    suppressed,
    restricted_headcount: suppressed ? null : seed.restrictedHeadcount,
    // A suppressed crew shows no restriction codes either: a code on a small crew can single a member out.
    restrictions: suppressed ? [] : seed.restrictions,
    signed_at: state === "unsigned" ? null : SEED_SIGNED_AT,
    signed_by_role: state === "unsigned" ? null : "supervisor",
    forecast_status: statusOf(options),
    ban_window: banWindow(date),
    policy_version: MOCK_POLICY_VERSION,
    config_version: MOCK_CONFIG_VERSION,
    model_id: MOCK_MODEL_ID,
  };
}

export type SignOffOutcome =
  | { kind: "signed"; signOff: Schemas["PlanSignOff"] }
  | { kind: "review-required"; missing: string[] }
  | { kind: "unknown-items"; unknown: { id: string; index: number }[] };

/**
 * Signs the crew's day plan off (B3 Task 17). Every Medium, High and Red item must be acknowledged; a plan with none
 * signs with an empty list. Signing never touches a stop, and an already signed plan answers the recorded sign-off
 * again. Unknown crew: undefined.
 */
export function signOffDayPlan(
  crewId: string,
  acknowledged: readonly string[],
  deviationReasonCode: string | null,
  options: DayOptions = {},
  date: string = REPLAY_DATE,
): SignOffOutcome | undefined {
  const plan = crewDayPlan(crewId, date, options);
  if (plan === undefined) return undefined;
  const known = new Set(plan.ack_items.map((item) => item.id));
  const unknown = acknowledged.flatMap((id, index) => (known.has(id) ? [] : [{ id, index }]));
  if (unknown.length > 0) return { kind: "unknown-items", unknown };
  const missing = plan.ack_items.map((item) => item.id).filter((id) => !acknowledged.includes(id));
  if (missing.length > 0) return { kind: "review-required", missing };
  const wasSigned = signoffs.get(crewId) === "signed";
  signoffs.set(crewId, "signed");
  return {
    kind: "signed",
    signOff: {
      crew_id: crewId,
      date,
      signoff_state: "signed",
      signed_at: wasSigned ? SEED_SIGNED_AT : REPLAY_INSTANT,
      signed_by_role: "supervisor",
      acknowledged_items: [...acknowledged],
      deviation_reason_code: deviationReasonCode,
    },
  };
}

// --- Try-a-plan: canned validator answers -----------------------------------------------------------------------------------

export interface RosterSegment {
  start: string;
  end: string;
  state: "work" | "rest" | "break";
}

export type RosterParse = { segments: RosterSegment[] } | { errors: Schemas["RosterError"][] };

const TIME = /^([01]?\d|2[0-3]):[0-5]\d$/;

/** Reads `HH:MM-HH:MM work|rest|break` lines (`#` comments allowed). Only the format is checked; nothing is planned. */
export function parseRoster(text: string): RosterParse {
  const segments: RosterSegment[] = [];
  const errors: Schemas["RosterError"][] = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1;
    const content = (raw.split("#")[0] ?? "").trim();
    if (content === "") return;
    const match = /^(\S+)-(\S+)\s+(\S+)$/.exec(content);
    if (match === null) {
      errors.push({ line, message: "write the line as HH:MM-HH:MM work, rest or break" });
      return;
    }
    const [, start = "", end = "", state = ""] = match;
    if (!TIME.test(start)) errors.push({ line, message: `start ${start} is not a time` });
    else if (!TIME.test(end)) errors.push({ line, message: `end ${end} is not a time` });
    else if (minutesOf(start) >= minutesOf(end)) errors.push({ line, message: "the start must be before the end" });
    else if (state !== "work" && state !== "rest" && state !== "break") errors.push({ line, message: `state ${state} is not work, rest or break` });
    else segments.push({ start: clock(minutesOf(start)), end: clock(minutesOf(end)), state });
  });
  return errors.length > 0 ? { errors } : { segments };
}

const COMMON_ROSTER = "06:00-12:30 work|15:00-17:00 work";
const LEGAL_DEFAULT = "06:00-11:00 work|15:00-18:00 work";
const STRAIGHT_THROUGH = "06:00-18:00 work";

function range(date: string, from: string, to: string): Schemas["TimeRange"] {
  return { starts_at: instantAt(date, minutesOf(from)), ends_at: instantAt(date, minutesOf(to)) };
}

/** The canned violations of a roster template; the clause and the Art. 18 detail are the contract's own example. */
function cannedViolations(key: string, date: string): Schemas["Violation"][] {
  const art18 = (from: string, to: string, detail: string): Schemas["Violation"] => ({
    rule_id: "P-H3",
    clause: CLAUSE_ART18,
    source_id: SOURCE_ART18,
    ranges: [range(date, from, to)],
    detail,
  });
  // The contract gives no clause or source id for the daily-hours rule: both are empty here.
  const daily = (ranges: Schemas["TimeRange"][], detail: string): Schemas["Violation"] => ({ rule_id: "P-H2.daily", clause: "", source_id: "", ranges, detail });
  if (key === COMMON_ROSTER) {
    return [art18("06:00", "12:30", "6.5 hours of attendance without a one-hour break."), daily([range(date, "06:00", "12:30"), range(date, "15:00", "17:00")], "8.5 hours of attendance in the day.")];
  }
  if (key === STRAIGHT_THROUGH) {
    const ban: Schemas["Violation"][] = inBanSeason(date)
      ? [{ rule_id: "P-H1", clause: CLAUSE_BAN, source_id: "", ranges: [range(date, BAN_START, BAN_END)], detail: "Work inside the midday ban." }]
      : [];
    return [...ban, art18("06:00", "18:00", "12 hours of attendance without a one-hour break."), daily([range(date, "06:00", "18:00")], "12 hours of attendance in the day.")];
  }
  return [];
}

export interface TypedPlan {
  date: string;
  segments: RosterSegment[];
}

/**
 * The canned validator answer for a typed roster: the common roster (06:00-12:30 and 15:00-17:00) and straight-through
 * work (06:00-18:00) have violations; the legal default (06:00-11:00 and 15:00-18:00) has none; any other roster gets
 * "no violations, rules checked". It is a picture of the screen, not a check of the roster.
 */
export function validateTyped(typed: TypedPlan, options: DayOptions = {}): Schemas["PlanValidateResponse"] {
  const key = [...typed.segments]
    .sort((a, b) => minutesOf(a.start) - minutesOf(b.start))
    .map((segment) => `${segment.start}-${segment.end} ${segment.state}`)
    .join("|");
  const violations = key === LEGAL_DEFAULT ? [] : cannedViolations(key, typed.date);
  return {
    banner_code: "plan.floor_banner",
    validator: { passed: violations.length === 0, violations, checked_rules: CHECKED_RULES.filter((rule) => rule !== "STOP.red") },
    zone_hours: zoneHours(typed.date, options.forecastStatus === "fallback"),
    forecast_status: statusOf(options),
    ban_window: banWindow(typed.date),
    policy_version: MOCK_POLICY_VERSION,
    config_version: MOCK_CONFIG_VERSION,
    model_id: MOCK_MODEL_ID,
  };
}

// --- F1's forecast day, kept for the on-device risk vectors ----------------------------------------------------------------

/*
 * The forecast day F1's worker Today tests and personal-risk vectors are pinned to: Wed 11 Nov 2026, 15 hours from
 * 05:00 to 19:00 local, the 13:00 hour {26, 28, 30} orange (the Task 9 vector), no data at 19:00. It is a November day,
 * outside the ban season, so its ban window is not in force. It is NOT served by the mock API (the handlers answer the
 * replay day); tests that pin it use this function or override the handler with it. Delete it when F2 Task 14 rewrites
 * those tests against the replay day.
 */
export const LEGACY_FORECAST_DATE = "2026-11-11";

const LEGACY_DAY: { hour: number; p50: number | null; level: Level | null }[] = [
  { hour: 5, p50: 21, level: "green" },
  { hour: 6, p50: 22, level: "green" },
  { hour: 7, p50: 23, level: "green" },
  { hour: 8, p50: 24, level: "green" },
  { hour: 9, p50: 25, level: "amber" },
  { hour: 10, p50: 26, level: "amber" },
  { hour: 11, p50: 27, level: "amber" },
  { hour: 12, p50: 27, level: "amber" },
  { hour: 13, p50: 28, level: "orange" },
  { hour: 14, p50: 29, level: "orange" },
  { hour: 15, p50: 28, level: "orange" },
  { hour: 16, p50: 27, level: "amber" },
  { hour: 17, p50: 25, level: "amber" },
  { hour: 18, p50: 23, level: "green" },
  { hour: 19, p50: null, level: null },
];

/** F1's forecast day for `siteId`, generated `ageMs` before `now`. Unknown site: undefined. */
export function legacyForecastToday(
  siteId: string,
  { ageMs = FRESH_AGE_MS, now = new Date() }: { ageMs?: number; now?: Date } = {},
): Schemas["SiteForecastToday"] | undefined {
  if (!sites.some((site) => site.id === siteId)) return undefined;
  return {
    site_id: siteId,
    date: LEGACY_FORECAST_DATE,
    generated_at: new Date(now.getTime() - ageMs).toISOString(),
    policy_version: MOCK_POLICY_VERSION,
    config_version: MOCK_CONFIG_VERSION,
    mode: "replay",
    forecast_status: ageMs >= STALE_AGE_MS ? "stale" : "fresh",
    model_id: null,
    lead_days: 1,
    ban_window: banWindow(LEGACY_FORECAST_DATE),
    hours: LEGACY_DAY.map(({ hour, p50, level }) => ({
      starts_at: instantAt(LEGACY_FORECAST_DATE, hour * 60),
      wbgt_c: p50 === null ? { p05: null, p50: null, p95: null } : { p05: p50 - 2, p50, p95: p50 + 2 },
      site_level: level,
      action_codes: [],
      ban_active: false,
    })),
  };
}
