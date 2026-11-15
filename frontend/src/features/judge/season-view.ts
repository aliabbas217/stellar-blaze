import type { useTranslations } from "next-intl";
import { dayFormat, type DayFormat } from "@/components/charts/day-format";
import type { RibbonLabels, RibbonTick, SeasonRibbonProps } from "@/components/charts/SeasonRibbon";
import type { Proof } from "@/components/provenance/proof";
import { makeFormat } from "./adapters";
import { SEASON_BAN } from "./ban";
import { FORECAST_CLAIMS, forecastClaims, type Claim } from "./claims";
import { cumulativeTally, seasonFacts, type HourlySeries, type SeasonFacts, type TallyPoint } from "./facts";
import { HEAVY_WORK_LIMIT_WBGT_C } from "./limit";

/*
 * The season of the recorded forecast, ready to draw: the counts (`seasonFacts`), the ribbon's props with every label
 * worded and formatted for the reader, the running tally for the player, and the claims (with their proofs) behind the
 * counters. One builder for the scoreboard and the kit page, so they can never disagree about what the season says.
 */

export type JudgeT = ReturnType<typeof useTranslations<"judge.scoreboard">>;

export interface SeasonView {
  readonly facts: SeasonFacts;
  readonly ribbon: Omit<SeasonRibbonProps, "upto">;
  readonly tally: readonly TallyPoint[];
  readonly claims: readonly Claim[];
  readonly proofs: { readonly days: Proof | null; readonly hours: Proof | null; readonly inBan: Proof | null };
  /** First and last day of the series, worded ("15 May", "30 Sep"). */
  readonly firstDay: string;
  readonly lastDay: string;
}

export interface SeasonViewInput {
  readonly series: HourlySeries;
  readonly file: { readonly path: string; readonly sha256: string };
  readonly source: string;
  readonly locale: string;
  readonly t: JudgeT;
}

const hourText = (hour: number): string => `${String(hour).padStart(2, "0")}:00`;

/** The first day, the first of each month and the last day. The months between are `minor`: dropped on a phone. */
function monthTicks(days: readonly string[], f: DayFormat): RibbonTick[] {
  const last = days.length - 1;
  const ticks: RibbonTick[] = [];
  days.forEach((day, i) => {
    if (i === 0 || i === last) ticks.push({ index: i, label: f.dayMonth(day) });
    else if (day.endsWith("-01")) ticks.push({ index: i, label: f.month(day), minor: ticks.length % 2 === 1 });
  });
  return ticks;
}

export function buildSeasonView({ series, file, source, locale, t }: SeasonViewInput): SeasonView {
  const limit = HEAVY_WORK_LIMIT_WBGT_C;
  const facts = seasonFacts(series, SEASON_BAN, limit);
  const tally = cumulativeTally(series, SEASON_BAN, limit);
  const format = makeFormat(locale);
  const f = dayFormat(locale);
  const days = series.days;
  const firstDay = f.dayMonth(days[0] ?? "");
  const lastDay = f.dayMonth(days[days.length - 1] ?? "");
  const ban = facts.ban;
  const slotText = ban === null
    ? ""
    : t("season.slot", {
        from: f.dayMonth(days[ban.fromIndex] ?? ""),
        to: f.dayMonth(days[ban.toIndex] ?? ""),
        start: SEASON_BAN.start,
        end: SEASON_BAN.end,
      });
  const limitText = String(limit);
  const highestDay = f.dayMonth(days[facts.pkI] ?? "");

  const labels: RibbonLabels = {
    ariaLabel: t(ban === null ? "season.ariaNoBreak" : "season.aria", {
      days: String(days.length),
      from: firstDay,
      to: lastDay,
      daysOver: String(facts.daysOver),
      limit: limitText,
      lowest: facts.lo.toFixed(1),
      highest: facts.pk.toFixed(1),
      highestDay,
      slot: slotText,
    }),
    limit: t("season.limit", { limit: limitText }),
    slot: slotText,
    slotShort: t("season.slotShort"),
    peak: t("season.peak", { value: facts.pk.toFixed(1), day: highestDay, hour: hourText(facts.pkH) }),
    coolest: t("season.coolest", { value: facts.lo.toFixed(1), day: f.dayMonth(days[facts.loI] ?? "") }),
    tableToggle: t("season.tableToggle"),
    tableCaption: t("season.tableCaption"),
    columns: {
      day: t("season.columns.day"),
      peak: t("season.columns.peak"),
      over: t("season.columns.over"),
      inBreak: t("season.columns.inBreak"),
    },
    yes: t("season.yes"),
    no: t("season.no"),
  };

  const claims = forecastClaims(
    facts,
    { file, protocol: source },
    format,
    {
      daysOverLimit: t("tally.whatDays"),
      hoursOverLimit: t("tally.whatHours"),
      hoursInBreak: t("tally.whatInBreak"),
      units: { days: t("tally.days", { limit: limitText }), hours: t("tally.hours"), inBreak: t("tally.inBreak") },
    },
  );
  const proofOf = (id: string): Proof | null => claims.find((claim) => claim.id === id)?.proof ?? null;

  return {
    facts,
    ribbon: {
      days,
      dayLabels: days.map((day) => f.withWeekday(day)),
      peaks: facts.peaks,
      perDay: facts.perDay,
      ban,
      limitC: limit,
      ticks: monthTicks(days, f),
      labels,
    },
    tally,
    claims,
    proofs: { days: proofOf(FORECAST_CLAIMS.days), hours: proofOf(FORECAST_CLAIMS.hours), inBan: proofOf(FORECAST_CLAIMS.inBan) },
    firstDay,
    lastDay,
  };
}
