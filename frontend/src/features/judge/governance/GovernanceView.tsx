"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { queryKeys } from "@/api/query-keys";
import { dataRequestMutation, transparencyLogQueryOptions } from "@/api/queries";
import { AccessLog } from "@/components/governance/AccessLog";
import { Stamp } from "@/components/provenance/Stamp";
import { ResetDemoControl } from "@/components/shell/ResetDemoControl";
import { SyntheticDemoBanner } from "@/components/shell/SyntheticDemoBanner";
import { Link } from "@/i18n/navigation";
import { useDemo } from "@/features/demo/DemoProvider";
import { AnswerCard } from "./AnswerCard";
import { AuditCard } from "./AuditCard";
import { RequestCard } from "./RequestCard";
import { outcomeOf, REQUEST_DATA_CLASS, SYNTHETIC_WORKER_REF, type Outcome } from "./answer";
import { clockTime, dayAndTime } from "./clock";
import { toAuditRow, type AuditRow, type RecordedView, type RefusalAnswer } from "./recorded-view";

/*
 * The governance refusal, `/replay/governance`: a four-step sequence in time order (the employer's request, the service's
 * answer, the audit row, the worker's phone) with a clock time on each step.
 *
 * First paint shows a COMPLETED run, the recorded one (a build-time file), so the hero exists before any call and the page
 * reads the same with the API stopped. "Send the employer's request" makes the live call. The page never sends by itself:
 * each send is a visible audit row for every worker of the site. A 429 is shown and never retried.
 *
 * What is drawn is decided in one place (below):
 *   steps 1 to 4 are ONE run: the one this page just made once there is one, the recorded run before. The API's own log rows
 *   (what earlier sends wrote, possibly by other visitors) never replace a recorded step: before a live run they sit in their
 *   own block, "Live rows from the demo API".
 * Only a refusal changes the run; a 401, a 429, an unreachable API or an unexpected 2xx is said under the button and the
 * last good run stays in place.
 */

export interface GovernanceViewProps {
  /** The recorded run, or null when none could be read. */
  readonly recorded: RecordedView | null;
}

type Tone = "done" | "refuse" | "wait";

const NODE: Record<Tone, string> = {
  done: "border-ink bg-ink",
  refuse: "border-signal bg-signal",
  wait: "border-dashed border-edge bg-ground",
};

function Step({ time, who, tone, children }: { readonly time: string; readonly who: string; readonly tone: Tone; readonly children: ReactNode }) {
  return (
    <li className="relative pb-8 ps-9 last:pb-0 lg:flex lg:flex-col lg:pb-0 lg:ps-0 lg:pe-4" data-step="">
      <span aria-hidden="true" className={`absolute start-0 top-0 size-5 rounded-sign border-2 lg:relative lg:block ${NODE[tone]}`} />
      <span aria-hidden="true" className="absolute start-2.25 top-5 bottom-0 w-0.5 bg-edge lg:hidden" />
      <span aria-hidden="true" className="absolute start-5 end-0 top-2.25 hidden h-0.5 bg-edge lg:block" />
      <p className="flex flex-wrap items-baseline gap-x-2 lg:mt-3">
        <b className="text-xl font-medium tabular-nums text-ink">{time}</b>
        <span className="text-sm text-ink-3">{who}</span>
      </p>
      <div className="mt-2 grid min-h-0 content-start gap-3 rounded-sign border border-hair bg-panel p-4 lg:min-h-96 lg:flex-1">{children}</div>
    </li>
  );
}

const BLANK_CLOCK = "--:--:--";

/** The worker list shows the newest rows only, with the count: a demo that is pressed often must not grow the page without end. */
const MAX_ROWS = 3;

