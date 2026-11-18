"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState, type ReactNode, type SubmitEvent } from "react";
import { signOffMutation } from "@/api/queries";
import { queryKeys } from "@/api/query-keys";
import { ApiProblem, type Problem } from "@/api/problem";
import type { components } from "@/api/schema";
import { ACTION_PRIMARY } from "@/components/states/actions";
import { formatClock } from "@/components/spine/geometry";
import { cycleOfCode, type PlanAckItem } from "@/features/supervisor/plan/derive-ack";
import { isShiftNotLegal } from "@/features/supervisor/plan/plan-model";
import { ShiftNotLegalResult } from "@/features/supervisor/plan/ShiftNotLegalResult";
import { hourOfDay } from "@/lib/time/zone";

/*
 * Sign-off (F2 Task 20): one tick per acknowledgement item, then "Sign off". It is the page's one primary action, and it is
 * NEVER in the way of a safety action: the Stop work bar is not inside this form (it is not even in this component's tree), no state
 * of the form (in flight, refused, offline) reaches it, and the copy says so.
 *
 *  - The submit button is never pre-disabled (web interface rules): pressed with items unticked it says how many are left and
 *    moves focus to the first unticked box, and sends nothing.
 *  - The items are the SERVER's (`ack_items`): the ids ticked are the ids sent. If the plan changed under the supervisor, the API
 *    answers 409 `review-required` with the ids still missing: they are shown, unticked, and focus goes to the first.
 *  - 422 `shift-not-legal` is shown as an informative result, never as a failure; no signal and any other refusal read as "not
 *    recorded" (never as signed): the signed state comes only from the API's 201.
 *
 * This file is loaded on demand (PlanView), so a signed plan never pays for it. Nothing safety-critical lives here.
 */

type PlanSignOff = components["schemas"]["PlanSignOff"];
type DayPlan = components["schemas"]["DayPlan"];

const bdi = (chunks: ReactNode): ReactNode => <bdi>{chunks}</bdi>;

/** Private-use code point: stands where `{list}` goes while a sentence is formatted, never in any catalogue. */
const LIST_SLOT = "";

type Outcome =
  | { readonly kind: "none" }
  | { readonly kind: "ticks"; readonly left: number }
  | { readonly kind: "missing"; readonly ids: readonly string[] }
  | { readonly kind: "not-legal"; readonly problem: Problem }
  | { readonly kind: "offline" }
  | { readonly kind: "failed"; readonly problem: Problem };

export interface SignOffFormProps {
  readonly crewId: string;
  readonly date: string;
  readonly items: readonly PlanAckItem[];
  readonly zone: string;
}

