import { getLocale, getTranslations } from "next-intl/server";
import { DayChart, type DayChartLabels } from "@/components/charts/DayChart";
import { FrontierChart } from "@/components/charts/FrontierChart";
import { SeasonRibbon } from "@/components/charts/SeasonRibbon";
import { Counter } from "@/components/provenance/Counter";
import { ScoreboardTable, type ScoreRow } from "@/components/provenance/ScoreboardTable";
import { Verdict } from "@/components/provenance/Verdict";
import type { Proof } from "@/components/provenance/proof";
import { PendingBanner } from "@/components/states/PendingBanner";
import { banStateFrom } from "@/components/spine/ban-state";
import { ScoreboardSkeleton } from "@/features/judge/ScoreboardSkeleton";
import { loadHourly } from "@/features/judge/hourly";
import { makeFormat } from "@/features/judge/adapters";
import { SEASON_BAN } from "@/features/judge/ban";
import { HEAVY_WORK_LIMIT_WBGT_C } from "@/features/judge/limit";
import { parseRosterFrontier } from "@/features/judge/roster-frontier";
import { buildSeasonView } from "@/features/judge/season-view";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Cell, CellGrid } from "./Cell";

/*
 * The evidence components, drawn from the real recorded files: the season ribbon and its counts come from the committed
 * hourly forecast, the day chart from one real day of it, the frontier from the roster analysis. The scored cells carry
 * SAMPLE numbers and a sample proof (a kit specimen is never a result) so the table, the counter and the verdict can be
 * seen in every state: with proof, without proof (the number is not shown), and pending (### under one banner).
 */

const SAMPLE_PROOF: Proof = {
  what: "Sample number",
  protocol: "kit specimen, not a protocol line",
  protocolHref: null,
  script: "kit/sections/evidence.tsx",
  file: "static/omaa_2026_ifs_d1_wbgt_hourly.json",
  fileSha256: "0".repeat(64),
  sourceSha256: null,
  label: "SIMULATED",
  modelId: null,
  generatedAt: null,
};

