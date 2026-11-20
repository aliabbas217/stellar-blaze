import { useTranslations, useLocale } from "next-intl";
import type { ReactNode } from "react";
import { AccessLog } from "@/components/governance/AccessLog";
import { Stamp } from "@/components/provenance/Stamp";
import { SyntheticDemoBanner } from "@/components/shell/SyntheticDemoBanner";
import { OfflineBanner } from "@/components/states/OfflineBanner";
import { FieldLink } from "@/components/shell/FieldLink";
import { AnswerCard } from "./AnswerCard";
import { AuditCard } from "./AuditCard";
import { RequestCard } from "./RequestCard";
import { REQUEST_DATA_CLASS, SYNTHETIC_WORKER_REF, type Outcome } from "./answer";
import { clockTime, dayAndTime } from "./clock";
import type { RecordedView } from "./recorded-view";
import type { RunModel } from "./run";
import { claimsLocale } from "@/i18n/claims-english";

/*
 * The governance refusal, `/replay/governance`: a four-step sequence in time order (the employer's request, the service's
 * answer, the audit row, the worker's phone) with a clock time on each step.
 *
 * This file is PRESENTATIONAL and shared by two callers: the server-rendered first paint (`GovernanceStatic`, a completed
 * RECORDED run, no TanStack Query and no demo context in the page's JS) and the interactive island (`GovernanceView`, loaded on
 * the first interaction with a control). Both pass a `RunModel` from `deriveRun`, so the page reads the same before and after.
 * The three controls (the demo mode switch, the send button, the reset button) are plain buttons carrying `data-island-action`:
 * in the first paint a tiny gate listens for them, in the island the controller's handlers are attached.
 *
 * The page never sends by itself: each send is a visible audit row for every worker of the site. A 429 is shown and never
 * retried. Only a refusal changes the run; a 401, a 429, an unreachable API or an unexpected 2xx is said under the button and
 * the last good run stays in place.
 */

export interface GovernanceLayoutProps {
  readonly run: RunModel;
  readonly recorded: RecordedView | null;
  /** The demo site's name once `list_sites` answered (island only). */
  readonly siteName: string | null;
  /** The demo site's id once known: the first paint shows the recorded run's own. */
  readonly siteId: string | undefined;
  readonly pending: boolean;
  /** The API's log is being read (island only): the worker's list says it is busy. */
  readonly logFetching: boolean;
  /** A call reached the service from this page: the send button then reads "Send again". */
  readonly sentBefore: boolean;
  /** What went wrong with the call just made (island only). */
  readonly notice?: ReactNode;
  /** Undefined in the first paint (the gate handles the click); the island's send handler afterwards. */
  readonly onSend?: () => void;
  /** The demo mode switch row (static in the first paint, the live one in the island). */
  readonly modeSwitch: ReactNode;
  /** The reset control (a plain button in the first paint, the live control in the island). */
  readonly reset: ReactNode;
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

export function GovernanceLayout({ run, recorded, siteName, siteId, pending, logFetching, sentBefore, notice, onSend, modeSwitch, reset }: GovernanceLayoutProps) {
  const t = useTranslations("judge.governance");
  const locale = claimsLocale(useLocale());
  const { answer, auditRow, logRows, shownRows, runLive } = run;

  // Before any call the page draws the recorded run; when that recording came from the demo mock its ids ("mock-req-1", "mock-0") are
  // placeholders, so they are not printed and the cards say "Recorded example". A call this page just made is live and prints its own.
  const example = !runLive && recorded?.source === "msw-mock";
  const path = `/api/v1/sites/${siteId ?? recorded?.siteId ?? "{site_id}"}/data-requests`;
  const clock = (iso: string | null): string => (iso === null ? BLANK_CLOCK : clockTime(iso, locale));

  return (
    <>
      <div className="flex justify-end border-b border-hair px-4 py-2 sm:px-6">{modeSwitch}</div>
      <SyntheticDemoBanner siteName={siteName} />
      <main id="main-content" className="mx-auto flex w-full max-w-(--content-max) flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8" data-governance={run.state}>
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
            <Step time={clock(run.requestSentAt)} who={t("request.who")} tone="done">
              <RequestCard
                path={path}
                workerRef={SYNTHETIC_WORKER_REF}
                dataClass={REQUEST_DATA_CLASS}
                sentBefore={sentBefore}
                pending={pending}
                {...(onSend === undefined ? {} : { onSend })}
                notice={notice}
              />
            </Step>
            <Step time={pending ? BLANK_CLOCK : clock(answer?.answeredAt ?? null)} who={t("answer.who")} tone={answer === null ? "wait" : "refuse"}>
              <AnswerCard answer={answer} pending={pending} example={example} />
            </Step>
            <Step time={pending ? BLANK_CLOCK : clock(auditRow?.at ?? null)} who={t("audit.who")} tone={auditRow === null ? "wait" : "done"}>
              <AuditCard row={auditRow} clock={auditRow === null ? null : clock(auditRow.at)} pending={pending} example={example} />
            </Step>
            <Step time={pending ? BLANK_CLOCK : clock(logRows[0]?.at ?? null)} who={t("phone.who")} tone={logRows.length === 0 ? "wait" : "done"}>
              <h3 className="text-base font-semibold text-ink">{t("phone.title")}</h3>
              <div aria-busy={pending || logFetching} data-log-source={runLive ? "live" : "recorded"}>
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
                    ? t(runLive ? "phone.count" : "phone.countRecorded", { shown: String(shownRows.length), total: String(logRows.length) })
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

        {run.showApiBlock ? (
          <section aria-labelledby="live-rows-heading" className="flex flex-col gap-3 rounded-sign border border-hair bg-panel p-4" data-live-rows="">
            <h2 id="live-rows-heading" className="text-base font-semibold text-ink">
              {t("phone.liveBlockTitle")}
            </h2>
            <p className="max-w-(--measure) text-sm text-ink-3">{t("phone.liveBlockNote")}</p>
            <div className="max-w-(--measure)" aria-busy={logFetching}>
              <AccessLog entries={run.shownApiRows} empty={null} />
            </div>
            {run.apiRows.length > run.shownApiRows.length ? (
              <p className="text-sm text-ink-3">{t("phone.count", { shown: String(run.shownApiRows.length), total: String(run.apiRows.length) })}</p>
            ) : null}
          </section>
        ) : null}

        <div className="flex flex-wrap items-start gap-x-8 gap-y-4 border-t border-hair pt-6">
          {reset}
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
          <FieldLink href="/replay" className="inline-flex min-h-(--target) items-center text-base text-ink underline underline-offset-4">
            {t("back")}
          </FieldLink>
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
export function CallNotice({
  outcome,
  notReady,
  offline = false,
  logFailed,
}: {
  readonly outcome: Outcome | null;
  readonly notReady: boolean;
  /** A send was tapped with no network: nothing was sent and the recorded run stays on screen. */
  readonly offline?: boolean;
  readonly logFailed: boolean;
}) {
  const t = useTranslations("judge.governance.status");
  const note = "flex flex-col gap-1 rounded-sign border border-edge bg-ground px-3 py-2 text-sm text-ink-2";
  return (
    <div className="flex flex-col gap-2" data-notices="">
      {logFailed ? (
        <div role="status" className={note} data-notice="logFailed">
          <p>{t("logFailed")}</p>
        </div>
      ) : null}
      {offline ? (
        <div data-notice="offline">
          <OfflineBanner />
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
