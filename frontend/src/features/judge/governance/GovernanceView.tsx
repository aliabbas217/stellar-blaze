"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { queryKeys } from "@/api/query-keys";
import { dataRequestMutation, transparencyLogQueryOptions } from "@/api/queries";
import { ResetDemoControl } from "@/components/shell/ResetDemoControl";
import { useDemo } from "@/features/demo/DemoProvider";
import { DemoSwitch } from "@/features/demo/DemoSwitch";
import { useRestoreFocus } from "@/features/judge/live/useIslandGate";
import { outcomeOf, REQUEST_DATA_CLASS, SYNTHETIC_WORKER_REF, type Outcome } from "./answer";
import { CallNotice, GovernanceLayout } from "./GovernanceLayout";
import { toAuditRow, type AuditRow, type RecordedView, type RefusalAnswer } from "./recorded-view";
import { deriveRun } from "./run";

/*
 * The interactive governance screen: the island that `GovernanceGate` loads on the first interaction with a control (so
 * TanStack Query and the demo context are not in the route's first-load JS; see features/judge/live/useIslandGate.ts). It
 * renders the same `GovernanceLayout` as the server-rendered first paint, now with the page's own call, the API's log and
 * the live reset.
 *
 * "Send the employer's request" makes the live call. The page never sends by itself: the only way a request is made is a tap,
 * either on the button here or on the plain button of the first paint (`initialAction === "send"`, performed once after the
 * demo site is known). A 429 is shown and never retried.
 */

export interface GovernanceViewProps {
  /** The recorded run, or null when none could be read. */
  readonly recorded: RecordedView | null;
  /** The tap that loaded this island, performed once (see `IslandProps`). */
  readonly initialAction?: string | null;
  readonly restoreFocus?: string | null;
}

export function GovernanceView({ recorded, initialAction = null, restoreFocus = null }: GovernanceViewProps) {
  const t = useTranslations("judge.governance.status");
  const demo = useDemo();
  const queryClient = useQueryClient();
  const site = demo.site;
  const siteId = site?.id;

  const [live, setLive] = useState<{ readonly sentAt: string; readonly outcome: Outcome | null } | null>(null);
  // The last REFUSED call: steps 1 to 4 keep showing it while a later call runs or fails ("the last run stays on screen").
  const [lastRun, setLastRun] = useState<{ readonly sentAt: string; readonly answer: RefusalAnswer } | null>(null);
  const [notReady, setNotReady] = useState(false);
  // Set when a call REACHED the service (a refusal, or a 2xx that should not happen), so the button reads "Send again" only
  // then: after a 401, a 429 or a network failure nothing was sent, and it keeps its label while a call runs.
  const [sentOnce, setSentOnce] = useState(false);

  const send = useMutation({
    ...dataRequestMutation(siteId ?? ""),
    // Returning the refetch keeps the call "pending" until the new row is in, so the sequence changes once, not twice.
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.transparencyLog(siteId ?? "") }),
  });

  const log = useQuery({ ...transparencyLogQueryOptions(siteId ?? ""), enabled: siteId !== undefined });

  function onSend(): void {
    if (send.isPending) return;
    if (siteId === undefined) {
      // The demo site comes from list_sites; until it answers there is nothing to address. Said, never silent.
      setNotReady(true);
      return;
    }
    setNotReady(false);
    const sentAt = new Date().toISOString();
    setLive({ sentAt, outcome: null });
    send.mutate(
      { subject: "worker", data_class: REQUEST_DATA_CLASS, worker_ref: SYNTHETIC_WORKER_REF },
      {
        onError: (error) => {
          const result = outcomeOf(error.problem, new Date().toISOString());
          setLive({ sentAt, outcome: result });
          if (result.kind === "refused") {
            setLastRun({ sentAt, answer: result.answer });
            setSentOnce(true);
          }
        },
        // The contract says every answer is a refusal; a 2xx is a contract break and is never reported as a result.
        onSuccess: () => {
          setLive({ sentAt, outcome: { kind: "unexpected" } });
          setSentOnce(true);
        },
      },
    );
  }

  // The tap that loaded this island (the plain buttons of the first paint carry no handler). Performed once, and only after
  // the demo site is known or known to be missing: a send needs the site id.
  const handedOff = useRef(false);
  const { siteStatus, setDemo } = demo;
  const onSendRef = useRef(onSend);
  useEffect(() => {
    onSendRef.current = onSend;
  });
  useEffect(() => {
    if (handedOff.current) return;
    if (initialAction === "demo-live" || initialAction === "demo-replay") {
      handedOff.current = true;
      setDemo(initialAction === "demo-live" ? "live" : "replay");
    } else if (initialAction === "send" && siteStatus !== "loading") {
      handedOff.current = true;
      onSendRef.current();
    }
  }, [initialAction, siteStatus, setDemo]);
  useRestoreFocus(restoreFocus);

  const apiRows: readonly AuditRow[] = log.data?.entries.map(toAuditRow) ?? [];
  const pending = send.isPending;
  const run = deriveRun({ recorded, live, lastRun, apiRows, pending });

  return (
    <GovernanceLayout
      run={run}
      recorded={recorded}
      siteName={site?.name ?? null}
      siteId={siteId}
      pending={pending}
      logFetching={log.isFetching}
      sentBefore={sentOnce}
      onSend={onSend}
      notice={<CallNotice outcome={run.outcome} notReady={notReady} logFailed={log.isError && run.runLive} />}
      modeSwitch={<DemoSwitch />}
      reset={<ResetDemoControl siteId={siteId} autoStart={initialAction === "reset"} siteFailed={siteStatus === "error"} notReady={t("notReady")} />}
    />
  );
}
