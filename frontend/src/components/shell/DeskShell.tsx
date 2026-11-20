"use client";

import { useTranslations } from "next-intl";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, ViewTransition, type ReactNode, type RefObject } from "react";
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
 * Whether the menu has more to scroll to. `Math.abs`: in a right-to-left page `scrollLeft` runs from 0 down to a negative number, and the far
 * end is the same distance either way. One pixel of slack for sub-pixel scroll positions. Measured on scroll and on resize, never polled.
 */
function useMoreToScroll(): { readonly ref: RefObject<HTMLElement | null>; readonly more: boolean } {
  const ref = useRef<HTMLElement | null>(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const measure = (): void => {
      setMore(Math.abs(element.scrollLeft) + element.clientWidth < element.scrollWidth - 1);
    };
    measure();
    element.addEventListener("scroll", measure, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(element);
    return () => {
      element.removeEventListener("scroll", measure);
      observer?.disconnect();
    };
  }, []);
  return { ref, more };
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
  const { ref: menu, more } = useMoreToScroll();

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex flex-wrap items-center gap-x-4 border-b border-hair px-4 py-1 sm:px-6">
        <ViewTransition name="wordmark" share="morph" default="none">
          <FieldLink
            href="/"
            className="inline-flex min-h-(--target) flex-none items-center font-display text-sm font-semibold uppercase tracking-wordmark text-ink no-underline"
          >
            {t("common.appName")}
          </FieldLink>
        </ViewTransition>
        {/* A phone: the menu is its own full-width row (six items do not fit beside the wordmark), and while more of it is off screen a flat end marker says so. */}
        <div className="relative order-last min-w-0 basis-full sm:order-none sm:flex-1 sm:basis-0">
          <nav ref={menu} aria-label={t("shell.desk.menu")} className="scroll-pe-10 overflow-x-auto">
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
          {more ? (
            <span aria-hidden="true" data-nav-more="" className="pointer-events-none absolute inset-y-0 end-0 flex w-9 items-center justify-center border-s border-hair bg-ground">
              <svg viewBox="0 0 24 24" className="size-4 text-ink-2 rtl:-scale-x-100">
                <path d="M9 5l7 7-7 7" stroke="currentColor" strokeWidth="2" fill="none" />
              </svg>
            </span>
          ) : null}
        </div>
        {trailing === undefined ? null : <div className="ms-auto flex-none">{trailing}</div>}
      </header>
      {children}
    </div>
  );
}
