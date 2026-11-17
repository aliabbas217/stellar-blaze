import { useTranslations } from "next-intl";
import { Banner } from "./Banner";

export interface OfflineBannerProps {
  /** When the level on screen was last updated (absolute clock time). Given with `ageLabel`, never one alone. */
  readonly updatedAt?: string;
  /** How long ago that was, already worded for the locale ("1 h 30 min"). */
  readonly ageLabel?: string;
}

/** The phone has no connection. When it holds a level it says which, as "Last known level" with time and age. */
export function OfflineBanner({ updatedAt, ageLabel }: OfflineBannerProps) {
  const t = useTranslations("states.offlineBanner");
  return (
    <Banner>
      <p>
        <strong className="block font-medium text-ink">{t("title")}</strong>
        {t("body")}
      </p>
      {updatedAt === undefined || ageLabel === undefined ? null : (
        <p>{t.rich("lastKnown", { time: updatedAt, age: ageLabel, bdi: (chunks) => <bdi>{chunks}</bdi> })}</p>
      )}
    </Banner>
  );
}
