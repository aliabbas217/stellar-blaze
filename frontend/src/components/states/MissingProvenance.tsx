import { useTranslations } from "next-intl";
import { useLocaleAttrs } from "@/i18n/use-locale-attrs";

/**
 * Stands where a number would be when the number has no provenance block: every number has provenance or is not
 * shown (global constraint). It never carries the value, so the value cannot leak into the markup or the page text.
 */
export function MissingProvenance({ what }: { readonly what: string }) {
  const t = useTranslations("states");
  const attrs = useLocaleAttrs();
  return (
    <p {...attrs} role="note" className="w-fit rounded-sign border border-dashed border-edge px-3 py-2 text-base text-ink-2">
      {t("missingProvenance", { what })}
    </p>
  );
}