export function GovernanceView({ recorded }: GovernanceViewProps) {
  const t = useTranslations("judge.governance");
  const locale = useLocale();
  const demo = useDemo();
  const queryClient = useQueryClient();
  const site = demo.site;
  const siteId = site?.id;

  const [live, setLive] = useState<{ readonly sentAt: string; readonly outcome: Outcome | null } | null>(null);
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
          if (result.kind === "refused") setSentOnce(true);
        },
        // The contract says every answer is a refusal; a 2xx is a contract break and is never reported as a result.
        onSuccess: () => {
          setLive({ sentAt, outcome: { kind: "unexpected" } });
          setSentOnce(true);
        },
      },
    );
  }

  const pending = send.isPending;
  const outcome = live?.outcome ?? null;
  const liveAnswer: RefusalAnswer | null = outcome?.kind === "refused" ? outcome.answer : null;

  const runLive = liveAnswer !== null;
  const apiRows: readonly AuditRow[] = log.data?.entries.map(toAuditRow) ?? [];
  // Steps 3 and 4 are part of the run on screen: this page's own call once there is one, else the recorded run. The API's
  // rows that earlier sends wrote are NEVER mixed into a recorded run (their times are later, and "the same row" would be
  // untrue): before a live run they are shown in their own labelled block.
  const logRows: readonly AuditRow[] = runLive ? apiRows : (recorded?.entries ?? []);
  const auditRow: AuditRow | null = runLive ? (apiRows[0] ?? null) : (recorded?.entries[0] ?? null);
  const shownRows = logRows.slice(0, MAX_ROWS);
  const showApiBlock = !runLive && apiRows.length > 0;
  const shownApiRows = apiRows.slice(0, MAX_ROWS);

  const answer: RefusalAnswer | null = liveAnswer ?? recorded?.answer ?? null;
  const requestSentAt = runLive && live !== null ? live.sentAt : (recorded?.request.sentAt ?? null);

  const path = `/api/v1/sites/${siteId ?? recorded?.siteId ?? "{site_id}"}/data-requests`;
  const clock = (iso: string | null): string => (iso === null ? BLANK_CLOCK : clockTime(iso, locale));

  const state = pending
    ? "loading"
    : outcome !== null && outcome.kind !== "refused"
      ? outcome.kind
      : runLive
        ? logRows.length === 0
          ? "empty"
          : "live"
        : recorded === null
          ? "empty"
          : "recorded";

  return (
    <>
      <SyntheticDemoBanner siteName={site?.name ?? null} />
      <main id="main-content" className="mx-auto flex w-full max-w-(--content-max) flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8" data-governance={state}>
        <header className="flex flex-col gap-3">
          <h1 className="max-w-(--measure) font-display text-3xl leading-solid font-normal tracking-display">{t("title")}</h1>
          <p className="max-w-(--measure) text-lg text-ink-2">{t("lede")}</p>
        </header>

        <RunNotice runLive={runLive} recorded={recorded} locale={locale} />

        <section aria-labelledby="sequence-heading" className="flex flex-col gap-3">
          <h2 id="sequence-heading" className="sr-only">
            {t("sequence")}
          </h2>
          <ol data-hero="" data-spine="" className="grid lg:grid-cols-[1.05fr_1.35fr_1fr_1fr]" aria-label={t("sequence")}>
            <Step time={clock(requestSentAt)} who={t("request.who")} tone="done">
              <RequestCard
                path={path}
                workerRef={SYNTHETIC_WORKER_REF}
                dataClass={REQUEST_DATA_CLASS}
                sentBefore={sentOnce}
                pending={pending}
                onSend={onSend}
                notice={<CallNotice outcome={outcome} notReady={notReady} logFailed={log.isError && runLive} />}
              />
            </Step>
            <Step time={pending ? BLANK_CLOCK : clock(answer?.answeredAt ?? null)} who={t("answer.who")} tone={answer === null ? "wait" : "refuse"}>
              <AnswerCard answer={answer} pending={pending} />
            </Step>
            <Step time={pending ? BLANK_CLOCK : clock(auditRow?.at ?? null)} who={t("audit.who")} tone={auditRow === null ? "wait" : "done"}>
              <AuditCard row={auditRow} clock={auditRow === null ? null : clock(auditRow.at)} pending={pending} />
            </Step>
            <Step time={pending ? BLANK_CLOCK : clock(logRows[0]?.at ?? null)} who={t("phone.who")} tone={logRows.length === 0 ? "wait" : "done"}>
              <h3 className="text-base font-semibold text-ink">{t("phone.title")}</h3>
              <div aria-busy={pending || log.isFetching} data-log-source={runLive ? "live" : "recorded"}>
                <AccessLog
                  entries={shownRows}
                  empty={
                    <div className="grid gap-1 rounded-sign border border-dashed border-edge p-3">
                      <p className="text-base text-ink">{t("phone.empty")}</p>
                      <p className="text-sm text-ink-3">{t("phone.emptyHint")}</p>
                    </div>
                  }
                />
              </div>
              {logRows.length === 0 ? null : (
                <p className="text-sm text-ink-3" data-log-count="">
                  {logRows.length > shownRows.length
                    ? t("phone.count", { shown: String(shownRows.length), total: String(logRows.length) })
                    : runLive
                      ? t("phone.sourceLive")
                      : t("phone.sourceRecorded")}
                </p>
              )}
              <p className="text-sm text-ink-3">{t("phone.note")}</p>
            </Step>
          </ol>
          <p className="text-sm text-ink-3">{t("notes.times")}</p>
        </section>

        {showApiBlock ? (
          <section aria-labelledby="live-rows-heading" className="flex flex-col gap-3 rounded-sign border border-hair bg-panel p-4" data-live-rows="">
            <h2 id="live-rows-heading" className="text-base font-semibold text-ink">
              {t("phone.liveBlockTitle")}
            </h2>
            <p className="max-w-(--measure) text-sm text-ink-3">{t("phone.liveBlockNote")}</p>
            <div className="max-w-(--measure)" aria-busy={log.isFetching}>
              <AccessLog entries={shownApiRows} empty={null} />
            </div>
            {apiRows.length > shownApiRows.length ? (
              <p className="text-sm text-ink-3">{t("phone.count", { shown: String(shownApiRows.length), total: String(apiRows.length) })}</p>
            ) : null}
          </section>
        ) : null}

        <div className="flex flex-wrap items-start gap-x-8 gap-y-4 border-t border-hair pt-6">
          {siteId === undefined ? null : <ResetDemoControl siteId={siteId} />}
          <p className="max-w-(--measure) text-sm text-ink-3">{t("resetNote")}</p>
        </div>

        <details className="rounded-sign border border-hair bg-panel" data-proves="">
          <summary className="min-h-(--target) cursor-pointer px-4 py-3 text-base font-medium text-ink">{t("proves.title")}</summary>
          <ul className="grid border-t border-hair">
            {(["data_request_403_and_audit_row", "transparency_log_shows_refusal", "verify_detects_edited_row"] as const).map((name) => (
              <li key={name} className="grid gap-1 border-b border-hair px-4 py-3 text-sm last:border-b-0 sm:grid-cols-2 sm:gap-4">
                <code className="font-mono break-all text-ink" dir="ltr" translate="no">{`test_${name}`}</code>
                <span className="text-ink-2">{t(`proves.${name}`)}</span>
              </li>
            ))}
          </ul>
        </details>

        <ul className="flex flex-col gap-1 border-t border-hair pt-4 text-sm text-ink-3">
          <li>{t("notes.privacy")}</li>
        </ul>
        <p>
          <Link href="/replay" className="inline-flex min-h-(--target) items-center text-base text-ink underline underline-offset-4">
            {t("back")}
          </Link>
        </p>
      </main>
    </>
  );
}

