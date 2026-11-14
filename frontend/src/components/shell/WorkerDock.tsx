"use client";

import { useTranslations } from "next-intl";
import { usePathname } from "next/navigation";
import { ViewTransition } from "react";
import { Link } from "@/i18n/navigation";
import "@/styles/view-transitions.css";

/**
 * Whether the dock shows the My data tab. Off until Task 21 ships the screen it opens; Task 21 flips this one constant
 * (a link to a route that does not exist would be a dead end on the one screen a worker lives on).
 */
export const MY_DATA_TAB_ENABLED = false;

/** The route after the locale prefix: `/en/worker/alerts` is `/worker/alerts`. */
function withoutLocale(pathname: string): string {
  return pathname.replace(/^\/[a-z]{2}(?=\/|$)/, "") || "/";
}

/*
 * No link in the field shell prefetches (`prefetch={false}`). A prefetch is a request the service worker answers and caches
 * after the page has hydrated, i.e. just when a worker may be removing their data: a page response written after the clearing
 * leaves a cache behind and the removal could not honestly say "removed" (F1 invariant b, tests/e2e/revoke.spec.ts). Static
 * pages are small and the worker's own visits are cached by the service worker anyway. The `/worker/unwell` target is built by
 * a later task; prefetching a route that does not exist yet left its request pending under the service worker, which kept
 * every `networkidle` wait in the e2e suite from settling. Enable prefetch on the unwell link once that route exists.
 */

/**
 * The worker's bottom dock: "I feel unwell" above the section tabs. The unwell link is a safety action (F2 global
 * constraints, "safety actions never wait"): it is always rendered, never inside a form, and never disabled by any
 * state, loading, error or offline included. It is a link, not a button, so it works with no script and from cache.
 * `data-emergency` marks it for the design gate (it is not counted as the page's primary action). Its view-transition
 * name `unwell` pairs it with the Call hero of the unwell sheet.
 */
export function WorkerDock({ myDataEnabled = MY_DATA_TAB_ENABLED }: { myDataEnabled?: boolean }) {
  const t = useTranslations("worker.nav");
  const route = withoutLocale(usePathname());

  const tabs = [
    { href: "/worker", label: t("today"), current: route === "/worker" },
    { href: "/worker/alerts", label: t("alerts"), current: route.startsWith("/worker/alerts") },
    ...(myDataEnabled ? [{ href: "/worker/data", label: t("myData"), current: route.startsWith("/worker/data") }] : []),
  ];

  return (
    <div className="fixed inset-x-0 bottom-0 z-10">
      <div className="mx-auto max-w-110 border-t border-edge bg-ground px-4 pt-2.5 pb-[calc(var(--s-2)+env(safe-area-inset-bottom))]">
        <ViewTransition name="unwell" share="morph" default="none">
          <Link
            href="/worker/unwell"
            prefetch={false}
            data-emergency=""
            transitionTypes={["nav-forward"]}
            className="flex min-h-14 w-full items-center justify-center gap-3 rounded-sign bg-ink px-4 font-body text-lg font-semibold text-ground no-underline"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" className="size-8 flex-none rounded-sign bg-ground p-1.5 text-ink">
              <path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z" fill="currentColor" />
            </svg>
            <span>{t("unwell")}</span>
          </Link>
        </ViewTransition>
        <nav aria-label={t("label")} className="mt-1.5 flex">
          {tabs.map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              prefetch={false}
              aria-current={tab.current ? "page" : undefined}
              className="flex min-h-12 flex-1 items-center justify-center border-t-2 border-transparent font-body text-base text-ink-3 no-underline aria-[current=page]:border-ink aria-[current=page]:font-semibold aria-[current=page]:text-ink"
            >
              {tab.label}
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}
