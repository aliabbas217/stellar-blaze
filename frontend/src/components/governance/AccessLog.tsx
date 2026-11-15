import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import type { components } from "@/api/schema";

/** The one member of a log entry the worker's list prints. The API's `TransparencyEntry` is assignable to it. */
type Entry = Pick<components["schemas"]["TransparencyEntry"], "at">;

/**
 * The worker's access log: who asked for individual data at the site, and was refused. One row per refusal of the API's
 * worker-visible transparency log, newest first, as the API sends it.
 *
 * Shared and presentational: it takes the entries and the empty state as props and imports no feature (ADR 0009 section 7),
 * so the judge screen and the worker's My data screen can both draw it. It carries no personal data because the API's log
 * has none: an entry says that an employer request for individual data at THIS SITE was refused, and when. It never says
 * whose data was asked for (ADR 0054 section 3), so the sentence is about the site and never "about you". Nothing of an
 * entry other than its time is printed: the rule text and the version ids belong to the audit view, not to a worker's phone.
 */
export interface AccessLogProps {
  readonly entries: readonly Entry[];
  /** Shown when there are no entries (a worker who nobody has asked about reads this). */
  readonly empty: ReactNode;
}

const DUBAI = "Asia/Dubai";

export function AccessLog({ entries, empty }: AccessLogProps) {
  const t = useTranslations("common.accessLog");
  const locale = useLocale();
  // Western digits in every locale, in the site's own zone.
  const tag = `${locale === "en" ? "en-GB" : locale}-u-nu-latn`;
  const date = new Intl.DateTimeFormat(tag, { day: "numeric", month: "short", timeZone: DUBAI });
  const time = new Intl.DateTimeFormat(tag, { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZone: DUBAI });

  if (entries.length === 0) return <div data-access-log="empty">{empty}</div>;

  return (
    <ul aria-label={t("label")} data-access-log="rows" className="flex flex-col gap-2">
      {entries.map((entry, index) => {
        const at = new Date(entry.at);
        return (
          <li
            key={`${entry.at}-${String(index)}`}
            data-access-row=""
            className="flex flex-col gap-1 rounded-sign border border-edge bg-ground p-3"
          >
            <p className="text-base font-medium leading-snug text-ink">{t("refused")}</p>
            <p className="text-base text-ink-2">
              <time dateTime={entry.at} className="tabular-nums">
                <bdi>{date.format(at)}</bdi>, <bdi>{time.format(at)}</bdi>
              </time>
            </p>
          </li>
        );
      })}
    </ul>
  );
}
