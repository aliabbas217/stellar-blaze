"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { resetDemoMutation } from "@/api/queries";

/**
 * "Reset demo site": one tap, no confirm dialog, calls `reset_demo_site` (ADR 0062, 0066). Nothing is deleted: the API
 * starts a new demo epoch and the audit log stays append-only, so there is nothing to confirm. It never fires on its own.
 *
 * On success it invalidates every query (the screens refetch the reverted crews and sign-offs) and says which epoch it
 * is (`epoch_id`). On 404 or 501 (a deployment without the operation) it says reset is not available here, and on 429
 * (reset is limited to once a minute) that it is limited and to try again shortly, both in a status line; any other
 * failure is an alert that quotes the request id. The button keeps its label while the request runs and is not
 * disabled (a second tap while one runs is ignored).
 */
export function ResetDemoControl({ siteId }: { siteId: string }) {
  const t = useTranslations("shell");
  const tError = useTranslations("states.error");
  const queryClient = useQueryClient();
  const reset = useMutation({
    ...resetDemoMutation(siteId),
    onSuccess: () => {
      void queryClient.invalidateQueries();
    },
  });

  const status = reset.error?.problem.status;
  const unavailable = status === 404 || status === 501;
  // The API allows one reset a minute and ten an hour, and the BFF limits the write too: a calm line, not an alert.
  const rateLimited = status === 429;

  return (
    <div className="flex flex-col gap-2 font-body text-sm text-ink">
      <button
        type="button"
        aria-busy={reset.isPending}
        onClick={() => {
          if (!reset.isPending) reset.mutate();
        }}
        className="inline-flex min-h-(--target) w-fit items-center justify-center gap-2 rounded-sign border border-edge px-4 text-base text-ink"
      >
        {reset.isPending ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : null}
        {t("demo.reset.button")}
      </button>
      <p role="status">
        {reset.isSuccess ? t("demo.reset.done", { epoch: String(reset.data.epoch_id) }) : null}
        {unavailable ? t("demo.reset.unavailable") : null}
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
