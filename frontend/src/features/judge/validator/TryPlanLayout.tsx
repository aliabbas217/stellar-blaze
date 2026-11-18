import { useTranslations } from "next-intl";
import type { ReactNode, SyntheticEvent } from "react";
import type { RosterError } from "@/api/roster-problem";
import { Stamp } from "@/components/provenance/Stamp";
import { SyntheticDemoBanner } from "@/components/shell/SyntheticDemoBanner";
import type { BanState } from "@/components/spine/ban-state";
import { OfflineBanner } from "@/components/states/OfflineBanner";
import { Skeleton } from "@/components/states/Skeletons";
import { WakingLine } from "@/components/states/WakingLine";
import { ACTION_PRIMARY_DENSE, ACTION_SECONDARY_DENSE } from "@/components/states/actions";
import { PlanStrip } from "./PlanStrip";
import { RunsForm, type RunsFormHandlers } from "./RunsForm";
import { ViolationList } from "./ViolationList";
import { REPLAY_HEADCOUNT } from "./request";
import type { Run, RunProblem, TemplateId } from "./runs";
import type { AnswerView, RecordedPlanView } from "./view";

/*
 * Try a plan, `/replay/try`: pick or write a roster, press "Check this plan", read the independent validator's answer. This
 * file is PRESENTATIONAL and shared by the server-rendered first paint (`TryStatic`: the common roster on the day's heat, the
 * controls as plain buttons, no TanStack Query and no demo context in the page's JS) and the interactive island
 * (`TryPlanView`, loaded on the first interaction). Both pass the same props, so the page reads the same before and after.
 *
 * The result is the API's answer; nothing is re-implemented in the browser. States: idle, loading (the button keeps its
 * label), answered with violations, answered with none ("0 rules broken" and what was checked), could not read the roster
 * (422, per line), and the validator did not answer (times kept, retry, request id, "Show a recorded result"). Offline is its own
 * settled state: the page says so (the existing offline banner), sends nothing, and offers the same recorded result.
 */

export type TryPhase = "idle" | "loading" | "answer" | "none" | "invalid" | "error" | "offline";

export interface TryHandlers extends RunsFormHandlers {
  readonly onCheck: () => void;
  readonly onShowRecorded: () => void;
}

export interface TryLayoutProps {
  readonly phase: TryPhase;
  readonly runs: readonly Run[];
  /** What is wrong with each row once its fields lost focus, or null. */
  readonly rowProblems: readonly (RunProblem | null)[];
  readonly templateId: TemplateId | null;
  readonly acclimatised: boolean;
  readonly daysPerWeek: string;
  readonly daysProblem: boolean;
  readonly heat: readonly (string | null)[];
  readonly ban: BanState;
  readonly dateLabel: string;
  readonly siteName: string | null;
  /** The API's answer for exactly the runs on screen (phase `answer` or `none`). */
  readonly answer: AnswerView | null;
  /** The per-line problems of a 422 (phase `invalid`). */
  readonly invalidLines: readonly RosterError[];
  /** The request id of a failure (phase `error`), when the response had one. */
  readonly requestId: string | null;
  /** The recorded B0 result, when the build has one: it is what "Show a recorded result" shows. */
  readonly recorded: RecordedPlanView | null;
  readonly showRecorded: boolean;
  /** Which day the API said it is: the replay day or today at the site (the sentence under the heading says which). Replay until the API has answered. */
  readonly mode?: "live" | "replay";
  /** Said under the check button: a plan that does not read, the demo site still loading. Island only. */
  readonly notice?: ReactNode;
  /** Undefined in the first paint: the gate loads the island, which owns the state. */
  readonly handlers?: TryHandlers;
  readonly modeSwitch: ReactNode;
  readonly locale: string;
}

