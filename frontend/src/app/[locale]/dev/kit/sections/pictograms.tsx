import { useTranslations } from "next-intl";
import { PICTOGRAM_NAMES, Pictogram } from "@/components/level/Pictogram";

/** Every pictogram at the 24 px default and at 48 px, then the labelled form (an image with a name). */
export function PictogramsSection() {
  const t = useTranslations("common.kit.sample");
  return (
    <div className="flex flex-col gap-4">
      <ul className="grid grid-cols-3 gap-4 sm:grid-cols-5 xl:grid-cols-9">
        {PICTOGRAM_NAMES.map((name) => (
          <li key={name} className="flex flex-col items-center gap-3 rounded-sign border border-hair p-4">
            <Pictogram name={name} className="size-12" />
            <Pictogram name={name} />
            <span className="font-mono text-sm text-ink-3">{name}</span>
          </li>
        ))}
      </ul>
      <p className="flex items-center gap-3 text-base text-ink-2">
        <Pictogram name="cross" label={t("medicalLabel")} className="size-6 text-ink" />
        <span>{t("medicalLabel")}</span>
      </p>
    </div>
  );
}
