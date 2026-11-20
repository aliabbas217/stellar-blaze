import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/states/Skeletons";
import type { AuditRow } from "./recorded-view";

export interface AuditCardProps {
  /** The newest row of the log, or null when the log has none. */
  readonly row: AuditRow | null;
  readonly clock: string | null;
  readonly pending: boolean;
  /** The row is from a recorded example (not a live call): the version ids and model are placeholders of the recording and are not printed. */
  readonly example?: boolean;
}

export const AUDIT_SKELETON_HEIGHT = "13rem";

/**
 * Step 3: the audit row the refusal wrote. The API's `rule` text is not printed: it names a design record, so the "why" is
 * the page's own sentence. The version ids are identifiers (mono). The log is append-only and tamper-evident: an edited
 * row is detected, not prevented, which is why the wording is "tamper-evident".
 */
export function AuditCard({ row, clock, pending, example = false }: AuditCardProps) {
  const t = useTranslations("judge.governance.audit");
  return (
    <div className="grid content-start gap-3" aria-busy={pending}>
      <h3 className="text-base font-semibold text-ink">{t("title")}</h3>
      {pending ? (
        <Skeleton height={AUDIT_SKELETON_HEIGHT} />
      ) : row === null ? (
        <p className="text-base text-ink-3" data-audit="none">
          {t("none")}
        </p>
      ) : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm" data-audit="shown">
          <dt className="text-ink-3">{t("when")}</dt>
          <dd className="text-ink tabular-nums">
            <time dateTime={row.at}>{clock}</time>
          </dd>
          <dt className="text-ink-3">{t("what")}</dt>
          <dd className="text-ink">{t("whatValue")}</dd>
          <dt className="text-ink-3">{t("askedBy")}</dt>
          <dd className="text-ink">{t("askedByValue")}</dd>
          <dt className="text-ink-3">{t("outcome")}</dt>
          <dd className="text-ink">{t("outcomeValue")}</dd>
          <dt className="text-ink-3">{t("why")}</dt>
          <dd className="text-ink">{t("whyValue")}</dd>
          <dt className="text-ink-3">{t("rules")}</dt>
          <dd className="font-mono text-xs break-all text-ink" dir="ltr" translate="no">
            {example ? t("exampleValue") : `${row.policyVersion} · ${String(row.configVersion)}`}
          </dd>
          <dt className="text-ink-3">{t("model")}</dt>
          <dd className="font-mono text-xs break-all text-ink" dir="ltr" translate="no">
            {example ? t("exampleValue") : (row.modelId ?? t("noModel"))}
          </dd>
        </dl>
      )}
      <p className="text-sm text-ink-3">{t("note")}</p>
    </div>
  );
}
