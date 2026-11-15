"use client";

import { useMutation } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { validatePlanMutation } from "@/api/queries";
import { RosterInvalidProblem, type RosterError } from "@/api/roster-problem";
import type { BanState } from "@/components/spine/ban-state";
import { useDemo } from "@/features/demo/DemoProvider";
import { DemoSwitch } from "@/features/demo/DemoSwitch";
import { useRestoreFocus, type IslandProps } from "@/features/judge/live/useIslandGate";
import { TryPlanLayout, type TryPhase } from "./TryPlanLayout";
import { buildRequest, DEFAULT_ACCLIMATISED, DEFAULT_DAYS_PER_WEEK, parseDays } from "./request";
import { filledRuns, MAX_RUNS, normalizeTime, padRuns, runProblem, templateOf, templateRuns, type Run, type RunProblem, type TemplateId } from "./runs";
import { toAnswerView, type AnswerView, type RecordedPlanView } from "./view";

/*
 * The interactive try-a-plan screen: the island that `TryGate` loads on the first interaction with a control (so TanStack
 * Query and the demo context are not in the route's first-load JS; see features/judge/live/useIslandGate.ts). It renders the
 * same `TryPlanLayout` as the server-rendered first paint, now owning the plan, the two crew assumptions and the call.
 *
 * "Check this plan" sends the request ONCE per press: never on load, never on a change of the plan. The tap that loaded the
 * island (`initialAction`) is performed once, after the demo site is known. The result is the API's answer: nothing about a
 * plan is judged here. Anything that changes the plan clears the answer, which was about the plan it was asked for.
 */

export interface TryViewProps extends Partial<IslandProps> {
  readonly heat: readonly (string | null)[];
  readonly ban: BanState;
  readonly dateLabel: string;
  readonly recorded: RecordedPlanView | null;
}

type Outcome =
  | { readonly kind: "answer"; readonly answer: AnswerView }
  | { readonly kind: "invalid"; readonly lines: readonly RosterError[] }
  | { readonly kind: "error"; readonly requestId: string | null };

type Notice = { readonly kind: "none" } | { readonly kind: "notReady" } | { readonly kind: "run"; readonly run: number; readonly problem: RunProblem };

/** The rows the visitor had typed in the static page, or null when the page had none (nothing was typed before the island loaded). */
function runsFromFields(fields: Readonly<Record<string, string>>): Run[] | null {
  if (fields["run-0-start"] === undefined) return null;
  return padRuns(Array.from({ length: MAX_RUNS }, (_, i) => ({ start: fields[`run-${String(i)}-start`] ?? "", end: fields[`run-${String(i)}-end`] ?? "" })));
}

const TEMPLATE_ACTION = /^template-(common|legal|straight)$/;