export default function SignOffForm({ crewId, date, items, zone }: SignOffFormProps) {
  const t = useTranslations("supervisor.plan");
  const crews = useTranslations("supervisor.crews");
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [outcome, setOutcome] = useState<Outcome>({ kind: "none" });
  const boxes = useRef(new Map<string, HTMLInputElement>());
  const sending = useRef(false);
  const mutation = useMutation(signOffMutation(crewId, date));

  // Only ids of the plan as it is now count: a tick for an item that is gone (the plan was refreshed) is not sent.
  const heldIds = items.filter((item) => ticked.has(item.id)).map((item) => item.id);
  const unticked = items.filter((item) => !ticked.has(item.id));
  const list = new Intl.ListFormat(locale, { type: "conjunction", style: "long" });

  // "Plan zone Medium, 06:00 to 09:00" with the zone and both clocks in a <bdi> each (the catalogue's `signOff.item`).
  const itemSentence = (item: PlanAckItem): ReactNode =>
    t.rich("signOff.item", {
      zone: t(`zone.${item.zone}`),
      from: formatClock(hourOfDay(new Date(item.startsAt), zone)),
      to: formatClock(hourOfDay(new Date(item.endsAt), zone)),
      bdi,
    });
  /**
   * A sentence with a list of items in it ("N items need a tick: {list}."), the list joined with the language's own words but built of
   * elements, so every item (and the clocks in it) is an isolate and no clock sits bare in Urdu or Arabic running text. The catalogue
   * message is formatted once with a private-use slot where `{list}` goes, then split there (a message argument cannot be an element).
   */
  const withList = (sentence: (slot: string) => string, entries: readonly ReactNode[]): ReactNode => {
    const [before = "", after = ""] = sentence(LIST_SLOT).split(LIST_SLOT);
    const parts = list.formatToParts(entries.map((_, index) => String(index)));
    return (
      <>
        {before}
        {parts.map((part, index) => (part.type === "literal" ? part.value : <bdi key={index}>{entries[Number(part.value)]}</bdi>))}
        {after}
      </>
    );
  };
  const labelNode = (item: PlanAckItem): ReactNode => {
    const cycle = cycleOfCode(item.textCode);
    return (
      <>
        {itemSentence(item)}
        {cycle === null ? null : <span className="block text-sm text-ink-2">{crews("focal.cycle", { work: String(cycle.work), rest: String(cycle.rest) })}</span>}
      </>
    );
  };

  const focusFirst = (ids: readonly string[]): void => {
    const first = ids[0];
    if (first !== undefined) boxes.current.get(first)?.focus();
  };

  // The server's missing ids may name items this screen has not listed yet (the plan changed since it was read): the plan is read again
  // (onError below), and the first missing item takes the focus once its box exists. Once per refusal: a later refresh of the plan
  // never moves the focus again.
  const focusedFor = useRef<Outcome | null>(null);
  useEffect(() => {
    if (outcome.kind !== "missing" || focusedFor.current === outcome) return;
    const first = outcome.ids.find((id) => boxes.current.has(id));
    if (first === undefined) return;
    focusedFor.current = outcome;
    boxes.current.get(first)?.focus();
  }, [outcome, items]);

  const submit = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (sending.current) return;
    if (unticked.length > 0) {
      setOutcome({ kind: "ticks", left: unticked.length });
      focusFirst(unticked.map((item) => item.id));
      return;
    }
    sending.current = true;
    setOutcome({ kind: "none" });
    mutation.mutate(
      { acknowledged_items: heldIds },
      {
        onSuccess: (signed: PlanSignOff) => {
          // The 201 is the only thing that says "signed". The cache shows it at once; the refetch that follows is the server's word.
          queryClient.setQueryData<DayPlan>(queryKeys.crewDayPlan(crewId), (plan) =>
            plan === undefined
              ? plan
              : { ...plan, signoff_state: "signed", signed_at: signed.signed_at, signed_by_role: signed.signed_by_role, signoff_label_code: null },
          );
          void queryClient.invalidateQueries({ queryKey: ["crews"] });
          void queryClient.invalidateQueries({ queryKey: ["crew-timeline"] });
          void queryClient.invalidateQueries({ queryKey: queryKeys.crewDayPlan(crewId) });
        },
        onError: (error) => {
          const problem = error instanceof ApiProblem ? error.problem : null;
          if (problem === null || problem.status === 0) {
            setOutcome({ kind: "offline" });
          } else if (problem.status === 409 && problem.missing_items !== undefined) {
            const ids = problem.missing_items;
            // The server says these are not acknowledged: they are unticked, whatever this form held.
            setTicked((held) => new Set([...held].filter((id) => !ids.includes(id))));
            setOutcome({ kind: "missing", ids });
            // Read the plan again: an id the screen does not list becomes a box to tick when the new plan arrives.
            void queryClient.invalidateQueries({ queryKey: queryKeys.crewDayPlan(crewId) });
          } else if (isShiftNotLegal(problem)) {
            setOutcome({ kind: "not-legal", problem });
          } else {
            setOutcome({ kind: "failed", problem });
          }
        },
        onSettled: () => {
          sending.current = false;
        },
      },
    );
  };

  const toggle = (id: string, on: boolean): void => {
    setTicked((held) => {
      const next = new Set(held);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const intro: ReactNode =
    items.length === 0
      ? t("signOff.none")
      : items.length === 1
        ? withList((slot) => t("signOff.itemsOne", { list: slot }), items.map(itemSentence))
        : withList((slot) => t("signOff.items", { count: String(items.length), list: slot }), items.map(itemSentence));

  let message: ReactNode = null;
  if (outcome.kind === "ticks") message = unticked.length === 1 ? t("signOff.tickOne") : t("signOff.tickMany", { count: String(unticked.length) });
  else if (outcome.kind === "missing") {
    const named = outcome.ids.map((id): ReactNode => {
      const item = items.find((candidate) => candidate.id === id);
      return item === undefined ? id : itemSentence(item);
    });
    message = withList((slot) => t("signOff.missing", { list: slot }), named);
  } else if (outcome.kind === "offline") message = t("signOff.offline");
  else if (outcome.kind === "failed") message = t("signOff.failed");

  return (
    <section aria-labelledby="sign-off" data-sign-off="" className="flex flex-col gap-3 px-4 pt-6">
      <h2 id="sign-off" className="font-display text-lg font-medium leading-(--sign-leading-text) text-ink">
        {t("signOff.heading")}
      </h2>
      <p className="text-base leading-(--sign-leading-text) text-ink-2">{t("signOff.intro")}</p>
      {/* A plan zone is not a level: the items name plan zones, the sentence above names the hourly level, and the two can differ. */}
      {items.length === 0 ? null : <p data-zone-note="" className="text-sm leading-(--sign-leading-text) text-ink-3">{t("signOff.zoneNote")}</p>}
      <form noValidate onSubmit={submit} className="flex flex-col gap-3">
        <p data-sign-off-items="" className="text-base leading-(--sign-leading-text) text-ink-2">
          {intro}
        </p>
        {items.length === 0 ? null : (
          <ul className="m-0 flex list-none flex-col p-0">
            {items.map((item) => (
              <li key={item.id} className="border-t border-hair">
                <label className="relative flex min-h-11 cursor-pointer items-center gap-3 py-2 text-base leading-(--sign-leading-text) text-ink">
                  {/* The real checkbox covers the whole row (a 44 px target, the row itself); the 24 px box beside the words is its drawing. */}
                  <input
                    ref={(node) => {
                      if (node === null) boxes.current.delete(item.id);
                      else boxes.current.set(item.id, node);
                    }}
                    type="checkbox"
                    name="ack"
                    value={item.id}
                    checked={ticked.has(item.id)}
                    onChange={(event) => {
                      toggle(item.id, event.currentTarget.checked);
                    }}
                    className="peer absolute inset-0 size-full cursor-pointer opacity-0"
                  />
                  <span
                    aria-hidden="true"
                    className="flex size-6 shrink-0 items-center justify-center rounded-sign border-2 border-ink bg-ground text-ground peer-checked:bg-ink peer-checked:[&_svg]:block peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink"
                  >
                    <svg viewBox="0 0 24 24" className="hidden size-4">
                      <path d="M4 12l5 5L20 6" stroke="currentColor" strokeWidth="3" fill="none" />
                    </svg>
                  </span>
                  <span>{labelNode(item)}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <p role="status" data-sign-off-message="" className={`min-h-6 text-base leading-(--sign-leading-text) ${outcome.kind === "none" ? "" : "font-semibold text-ink"}`}>
          {message}
        </p>
        {outcome.kind === "failed" && outcome.problem.request_id !== undefined ? (
          <p className="text-sm text-ink-3">
            {/* Request IDs are the one identifier a person is asked to pass on. */}
            <code dir="ltr" translate="no" className="font-mono text-ink-2">
              {outcome.problem.request_id}
            </code>
          </p>
        ) : null}
        {outcome.kind === "not-legal" ? <ShiftNotLegalResult violations={outcome.problem.violations ?? []} /> : null}
        <button type="submit" data-primary="" aria-busy={mutation.isPending} className={`${ACTION_PRIMARY} w-full`}>
          <span>{t("signOff.submit")}</span>
        </button>
      </form>
    </section>
  );
}
