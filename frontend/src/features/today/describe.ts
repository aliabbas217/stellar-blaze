import type { components } from "@/api/schema";
import type { LevelKind } from "@/components/level/LevelScale";
import { levelIndex, type Level } from "@/components/level/level";
import { banStateFrom, type BanState } from "@/components/spine/ban-state";
import type { SpineCell } from "@/components/spine/TimeSpine";
import { actionPlan, type ActionPlan } from "@/features/today/action-codes";
import { hourOfDay, levelRun, localDate, waypointSpecs, type WaypointSpec } from "@/features/today/schedule";
import type { TodayViewModel } from "@/features/today/useSiteToday";

/*
 * What the Today screen shows, decided from the answers it has (F2 Task 16). Pure and total: the view words it, this decides
 * it, and nothing here reads a clock or a locale beyond its inputs.
 *
 * The rules it keeps (F2 review focus):
 *  - A level is "live" only for a current forecast on a connected phone. A stale forecast (the API says so, or it is older
 *    than three hours) and any forecast on a phone that reports no connection are the LAST KNOWN level, with the time they were
 *    written and their age. A fallback forecast has no level at all: the site rules stand in.
 *  - A last known level is SECONDARY (F2 W1, I2): it keeps the sign (dimmed, with the clock and the dashed marker) and the banner
 *    that says when it was written and how old it is, and nothing else is drawn from it. The lead is the protective site rules
 *    (never the stale hour's own cycle or "Also now" lines), the spine's cells carry no heat colour and there is no line at now,
 *    and no "until" is promised. A stale hour read as current ("Work 20 min, rest 40 min in shade") is a wrong instruction.
 *  - A forecast that does not cover now (another day, an empty list) has no level and no personal level: the site rules.
 *  - The age counts from the phone's own clock. The replay clock is a recorded morning months ago; a forecast is "26 h old"
 *    by how long ago it was written, not by how far it is from the replayed hour.
 *  - No slot where the midday break is not in force; the day's note says so instead.
 */

type Forecast = components["schemas"]["SiteForecastToday"];
type Timeline = components["schemas"]["CrewTimeline"];

export interface DescribeInput {
  readonly view: TodayViewModel;
  /** The crew's timeline for the same day, or null while it loads, failed, or the phone has no crew. */
  readonly timeline: Timeline | null;
  /** The browser reports no connection. */
  readonly offline: boolean;
  /** The instant the screen treats as now (the replay clock in replay mode). */
  readonly now: Date;
  /** The phone's own clock: the age of a forecast counts from it. */
  readonly deviceNow: Date;
  /** The site's zone. */
  readonly zone: string;
  readonly locale: string;
}

export type Kicker = "site" | "personal" | "protective" | "noHour";

export interface Banner {
  readonly kind: "stale" | "offline";
  /** When the forecast on screen was written. */
  readonly updatedAt: Date;
  readonly ageMs: number;
}

/** Why there is no slot: the date is after the season (the break ended) or before it (it has not begun). */
export interface BanNote {
  readonly phase: "after" | "before";
  /** `MM-DD`, the API's own. */
  readonly seasonEnd: string;
  /** "15 Jun", when the break next applies, or null when unknown. */
  readonly resumes: string | null;
}

/**
 * The level the sign shows while the forecast is not live: High, which the level vocabulary writes "orange" (ADR 0046 decision 3:
 * Low green, Medium amber, High orange, Red red). ADR 0058 decision 4 and its 2026-11-15 clarification: with no usable forecast
 * (fallback) or a stale one, the plan treats every on-shift tick as High, "the most severe workable zone; never less protective
 * than the ban", and labels it "No fresh forecast: protective plan". The sign says the same level the plan uses.
 */
export const PROTECTIVE_LEVEL: Level = "orange";

export interface TodayDescription {
  /** The level on the sign: the protective level in a not-live state; null shows "Site rules" with no marker (live, no hour now). */
  readonly level: Level | null;
  readonly levelKind: LevelKind;
  readonly kicker: Kicker;
  /** The end of the site level's run; null for a personal level (its run is not forecast) and when there is no level. */
  readonly untilAt: Date | null;
  /** The worker's own level is strictly above the site's: the screen says so. */
  readonly personalHigher: boolean;
  /** The worker has a profile and the phone could not work their level out: the screen says why the site level is shown. */
  readonly personalUnavailable: boolean;
  readonly banner: Banner | null;
  /** The forecast on screen is last known, not live (stale, or the phone is offline): nothing is drawn from it as current. */
  readonly lastKnown: boolean;
  /** No live forecast to act on: stale, offline or fallback. The protective-plan lead is the hero of the screen (F2 W3.2). */
  readonly notLive: boolean;
  /** The last known level of a stale or offline forecast: shown secondary and dashed beside the protective sign, never as current. */
  readonly lastKnownLevel: Level | null;
  /** There is no level to act on, or only a last known one: the lead is the protective site rules, in fixed words. */
  readonly protective: boolean;
  readonly plan: ActionPlan;
  readonly cells: readonly SpineCell[];
  readonly from: number;
  readonly to: number;
  /** The hour of the site's day now, or null when the forecast is for another day. */
  readonly nowHour: number | null;
  readonly ban: BanState;
  readonly banNote: BanNote | null;
  readonly waypoints: readonly WaypointSpec[];
  /** The crew's timeline is loaded for this day and its shift is empty. */
  readonly noShift: boolean;
  readonly crewName: string | null;
}

