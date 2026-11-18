"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState, ViewTransition, type ReactNode } from "react";
import { FieldHeadingContext, type FieldHeadingSlot } from "@/components/shell/FieldHeading";
import { FieldLink } from "@/components/shell/FieldLink";
import { SettingsSheet, type ChangeCrew } from "@/components/shell/SettingsSheet";
import { useRouteTheme } from "@/components/shell/useRouteTheme";
import { setTheme } from "@/lib/sun/route-theme";
import "@/styles/view-transitions.css";

/**
 * The shell of the phone surfaces (worker and supervisor): a header with the site and crew, the clock and ONE language pill that
 * opens the settings sheet (language, screen colors, change crew: SettingsSheet.tsx), the page, and an optional dock. It is a presentational composition, so it imports no feature:
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
  demo = false,
  changeCrew,
  reserveLabels = false,
  clock,
  dock,
  children,
}: {
  /**
   * The site's name, or null when none is known yet (an honest line is shown, never a blank). Omitted: the header names no
   * site at all, for a sheet that must not look anything up (the unwell sheet).
   */
  siteName?: string | null;
  crewLabel?: string | null;
  /** The site is the synthetic demo site: it is tagged "Demo" beside its name (the caller has already taken "(synthetic)" out of the name). */
  demo?: boolean;
  /** "Change crew" in the settings sheet: omitted on surfaces that have no crew to change (the supervisor). */
  changeCrew?: ChangeCrew;
  /**
   * Hold the header's final height from the first paint: two lines for the site's name and one for the crew's. The names arrive after
   * the page does (the demo site, then the crew's timeline), and on a phone each one grew the header and pushed the whole screen down
   * (layout shift 0.05 on the crew plan screen). For a screen that always has both; others keep the height of what they show.
   */
  reserveLabels?: boolean;
  /** The time to show, already formatted (a node, so the caller can put a Suspense boundary around what reads the URL). Omitted: none is shown. */
  clock?: ReactNode;
  dock?: ReactNode;
  children: ReactNode;
}) {
  const t = useTranslations();
  useRouteTheme("route");
  const [reportedCrew, setReportedCrew] = useState<string | null>(null);
  const [reportedSite, setReportedSite] = useState<string | null>(null);
  const slot = useMemo<FieldHeadingSlot>(() => ({ setCrewLabel: setReportedCrew, setSiteLabel: setReportedSite }), []);
  const crew = crewLabel != null && crewLabel !== "" ? crewLabel : reportedCrew;
  // What the page says wins: it knows which site its own data is about.
  const site = reportedSite ?? siteName;

  // Unmount only: the shell that mounts next (another field route) applies its own theme in the same commit, so night never paints.
  useEffect(
    () => () => {
      setTheme("night");
    },
    [],
  );

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-110 flex-col bg-ground sm:my-6 sm:min-h-0 sm:border sm:border-hair">
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-hair px-4 py-2">
        <ViewTransition name="wordmark" share="morph" default="none">
          <FieldLink
            href="/"
            className="hidden min-h-(--target) items-center font-display text-sm font-semibold uppercase tracking-wordmark text-ink no-underline sm:inline-flex sm:basis-full"
          >
            {t("common.appName")}
          </FieldLink>
        </ViewTransition>
        {/* From sm up the wordmark takes its own line (basis-full above): beside it the name had about 90 px and a long word ("Mussafah") was cut. */}
        <div className="min-w-0 flex-1">
          {site === undefined ? null : (
            // The name wraps and is never cut: the demo site's name ends in "(synthetic)", and a two-line clamp put its ellipsis exactly there
            // when the Arabic sun-mode button left the name about 135 px (F2 Task 22 fix round 1). A long word breaks instead of overflowing.
            // The <bdi> takes its line's height ("inherit"): the language's own leading (2.5 in Urdu) is a rule for every element of the
            // page, so an inline child would otherwise keep it and make each line of the name 40 px tall.
            <p {...(site === null ? {} : { title: site })} className={`font-body text-base leading-tight font-semibold break-words text-ink${reserveLabels ? " max-sm:min-h-10" : ""}`}>
              {site === null ? t("shell.field.noSite") : <bdi className="leading-[inherit]">{site}</bdi>}
              {demo && site !== null ? (
                <span
                  data-demo-tag=""
                  className="mt-1 flex min-h-6 w-fit items-center rounded-sign px-2 font-body text-xs leading-none font-semibold tracking-wide text-ink-2 uppercase inset-ring-[1.5px] inset-ring-edge"
                >
                  {t("shell.field.demo")}
                </span>
              ) : null}
            </p>
          )}
          {crew === null ? (
            reserveLabels ? <p aria-hidden="true" className="max-sm:min-h-[1.0938rem]" /> : null
          ) : (
            <p className="truncate font-body text-sm leading-tight text-ink-3">
              <bdi className="leading-[inherit]">{crew}</bdi>
            </p>
          )}
        </div>
        {clock === undefined ? null : (
          <p data-time-label="" className="font-display text-xl font-medium text-ink">
            <span className="sr-only">{t("shell.field.clockLabel")} </span>
            <bdi dir="ltr">{clock}</bdi>
          </p>
        )}
        <SettingsSheet {...(changeCrew === undefined ? {} : { changeCrew })} />
      </header>
      <FieldHeadingContext.Provider value={slot}>
        <div className={dock === undefined ? "flex flex-1 flex-col" : "flex flex-1 flex-col pb-44"}>{children}</div>
      </FieldHeadingContext.Provider>
      {dock}
    </div>
  );
}
