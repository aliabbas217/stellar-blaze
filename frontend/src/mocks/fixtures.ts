import type { components } from "@/api/schema";

/*
 * Synthetic data behind the mock API: every name says so. The forecast day is fixed, 2026-11-11 at Asia/Dubai
 * (UTC+4, no daylight saving), so unit tests and e2e assert the same values on any real day. Typed from the
 * generated schema, so `pnpm typecheck` fails when this file drifts from the contract.
 *
 * Loaded by scripts/mock-api.ts under Node's type stripping: only `import type` from the "@/" alias (it is erased),
 * relative imports end in ".ts", and no enums or parameter properties.
 */

type Schemas = components["schemas"];
type Level = Schemas["Level"];

export const SITE_DEMO = "site-demo-mussafah";
export const SITE_EMPTY = "site-demo-empty";
export const FIXTURE_DATE = "2026-11-11";

/** Asia/Dubai is UTC+4 all year, so local 05:00 is 01:00Z. */
const DUBAI_UTC_OFFSET_HOURS = 4;

export const sites: Schemas["Site"][] = [
  { id: SITE_DEMO, name: "Demo yard A (synthetic)", timezone: "Asia/Dubai", synthetic: true },
  { id: SITE_EMPTY, name: "Demo yard B (synthetic, no crews)", timezone: "Asia/Dubai", synthetic: true },
];

/*
 * One row per local hour, 05:00 to 19:00. WBGT p50 in degrees C, quantiles p50 -2 and p50 +2; level; midday ban.
 * Levels rise to orange for 13:00 to 15:00 local and the ban covers the 13:00 and 14:00 hours. 19:00 has no data.
 * crewShare is the share of crew-a above amber (crew-b is suppressed and never carries it).
 * action_codes stay empty: the backend ruleset owns the codes and none exists yet (ADR 0009).
 */
interface HourRow {
  hour: number;
  p50: number | null;
  level: Level | null;
  ban: boolean;
  crewShare: number | null;
}

const DAY: HourRow[] = [
  { hour: 5, p50: 21, level: "green", ban: false, crewShare: 0 },
  { hour: 6, p50: 22, level: "green", ban: false, crewShare: 0 },
  { hour: 7, p50: 23, level: "green", ban: false, crewShare: 0 },
  { hour: 8, p50: 24, level: "green", ban: false, crewShare: 0 },
  { hour: 9, p50: 25, level: "amber", ban: false, crewShare: 0.08 },
  { hour: 10, p50: 26, level: "amber", ban: false, crewShare: 0.17 },
  { hour: 11, p50: 27, level: "amber", ban: false, crewShare: 0.25 },
  { hour: 12, p50: 27, level: "amber", ban: false, crewShare: 0.33 },
  { hour: 13, p50: 28, level: "orange", ban: true, crewShare: 0.42 },
  { hour: 14, p50: 29, level: "orange", ban: true, crewShare: 0.5 },
  { hour: 15, p50: 28, level: "orange", ban: false, crewShare: 0.42 },
  { hour: 16, p50: 27, level: "amber", ban: false, crewShare: 0.25 },
  { hour: 17, p50: 25, level: "amber", ban: false, crewShare: 0.08 },
  { hour: 18, p50: 23, level: "green", ban: false, crewShare: 0 },
  { hour: 19, p50: null, level: null, ban: false, crewShare: null },
];

/** The instant of local `hour` on `date` (YYYY-MM-DD) at Asia/Dubai, as ISO 8601 UTC without milliseconds. */
function startsAt(date: string, hour: number): string {
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
  const instant = new Date(Date.UTC(year, month - 1, day, hour - DUBAI_UTC_OFFSET_HOURS));
  return instant.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function hourForecast(date: string, row: HourRow): Schemas["HourForecast"] {
  const { p50 } = row;
  return {
    starts_at: startsAt(date, row.hour),
    wbgt_c: p50 === null ? { p05: null, p50: null, p95: null } : { p05: p50 - 2, p50, p95: p50 + 2 },
    site_level: row.level,
    action_codes: [],
    ban_active: row.ban,
  };
}

export const FRESH_AGE_MS = 10 * 60 * 1000;
export const STALE_AGE_MS = 26 * 60 * 60 * 1000;

/** The forecast of `siteId` for the fixture day, generated `ageMs` before `now`. Unknown site: undefined. */
export function forecastToday(
  siteId: string,
  { ageMs = FRESH_AGE_MS, now = new Date() }: { ageMs?: number; now?: Date } = {},
): Schemas["SiteForecastToday"] | undefined {
  if (!sites.some((site) => site.id === siteId)) return undefined;
  return {
    site_id: siteId,
    date: FIXTURE_DATE,
    generated_at: new Date(now.getTime() - ageMs).toISOString(),
    policy_version: "mock-0",
    config_version: 1,
    hours: DAY.map((row) => hourForecast(FIXTURE_DATE, row)),
  };
}

export const riskPolicy: Schemas["RiskPolicy"] = {
  version: "mock-0",
  config_version: 1,
  k_suppression: 5,
  // The placeholder: Task 9's on-device tests count 10 days since heat-work start as acclimatised and 2 days as not.
  acclimatisation_days_required: 7,
  // Placeholders until B3's back-test sets the real probability cut-offs.
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

export const crews: Schemas["Crew"][] = [
  { id: "crew-a", site_id: SITE_DEMO, name: "Crew A (synthetic)", member_count: 12 },
  { id: "crew-b", site_id: SITE_DEMO, name: "Crew B (synthetic)", member_count: 3 },
];

/**
 * The crew's aggregate timeline for `date`. A crew smaller than k_suppression is suppressed: it keeps the crew
 * level but carries no share above amber (a share over three people would single them out).
 * Unknown crew: undefined.
 */
export function crewTimeline(crewId: string, date: string): Schemas["CrewTimeline"] | undefined {
  const crew = crews.find((candidate) => candidate.id === crewId);
  if (crew === undefined) return undefined;
  const suppressed = crew.member_count < riskPolicy.k_suppression;
  return {
    crew_id: crew.id,
    crew_name: crew.name,
    site_id: crew.site_id,
    date,
    suppressed,
    k: riskPolicy.k_suppression,
    hours: DAY.map((row) => ({
      starts_at: startsAt(date, row.hour),
      crew_level: row.level,
      share_above_amber: suppressed ? null : row.crewShare,
      ban_active: row.ban,
    })),
  };
}
