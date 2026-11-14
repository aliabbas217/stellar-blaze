import type { components } from "@/api/schema";
import {
  ackItemsOf,
  inBanSeason,
  instantAt,
  levelOfZone,
  planCrew,
  segmentsOf,
  tickStart,
  validate,
  zoneOfLevel,
  BAN_END_MIN,
  BAN_START_MIN,
  TICK_COUNT,
  TICK_MIN,
  type CrewShape,
  type PlanInputs,
  type RosterSegment,
  type TickPlan,
  type TickState,
} from "./rules.ts";

/*
 * SIMULATED data behind the mock API (ADR 0057): a synthetic yard, four crews that exist only in the crew fixture, and
 * one recorded forecast day. Every name says so. Typed from the generated schema, so `pnpm typecheck` fails when this
 * file drifts from the contract (openapi/stellar-blaze.openapi.json).
 *
 * The forecast day is the design replay day, Thu 3 Sep 2026 at Asia/Dubai (UTC+4, no daylight saving), inside the
 * midday-ban season. The hourly WBGT numbers are REAL: the Open-Meteo ECMWF IFS 0.25 day-1 forecast ("issued the day
 * before") at OMAA with Liljegren WBGT, copied from docs/design/v2/prototype/data/omaa_2026_ifs_d1_wbgt_hourly.json,
 * entry "2026-09-03". The LEVELS are a documented placeholder (`model_id: "mock"`), not the product rule: B3 derives
 * them from the ADOSH zone of the effective TWL at the warning quantile (ADR 0046). The placeholder is the design
 * prototype's heavy-work band on WBGT p50 (assets/crews.js, BANDS.heavy): amber from 30, orange from 34, red from 39
 * degrees C. ADR 0046 gives one site level for every crew (TWL does not depend on the workload), so these bands apply
 * to the site and to every crew alike. The 5 % and 95 % quantiles are p50 minus and plus 2 degrees C, a placeholder
 * spread (B3 reports the corrector's real quantiles).
 *
 * The mock serves this one day for any requested date, re-dated; the ban window and `ban_active` follow the requested
 * date, so a November date has no ban. Nothing here claims to be a forecast for that date.
 *
 * State: crew stops, plan sign-offs and the transparency log live in memory of the process that imports this module
 * (Vitest: one file; `pnpm mock:api`: the server). `resetDemoState()` is what reset_demo_site calls.
 *
 * Loaded by scripts/mock-api.ts under Node's type stripping: only `import type` from the "@/" alias (it is erased),
 * relative imports end in ".ts", and no enums or parameter properties.
 */

type Schemas = components["schemas"];
type Level = Schemas["Level"];
type Workload = "light" | "moderate" | "heavy";
export type ForecastStatus = Schemas["SiteForecastToday"]["forecast_status"];

export const SITE_DEMO = "site-demo-mussafah";
export const SITE_EMPTY = "site-demo-empty";
export const REPLAY_DATE = "2026-09-03";
export const FIXTURE_DATE = REPLAY_DATE;
/** The replay clock: the API date at 11:10 Asia/Dubai (the F2 plan's demo clock). */
export const REPLAY_INSTANT = instantAt(REPLAY_DATE, 11 * 60 + 10);

export const MOCK_MODEL_ID = "mock";
export const MOCK_POLICY_VERSION = "mock-0";
export const MOCK_CONFIG_VERSION = 1;

