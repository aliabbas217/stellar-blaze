"use client";

import { useLocale, useTranslations } from "next-intl";
import { getPathname, usePathname } from "@/i18n/navigation";
import { CHIP } from "@/components/states/actions";
import { routing } from "@/i18n/routing";

/**
 * The six languages as one row of chips, each in its own name and script (endonyms), the active one marked with
 * `aria-current`; the current one is a filled pill with a check mark (the CHIP of components/states/actions.ts). The field screens show them directly because a worker must find their language without opening a menu.
 *
 * A chip is a plain link: choosing a language loads a new document, as in LocaleSwitcher, because the [locale] layout owns
 * <html> and a soft navigation between locales would re-mount it and lose `data-theme`. The click keeps the query string
 * and the hash (`?demo=`, `?at=`); a modified click or a middle click is left to the browser (open in a new tab).
 */
export function LanguageChips() {
  const t = useTranslations("shell");
  const locale = useLocale();
  const pathname = usePathname();

  return (
    <nav aria-label={t("language")} className="flex gap-1 overflow-x-auto border-b border-hair px-2 py-1">
      {routing.locales.map((code) => {
        const href = getPathname({ href: pathname, locale: code });
        return (
          <a
            key={code}
            href={href}
            lang={code}
            hrefLang={code}
            aria-current={code === locale ? "true" : undefined}
            onClick={(event) => {
              if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              const { search, hash } = window.location;
              // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a full load is intended, see above
              window.location.assign(`${href}${search}${hash}`);
            }}
            className={`${CHIP} min-w-(--target) px-2 font-body text-base`}
          >
            {t(`locales.${code}`)}
          </a>
        );
      })}
    </nav>
  );
}