export async function EvidenceSection() {
  const locale = await getLocale();
  const t = await getTranslations("judge.scoreboard");
  const tf = await getTranslations("judge.frontier");
  const tk = await getTranslations("common.kit.sample");
  const hourly = await loadHourly();
  const season = buildSeasonView({ ...hourly, locale, t });
  const format = makeFormat(locale);

  const columns = [
    { key: "missed", heading: t("warnings.columns.missed") },
    { key: "falseAlarm", heading: t("warnings.columns.falseAlarm") },
  ];
  const cell = (value: string, proof: Proof | null) => ({ value, interval: t("table.interval", { lo: "1.0", hi: "2.0" }), what: t("warnings.columns.missed"), proof });
  const rows = (proof: Proof | null): ScoreRow[] => [
    { id: "a", label: t("warnings.policies.P0.label"), sublabel: t("warnings.policies.P0.sub"), ours: false, cells: [cell("12.3", proof), cell("0.0", proof)] },
    { id: "b", label: t("warnings.policies.P3_protect.label"), sublabel: t("warnings.policies.P3_protect.sub"), ours: true, cells: [cell("4.5", proof), cell("21.0", proof)] },
  ];

  // One real day of the recorded forecast: the replay day when the file has it, otherwise the hottest day.
  const index = Math.max(0, hourly.series.days.indexOf("2026-09-03"));
  const raw = hourly.series.wbgt_c_by_local_hour[index] ?? [];
  const day = hourly.series.days[index] ?? "";
  const ban = banStateFrom(
    {
      start: SEASON_BAN.start,
      end: SEASON_BAN.end,
      season_start: SEASON_BAN.season_start,
      season_end: SEASON_BAN.season_end,
      timezone: "Asia/Dubai",
      starts_at: `${day}T08:30:00Z`,
      ends_at: `${day}T11:00:00Z`,
    },
    "Asia/Dubai",
    day,
    locale,
  );
  const outOfSeason = banStateFrom(
    { start: SEASON_BAN.start, end: SEASON_BAN.end, season_start: SEASON_BAN.season_start, season_end: SEASON_BAN.season_end, timezone: "Asia/Dubai", starts_at: null, ends_at: null },
    "Asia/Dubai",
    "2026-05-20",
    locale,
  );
  const dayLabels: DayChartLabels = {
    ariaLabel: `${day}: raw forecast, WBGT by local hour`,
    limit: t("season.limit", { limit: String(HEAVY_WORK_LIMIT_WBGT_C) }),
    slot: t("season.slotShort"),
    outline: "Midday break by law: not in force until 15 Jun",
    legend: { raw: "Raw forecast", ours: "Stellar Blaze, 5th to 95th percentile and median", truth: "Station truth" },
    peak: `${Math.max(...raw.filter((v): v is number => v !== null)).toFixed(1)} °C`,
  };
  const synthetic = (shift: number) => raw.map((v) => (v === null ? null : v + shift));

  const frontier = parseRosterFrontier(JSON.parse(await readFile(path.join(process.cwd(), "data", "static", "roster_frontier.json"), "utf8")) as unknown);
  const hours = new Intl.NumberFormat(`${locale}-u-nu-latn`, { maximumFractionDigits: 2 });

  return (
    <div className="flex flex-col gap-6">
      <CellGrid>
        <Cell caption="SeasonRibbon · the recorded season, with its table alternative" wide testId="evidence-ribbon">
          <SeasonRibbon {...season.ribbon} />
        </Cell>
        <Cell caption="SeasonRibbon · partway (upto 60) and compact" wide>
          <div className="grid gap-6 md:grid-cols-2">
            <SeasonRibbon {...season.ribbon} upto={60} />
            <SeasonRibbon {...season.ribbon} compact />
          </div>
        </Cell>
        <Cell caption="DayChart · raw forecast only (the other series do not exist yet)" wide testId="evidence-day-raw">
          <DayChart raw={raw} ban={ban} from={5} to={20} limitC={HEAVY_WORK_LIMIT_WBGT_C} labels={dayLabels} />
        </Cell>
        <Cell caption="DayChart · all three series (SAMPLE band and truth, offset from the raw), break not in force" wide>
          <DayChart
            raw={raw}
            ours={raw.map((v) => (v === null ? null : { p05: v - 1.4, p50: v - 0.4, p95: v + 1.1 }))}
            truth={synthetic(-0.3)}
            ban={outOfSeason}
            from={5}
            to={20}
            limitC={HEAVY_WORK_LIMIT_WBGT_C}
            labels={dayLabels}
          />
        </Cell>
        <Cell caption="Counter · mega, numeral, danger, interval" testId="evidence-counters">
          <div className="flex flex-col gap-6">
            <Counter size="mega" value={format.whole(season.facts.over)} unit={t("tally.hours")} proof={season.proofs.hours} />
            <Counter size="numeral" value={format.whole(season.facts.daysOver)} unit={t("tally.days", { limit: String(HEAVY_WORK_LIMIT_WBGT_C) })} interval={t("tally.daysOf", { total: format.whole(season.ribbon.days.length) })} proof={season.proofs.days} danger />
          </div>
        </Cell>
        <Cell caption="Counter · no proof: the value is not shown">
          <Counter size="numeral" value="1,624" unit={t("tally.hours")} proof={null} />
        </Cell>
        <Cell caption="Verdict · pending, then a sample sentence with a sample proof, then a sentence with no proof">
          <div className="flex flex-col gap-4">
            <Verdict sentence={null} proof={null} />
            <Verdict sentence={tk("verdictSample")} proof={SAMPLE_PROOF} />
            <Verdict sentence={tk("verdictSample")} proof={null} />
          </div>
        </Cell>
        <Cell caption="ScoreboardTable · scored (sample numbers), a row without proof, and ours last" wide>
          <div className="flex flex-col gap-6">
            <ScoreboardTable caption={t("warnings.caption")} rowHeading={t("warnings.columns.policy")} columns={columns} rows={rows(SAMPLE_PROOF)} />
            <ScoreboardTable caption={t("warnings.caption")} rowHeading={t("warnings.columns.policy")} columns={columns} rows={rows(null)} />
          </div>
        </Cell>
        <Cell caption="ScoreboardTable · pending: one banner, ### in every cell, no proof" wide testId="evidence-pending">
          <div className="flex flex-col gap-3">
            <PendingBanner what={t("warnings.pending")} />
            <ScoreboardTable caption={t("warnings.caption")} rowHeading={t("warnings.columns.policy")} columns={columns} rows={rows(null)} pending />
          </div>
        </Cell>
        <Cell caption="ScoreboardSkeleton · the loading state of the scoreboard route, at final size" wide testId="evidence-loading">
          <div role="status" aria-busy="true" aria-label={t("loading")} className="mx-auto flex w-full max-w-(--content-max) flex-col gap-10">
            <ScoreboardSkeleton />
          </div>
        </Cell>
        <Cell caption="FrontierChart · 45 minute commute, from the recorded roster analysis" wide>
          <FrontierChart
            data={frontier}
            commuteMin={45}
            formatHours={(h) => hours.format(h)}
            labels={{
              ariaLabel: tf("aria", { minutes: "45" }),
              xAxis: tf("xAxis"),
              yAxis: tf("yAxis"),
              gate: tf("gate", { hours: hours.format(frontier.assumptions.sleep_gate_h) }),
              legal: tf("baselineLegal"),
              common: tf("baselineCommon"),
              tableToggle: tf("tableToggle"),
              tableCaption: tf("tableCaption", { minutes: "45" }),
              columns: { roster: tf("columns.roster"), sleep: tf("columns.sleep"), exposure: tf("columns.exposure") },
            }}
          />
        </Cell>
      </CellGrid>
    </div>
  );
}
