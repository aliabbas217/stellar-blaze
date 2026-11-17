"use client";

import { useTranslations } from "next-intl";
import { ACTION_PRIMARY } from "@/components/states/actions";
import { Skeleton } from "@/components/states/Skeletons";
import { WakingLine } from "@/components/states/WakingLine";

/**
 * What Today shows on a phone that has no site yet. There is no account and no sign-in: a worker joins by scanning the poster
 * on site or opening the crew's link, and a visitor with neither opens the demo yard with one tap (the one primary action here).
 * It is an empty state in the sense of the design: a title, why, and a primary action that does something, never a blank.
 *
 * The button is not disabled while the demo yard is still being found (a disabled control on the one screen of a phone with no
 * site is a dead end): until the site list answers it is a placeholder of the button's height, and if the list cannot be loaded
 * the screen says so and offers the retry.
 */
export function SiteEntry({
  status,
  onDemoYard,
  onRetry,
}: {
  /**
   * `ready`: a demo site is known. `loading`: the site list has not answered. `unavailable`: it failed, or it has no demo site.
   * `failed`: the choice could not be saved on this phone (a stale chunk, no signal): the same button, tried again.
   */
  readonly status: "ready" | "loading" | "unavailable" | "failed";
  readonly onDemoYard: () => void;
  readonly onRetry: () => void;
}) {
  const t = useTranslations("worker.today.entry");
  const retry = useTranslations("states")("retry");

  return (
    <section className="flex flex-col items-start gap-3 px-4 pt-6">
      <h2 className="font-display text-2xl font-medium text-ink">{t("title")}</h2>
      <p className="max-w-(--measure) text-lg leading-(--sign-leading-text) text-ink-2">{t("reason")}</p>
      {status === "ready" ? (
        <button type="button" data-primary="" onClick={onDemoYard} className={ACTION_PRIMARY}>
          {t("demo")}
        </button>
      ) : status === "loading" ? (
        <>
          <div role="status" aria-busy="true" className="flex w-full flex-col gap-2">
            <Skeleton height="var(--target)" width="12rem" />
            <span className="sr-only">{t("loading")}</span>
          </div>
          {/* The site list read can be waiting for a scaled-to-zero API. */}
          <WakingLine />
        </>
      ) : status === "failed" ? (
        <div role="alert" className="flex flex-col items-start gap-3">
          <p className="text-base text-ink-2">{t("chooseFailed")}</p>
          <button type="button" data-primary="" onClick={onDemoYard} className={ACTION_PRIMARY}>
            {retry}
          </button>
        </div>
      ) : (
        <div role="alert" className="flex flex-col items-start gap-3">
          <p className="text-base text-ink-2">{t("unavailable")}</p>
          <button type="button" onClick={onRetry} className={ACTION_PRIMARY}>
            {retry}
          </button>
        </div>
      )}
    </section>
  );
}
