"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { siteForecastQueryOptions, validatePlanMutation } from "@/api/queries";
import { RosterInvalidProblem, type RosterError } from "@/api/roster-problem";
import { dayFormat } from "@/components/charts/day-format";
import type { BanState } from "@/components/spine/ban-state";
import { useDemo } from "@/features/demo/DemoProvider";
import { DemoSwitch } from "@/features/demo/DemoSwitch";
import { banStateFor, SEASON_BAN } from "@/features/judge/ban";
import { lastModeTap, NO_ACTIONS, useRestoreFocus, type IslandProps } from "@/features/judge/live/useIslandGate";
import { TryPlanLayout, type TryPhase } from "./TryPlanLayout";
import { buildRequest, DEFAULT_ACCLIMATISED, DEFAULT_DAYS_PER_WEEK, parseDays } from "./request";
import { filledEntries, MAX_RUNS, normalizeTime, padRuns, rowOfLine, runProblem, templateOf, templateRuns, type Run, type RunProblem, type TemplateId } from "./runs";
import { toAnswerView, type AnswerView, type RecordedPlanView } from "./view";

/*
 * The interactive try-a-plan screen: the island that `TryGate` loads on the first interaction with a control (so TanStack
 * Query and the demo context are not in the route's first-load JS; see features/judge/live/useIslandGate.ts). It renders the
 * same `TryPlanLayout` as the server-rendered first paint, now owning the plan, the two crew assumptions and the call.
 *
 * "Check this plan" sends the request ONCE per press: never on load, never on a change of the plan. The taps made while the island
 * loaded (`initialActions`) are performed once each, in the order tapped (a template sets the plan, a check waits for the demo
 * site and its forecast, a mode tap sets the mode; the plan the check runs on is the last template tapped). The result is the
 * API's answer: nothing about a plan is judged here. Anything that changes the plan clears the answer, which was about the plan it
 * was asked for.
 *
 * The site and the DAY come from the API: the demo site is the first synthetic site of `list_sites` and the day is the `date` of
 * that site's forecast (the replay day in replay mode, today in live mode: the contract requires a date, so neither mode omits
 * it). `date` and `heat` are what the server rendered for its own day; when the API says another day, the page shows that day
 * (label, break, and no heat colour, since the recorded heat is for the other day) and the check is for that day.
 */

export interface TryViewProps extends Partial<IslandProps> {
  /** The site-local day (YYYY-MM-DD) the server rendered `heat`, `ban` and `dateLabel` for. */
  readonly date: string;
  readonly heat: readonly (string | null)[];
  readonly ban: BanState;
  readonly dateLabel: string;
  readonly recorded: RecordedPlanView | null;
}

type Outcome =
  | { readonly kind: "answer"; readonly answer: AnswerView }
  | { readonly kind: "invalid"; readonly lines: readonly RosterError[] }
  | { readonly kind: "error"; readonly requestId: string | null };

type Notice = { readonly kind: "none" } | { readonly kind: "notReady" } | { readonly kind: "noDay" } | { readonly kind: "run"; readonly run: number; readonly problem: RunProblem };

/** The rows the visitor had typed in the static page, or null when the page had none (nothing was typed before the island loaded). */
function runsFromFields(fields: Readonly<Record<string, string>>): Run[] | null {
  if (fields["run-0-start"] === undefined) return null;
  return padRuns(Array.from({ length: MAX_RUNS }, (_, i) => ({ start: fields[`run-${String(i)}-start`] ?? "", end: fields[`run-${String(i)}-end`] ?? "" })));
}

const TEMPLATE_ACTION = /^template-(common|legal|straight)$/;
const NO_HEAT: readonly (string | null)[] = Array.from({ length: 24 }, () => null);
const NO_FIELDS: Readonly<Record<string, string>> = {};

/** The template of the last template tap in the queue, or undefined. */
function lastTemplateTap(actions: readonly string[]): TemplateId | undefined {
  for (let i = actions.length - 1; i >= 0; i -= 1) {
    const id = TEMPLATE_ACTION.exec(actions[i] ?? "")?.[1];
    if (id !== undefined) return id as TemplateId;
  }
  return undefined;
}

