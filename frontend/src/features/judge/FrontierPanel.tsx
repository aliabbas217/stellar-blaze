"use client";

import { useLocale, useTranslations } from "next-intl";
import { useId, useMemo } from "react";
import { COMMUTES, FrontierChart, type Commute } from "@/components/charts/FrontierChart";
import { Counter } from "@/components/provenance/Counter";
import { useUrlParam } from "@/lib/url-state";
import { makeFormat } from "./adapters";
import { FRONTIER_LEGAL_ID, frontierBestId, frontierClaims, type FrontierSource } from "./claims";
import type { RosterFrontier } from "./roster-frontier";

/*
 * The roster frontier with its commute slider. The commute is the `commute` query parameter, so a link reproduces the
 * screen (global constraint: filters and sliders live in the URL); the default is not written to the URL. A bad or
 * missing value reads as the default. The panel is the only client code of the frontier section: it needs the URL, which a
 * static page cannot read on the server. `FrontierSection` wraps it in <Suspense> with the same chart as the fallback.
 */

export const DEFAULT_COMMUTE: Commute = 45;
export const COMMUTE_PARAM = "commute";

/** The commute a query value names; throws for anything but one of the six the analysis ran (so it reads as the default). */
export function parseCommute(raw: string | null): Commute {
  const value = Number(raw);
  const found = COMMUTES.find((minutes) => minutes === value);
  if (raw === null || raw.trim() === "" || found === undefined) throw new RangeError(`not a commute: ${String(raw)}`);
  return found;
}

export interface FrontierPanelProps {
  readonly data: RosterFrontier;
  readonly source: FrontierSource;
}

/** The text and numbers of a frontier at one commute; shared by the live panel and its server-rendered fallback. */
export function useFrontierText(data: RosterFrontier) {
  const t = useTranslations("judge.frontier");
  const locale = useLocale();
  const format = useMemo(() => makeFormat(locale), [locale]);
  const hours = useMemo(() => new Intl.NumberFormat(`${locale}-u-nu-latn`, { maximumFractionDigits: 2 }), [locale]);
  const labels = (minutes: Commute) => ({
    ariaLabel: t("aria", { minutes: String(minutes) }),
    xAxis: t("xAxis"),
    yAxis: t("yAxis"),
    gate: t("gate", { hours: hours.format(data.assumptions.sleep_gate_h) }),
    legal: t("baselineLegal"),
    common: t("baselineCommon"),
    tableToggle: t("tableToggle"),
    tableCaption: t("tableCaption", { minutes: String(minutes) }),
    columns: { roster: t("columns.roster"), sleep: t("columns.sleep"), exposure: t("columns.exposure") },
  });
  return { t, format, formatHours: (h: number) => hours.format(h), labels };
}

export function FrontierPanel({ data, source }: FrontierPanelProps) {
  const [commute, setCommute] = useUrlParam(COMMUTE_PARAM, parseCommute, DEFAULT_COMMUTE);
  const { t, format, formatHours, labels } = useFrontierText(data);
  const sliderId = useId();

  const gate = data.frontier_absolute_gate.find((g) => g.commute_min === commute);
  const best = gate?.avoided_vs_legal_default_ge30 ?? null;
  const claims = frontierClaims(data, source, format, { best: (minutes) => t("whatBest", { minutes: String(minutes) }), legal: t("whatLegal") });
  const bestClaim = claims.find((claim) => claim.id === frontierBestId(commute));
  const legalClaim = claims.find((claim) => claim.id === FRONTIER_LEGAL_ID);

  return (
    <div className="flex flex-col gap-6" data-frontier-panel="" data-commute={commute}>
      <div className="flex flex-col gap-2">
        <label htmlFor={sliderId} className="flex items-baseline justify-between gap-4 text-base font-medium text-ink">
          <span>{t("commute")}</span>
          <output htmlFor={sliderId} className="tabular-nums text-ink">
            {t("commuteValue", { minutes: String(commute) })}
          </output>
        </label>
        <input
          id={sliderId}
          type="range"
          min={COMMUTES[0]}
          max={COMMUTES[COMMUTES.length - 1]}
          step={15}
          value={commute}
          aria-valuetext={t("commuteValue", { minutes: String(commute) })}
          onChange={(event) => {
            try {
              setCommute(parseCommute(event.currentTarget.value));
            } catch {
              // a value the slider cannot produce: keep the current one
            }
          }}
          className="h-11 w-full cursor-pointer accent-signal"
        />
        <div aria-hidden className="flex justify-between px-2 text-sm text-ink-3 tabular-nums">
          {COMMUTES.map((minutes) => (
            <span key={minutes}>{minutes}</span>
          ))}
        </div>
      </div>

      <FrontierChart data={data} commuteMin={commute} labels={labels(commute)} formatHours={formatHours} />

      <div className="grid gap-6 sm:grid-cols-2" data-frontier-readouts="">
        <div className="flex flex-col gap-2 border-t border-edge pt-3">
          <h3 className="text-sm font-medium text-ink-3">{t("bestTitle")}</h3>
          {best === null || best === 0 ? (
            <p className="max-w-(--measure) text-base text-ink" data-frontier-best="none">
              {t("bestNone")}
            </p>
          ) : (
            <Counter
              size="numeral"
              value={bestClaim?.value ?? format.percentOne(best)}
              unit={t("bestUnit", { hours: formatHours(data.assumptions.sleep_gate_h) })}
              proof={bestClaim?.proof ?? null}
            />
          )}
        </div>
        <div className="flex flex-col gap-2 border-t border-edge pt-3">
          <h3 className="text-sm font-medium text-ink-3">{t("legalTitle")}</h3>
          <Counter
            size="numeral"
            value={legalClaim?.value ?? ""}
            unit={t("legalUnit")}
            proof={legalClaim?.proof ?? null}
          />
        </div>
      </div>
    </div>
  );
}