export function TryPlanView({ heat, ban, dateLabel, recorded, initialAction = null, restoreFocus = null, fields = {} }: TryViewProps) {
  const t = useTranslations("judge.try");
  const locale = useLocale();
  const demo = useDemo();
  const site = demo.site;
  const siteId = site?.id;
  const { siteStatus, setDemo } = demo;

  const start = TEMPLATE_ACTION.exec(initialAction ?? "")?.[1] as TemplateId | undefined;
  const [runs, setRuns] = useState<Run[]>(() => (start === undefined ? (runsFromFields(fields) ?? templateRuns("common")) : templateRuns(start)));
  const [rowProblems, setRowProblems] = useState<(RunProblem | null)[]>(() => Array.from({ length: MAX_RUNS }, () => null));
  const [acclimatised, setAcclimatised] = useState(() => (fields.acclimatised === undefined ? DEFAULT_ACCLIMATISED : fields.acclimatised === "true"));
  const [days, setDays] = useState(() => fields.days ?? DEFAULT_DAYS_PER_WEEK);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [daysProblem, setDaysProblem] = useState(false);
  const [showRecorded, setShowRecorded] = useState(false);
  // A tap on "Check this plan" before the demo site is known waits for it (one call, then) instead of asking the visitor to try again.
  const [queued, setQueued] = useState(initialAction === "check");

  const validate = useMutation(validatePlanMutation());

  function reset(): void {
    setOutcome(null);
    setNotice(null);
    setShowRecorded(false);
  }

  function check(): void {
    if (validate.isPending) return;
    setQueued(false);
    setNotice(null);
    const filled = filledRuns(runs);
    if (filled.length === 0) {
      setNotice({ kind: "none" });
      return;
    }
    for (const [i, run] of filled.entries()) {
      const problem = runProblem(run);
      if (problem !== null) {
        setNotice({ kind: "run", run: i + 1, problem: problem.problem });
        return;
      }
    }
    const perWeek = parseDays(days);
    if (perWeek === null) {
      setDaysProblem(true);
      return;
    }
    setDaysProblem(false);
    if (siteId === undefined) {
      // The demo site comes from list_sites. While it loads the check waits for it; if it did not answer, say so, never silent.
      if (siteStatus === "loading") setQueued(true);
      else setNotice({ kind: "notReady" });
      return;
    }
    setOutcome(null);
    setShowRecorded(false);
    validate.mutate(buildRequest({ siteId, runs: filled, acclimatised, days: perWeek }), {
      onSuccess: (response) => {
        setOutcome({ kind: "answer", answer: toAnswerView(response) });
      },
      onError: (error) => {
        setOutcome(error instanceof RosterInvalidProblem ? { kind: "invalid", lines: error.errors } : { kind: "error", requestId: error.problem.request_id ?? null });
      },
    });
  }

  // The tap that loaded this island is performed once; a queued check runs when the demo site is known (or known to be missing).
  const handedOff = useRef(false);
  const checkRef = useRef(check);
  useEffect(() => {
    checkRef.current = check;
  });
  useEffect(() => {
    if (handedOff.current) return;
    if (initialAction === "demo-live" || initialAction === "demo-replay") {
      handedOff.current = true;
      setDemo(initialAction === "demo-live" ? "live" : "replay");
    }
  }, [initialAction, setDemo]);
  useEffect(() => {
    if (queued && siteStatus !== "loading") checkRef.current();
  }, [queued, siteStatus]);
  useRestoreFocus(restoreFocus);

  const phase: TryPhase = validate.isPending || queued
    ? "loading"
    : outcome === null
      ? "idle"
      : outcome.kind === "answer"
        ? outcome.answer.validator.violations.length === 0
          ? "none"
          : "answer"
        : outcome.kind;

  return (
    <TryPlanLayout
      phase={phase}
      runs={runs}
      rowProblems={rowProblems}
      templateId={templateOf(runs)}
      acclimatised={acclimatised}
      daysPerWeek={days}
      daysProblem={daysProblem}
      heat={heat}
      ban={ban}
      dateLabel={dateLabel}
      siteName={site?.name ?? null}
      answer={outcome?.kind === "answer" ? outcome.answer : null}
      invalidLines={outcome?.kind === "invalid" ? outcome.lines : []}
      requestId={outcome?.kind === "error" ? outcome.requestId : null}
      recorded={recorded}
      showRecorded={showRecorded}
      locale={locale}
      modeSwitch={<DemoSwitch />}
      notice={
        notice === null ? null : (
          <p role="status" className="text-sm text-ink-2" data-notice={notice.kind}>
            {notice.kind === "none"
              ? t("runs.none")
              : notice.kind === "notReady"
                ? t("notReady")
                : `${t("runs.run", { n: String(notice.run) })}: ${t(`runs.problem.${notice.problem}`)}`}
          </p>
        )
      }
      handlers={{
        onCheck: check,
        onShowRecorded: () => {
          setShowRecorded((value) => !value);
        },
        onTemplate: (id) => {
          setRuns(templateRuns(id));
          setRowProblems(Array.from({ length: MAX_RUNS }, () => null));
          reset();
        },
        onRun: (index, field, value) => {
          setRuns((current) => current.map((run, i) => (i === index ? { ...run, [field]: value } : run)));
          setRowProblems((current) => current.map((problem, i) => (i === index ? null : problem)));
          reset();
        },
        onRunBlur: (index, field) => {
          // A time is checked when its field loses focus (never mid-keystroke): one that reads is tidied to hh:mm. A row is only
          // judged once both of its times are filled in; a half-written row is said when the check is pressed.
          const row = runs[index];
          if (row === undefined) return;
          const tidy: Run = { ...row, [field]: normalizeTime(row[field]) ?? row[field] };
          setRuns((current) => current.map((run, i) => (i === index ? tidy : run)));
          const both = tidy.start.trim() !== "" && tidy.end.trim() !== "";
          setRowProblems((current) => current.map((problem, i) => (i === index ? (both ? (runProblem(tidy)?.problem ?? null) : null) : problem)));
        },
        onAcclimatised: (value) => {
          setAcclimatised(value);
          reset();
        },
        onDays: (value) => {
          setDays(value);
          setDaysProblem(false);
          reset();
        },
      }}
    />
  );
}