export function TryPlanLayout(props: TryLayoutProps) {
  const { phase, runs, templateId, heat, ban, dateLabel, siteName, answer, handlers } = props;
  const t = useTranslations("judge.try");
  const loading = phase === "loading";
  return (
    <>
      <div className="flex justify-end border-b border-hair px-4 py-2 sm:px-6">{props.modeSwitch}</div>
      <SyntheticDemoBanner siteName={siteName} />
      <main id="main-content" className="mx-auto flex w-full max-w-(--content-max) flex-col gap-8 px-4 py-6 sm:px-6 sm:py-8" data-try={phase}>
        <header className="flex flex-col gap-3">
          <h1 className="max-w-(--measure) font-display text-3xl leading-solid font-normal tracking-display sm:text-4xl">{t("title")}</h1>
          <p className="max-w-(--measure) text-lg text-ink-2">{t("lede")}</p>
          <p className="max-w-(--measure) text-sm text-ink-3">{t("independent")}</p>
        </header>

        {/* One real form (Enter in a time field runs the check); `display: contents` keeps the page's own column. */}
        <form
          noValidate
          className="contents"
          {...(handlers === undefined
            ? {}
            : {
                onSubmit: (event: SyntheticEvent<HTMLFormElement>) => {
                  event.preventDefault();
                  handlers.onCheck();
                },
              })}
        >
          <section aria-labelledby="try-plan-heading" className="flex flex-col gap-4" data-hero="">
            <h2 id="try-plan-heading" className="text-base font-semibold text-ink">
              {t("strip.heading")}
            </h2>
            <p className="text-sm text-ink-2">{t(props.mode === "live" ? "dayLive" : "day", { date: dateLabel, headcount: String(REPLAY_HEADCOUNT) })}</p>
            <PlanStrip runs={runs} validator={phase === "answer" || phase === "none" ? (answer?.validator ?? null) : null} heat={heat} ban={ban} dateLabel={dateLabel} />
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-3">
                <button type="submit" data-primary="" data-island-action="check" aria-busy={loading} className={ACTION_PRIMARY_DENSE}>
                  {t("check")}
                </button>
                {loading ? (
                  <p role="status" className="text-sm text-ink-3">
                    {t("checking")}
                  </p>
                ) : null}
              </div>
              {props.notice}
            </div>
          </section>

          <RunsForm
            runs={runs}
            rowProblems={props.rowProblems}
            templateId={templateId}
            acclimatised={props.acclimatised}
            daysPerWeek={props.daysPerWeek}
            daysProblem={props.daysProblem}
            {...(handlers === undefined ? {} : { handlers })}
          />
        </form>

        <Result {...props} />
      </main>
    </>
  );
}

