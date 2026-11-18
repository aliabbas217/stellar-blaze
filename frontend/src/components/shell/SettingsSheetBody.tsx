"use client";

import { useLocale, useTranslations } from "next-intl";
import { ScreenColors } from "@/components/shell/ScreenColors";
import type { ChangeCrew } from "@/components/shell/SettingsSheet";
import { ACTION_SECONDARY_DENSE } from "@/components/states/actions";
import { getPathname, usePathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

/*
 * What the settings sheet holds besides its title and Close button: the six languages, "Screen colors" and, in the worker app,
 * "Change crew". It is a module of its own so that the header every field route shares does not carry it in its first load: the
 * sheet loads this on its first opening (SettingsSheet.tsx prefetches it when the browser is idle, so the tap finds it in memory
 * and, offline, in the service worker's runtime cache). A closed sheet costs the page nothing and ScreenColors reads the phone's
 * stored choice when it appears. Moving it out took every route using the header below its 170 KB first-load ceiling again.
 */

function Check() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 flex-none">
      <path fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="square" d="M4.5 12.5l5 5 10-11" />
    </svg>
  );
}

function LanguageRows() {
  const t = useTranslations("shell");
  const locale = useLocale();
  const pathname = usePathname();

  return (
    <nav aria-label={t("language")} className="flex flex-col gap-2">
      <h3 className="text-base leading-(--sign-leading-text) font-medium text-ink-3">{t("language")}</h3>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {routing.locales.map((code) => {
          const href = getPathname({ href: pathname, locale: code });
          return (
            <li key={code}>
              <a
                href={href}
                lang={code}
                hrefLang={code}
                aria-current={code === locale ? "true" : undefined}
                onClick={(event) => {
                  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  event.preventDefault();
                  const { search, hash } = window.location;
                  // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a full load is intended, see SettingsSheet.tsx
                  window.location.assign(`${href}${search}${hash}`);
                }}
                className="flex min-h-(--target-stop) items-center justify-between gap-3 rounded-ctl bg-panel px-4 text-lg font-medium text-ink no-underline aria-[current=true]:bg-ink aria-[current=true]:font-semibold aria-[current=true]:text-ground"
              >
                <span>{t(`locales.${code}`)}</span>
                {code === locale ? <Check /> : null}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function SettingsSheetBody({ changeCrew }: { readonly changeCrew?: ChangeCrew }) {
  const t = useTranslations("shell");
  return (
    <>
      <LanguageRows />
      <ScreenColors />
      {changeCrew === undefined ? null : (
        <a
          href={changeCrew.href}
          data-change-crew=""
          onClick={(event) => {
            if (changeCrew.onActivate === undefined || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            const href = event.currentTarget.href;
            // Whatever the callback does, the worker still lands on the chooser: a failure here must never be a dead link.
            void Promise.resolve(changeCrew.onActivate())
              .catch(() => undefined)
              .then(() => {
                window.location.assign(href);
              });
          }}
          className={`${ACTION_SECONDARY_DENSE} w-full`}
        >
          {t("settings.changeCrew")}
        </a>
      )}
    </>
  );
}
