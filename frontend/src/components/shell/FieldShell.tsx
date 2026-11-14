"use client";

import { useTranslations } from "next-intl";
import { ViewTransition, type ReactNode } from "react";
import { LanguageChips } from "@/components/shell/LanguageChips";
import { SunToggle } from "@/components/shell/SunToggle";
import { useRouteTheme } from "@/components/shell/useRouteTheme";
import { Link } from "@/i18n/navigation";
import "@/styles/view-transitions.css";

/**
 * The shell of the phone surfaces (worker and supervisor): a header with the site and crew, the clock and the sun toggle,
 * the six language chips, the page, and an optional dock. It is a presentational composition, so it imports no feature:
 * the layout that mounts it passes what to show (the pinned site, the demo clock, the worker dock).
 *
 * The page renders its own <main> (this shell owns none), and the dock is `position: fixed`, so the page gets bottom
 * padding to scroll clear of it. Re-applies the theme on every client navigation (see useRouteTheme).
 */
export function FieldShell({
  siteName,
  crewLabel,
  clock,
  dock,
  children,
}: {
  /** The site's name, or null when none is known yet (an honest line is shown, never a blank). */
  siteName: string | null;
  crewLabel?: string | null;
  /** The time to show, already formatted (a node, so the caller can put a Suspense boundary around what reads the URL). */
  clock: ReactNode;
  dock?: ReactNode;
  children: ReactNode;
}) {
  const t = useTranslations();
  useRouteTheme("route");

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-110 flex-col bg-ground sm:my-6 sm:min-h-0 sm:border sm:border-hair">
      <header className="flex items-center gap-3 border-b border-hair px-4 py-3">
        <ViewTransition name="wordmark" share="morph" default="none">
          <Link
            href="/"
            prefetch={false}
            className="hidden min-h-(--target) items-center font-display text-sm font-semibold uppercase tracking-wordmark text-ink no-underline sm:inline-flex"
          >
            {t("common.appName")}
          </Link>
        </ViewTransition>
        <div className="min-w-0 flex-1">
          <p className="font-body text-base leading-tight font-semibold text-ink">
            {siteName === null ? t("shell.field.noSite") : <bdi>{siteName}</bdi>}
          </p>
          {crewLabel != null && crewLabel !== "" ? (
            <p className="font-body text-sm text-ink-3">
              <bdi>{crewLabel}</bdi>
            </p>
          ) : null}
        </div>
        <p className="font-display text-xl font-medium text-ink">
          <span className="sr-only">{t("shell.field.clockLabel")} </span>
          <bdi dir="ltr">{clock}</bdi>
        </p>
        <SunToggle />
      </header>
      <LanguageChips />
      <div className={dock === undefined ? "flex flex-1 flex-col" : "flex flex-1 flex-col pb-44"}>{children}</div>
      {dock}
    </div>
  );
}
