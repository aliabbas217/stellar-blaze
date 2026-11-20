import { useTranslations, useLocale } from "next-intl";
import { useMemo } from "react";
import { makeFormat } from "./adapters";
import { frontierHeading, frontierStatement } from "./frontier-statement";
import type { RosterFrontier } from "./roster-frontier";
import { claimsLocale } from "@/i18n/claims-english";

/**
 * The frontier section's heading and its one-line explanation. The heading is a sentence generated from the export at the
 * commute on the slider (`frontier-statement.ts`), so it is true at every commute the chart can show. Not a client component
 * itself: the server renders it for the default commute inside the Suspense fallback, the panel renders it for the URL's.
 */
export function FrontierHeading({ data, commute }: { readonly data: RosterFrontier; readonly commute: number }) {
  const t = useTranslations("judge.frontier");
  const locale = claimsLocale(useLocale());
  const format = useMemo(() => makeFormat(locale), [locale]);
  const hours = useMemo(() => new Intl.NumberFormat(`${locale}-u-nu-latn`, { maximumFractionDigits: 2 }), [locale]);
  return (
    <>
      <h2 id="frontier-heading" className="max-w-(--measure) font-display text-2xl font-medium" data-frontier-heading="">
        {frontierHeading(frontierStatement(data, commute), t, format, (h) => hours.format(h))}
      </h2>
      <p className="max-w-(--measure) text-base text-ink-2">{t("sub")}</p>
    </>
  );
}