const NOTICE = "flex flex-col gap-1 rounded-sign border border-edge border-s-3 border-s-ink-2 bg-panel px-4 py-3 text-base text-ink-2";

/** Which run steps 1 to 3 show: the recorded one (with its stamps) or the one this page just made. */
function RunNotice({ runLive, recorded, locale }: { readonly runLive: boolean; readonly recorded: RecordedView | null; readonly locale: string }) {
  const t = useTranslations("judge.governance.status");
  if (runLive) {
    return (
      <div role="status" className={NOTICE} data-notice="live">
        <p>
          <strong className="font-medium text-ink">{t("live.title")}</strong> {t("live.reason")}
        </p>
      </div>
    );
  }
  if (recorded === null) {
    return (
      <div role="status" className={NOTICE} data-notice="norun">
        <p>
          <strong className="font-medium text-ink">{t("noRun.title")}</strong> {t("noRun.reason")}
        </p>
      </div>
    );
  }
  return (
    <div role="status" className={`${NOTICE} sm:flex-row sm:items-center sm:gap-3`} data-notice="recorded">
      <span className="flex flex-wrap items-center gap-2">
        <Stamp kind="RECORDED" detail={dayAndTime(recorded.recordedAt, locale)} />
      </span>
      <p data-notice-source={recorded.source}>{recorded.source === "msw-mock" ? t("recordedMock") : t("recorded")}</p>
    </div>
  );
}

/**
 * What went wrong with the call just made, shown under the button that made it. Only a refusal changes the sequence; every
 * other outcome is said here, the last good run stays in place, and nothing here is worded as a refusal.
 */
function CallNotice({ outcome, notReady, logFailed }: { readonly outcome: Outcome | null; readonly notReady: boolean; readonly logFailed: boolean }) {
  const t = useTranslations("judge.governance.status");
  const note = "flex flex-col gap-1 rounded-sign border border-edge bg-ground px-3 py-2 text-sm text-ink-2";
  return (
    <div className="flex flex-col gap-2" data-notices="">
      {logFailed ? (
        <div role="status" className={note} data-notice="logFailed">
          <p>{t("logFailed")}</p>
        </div>
      ) : null}
      {notReady ? (
        <div role="status" className={note} data-notice="notReady">
          <p>{t("notReady")}</p>
        </div>
      ) : null}
      {outcome?.kind === "limited" ? (
        <div role="status" className={note} data-notice="limited">
          <p className="text-base font-medium text-ink">{t("limited")}</p>
        </div>
      ) : null}
      {outcome?.kind === "unauthorized" ? (
        <div role="alert" className={note} data-notice="unauthorized">
          <p>
            <strong className="font-medium text-ink">{t("unauthorized.title")}</strong> {t("unauthorized.reason")}
          </p>
        </div>
      ) : null}
      {outcome?.kind === "failed" ? (
        <div role="alert" className={note} data-notice="failed">
          <p>
            <strong className="font-medium text-ink">{t("failed.title")}</strong> {t("failed.reason")}
          </p>
          {outcome.requestId === null ? null : (
            <p>
              {t("requestId")}{" "}
              <code dir="ltr" translate="no" className="font-mono text-xs text-ink">
                {outcome.requestId}
              </code>
            </p>
          )}
        </div>
      ) : null}
      {outcome?.kind === "unexpected" ? (
        <div role="alert" className={note} data-notice="unexpected">
          <p>
            <strong className="font-medium text-ink">{t("unexpected.title")}</strong> {t("unexpected.reason")}
          </p>
        </div>
      ) : null}
    </div>
  );
}
