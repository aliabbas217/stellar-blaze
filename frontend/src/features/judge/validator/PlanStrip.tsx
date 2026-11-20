import { useTranslations, useLocale } from "next-intl";
import { PlanBars, type PlanMark } from "@/components/plan/PlanBars";
import type { BanState } from "@/components/spine/ban-state";
import { clockOf, parseTime, runProblem, type Run } from "./runs";
import type { ValidatorView } from "./view";
import { claimsLocale } from "@/i18n/claims-english";

/*
 * The plan on the day's heat, with the midday break cut through and each violation numbered on the bar it attaches to. The
 * heat behind it is the raw forecast of the replay day (colours come from the page, data only). Runs that do not read yet
 * (a half-typed time) are simply not drawn: the strip never guesses what a visitor meant. The violations are the API's, only
 * placed: nothing here decides that a plan breaks a rule.
 */

export interface PlanStripProps {
  readonly runs: readonly Run[];
  /** The API's verdict for exactly these runs, or null before a check (then no mark is drawn). */
  readonly validator: ValidatorView | null;
  readonly heat: readonly (string | null)[];
  readonly ban: BanState;
  readonly dateLabel: string;
}

export const STRIP_AXIS: { readonly from: number; readonly to: number } = { from: 5, to: 20 };

export function PlanStrip({ runs, validator, heat, ban, dateLabel }: PlanStripProps) {
  const t = useTranslations("judge.try");
  const locale = claimsLocale(useLocale());
  const drawn = runs.filter((run) => runProblem(run) === null).map((run) => ({ fromMin: minutes(run.start), toMin: minutes(run.end) }));
  const marks: PlanMark[] = (validator?.violations ?? []).flatMap((violation, i) => violation.ranges.map((range) => ({ n: i + 1, fromMin: range.fromMin, toMin: range.toMin })));
  const list = new Intl.ListFormat(locale, { type: "conjunction" });
  const runsText = list.format(drawn.map((bar) => t("runs.range", { from: clockOf(bar.fromMin), to: clockOf(bar.toMin) })));
  const status =
    validator === null ? t("strip.ariaNoMarks") : validator.violations.length === 0 ? t("strip.ariaClean") : validator.violations.length === 1 ? t("strip.ariaMarksOne") : t("strip.ariaMarks", { count: validator.violations.length });

  return (
    <div className="flex flex-col gap-2" data-plan-strip="">
      <PlanBars
        bars={drawn}
        marks={marks}
        heat={heat}
        ban={ban}
        fromHour={STRIP_AXIS.from}
        toHour={STRIP_AXIS.to}
        labels={{
          ariaLabel: t("strip.aria", { date: dateLabel, runs: runsText, marks: status }),
          slot: t("strip.slot"),
          outline: ban.kind === "not-in-force" && ban.resumesLabel !== null ? t("strip.outline", { date: ban.resumesLabel }) : t("strip.outlineUnknown"),
        }}
      />
      <p className="text-sm text-ink-3">{heat.some((colour) => colour !== null) ? t("strip.heatNote") : t("strip.noHeat")}</p>
    </div>
  );
}

function minutes(text: string): number {
  const parsed = parseTime(text);
  if (!("minutes" in parsed)) throw new RangeError(`not a time: ${text}`);
  return parsed.minutes;
}
