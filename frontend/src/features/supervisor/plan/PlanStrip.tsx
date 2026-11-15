"use client";

import { useTranslations } from "next-intl";
import { PlanBars, PlanSwatch, type HeatCell, type PlanBlockState } from "@/components/plan/PlanBars";
import { formatClock } from "@/components/spine/geometry";
import type { BanState } from "@/components/spine/ban-state";
import type { PlanBlock } from "@/features/supervisor/plan/plan-model";

/*
 * The chart of the plan screen (F2 Task 20): the plan's blocks on the day's hours, the heat of each hour behind them, the midday
 * slot cut through where the break is in force, the now line, and a legend of what each bar shape means. It is the shared
 * presentational `PlanBars` fed with this screen's words; the blocks themselves are listed as rows under it (BlockRows), where
 * they can be read and touched. The heat note is shown only when heat is drawn (a stale or fallback forecast draws none).
 */

const LEGEND: readonly { readonly state: PlanBlockState; readonly key: "work" | "rest" | "art18" | "ban" | "stopped" }[] = [
  { state: "work", key: "work" },
  { state: "adosh_rest", key: "rest" },
  { state: "art18_break", key: "art18" },
  { state: "ban", key: "ban" },
  { state: "stopped", key: "stopped" },
];

export interface PlanStripProps {
  readonly crewName: string | null;
  readonly blocks: readonly PlanBlock[];
  readonly axis: { readonly from: number; readonly to: number };
  readonly heat: readonly (HeatCell | null)[];
  readonly ban: BanState;
  readonly nowMin: number | null;
}

export function PlanStrip({ crewName, blocks, axis, heat, ban, nowMin }: PlanStripProps) {
  const t = useTranslations("supervisor.plan");
  const present = new Set(blocks.map((block) => block.state));
  const drawsHeat = heat.some((cell) => cell !== null);
  const legend = LEGEND.filter((entry) => entry.state === "ban" ? ban.kind === "in-force" : present.has(entry.state));
  return (
    <div className="flex flex-col gap-2 px-4" data-plan-strip="">
      <PlanBars
        field
        slotThrough
        blocks={blocks.map((block) => ({ fromMin: block.fromMin, toMin: block.toMin, state: block.state }))}
        heat={heat}
        ban={ban}
        fromHour={axis.from}
        toHour={axis.to}
        nowMin={nowMin}
        labels={{
          ariaLabel: t("strip.aria", { crew: crewName ?? t("titleGeneric"), from: formatClock(axis.from), to: formatClock(axis.to) }),
          slot: t("strip.slot"),
          outline: ban.kind === "not-in-force" && ban.resumesLabel !== null ? t("strip.outline", { date: ban.resumesLabel }) : t("strip.outlineUnknown"),
        }}
      />
      <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-base text-ink-2" data-plan-legend="">
        {legend.map((entry) => (
          <li key={entry.key} className="flex items-center gap-2">
            <PlanSwatch state={entry.state} />
            {t(`legend.${entry.key}`)}
          </li>
        ))}
        {nowMin === null ? null : (
          <li className="flex items-center gap-2">
            <span aria-hidden="true" className="inline-block h-4 w-0.5 bg-signal" />
            {t("legend.now")}
          </li>
        )}
      </ul>
      {drawsHeat ? <p className="text-sm text-ink-3">{t("strip.heatNote")}</p> : null}
    </div>
  );
}
