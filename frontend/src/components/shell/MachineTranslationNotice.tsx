import { useLocale, useMessages, useTranslations } from "next-intl";
import { dirFor } from "@/i18n/direction";

/**
 * The one quiet line of a machine-translated catalogue: "Machine translation, not yet reviewed by a native speaker", in the page's
 * language and direction (architect ruling 2026-11-15; it replaces the draft-translation badge). It is a plain paragraph, not a banner:
 * mount it in a settings or about area or the footer, below the content, once per page, never above the fold. It renders nothing in
 * the source language and once a native speaker has reviewed the catalogue (`_meta.review_status` is "source" or "reviewed").
 * Works in Server and Client Components: it only reads the messages of the current request.
 */
export function MachineTranslationNotice({ className = "" }: { readonly className?: string }) {
  const t = useTranslations("shell");
  const locale = useLocale();
  const status: string = useMessages()._meta.review_status;
  if (status === "source" || status === "reviewed") return null;

  return (
    <p data-machine-translation="" lang={locale} dir={dirFor(locale)} className={`font-body text-sm text-ink-3 ${className}`.trim()}>
      {t("machineTranslation")}
    </p>
  );
}
