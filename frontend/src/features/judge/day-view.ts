import type { useTranslations } from "next-intl";
import type { components } from "@/api/schema";
import { dayFormat } from "@/components/charts/day-format";
import type { DayChartLabels, DayQuantiles } from "@/components/charts/DayChart";
import { proofFromProvenance, proofFromStaticFile, type Proof } from "@/components/provenance/proof";
import { banStateFor, SEASON_BAN, SITE_TZ } from "./ban";
import { REPLAY_DATE } from "@/features/demo/constants";
import { makeFormat } from "./adapters";
import { HEAVY_WORK_LIMIT_WBGT_C } from "./limit";
import type { HourlySeries } from "./facts";

/*
 * The day the day-zoom page draws, ready to draw. One builder, so the chart, its table and its counters can never disagree.
 *
 * WHICH DAY: whatever `demo_day.json` says (the pre-registered rule: most observed High-zone working hours outside the ban,
 * ties to the earliest date). Until the scoring run writes it there is no scored day, so the page draws the raw hourly series
 * of the replay day (`REPLAY_DATE`; the hottest raw forecast of the recorded season) and nothing else: no "ours", no truth,
 * `###` counters. The ban comes from the drift-tested `SEASON_BAN` (ban.ts): this page is static and reads no API.
 * The hours of the scored file are UTC hour starts; they are placed on the axis by their site-local hour.
 */

type DemoDay = components["schemas"]["DemoDay"];
export type DayT = ReturnType<typeof useTranslations<"judge.day">>;

/** The hours the axis shows, local: the working day with a margin either side (the prototype drew 05:00 to 20:00). */
export const AXIS: { readonly from: number; readonly to: number } = { from: 5, to: 20 };

const LOCAL_HOUR = new Intl.DateTimeFormat("en-US", { timeZone: SITE_TZ, hourCycle: "h23", hour: "2-digit" });

/** The site-local hour (0 to 23) an instant falls in. */
export function localHourOf(instant: string): number {
  const at = new Date(instant);
  if (Number.isNaN(at.getTime())) throw new RangeError(`not an instant: ${instant}`);
  return Number(LOCAL_HOUR.formatToParts(at).find((part) => part.type === "hour")?.value ?? "NaN");
}

export interface DayTableRow {
  readonly hour: number;
  readonly raw: string | null;
  readonly ours: string | null;
  readonly truth: string | null;
  /** The midday break covers this hour (or part of it): the text of the break column, or null. */
  readonly inBreak: string | null;
}

export interface DayCounter {
  readonly id: "high" | "outside" | "p1" | "raw" | "ours" | "balanced";
  readonly label: string;
  readonly value: string;
  readonly unit: string;
  readonly proof: Proof | null;
}

export interface DayModel {
  /** The date shown, `YYYY-MM-DD`. */
  readonly date: string;
  readonly dateLabel: string;
  /** True when the day is the scored one (a `demo_day.json` was read), false for the raw-only day. */
  readonly scored: boolean;
  /** Index by local hour 0 to 23. */
  readonly raw: readonly (number | null)[];
  readonly ours: readonly (DayQuantiles | null)[] | undefined;
  readonly truth: readonly (number | null)[] | undefined;
  readonly ban: ReturnType<typeof banStateFor>;
  readonly labels: DayChartLabels;
  readonly rows: readonly DayTableRow[];
  /** The four counters, or null while there is no scored day (the page then shows `###` under one banner). */
  readonly counters: readonly DayCounter[] | null;
  /** The proof behind "Read the day rule": the scored file's, or the recorded forecast file's while pending. */
  readonly ruleProof: Proof;
  readonly candidates: number | null;
  readonly runnerUp: string | null;
}

export interface DayInput {
  readonly day: DemoDay | null;
  readonly dayFile: { readonly path: string; readonly sha256: string } | null;
  readonly hourly: { readonly series: HourlySeries; readonly file: { readonly path: string; readonly sha256: string }; readonly source: string };
  readonly locale: string;
  readonly t: DayT;
}