export const sites: Schemas["Site"][] = [
  {
    id: SITE_DEMO,
    name: "Mussafah M-14 yard (synthetic)",
    timezone: "Asia/Dubai",
    synthetic: true,
    // SYNTHETIC numbers: not assigned to anyone.
    supervisor_phone: "+97150000001",
    first_aider_phone: "+97150000002",
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

/** WBGT in degrees C at local hour 0 to 23 on 2026-09-03 (REAL, see the header). */
const REPLAY_WBGT_C_BY_LOCAL_HOUR = [
  30.6, 30.3, 29.5, 28.4, 27.6, 27.4, 27.5, 28.7, 31, 33, 34.5, 35.4, 35.8, 36.7, 39.4, 35.9, 34.6, 33.5, 32.5, 31.4, 31, 30.9, 30.7, 30.4,
];

/** The forecast covers 06:00 to 19:00 local, 14 hours (B3 Task 10, `get_site_forecast_today`). */
const FIRST_HOUR = 6;
const LAST_HOUR = 19;
const SPREAD_C = 2;

/** The placeholder level rule (see the header): lower bounds of amber, orange and red on WBGT p50. */
const LEVEL_BOUNDS_C = [30, 34, 39] as const;
const LEVELS: Level[] = ["green", "amber", "orange", "red"];

export function placeholderLevel(wbgtC: number): Level {
  return LEVELS[LEVEL_BOUNDS_C.filter((bound) => wbgtC >= bound).length] ?? "green";
}

function wbgtAt(hour: number): number {
  return REPLAY_WBGT_C_BY_LOCAL_HOUR[hour] ?? Number.NaN;
}

const HOURS = Array.from({ length: LAST_HOUR - FIRST_HOUR + 1 }, (_, index) => FIRST_HOUR + index);

/** The midday ban of `date` as UTC instants, or null out of season (request R1). */
export function banWindow(date: string): Schemas["TimeRange"] | null {
  if (!inBanSeason(date)) return null;
  return { starts_at: instantAt(date, BAN_START_MIN), ends_at: instantAt(date, BAN_END_MIN) };
}

/** True for an hour that overlaps the ban: 12:00 only in part (12:30), 13:00 and 14:00 wholly. */
function banActive(date: string, hour: number): boolean {
  return inBanSeason(date) && (hour + 1) * 60 > BAN_START_MIN && hour * 60 < BAN_END_MIN;
}

function hourLevel(hour: number, fallback: boolean): Level | null {
  if (fallback || hour < FIRST_HOUR || hour > LAST_HOUR) return null;
  return placeholderLevel(wbgtAt(hour));
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
  // Placeholders until B3's back-test sets the real probability cut-offs (ADR 0049 will arrive as 0.10, 0.50, 0.90).
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

// --- Crews (ADR 0057, the crew fixture) ----------------------------------------------------------------------------------

interface CrewSeed {
  crew: Schemas["Crew"];
  /** Members limited by acclimatisation or a return from absence (member-derived: hidden when suppressed). */
  restrictedHeadcount: number;
  restrictions: string[];
  /** Whether the seed has the plan signed (SIMULATED; the prototype's crew table). */
  seedSigned: boolean;
}

/** Roster L1 for every crew (ADR 0057): 06:00 to 11:00 and 15:00 to 18:00 local. */
const L1_SHIFT: [number, number][] = [
  [6 * 60, 11 * 60],
  [15 * 60, 18 * 60],
];

const CREW_SEEDS: CrewSeed[] = [
  {
    crew: { id: "crew-a", site_id: SITE_DEMO, name: "Crew A", member_count: 12, task_label: "Rebar fixing", workload: "heavy" },
    restrictedHeadcount: 2,
    restrictions: ["restricted.acclimatisation_ramp"],
    seedSigned: true,
  },
  {
    crew: { id: "crew-b", site_id: SITE_DEMO, name: "Crew B", member_count: 20, task_label: "Concrete pour", workload: "heavy" },
    restrictedHeadcount: 0,
    restrictions: [],
    seedSigned: false,
  },
  {
    crew: { id: "crew-c", site_id: SITE_DEMO, name: "Crew C", member_count: 9, task_label: "Formwork", workload: "moderate" },
    restrictedHeadcount: 1,
    restrictions: ["restricted.returning_after_absence"],
    seedSigned: false,
  },
  {
    crew: { id: "crew-d", site_id: SITE_DEMO, name: "Crew D", member_count: 4, task_label: "Survey and inspection", workload: "light" },
    restrictedHeadcount: 0,
    restrictions: [],
    seedSigned: true,
  },
];

export const crews: Schemas["Crew"][] = CREW_SEEDS.map((seed) => seed.crew);

function seedOf(crewId: string): CrewSeed | undefined {
  return CREW_SEEDS.find((seed) => seed.crew.id === crewId);
}

function shapeOf(crew: Schemas["Crew"]): CrewShape {
  return { workload: crew.workload, shift: L1_SHIFT };
}

// --- Stateful in-memory rows ---------------------------------------------------------------------------------------------

interface StopRow {
  id: string;
  crewId: string;
  startedAt: string;
  clearedAt: string | null;
}

interface LogRow {
  siteId: string;
  epoch: number;
  entry: Schemas["TransparencyLog"]["entries"][number];
}

const SEED_SIGNED_AT = instantAt(REPLAY_DATE, 5 * 60 + 40);

function seedSignoffs(): Map<string, string> {
  return new Map(CREW_SEEDS.filter((seed) => seed.seedSigned).map((seed) => [seed.crew.id, SEED_SIGNED_AT]));
}

let stops: StopRow[] = [];
let signoffs: Map<string, string> = seedSignoffs();
let log: LogRow[] = [];
let epoch = 1;
let stopCounter = 0;

/**
 * Starts a new demo epoch: stops and sign-offs revert to the seed. The transparency log is append-only and keeps
 * every row (ADR 0054); each row remembers the epoch it was written in. Returns the new epoch.
 */
export function resetDemoState(): number {
  stops = [];
  stopCounter = 0;
  signoffs = seedSignoffs();
  epoch += 1;
  return epoch;
}

/** Test helper: back to epoch 1 with an empty log, as a fresh process. Not reachable through the API. */
export function resetDemoStateHard(): void {
  resetDemoState();
  epoch = 1;
  log = [];
}

export function currentEpoch(): number {
  return epoch;
}

function stopOf(row: StopRow): Schemas["CrewStop"] {
  return { id: row.id, crew_id: row.crewId, started_at: row.startedAt, cleared_at: row.clearedAt };
}

export function crewStops(crewId: string): Schemas["CrewStop"][] {
  return stops.filter((row) => row.crewId === crewId).map(stopOf);
}

/** Records a stop at the replay clock. The mock never alerts anyone and says nothing of the kind. */
export function createStop(crewId: string): Schemas["CrewStop"] {
  stopCounter += 1;
  const row: StopRow = { id: `stop-mock-${String(stopCounter)}`, crewId, startedAt: REPLAY_INSTANT, clearedAt: null };
  stops.push(row);
  return stopOf(row);
}

/** Clears a stop at the replay clock. Idempotent: an unknown or cleared stop changes nothing. */
export function clearStop(crewId: string, stopId: string): void {
  const row = stops.find((candidate) => candidate.id === stopId && candidate.crewId === crewId);
  if (row !== undefined && row.clearedAt === null) row.clearedAt = REPLAY_INSTANT;
}

/** True when any stop of the crew covers part of [fromMs, toMs): from its start to its clear, or to the day's end. */
function stoppedBetween(crewId: string, fromMs: number, toMs: number): boolean {
  return stops.some((row) => {
    if (row.crewId !== crewId) return false;
    const start = Date.parse(row.startedAt);
    const end = row.clearedAt === null ? Number.POSITIVE_INFINITY : Date.parse(row.clearedAt);
    // A stop cleared at its own start (the 10 second undo, on the replay clock) covered nothing.
    return end > start && toMs > start && fromMs < end;
  });
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

// --- Crew timeline and day plan ------------------------------------------------------------------------------------------

export interface DayOptions {
  forecastStatus?: ForecastStatus;
  /** The `suppressed` scenario: every crew is below k. */
  forceSuppressed?: boolean;
}

function isSuppressed(crew: Schemas["Crew"], options: DayOptions): boolean {
  return options.forceSuppressed === true || crew.member_count < riskPolicy.k_suppression;
}

/**
 * The crew's aggregate timeline for `date`. The crew level is the site's level of the hour, raised to red by a
 * crew-lead stop (ADR 0050); it uses no member data, so a suppressed crew keeps it. Unknown crew: undefined.
 */
export function crewTimeline(crewId: string, date: string, options: DayOptions = {}): Schemas["CrewTimeline"] | undefined {
  const seed = seedOf(crewId);
  if (seed === undefined) return undefined;
  const { crew } = seed;
  const fallback = options.forecastStatus === "fallback";
  return {
    crew_id: crew.id,
    crew_name: crew.name,
    site_id: crew.site_id,
    date,
    suppressed: isSuppressed(crew, options),
    k: riskPolicy.k_suppression,
    ban_window: banWindow(date),
    shift: L1_SHIFT.map(([from, to]) => ({ starts_at: instantAt(date, from), ends_at: instantAt(date, to) })),
    signoff_state: signoffs.has(crew.id) ? "signed" : "unsigned",
    hours: HOURS.map((hour) => {
      const start = Date.parse(instantAt(date, hour * 60));
      const stopped = stoppedBetween(crew.id, start, start + 60 * 60 * 1000);
      return {
        starts_at: instantAt(date, hour * 60),
        crew_level: stopped ? "red" : hourLevel(hour, fallback),
        ban_active: banActive(date, hour),
      };
    }),
  };
}

function planInputs(crewId: string, date: string, fallback: boolean): PlanInputs {
  const zoneOfHour = Array.from({ length: 24 }, (_, hour) => zoneOfLevel(hourLevel(hour, fallback)));
  const dayStart = Date.parse(instantAt(date, 0));
  return {
    zoneOfHour,
    inBan: inBanSeason(date),
    stopped: (minute) => stoppedBetween(crewId, dayStart + minute * 60_000, dayStart + (minute + TICK_MIN) * 60_000),
  };
}

function signoffOf(crewId: string): Schemas["DaySignoff"] {
  const signedAt = signoffs.get(crewId);
  return signedAt === undefined
    ? { state: "unsigned", signed_at: null, signed_by_role: null }
    : { state: "signed", signed_at: signedAt, signed_by_role: "employer" };
}

/** The crew's rule plan for `date`, checked by the validator, with the acknowledgement items. Unknown crew: undefined. */
export function crewDayPlan(crewId: string, date: string, options: DayOptions = {}): Schemas["DayPlan"] | undefined {
  const seed = seedOf(crewId);
  if (seed === undefined) return undefined;
  const { crew } = seed;
  const fallback = options.forecastStatus === "fallback";
  const shape = shapeOf(crew);
  const plan: TickPlan = planCrew(shape, planInputs(crew.id, date, fallback));
  const suppressed = isSuppressed(crew, options);
  const signoff = signoffOf(crew.id);
  return {
    crew_id: crew.id,
    date,
    status: fallback ? "fallback" : "rule",
    signoff_state: signoff.state,
    banner_code: "plan.floor_banner",
    segments: segmentsOf(date, plan, shape, fallback),
    zone_hours: HOURS.map((hour) => {
      const zone = zoneOfLevel(hourLevel(hour, fallback));
      return { starts_at: instantAt(date, hour * 60), zone, level: levelOfZone(zone) };
    }),
    validator: validate(date, {
      states: plan.states,
      zones: plan.zones,
      workload: shape.workload,
      daysPerWeek: 6,
      inBan: inBanSeason(date),
    }),
    suppressed,
    restricted_headcount: suppressed ? null : seed.restrictedHeadcount,
    restrictions: seed.restrictions,
    forecast_status: options.forecastStatus ?? "fresh",
    policy_version: MOCK_POLICY_VERSION,
    config_version: MOCK_CONFIG_VERSION,
    model_id: MOCK_MODEL_ID,
    ack_items: ackItemsOf(date, plan, shape),
    signoff,
  };
}

export type SignOffOutcome =
  | { kind: "signed"; plan: Schemas["DayPlan"] }
  | { kind: "review-required"; missing: string[] }
  | { kind: "unknown-items"; unknown: string[] };

/**
 * Signs the crew's day plan off (B3 Task 17). One tap is allowed when the plan has no Medium, High or Red item;
 * otherwise every item must be acknowledged. Signing never touches a stop. Signing an already signed plan answers
 * the plan as it stands. Unknown crew: undefined.
 */
export function signOffDayPlan(
  crewId: string,
  acknowledged: readonly string[],
  options: DayOptions = {},
  date: string = REPLAY_DATE,
): SignOffOutcome | undefined {
  const before = crewDayPlan(crewId, date, options);
  if (before === undefined) return undefined;
  const known = new Set(before.ack_items.map((item) => item.id));
  const unknown = acknowledged.filter((id) => !known.has(id));
  if (unknown.length > 0) return { kind: "unknown-items", unknown };
  const missing = before.ack_items.map((item) => item.id).filter((id) => !acknowledged.includes(id));
  if (missing.length > 0) return { kind: "review-required", missing };
  if (!signoffs.has(crewId)) signoffs.set(crewId, REPLAY_INSTANT);
  const plan = crewDayPlan(crewId, date, options);
  return plan === undefined ? undefined : { kind: "signed", plan };
}

// --- Try-a-plan ----------------------------------------------------------------------------------------------------------

export interface TypedPlan {
  date: string;
  workload: Workload;
  daysPerWeek: number;
  segments: RosterSegment[];
  states: TickState[];
}

/** The validator's answer for a typed roster against the zones of `date` (the replay day's, re-dated). */
export function validateTyped(typed: TypedPlan, options: DayOptions = {}): Schemas["PlanValidateResponse"] {
  const fallback = options.forecastStatus === "fallback";
  const zones = Array.from({ length: TICK_COUNT }, (_, tick) => zoneOfLevel(hourLevel(Math.floor(tickStart(tick) / 60), fallback)));
  return {
    validator: validate(typed.date, {
      states: typed.states,
      zones,
      workload: typed.workload,
      daysPerWeek: typed.daysPerWeek,
      inBan: inBanSeason(typed.date),
    }),
    zone_hours: HOURS.map((hour) => {
      const zone = zoneOfLevel(hourLevel(hour, fallback));
      return { starts_at: instantAt(typed.date, hour * 60), zone, level: levelOfZone(zone) };
    }),
    policy_version: MOCK_POLICY_VERSION,
    config_version: MOCK_CONFIG_VERSION,
  };
}

// --- F1's forecast day, kept for the on-device risk vectors ----------------------------------------------------------------

/*
 * The forecast day F1's worker Today tests and personal-risk vectors are pinned to: Wed 11 Nov 2026, 15 hours from
 * 05:00 to 19:00 local, the 13:00 hour {26, 28, 30} orange (the Task 9 vector), no data at 19:00. It is a November day,
 * outside the ban season, so it has no ban window. It is NOT served by the mock API (the handlers answer the replay day);
 * tests that pin it use this function or override the handler with it. Delete it when F2 Task 14 rewrites those tests
 * against the replay day.
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
    ban_window: null,
    hours: LEGACY_DAY.map(({ hour, p50, level }) => ({
      starts_at: instantAt(LEGACY_FORECAST_DATE, hour * 60),
      wbgt_c: p50 === null ? { p05: null, p50: null, p95: null } : { p05: p50 - 2, p50, p95: p50 + 2 },
      site_level: level,
      action_codes: [],
      ban_active: false,
    })),
  };
}