const DEFAULT_FROM = 6;
const DEFAULT_TO = 18;

/** The crew's timeline when it is for the forecast's own day, else null: a shift of another day is not this day's. */
function sameDay(timeline: Timeline | null, forecast: Forecast): Timeline | null {
  return timeline !== null && timeline.date === forecast.date ? timeline : null;
}

function shiftSpan(timeline: Timeline | null, zone: string): { from: number; to: number; endHour: number | null } {
  const ranges = timeline?.shift ?? [];
  if (ranges.length === 0) return { from: DEFAULT_FROM, to: DEFAULT_TO, endHour: null };
  const starts = ranges.map((range) => hourOfDay(new Date(range.starts_at), zone));
  const ends = ranges.map((range) => hourOfDay(new Date(range.ends_at), zone));
  const from = Math.floor(Math.min(...starts));
  const endHour = Math.max(...ends);
  const to = Math.ceil(endHour);
  // A shift that crosses midnight, or a malformed one, would draw a backwards spine: the usual day instead.
  return to > from ? { from, to, endHour } : { from: DEFAULT_FROM, to: DEFAULT_TO, endHour: null };
}

function banNoteOf(forecast: Forecast, ban: BanState): BanNote | null {
  if (ban.kind === "in-force") return null;
  const { season_start: seasonStart, season_end: seasonEnd } = forecast.ban_window;
  const monthDay = forecast.date.slice(5);
  // The season does not wrap the new year in the UAE ruleset; if it ever does, "before" is the honest wording of "not now".
  const phase = seasonStart <= seasonEnd && monthDay > seasonEnd ? "after" : "before";
  return { phase, seasonEnd, resumes: ban.resumesLabel };
}

export function describeToday(input: DescribeInput): TodayDescription {
  const { view, offline, now, deviceNow, zone, locale } = input;
  const { forecast } = view;
  const fallback = forecast.forecast_status === "fallback";
  const stale = !fallback && (forecast.forecast_status === "stale" || view.freshness === "stale");
  const timeline = sameDay(input.timeline, forecast);

  const displayed = fallback ? null : view.displayed;
  // Offline is only a lower bound on "not live" (see useOffline), and a stale forecast is never live: either way it is last known.
  const lastKnown = stale || offline;
  const notLive = fallback || lastKnown;
  const lastKnownLevel = lastKnown && !fallback ? (displayed?.level ?? null) : null;
  // Not live: the sign shows the PROTECTIVE level (what the plan uses), dashed; the level the forecast last gave is secondary.
  const level = notLive ? PROTECTIVE_LEVEL : (displayed?.level ?? null);
  const levelKind: LevelKind = notLive || level === null ? "fallback" : "live";
  const kicker: Kicker = notLive ? "protective" : level === null ? "noHour" : displayed?.source === "personal" ? "personal" : "site";

  const run = displayed?.source === "site" && !notLive ? levelRun(forecast.hours, now) : null;
  const personalHigher =
    !notLive &&
    level !== null &&
    view.personal.status === "available" &&
    view.siteLevel !== null &&
    levelIndex(view.personal.value.level) > levelIndex(view.siteLevel);
  const personalUnavailable =
    view.personal.status === "unavailable" &&
    (view.personal.reason === "policy-unavailable" || view.personal.reason === "version-mismatch" || view.personal.reason === "not-computable");

  const generatedAt = new Date(forecast.generated_at);
  const banner: Banner | null =
    offline || stale ? { kind: offline ? "offline" : "stale", updatedAt: generatedAt, ageMs: deviceNow.getTime() - generatedAt.getTime() } : null;

  const span = shiftSpan(timeline, zone);
  const nowHour = localDate(now, zone) === forecast.date ? hourOfDay(now, zone) : null;
  const ban = banStateFrom(forecast.ban_window, zone, forecast.date, locale);
  // No heat colour from a forecast that is not live: a null cell is drawn in the hair colour (no data), never as a level.
  const cells: SpineCell[] = forecast.hours.map((hour) => ({
    hour: Math.floor(hourOfDay(new Date(hour.starts_at), zone)),
    wbgtC: fallback || lastKnown ? null : hour.wbgt_c.p50,
  }));
  // The waypoints that come from the clock and the day's own rules (the break, the shift's end) stay; "Now" is a claim about the
  // hour's heat on a forecast that no longer vouches for it, so it goes with the line: in EVERY not-live state, the fallback's
  // included (a fallback has no last-known level, but it has no hour to point at either: F2 W4 I1).
  const waypoints = waypointSpecs({ nowHour, ban, shiftEndHour: span.endHour, from: span.from, to: span.to }).filter(
    (spec) => !(notLive && spec.kind === "now"),
  );

  return {
    level,
    levelKind,
    kicker,
    untilAt: run?.endsAt ?? null,
    personalHigher,
    personalUnavailable,
    banner,
    lastKnown,
    notLive,
    lastKnownLevel,
    protective: level === null || notLive,
    // The hour's codes are read only from a live forecast (a fallback one has no level to act on either): no codes is "Follow the
    // site rules" and no extra lines.
    plan: actionPlan(lastKnown || fallback ? [] : (view.currentHour?.action_codes ?? [])),
    cells,
    from: span.from,
    to: span.to,
    nowHour: notLive ? null : nowHour,
    ban,
    banNote: banNoteOf(forecast, ban),
    waypoints,
    noShift: timeline !== null && timeline.shift.length === 0,
    crewName: timeline?.crew_name ?? null,
  };
}
