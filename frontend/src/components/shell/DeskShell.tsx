"use client";

import { useTranslations } from "next-intl";
import { usePathname } from "next/navigation";
import { ViewTransition, type ReactNode } from "react";
import { FieldLink } from "@/components/shell/FieldLink";
import { NAV_TAB } from "@/components/states/actions";
import { useRouteTheme } from "@/components/shell/useRouteTheme";
import "@/styles/view-transitions.css";

/*
 * No link of the desk header prefetches (FieldLink.tsx): Lighthouse counts the script a prefetch pulls in against the page
 * that made it, and /replay/governance read 10.8 KB gzip of /replay's chunk that it never runs. A desk route is one click
 * away; its script loads when it is opened.
 */

export interface DeskNavItem {
  /** A route without the locale prefix, as the locale-aware Link takes it. */
  readonly href: string;
  readonly label: string;
}

/** The route after the locale prefix: `/en/replay/day` is `/replay/day`. */
function withoutLocale(pathname: string): string {
  return pathname.replace(/^\/[a-z]{2}(?=\/|$)/, "") || "/";
}

/**
 * The item that is the current page: the longest `href` the route is, or is below, so `/replay/day` marks "One day" and
 * not also "Scoreboard" (`/replay`). The story link (`/`) is current only on the landing page itself.
 */
function currentHref(route: string, items: readonly DeskNavItem[]): string | null {
  let best: string | null = null;
  for (const { href } of items) {
    const matches = route === href || (href !== "/" && route.startsWith(`${href}/`));
    if (matches && (best === null || href.length > best.length)) best = href;
  }
  return best;
}

/**
 * The shell of the desk surfaces (judge, HSE, admin): the wordmark and a menu of links across the top, night only. A
 * presentational composition: the layout passes the menu and whatever sits at the end of the header (the demo mode
 * switch). Forces night on every client navigation, whatever a field route left on <html> (see useRouteTheme).
 */
export function DeskShell({
  items,
  trailing,
  children,
}: {
  items: readonly DeskNavItem[];
  trailing?: ReactNode;
  children: ReactNode;
}) {
  const t = useTranslations();
  useRouteTheme("desk");
  const current = currentHref(withoutLocale(usePathname()), items);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center gap-4 border-b border-hair px-4 py-1 sm:px-6">
        <ViewTransition name="wordmark" share="morph" default="none">
          <FieldLink
            href="/"
            className="inline-flex min-h-(--target) flex-none items-center font-display text-sm font-semibold uppercase tracking-wordmark text-ink no-underline"
          >
            {t("common.appName")}
          </FieldLink>
        </ViewTransition>
        <nav aria-label={t("shell.desk.menu")} className="min-w-0 flex-1 overflow-x-auto">
          <ul className="flex gap-1">
            {items.map((item) => {
              return (
                <li key={item.href} className="flex-none">
                  <FieldLink
                    href={item.href}
                    aria-current={item.href === current ? "page" : undefined}
                    className={`${NAV_TAB} font-body text-sm`}
                  >
                    {item.label}
                  </FieldLink>
                </li>
              );
            })}
          </ul>
        </nav>
        {trailing}
      </header>
      {children}
    </div>
  );
}
