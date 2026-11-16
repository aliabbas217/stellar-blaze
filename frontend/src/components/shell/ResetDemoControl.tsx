"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { resetDemoMutation } from "@/api/queries";
import { ResetDemoButton } from "@/components/shell/ResetDemoButton";
import { useLocaleAttrs } from "@/i18n/use-locale-attrs";

/**
 * "Reset demo site": one tap, no confirm dialog, calls `reset_demo_site` (ADR 0062, 0066). Nothing is deleted: the API
 * starts a new demo epoch and the audit log stays append-only, so there is nothing to confirm. It never fires on its own.
 *
 * On success it invalidates every query (the screens refetch the reverted crews and sign-offs) and says which epoch it
 * is (`epoch_id`). On 404 or 501 (a deployment without the operation) it says reset is not available here, and on 429
 * (reset is limited to once a minute) that it is limited and to try again shortly, both in a status line; any other
 * failure is an alert that quotes the request id. The button keeps its label while the request runs and is not
 * disabled (a second tap while one runs is ignored).
 *
 * `siteId` may be undefined while the demo site is still being looked up (the lazy island of a server-rendered page): a tap then
 * is remembered and performed once, when the id arrives. `autoStart` is the same for a tap already made on the plain button
 * of the first paint. If the lookup failed (`siteFailed`) a remembered tap is answered with `notReady`, never dropped silently.
 * Neither ever fires on its own. The button is one stable element, so focus and a pending click survive the lookup.
 */
export function ResetDemoControl({
  siteId,
  autoStart = false,
  siteFailed = false,
  notReady,
}: {
  siteId: string | undefined;
  autoStart?: boolean;
  siteFailed?: boolean;
  notReady?: string;
}) {
  const t = useTranslations("shell");
  const tError = useTranslations("states.error");
  const queryClient = useQueryClient();
  const reset = useMutation({
    ...resetDemoMutation(siteId ?? ""),
    onSuccess: () => {
      void queryClient.invalidateQueries();
    },
  });

  const attrs = useLocaleAttrs();
  const [asked, setAsked] = useState(autoStart);
  const started = useRef(false);
  const { mutate } = reset;
  useEffect(() => {
    if (!asked || started.current || siteId === undefined) return;
    started.current = true;
    mutate();
  }, [asked, siteId, mutate]);

  const status = reset.error?.problem.status;
  const unavailable = status === 404 || status === 501;
  // The API allows one reset a minute and ten an hour, and the BFF limits the write too: a calm line, not an alert.
  const rateLimited = status === 429;

  return (
    <div {...attrs} className="flex flex-col gap-2 font-body text-sm text-ink">
      <ResetDemoButton
        busy={reset.isPending || (asked && siteId === undefined && !siteFailed)}
        onClick={() => {
          if (reset.isPending) return;
          if (siteId === undefined) setAsked(true);
          else reset.mutate();
        }}
      />
      <p role="status">
        {reset.isSuccess ? t("demo.reset.done", { epoch: String(reset.data.epoch_id) }) : null}
        {unavailable ? t("demo.reset.unavailable") : null}
        {asked && siteId === undefined && siteFailed ? notReady : null}
        {rateLimited ? t("demo.reset.rateLimited") : null}
      </p>
      {reset.isError && !unavailable && !rateLimited ? (
        <p role="alert">
          {t("demo.reset.failed")}
          {reset.error.problem.request_id === undefined ? null : (
            <span className="block text-ink-2">{tError("requestId", { id: reset.error.problem.request_id })}</span>
          )}
        </p>
      ) : null}
    </div>
  );
}
