"use client";

import { useLocale, useTranslations } from "next-intl";
import { useId, useRef, useState, type ReactNode } from "react";
import { ScreenColors } from "@/components/shell/ScreenColors";
import { ACTION_QUIET, ACTION_SECONDARY_DENSE } from "@/components/states/actions";
import { getPathname, usePathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

/**
 * The header's one language pill and the settings sheet it opens (redesign S5, decision D4; it replaces the six always-visible
 * language chips and the "Sun mode" button). The pill shows the current language in its own name and script; the sheet is a native
 * <dialog> opened with showModal(), so the browser gives it the top layer, the focus trap, Escape and the backdrop with no library
 * (the first-load budget of the worker routes is tight, and the proof drawer already works this way). It holds:
 *
 *   Language       six rows, each in its own name and script (endonyms are never translated), the current one marked;
 *   Screen colors  Automatic, Bright, Night (ScreenColors.tsx);
 *   Change crew    a link, only where the shell is given one (the worker app).
 *
 * A language row is a plain link, exactly as the old chip was: choosing a language loads a new document, because the [locale] layout
 * owns <html> and a soft navigation between locales would re-mount it and lose `data-theme`. The tap keeps the query string and the
 * hash (`?demo=`, `?at=`, `?site=`); a modified or middle click is left to the browser (new tab). The locale is then persisted by the
 * route (the cookie the i18n middleware sets), as it was for the chips.
 *
 * The sheet's content mounts only while it is open, so a closed sheet costs the page nothing and ScreenColors reads the phone's
 * stored choice when it appears. When the dialog closes (Escape, Close, the backdrop) focus goes back to the pill. Right-to-left: the
 * rows and the pill's chevron follow the document direction (logical spacing only); heights are `min-height`, never `height`, so
 * Nastaliq grows a row instead of clipping it.
 */

export interface ChangeCrew {
  readonly href: string;
  /** Runs before the browser follows the link (it may clear what the old choice left on the phone); the link still works without it. */
  readonly onActivate?: () => void | Promise<void>;
}

function Chevron() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4 flex-none">
      <path fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="square" d="M5 9l7 7 7-7" />
    </svg>
  );
}

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
                  // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a full load is intended, see above
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

export function SettingsSheet({ changeCrew }: { readonly changeCrew?: ChangeCrew }): ReactNode {
  const t = useTranslations("shell");
  const locale = useLocale();
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const pill = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        ref={pill}
        type="button"
        data-settings-pill=""
        aria-haspopup="dialog"
        onClick={() => {
          setOpen(true);
          dialog.current?.showModal();
        }}
        className={`${ACTION_SECONDARY_DENSE} flex-none gap-1.5 ps-4 pe-3`}
      >
        <span lang={locale}>{t(`locales.${locale}`)}</span>
        <span className="sr-only">, {t("settings.title")}</span>
        <Chevron />
      </button>
      {/* The backdrop click is a pointer convenience on top of the two keyboard paths (Escape, the Close button). */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events -- see above */}
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        data-settings-sheet=""
        onClose={() => {
          setOpen(false);
          // The browser restores focus to the opener on its own; saying it here keeps that true where it does not.
          pill.current?.focus();
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) event.currentTarget.close();
        }}
        className="m-0 mt-auto mb-0 w-full max-w-110 max-h-[90dvh] overflow-y-auto rounded-t-card border-0 bg-ground p-0 text-ink mx-auto backdrop:bg-scrim"
      >
        {open ? (
          <div className="flex flex-col gap-6 px-4 pt-3 pb-6">
            <header className="flex items-center justify-between gap-3">
              <h2 id={titleId} className="font-display text-xl leading-(--sign-leading-text) font-semibold text-ink">
                {t("settings.title")}
              </h2>
              <button
                type="button"
                onClick={() => dialog.current?.close()}
                className={ACTION_QUIET}
              >
                {t("close")}
              </button>
            </header>
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
          </div>
        ) : null}
      </dialog>
    </>
  );
}