function Result(props: TryLayoutProps) {
  const { phase, answer, invalidLines, requestId, recorded, showRecorded, handlers } = props;
  const t = useTranslations("judge.try");
  const td = useTranslations("judge.try.result");
  if (phase === "idle") return null;

  return (
    <section aria-labelledby="try-result-heading" className="flex flex-col gap-4 border-t border-hair pt-6" data-try-result={phase}>
      <h2 id="try-result-heading" className="font-display text-2xl font-medium">
        {td("heading")}
      </h2>

      {phase === "loading" ? (
        <>
          <div aria-busy="true">
            <Skeleton height="var(--s-24)" />
          </div>
          {/* The check is a live call and can be waiting for a scaled-to-zero API. */}
          <WakingLine />
        </>
      ) : null}

      {(phase === "answer" || phase === "none") && answer !== null ? <AnswerBlock answer={answer} /> : null}

      {phase === "invalid" ? (
        <div role="alert" className="flex flex-col gap-2 rounded-sign border border-edge border-s-3 border-s-ink-2 bg-panel px-4 py-3 text-base text-ink-2" data-notice="invalid">
          <p>
            <strong className="font-medium text-ink">{t("invalid.title")}</strong> {t("invalid.reason")}
          </p>
          <ul className="grid gap-1 text-ink">
            {invalidLines.map((error, i) => (
              <li key={`${String(error.line)}-${String(i)}`} data-invalid-line={error.line}>
                <span className="text-ink-3">{t("invalid.line", { line: String(error.line) })}: </span>
                {error.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {phase === "error" ? (
        <div className="flex flex-col gap-3">
          <div role="alert" className="flex flex-col gap-2 rounded-sign border border-edge border-s-3 border-s-ink-2 bg-panel px-4 py-3 text-base text-ink-2" data-notice="error">
            <p>
              <strong className="font-medium text-ink">{t("error.title")}</strong> {t("error.reason")}
            </p>
            {requestId === null ? null : (
              <p>
                {t("error.requestId")}{" "}
                <code dir="ltr" translate="no" className="font-mono text-xs text-ink">
                  {requestId}
                </code>
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-3">
            <button type="button" data-island-action="check" {...(handlers === undefined ? {} : { onClick: handlers.onCheck })} className={ACTION_PRIMARY_DENSE}>
              {t("error.retry")}
            </button>
            {recorded === null ? null : (
              <button
                type="button"
                data-island-action="show-recorded"
                aria-pressed={showRecorded}
                {...(handlers === undefined ? {} : { onClick: handlers.onShowRecorded })}
                className={ACTION_SECONDARY_DENSE}
              >
                {showRecorded ? t("recorded.hide") : t("recorded.button")}
              </button>
            )}
          </div>
        </div>
      ) : null}

      {phase === "offline" ? (
        <div className="flex flex-col gap-3" data-notice="offline">
          <OfflineBanner />
          {recorded === null ? null : (
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                data-island-action="show-recorded"
                aria-pressed={showRecorded}
                {...(handlers === undefined ? {} : { onClick: handlers.onShowRecorded })}
                className={ACTION_SECONDARY_DENSE}
              >
                {showRecorded ? t("recorded.hide") : t("recorded.button")}
              </button>
            </div>
          )}
        </div>
      ) : null}

      {(phase === "error" || phase === "offline") && showRecorded && recorded !== null ? <RecordedBlock recorded={recorded} locale={props.locale} /> : null}
    </section>
  );
}

function AnswerBlock({ answer }: { readonly answer: AnswerView }) {
  const t = useTranslations("judge.try.result");
  const broken = answer.validator.violations.length;
  return (
    <div className="flex flex-col gap-4" data-answer={broken === 0 ? "none" : "violations"}>
      {answer.forecastStatus === "fresh" ? null : (
        <p role="status" className="max-w-(--measure) text-base font-medium text-ink" data-notice="not-fresh">
          {t("notFresh")}
        </p>
      )}
      <p className="flex flex-col gap-1">
        <strong className="font-display text-3xl leading-solid font-normal tabular-nums text-ink" data-broken={broken}>
          {broken === 0 ? t("zero") : broken === 1 ? t("brokenOne") : t("broken", { count: broken })}
        </strong>
        {broken === 0 ? <span className="text-base text-ink-2">{t("zeroNote")}</span> : null}
      </p>
      {broken === 0 ? null : <ViolationList violations={answer.validator.violations} />}
      <div className="flex flex-col gap-2 border-t border-hair pt-4" data-checked="">
        <h3 className="text-base font-semibold text-ink">{t("checked")}</h3>
        <p className="max-w-(--measure) text-sm text-ink-3">{t("checkedNote")}</p>
        <ul className="flex flex-wrap gap-2">
          {answer.validator.checkedRules.map((rule) => (
            <li key={rule}>
              <code className="rounded-sign border border-hair px-2 py-1 font-mono text-sm text-ink" dir="ltr" translate="no">
                {rule}
              </code>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function RecordedBlock({ recorded, locale }: { readonly recorded: RecordedPlanView; readonly locale: string }) {
  const t = useTranslations("judge.try.recorded");
  const date = new Intl.DateTimeFormat(`${locale === "en" ? "en-US" : locale}-u-nu-latn`, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(recorded.recordedAt));
  return (
    <div className="flex flex-col gap-3 rounded-sign border border-hair p-4" data-recorded="">
      <p className="flex flex-wrap items-center gap-3">
        <Stamp kind="RECORDED" detail={date} />
        <span className="text-sm text-ink-2">{recorded.source === "msw-mock" ? t("noteMock", { date }) : t("note", { date })}</span>
      </p>
      <AnswerBlock answer={recorded} />
    </div>
  );
}
