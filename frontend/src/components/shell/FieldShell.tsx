"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState, ViewTransition, type ReactNode } from "react";
import { FieldHeadingContext, type FieldHeadingSlot } from "@/components/shell/FieldHeading";
import { FieldLink } from "@/components/shell/FieldLink";
import { LanguageChips } from "@/components/shell/LanguageChips";
import { SunToggle } from "@/components/shell/SunToggle";
import { useRouteTheme } from "@/components/shell/useRouteTheme";
import { setTheme } from "@/lib/sun/route-theme";
import "@/styles/view-transitions.css";

/**
 * The shell of the phone surfaces (worker and supervisor): a header with the site and crew, the clock and the sun toggle,
 * the six language chips, the page, and an optional dock. It is a presentational composition, so it imports no feature:
 * the layout that mounts it passes what to show (the pinned site, the demo clock, the worker dock), and a page can name the
 * crew through `useFieldCrewLabel` (FieldHeading.tsx).
 *
 * The page renders its own <main> (this shell owns none), and the dock is `position: fixed`, so the page gets bottom
 * padding to scroll clear of it. Re-applies the theme on every client navigation (see useRouteTheme), and puts night back
 * when the shell unmounts: sun mode belongs to field routes only, so a client-side link out of one (the wordmark, the
 * landing page) must not leave it on a night-only page. This replaces a guard that used to sit in the locale layout and
 * shipped its code to every route, the landing page included.
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
  const [reportedCrew, setReportedCrew] = useState<string | null>(null);
  const slot = useMemo<FieldHeadingSlot>(() => ({ setCrewLabel: setReportedCrew }), []);
  const crew = crewLabel != null && crewLabel !== "" ? crewLabel : reportedCrew;

  // Unmount only: the shell that mounts next (another field route) applies its own theme in the same commit, so night never paints.
  useEffect(
    () => () => {
      setTheme("night");
    },
    [],
  );

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-110 flex-col bg-ground sm:my-6 sm:min-h-0 sm:border sm:border-hair">
      <header className="flex items-center gap-3 border-b border-hair px-4 py-3">
        <ViewTransition name="wordmark" share="morph" default="none">
          <FieldLink
            href="/"
            className="hidden min-h-(--target) items-center font-display text-sm font-semibold uppercase tracking-wordmark text-ink no-underline sm:inline-flex"
          >
            {t("common.appName")}
          </FieldLink>
        </ViewTransition>
        <div className="min-w-0 flex-1">
          <p className="font-body text-base leading-tight font-semibold text-ink">
            {siteName === null ? t("shell.field.noSite") : <bdi>{siteName}</bdi>}
          </p>
          {crew === null ? null : (
            <p className="font-body text-sm text-ink-3">
              <bdi>{crew}</bdi>
            </p>
          )}
        </div>
        <p data-time-label="" className="font-display text-xl font-medium text-ink">
          <span className="sr-only">{t("shell.field.clockLabel")} </span>
          <bdi dir="ltr">{clock}</bdi>
        </p>
        <SunToggle />
      </header>
      <LanguageChips />
      <FieldHeadingContext.Provider value={slot}>
        <div className={dock === undefined ? "flex flex-1 flex-col" : "flex flex-1 flex-col pb-44"}>{children}</div>
      </FieldHeadingContext.Provider>
      {dock}
    </div>
  );
}
