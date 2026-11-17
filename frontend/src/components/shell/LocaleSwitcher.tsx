"use client";

import { hasLocale, useLocale, useTranslations } from "next-intl";
import { useId } from "react";
import { getPathname, usePathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

/**
 * Language picker. A native <select>: it works with every screen reader and phone keyboard, costs
 * no JavaScript for a popup, and mirrors with the page direction. Each option carries its own `lang`
 * so the language's name is drawn in its own script, whatever the current page language is.
 *
 * Choosing a language is a full page load on purpose, not a client-side router.replace. The [locale]
 * layout owns <html>, so a soft navigation between locales re-mounts <html> on the client, and React
 * clears the attributes it does not manage (the data-theme the inline script set is lost: checked in
 * the browser, a dark override fell back to the system theme) and logs "Encountered a script tag while
 * rendering React component" for the inline theme script. A new document keeps the theme, loads only the
 * new locale's fonts, and costs one load on a control used once.
 */
export function LocaleSwitcher() {
  const t = useTranslations("shell");
  const locale = useLocale();
  const pathname = usePathname();
  const selectId = useId();

  return (
    <div className="flex items-center gap-2">
      <label htmlFor={selectId} className="font-body text-sm text-ink-2">
        {t("language")}
      </label>
      <select
        id={selectId}
        value={locale}
        onChange={(event) => {
          const next = event.target.value;
          if (!hasLocale(routing.locales, next)) return;
          // Keep the query string (e.g. ?site=) and the hash when the language changes.
          const { search, hash } = window.location;
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a full load is intended, see the comment above
          window.location.assign(`${getPathname({ href: pathname, locale: next })}${search}${hash}`);
        }}
        className="min-h-(--target) rounded-ctl border-[1.5px] border-edge bg-raised px-3 font-body text-base text-ink"
      >
        {routing.locales.map((code) => (
          <option key={code} value={code} lang={code}>
            {t(`locales.${code}`)}
          </option>
        ))}
      </select>
    </div>
  );
}
