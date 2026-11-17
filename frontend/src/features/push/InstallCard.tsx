import { useTranslations } from "next-intl";
import { useId } from "react";

/**
 * What an iPhone worker must do before alerts can work: add the app to the Home Screen first (iOS only gives push to
 * an installed app). Plain text steps for now; the pictogram version belongs to the design phase.
 */
export function InstallCard() {
  const t = useTranslations("alerts.install");
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h2 id={headingId} className="font-display text-xl">
        {t("title")}
      </h2>
      <p>{t("body")}</p>
      <ol className="list-decimal ps-6">
        <li>{t("step1")}</li>
        <li>{t("step2")}</li>
        <li>{t("step3")}</li>
      </ol>
    </section>
  );
}
