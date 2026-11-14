"use client";

import { useTranslations } from "next-intl";
import { usePathname } from "next/navigation";
import { ViewTransition } from "react";
import { FieldLink } from "@/components/shell/FieldLink";
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

/**
 * The worker's bottom dock: "I feel unwell" above the section tabs. The unwell link is a safety action (F2 global
 * constraints, "safety actions never wait"): it is always rendered, never inside a form, and never disabled by any
 * state, loading, error or offline included. It is a link, not a button, so it works with no script and from cache.
 * `data-emergency` marks it for the design gate (it is not counted as the page's primary action). Its view-transition
 * name `unwell` pairs it with the Call hero of the unwell sheet.
 *
 * Every link is a FieldLink, which never prefetches (see FieldLink.tsx for why a prefetch is unsafe on a field surface).
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
          <FieldLink
            href="/worker/unwell"
            data-emergency=""
            transitionTypes={["nav-forward"]}
            className="flex min-h-14 w-full items-center justify-center gap-3 rounded-sign bg-ink px-4 font-body text-lg font-semibold text-ground no-underline"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" className="size-8 flex-none rounded-sign bg-ground p-1.5 text-ink">
              <path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z" fill="currentColor" />
            </svg>
            <span>{t("unwell")}</span>
          </FieldLink>
        </ViewTransition>
        <nav aria-label={t("label")} className="mt-1.5 flex">
          {tabs.map((tab) => (
            <FieldLink
              key={tab.href}
              href={tab.href}
              aria-current={tab.current ? "page" : undefined}
              className="flex min-h-12 flex-1 items-center justify-center border-t-2 border-transparent font-body text-base text-ink-3 no-underline aria-[current=page]:border-ink aria-[current=page]:font-semibold aria-[current=page]:text-ink"
            >
              {tab.label}
            </FieldLink>
          ))}
        </nav>
      </div>
    </div>
  );
}
