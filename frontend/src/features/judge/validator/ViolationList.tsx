import { useLocale, useTranslations } from "next-intl";
import { clockOf } from "./runs";
import type { ViolationView } from "./view";

/**
 * The rules a plan breaks, as the API answered, numbered like the marks on the plan strip: the rule id in mono (an
 * identifier, never translated), the clause text only when the API sent some (a rule whose clause the contract does not
 * carry shows its id alone, never invented wording), when, and the API's own sentence about what the plan does.
 */
export function ViolationList({ violations }: { readonly violations: readonly ViolationView[] }) {
  const t = useTranslations("judge.try");
  const locale = useLocale();
  const list = new Intl.ListFormat(locale, { type: "conjunction" });
  return (
    <ol className="grid gap-3" data-violations="">
      {violations.map((violation, i) => (
        <li key={`${violation.ruleId}-${String(i)}`} className="grid gap-2 rounded-sign border border-hair bg-panel p-4" data-violation={i + 1}>
          <p className="flex flex-wrap items-center gap-3">
            <span
              aria-label={t("result.violation", { n: String(i + 1) })}
              className="flex size-6 items-center justify-center rounded-full border-2 border-signal text-sm font-semibold tabular-nums text-ink"
            >
              {i + 1}
            </span>
            <code className="font-mono text-base text-ink" dir="ltr" translate="no">
              {violation.ruleId}
            </code>
          </p>
          {violation.clause === "" ? null : <p className="max-w-(--measure) text-sm text-ink-2" data-clause="">{violation.clause}</p>}
          <p className="text-sm text-ink-2 tabular-nums">
            <span className="text-ink-3">{t("result.when")} </span>
            <bdi>{list.format(violation.ranges.map((range) => t("runs.range", { from: clockOf(range.fromMin), to: clockOf(range.toMin) })))}</bdi>
          </p>
          <p className="max-w-(--measure) text-base text-ink">{violation.detail}</p>
        </li>
      ))}
    </ol>
  );
}
