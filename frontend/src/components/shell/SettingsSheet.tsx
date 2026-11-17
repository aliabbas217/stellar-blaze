"use client";

import { useLocale, useTranslations } from "next-intl";
import { Component, lazy, Suspense, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ACTION_QUIET, ACTION_SECONDARY_DENSE } from "@/components/states/actions";

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
 * Those three live in SettingsSheetBody.tsx, a module of its own loaded on the first opening, so that the header every field
 * route shares carries only the pill, the dialog and its title in its first load (the 170 KB ceiling of every route that is not a
 * data screen, and the data screens' too, depend on it: with the rows in the header /hse was 660 B over). The browser's idle time
 * after the page has loaded is used to fetch the module, so the tap finds it ready, and offline it comes from the service
 * worker's runtime cache; if it cannot be loaded at all the sheet still opens with its title and Close, and closes. A language row
 * is a plain link, exactly as the old chip was: choosing a language loads a new document, because the [locale] layout owns <html>
 * and a soft navigation between locales would re-mount it and lose `data-theme`. The tap keeps the query string and the hash
 * (`?demo=`, `?at=`, `?site=`); a modified or middle click is left to the browser (new tab). The locale is then persisted by the
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

const loadBody = () => import("./SettingsSheetBody");
const SettingsSheetBody = lazy(() => loadBody().then((module) => ({ default: module.SettingsSheetBody })));

/** A body that failed to load leaves the sheet with its title and Close instead of taking the page down with it. */
class BodyBoundary extends Component<{ readonly children: ReactNode }, { readonly failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

function Chevron() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4 flex-none">
      <path fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="square" d="M5 9l7 7 7-7" />
    </svg>
  );
}

/** Fetch the body when the browser is idle after the page is up (no work on the critical path, nothing if the phone saves data). */
function usePrefetchBody(): void {
  useEffect(() => {
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    if (connection?.saveData === true) return;
    const idle = typeof window.requestIdleCallback === "function";
    const id = idle ? window.requestIdleCallback(() => void loadBody().catch(() => undefined)) : window.setTimeout(() => void loadBody().catch(() => undefined), 1500);
    return () => {
      if (idle) window.cancelIdleCallback(id);
      else window.clearTimeout(id);
    };
  }, []);
}

export function SettingsSheet({ changeCrew }: { readonly changeCrew?: ChangeCrew }): ReactNode {
  const t = useTranslations("shell");
  const locale = useLocale();
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const pill = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  usePrefetchBody();

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
            <BodyBoundary>
              <Suspense fallback={null}>
                <SettingsSheetBody {...(changeCrew === undefined ? {} : { changeCrew })} />
              </Suspense>
            </BodyBoundary>
          </div>
        ) : null}
      </dialog>
    </>
  );
}