export function TryPlanView({ date, heat, ban, dateLabel, recorded, initialActions = NO_ACTIONS, restoreFocus = null, fields = NO_FIELDS }: TryViewProps) {
  const t = useTranslations("judge.try");
  const locale = useLocale();
  const demo = useDemo();
  const site = demo.site;
  const siteId = site?.id;
  const { siteStatus, setDemo } = demo;
  const forecast = useQuery({ ...siteForecastQueryOptions(siteId ?? ""), enabled: siteId !== undefined });
  const forecastDate = forecast.data?.date;
  // Not ready while the site list or the site's forecast is still on its way (a failed one is ready: it is said, not waited for).
  const waiting = siteStatus === "loading" || (siteId !== undefined && forecast.isPending);

  const start = lastTemplateTap(initialActions);
  const [runs, setRuns] = useState<Run[]>(() => (start === undefined ? (runsFromFields(fields) ?? templateRuns("common")) : templateRuns(start)));
  const [rowProblems, setRowProblems] = useState<(RunProblem | null)[]>(() => Array.from({ length: MAX_RUNS }, () => null));
  const [acclimatised, setAcclimatised] = useState(() => (fields.acclimatised === undefined ? DEFAULT_ACCLIMATISED : fields.acclimatised === "true"));
  const [days, setDays] = useState(() => fields.days ?? DEFAULT_DAYS_PER_WEEK);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [daysProblem, setDaysProblem] = useState(false);
  const [showRecorded, setShowRecorded] = useState(false);
  // A tap on "Check this plan" before the demo site is known waits for it (one call, then) instead of asking the visitor to try again.
  const [queued, setQueued] = useState(() => initialActions.includes("check") || initialActions.includes("submit"));

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
    // Blank rows are left out of the request, so every row named here and every line the API reports goes back through `rows`.
    const entries = filledEntries(runs);
    if (entries.length === 0) {
      setNotice({ kind: "none" });
      return;
    }
    for (const { run, row } of entries) {
      const problem = runProblem(run);
      if (problem !== null) {
        setNotice({ kind: "run", run: row + 1, problem: problem.problem });
        return;
      }
    }
    const rows = entries.map((entry) => entry.row);
    const perWeek = parseDays(days);
    if (perWeek === null) {
      setDaysProblem(true);
      return;
    }
    setDaysProblem(false);
    if (siteId === undefined || forecastDate === undefined) {
      // The demo site comes from list_sites and the day from its forecast. While they load the check waits; if they did not answer, say so, never silent.
      if (waiting) setQueued(true);
      else setNotice({ kind: siteId === undefined ? "notReady" : "noDay" });
      return;
    }
    setOutcome(null);
    setShowRecorded(false);
    validate.mutate(buildRequest({ siteId, date: forecastDate, runs: entries.map((entry) => entry.run), acclimatised, days: perWeek }), {
      onSuccess: (response) => {
        setOutcome({ kind: "answer", answer: toAnswerView(response) });
      },
      onError: (error) => {
        setOutcome(
          error instanceof RosterInvalidProblem
            ? { kind: "invalid", lines: error.errors.map((line) => ({ ...line, line: rowOfLine(line.line, rows) })) }
            : { kind: "error", requestId: error.problem.request_id ?? null },
        );
      },
    });
  }

  // The taps that loaded this island are performed once each; a queued check runs when the site and its day are known (or known to be missing).
  const modeTap = lastModeTap(initialActions);
  const modeHandedOff = useRef(false);
  const checkFired = useRef(false);
  const checkRef = useRef(check);
  useEffect(() => {
    checkRef.current = check;
  });
  useEffect(() => {
    if (modeTap === null || modeHandedOff.current) return;
    modeHandedOff.current = true;
    setDemo(modeTap);
  }, [modeTap, setDemo]);
  useEffect(() => {
    // `checkFired` makes the hand-off happen once even when effects run twice (StrictMode in development): check() clears `queued` only on the next render.
    if (!queued) {
      checkFired.current = false;
      return;
    }
    if (waiting || checkFired.current) return;
    checkFired.current = true;
    checkRef.current();
  }, [queued, waiting]);
  useRestoreFocus(restoreFocus);

  // The day on screen: the API's, once it has answered; until then the one the server rendered.
  const shownDate = forecastDate ?? date;
  const shown =
    shownDate === date
      ? { heat, ban, dateLabel }
      : { heat: NO_HEAT, ban: banStateFor(SEASON_BAN, shownDate, locale), dateLabel: dayFormat(locale).withWeekday(shownDate) };

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
      heat={shown.heat}
      ban={shown.ban}
      dateLabel={shown.dateLabel}
      mode={forecast.data?.mode ?? "replay"}
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
                : notice.kind === "noDay"
                  ? t("noDay")
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
