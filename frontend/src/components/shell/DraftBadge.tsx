import { useMessages, useTranslations } from "next-intl";

/**
 * Marks a screen whose language is a machine draft. Shown unless the active file is the source
 * language ("source") or has been reviewed by a native speaker ("reviewed"). Works in Server and
 * Client Components: it only reads the messages of the current request.
 */
export function DraftBadge() {
  const t = useTranslations("shell");
  const status: string = useMessages()._meta.review_status;
  if (status === "source" || status === "reviewed") return null;

  return (
    <p className="inline-flex w-fit items-center rounded-sign border border-hairline bg-surface-raised px-2 py-1 font-body text-sm text-ink-muted">
      {t("draftTranslation")}
      <span className="sr-only">. {t("draftTranslationNote")}</span>
    </p>
  );
}
