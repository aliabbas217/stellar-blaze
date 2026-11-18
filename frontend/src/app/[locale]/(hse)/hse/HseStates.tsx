"use client";

import { useTranslations } from "next-intl";
import { EmptyState } from "@/components/states/EmptyState";
import { ErrorState } from "@/components/states/ErrorState";

/*
 * The two states of the safety view that only some visits reach: the failure and the empty list. A module of its own, loaded on demand by
 * HseView, so the first load of the route does not carry them (the route is held to the 170 KB budget).
 */

/** The crews (or the site) did not load: what failed, the request id, and a retry. */
export function HseError({ onRetry, requestId }: { readonly onRetry: () => void; readonly requestId: string | null }) {
  const t = useTranslations("hse");
  const states = useTranslations("states");
  return <ErrorState title={t("error.title")} detail={states("error.detail")} onRetry={onRetry} requestId={requestId} />;
}

/** The service returned no crews: say so, and lead somewhere that exists (the front door). */
export function HseEmpty() {
  const t = useTranslations("hse");
  return <EmptyState title={t("empty.title")} reason={t("empty.reason")} primary={{ label: t("empty.primary"), href: "/start" }} />;
}