const clock = (hour: number): string => `${String(hour).padStart(2, "0")}:00`;

function fill<T>(): (T | null)[] {
  return Array.from({ length: 24 }, () => null);
}

export function buildDay({ day, dayFile, hourly, locale, t }: DayInput): DayModel {
  const f = dayFormat(locale);
  const fmt = makeFormat(locale);
  const { series } = hourly;
  const limit = HEAVY_WORK_LIMIT_WBGT_C;

  // The day to draw: the scored one, else the replay day when the recorded season has it, else its hottest day.
  const scored = day !== null;
  const seasonRow = (date: string): readonly (number | null)[] | null => {
    const at = series.days.indexOf(date);
    return at < 0 ? null : (series.wbgt_c_by_local_hour[at] ?? null);
  };
  const peakDate = (): string => {
    let best = 0;
    let bestValue = -Infinity;
    series.wbgt_c_by_local_hour.forEach((row, i) => {
      const peak = Math.max(...row.filter((v): v is number => v !== null));
      if (peak > bestValue) {
        bestValue = peak;
        best = i;
      }
    });
    return series.days[best] ?? REPLAY_DATE;
  };
  const date = day?.date ?? (series.days.includes(REPLAY_DATE) ? REPLAY_DATE : peakDate());

  const raw = fill<number>();
  seasonRow(date)?.forEach((value, hour) => {
    if (hour < 24) raw[hour] = value;
  });
  let ours: (DayQuantiles | null)[] | undefined;
  let truth: (number | null)[] | undefined;
  if (day !== null) {
    ours = fill<DayQuantiles>();
    truth = fill<number>();
    for (const hour of day.hours) {
      const at = localHourOf(hour.starts_at);
      // The scored file's own raw forecast wins over the recorded season file where both have the hour.
      if (hour.raw_wbgt_c !== null) raw[at] = hour.raw_wbgt_c;
      truth[at] = hour.truth_wbgt_c;
      const q = hour.corrected_wbgt_c;
      ours[at] = q === null ? null : { p05: q.p05, p50: q.p50, p95: q.p95 };
    }
  }

  const ban = banStateFor(SEASON_BAN, date, locale);
  const dateLabel = f.withWeekday(date);

  let peakHour: number | null = null;
  for (let h = AXIS.from; h <= AXIS.to; h++) {
    const value = raw[h];
    if (value !== null && value !== undefined && (peakHour === null || value > (raw[peakHour] ?? -Infinity))) peakHour = h;
  }
  const peakValue = peakHour === null ? null : (raw[peakHour] ?? null);
  const peakText = peakHour !== null && peakValue !== null ? t("chart.peak", { value: peakValue.toFixed(1), hour: clock(peakHour) }) : null;
  const seriesAria = [t("chart.ariaRaw"), ours === undefined ? "" : t("chart.ariaOurs"), truth === undefined ? "" : t("chart.ariaTruth")]
    .filter((s) => s !== "")
    .join(" ");
  const station = day?.station ?? series.station;

  const labels: DayChartLabels = {
    ariaLabel: t("chart.aria", {
      station,
      date: dateLabel,
      from: clock(AXIS.from),
      to: clock(AXIS.to),
      series: seriesAria,
      limit: String(limit),
      peak: peakHour !== null && peakValue !== null ? t("chart.ariaPeak", { value: peakValue.toFixed(1), hour: clock(peakHour) }) : "",
    }),
    limit: t("chart.limit", { limit: String(limit) }),
    slot: t("chart.slot"),
    outline: ban.kind === "not-in-force" && ban.resumesLabel !== null ? t("chart.outline", { date: ban.resumesLabel }) : t("chart.outlineUnknown"),
    legend: { raw: t("chart.raw"), ours: t("chart.ours"), truth: t("chart.truth") },
    // The note sits on the raw line; with ours and truth drawn it would sit on top of them, so it is for the raw-only day (the peak is in the chart label and the table).
    peak: scored ? null : peakText,
  };

  const rows: DayTableRow[] = [];
  for (let hour = AXIS.from; hour <= AXIS.to; hour++) {
    const o = ours?.[hour] ?? null;
    const covers = ban.kind === "in-force" && hour + 1 > ban.fromHour && hour < ban.toHour;
    const inBreak = ban.kind === "in-force" && covers ? (hour < ban.fromHour ? t("table.from", { time: SEASON_BAN.start }) : t("table.yes")) : null;
    rows.push({
      hour,
      raw: raw[hour] === null || raw[hour] === undefined ? null : (raw[hour] ?? 0).toFixed(1),
      ours: o === null || o.p05 === null || o.p95 === null ? null : t("table.range", { lo: o.p05.toFixed(1), hi: o.p95.toFixed(1) }),
      truth: truth?.[hour] === null || truth?.[hour] === undefined ? null : (truth[hour] ?? 0).toFixed(1),
      inBreak,
    });
  }

  const ruleWhat = t("rule.what");
  const ruleProof =
    day !== null && dayFile !== null
      ? (proofFromProvenance(day.provenance, "", ruleWhat, dayFile) ?? recordedProof(hourly, ruleWhat))
      : recordedProof(hourly, ruleWhat);

  let counters: DayCounter[] | null = null;
  if (day !== null && dayFile !== null) {
    // Hours are counted whole; a partly banned hour counts its fraction, so only then is there a decimal.
    const count = (value: number): string => (Number.isInteger(value) ? fmt.whole(value) : fmt.one(value));
    const entry = (id: DayCounter["id"], label: string, value: number, of?: number): DayCounter => ({
      id,
      label,
      value: of === undefined ? count(value) : t("counters.of", { n: count(value), total: count(of) }),
      unit: label,
      proof: proofFromProvenance(day.provenance, "", label, dayFile, { claim: `day.${id}` }),
    });
    counters = [
      entry("high", t("counters.high"), day.high_hours),
      entry("outside", t("counters.outside", { start: SEASON_BAN.start, end: SEASON_BAN.end }), day.high_hours_outside_ban),
      // "of N": the hours the station recorded in the High or Red zone. P1 (the fixed 32 degree rule) and P2 (the ADOSH zones) both read
      // the raw forecast; the file's own `raw_hits` is P2's, so the label names the policy and P1's count is its own counter.
      entry("p1", t("counters.p1"), hitsBy(day, "P1"), day.high_hours),
      entry("raw", t("counters.raw"), day.raw_hits, day.high_hours),
      entry("ours", t("counters.ours"), day.p3_hits, day.high_hours),
      entry("balanced", t("counters.balanced"), hitsBy(day, "P3_balanced"), day.high_hours),
    ];
  }

  return {
    date,
    dateLabel,
    scored,
    raw,
    ours,
    truth,
    ban,
    labels,
    rows,
    counters,
    ruleProof,
    candidates: day?.candidates ?? null,
    runnerUp: day?.runner_up === null || day === null ? null : f.dayMonth(day.runner_up.date),
  };
}

/**
 * The hours of the scored day that were High or Red on the station and that the policy `warnedBy` named warned about, counted the way the
 * file counts its own `raw_hits` (P2) and `p3_hits` (P3_protect): each hour weighted by its `ban_weight`. The balanced-threshold count has no
 * field of its own in the file; it is counted from the same hours, and a test pins the method against the two fields that do exist.
 */
export function hitsBy(day: DemoDay, policy: DemoDay["hours"][number]["warned_by"][number]): number {
  return day.hours.filter((hour) => hour.truth_zone === "high" || hour.truth_zone === "red").filter((hour) => hour.warned_by.includes(policy)).reduce((sum, hour) => sum + hour.ban_weight, 0);
}

/** While there is no scored day, "the day rule" is proved by what the page does draw: the recorded forecast file. */
function recordedProof(hourly: DayInput["hourly"], what: string): Proof {
  return proofFromStaticFile(hourly.file, what, { protocol: hourly.source, script: "backend/eval/demo_day.py (writes demo_day.json after the scoring run)", label: "RECORDED" });
}
