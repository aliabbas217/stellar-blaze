"use client";

import { useTranslations } from "next-intl";
import type { ShiftViolation } from "@/api/problem";

/*
 * The 422 `shift-not-legal` of the day plan and the sign-off (F2 Task 20): the crew's published shift breaks a rule by itself, so
 * the planner cannot fix it and no plan is served. This is a RESULT the supervisor can act on (fix the shift), not a fault of the
 * app: no alert role, no error colour, no request id, and nothing here says anything is wrong with Stop work or alerts. Each
 * violated rule is a row with its id (an identifier, in the mono face); the clause text is shown only when the API sent some
 * (the contract allows it empty), as sent.
 */

export function ShiftNotLegalResult({ violations }: { readonly violations: readonly ShiftViolation[] }) {
  const t = useTranslations("supervisor.plan.notLegal");
  return (
    <section data-shift-not-legal="" role="status" className="flex flex-col gap-3 rounded-sign border border-edge border-s-3 border-s-ink-2 bg-panel px-4 py-4">
      <h2 className="font-display text-lg font-medium leading-(--sign-leading-text) text-ink">{t("title")}</h2>
      <p className="max-w-(--measure) text-base leading-(--sign-leading-text) text-ink-2">{t("detail")}</p>
      {violations.length === 0 ? null : (
        <div className="flex flex-col gap-1">
          <h3 className="text-base font-medium text-ink-3">{t("rules")}</h3>
          <ul className="m-0 flex list-none flex-col p-0">
            {violations.map((violation, index) => (
              <li key={`${violation.rule_id}-${String(index)}`} data-violation={violation.rule_id} className="flex flex-col gap-1 border-t border-hair py-2 first:border-t-0">
                <code dir="ltr" translate="no" className="font-mono text-sm text-ink">
                  {violation.rule_id}
                </code>
                {violation.clause === "" ? null : <p className="text-base leading-(--sign-leading-text) text-ink-2">{violation.clause}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
