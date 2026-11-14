import { useTranslations } from "next-intl";
import { Pictogram } from "@/components/level/Pictogram";
import { Banner } from "./Banner";

export interface StaleBannerProps {
  /** When the level was last updated, as an absolute clock time in the site's zone ("06:00"). */
  readonly updatedAt: string;
  /** How long ago that was, already worded for the locale ("5 h"). The banner adds "ago". */
  readonly ageLabel: string;
}

/**
 * Said whenever the level on screen is not from a current forecast: "Last known level", the absolute time and the
 * age. An age alone ("5 h ago") is unreadable once the screen has been open for a while, so both are shown.
 */
export function StaleBanner({ updatedAt, ageLabel }: StaleBannerProps) {
  const t = useTranslations("states.staleBanner");
  return (
    <Banner icon={<Pictogram name="clock" className="mt-0.5 size-5" />}>
      <p>
        <strong className="block font-medium text-ink">{t("title")}</strong>
        {t.rich("body", { time: updatedAt, age: ageLabel, bdi: (chunks) => <bdi>{chunks}</bdi> })}
      </p>
    </Banner>
  );
}
