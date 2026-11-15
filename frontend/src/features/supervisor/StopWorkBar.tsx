"use client";

import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Spinner } from "@/components/states/Spinner";
import { ACTION_SECONDARY } from "@/components/states/actions";
import { useClock } from "@/features/demo/useClock";
import { NOTIFY_WINDOW_MS, type StopWorkOf } from "@/features/supervisor/useStopWork";
import { useTimeFormat } from "@/lib/time/use-time-format";

/*
 * Stop work (F2 Task 19), pinned to the foot of the screen for the focal crew. It is the safety action of the screen and the
 * rules are structural, not stylistic:
 *
 *  - always rendered: in every state of the page (loading, error, empty, offline, stale, a plan that failed its validator, a
 *    sign-off in flight) and in every state of the stop itself. The press button is never `disabled`; a press while a send is
 *    in flight is ignored by the hook, not by the button.
 *  - never inside a form (there is none on this screen), no confirm dialog to STOP (ink, one press, a 10 s undo).
 *  - never claims a delivery: "Stop recorded.", "Crews are notified within about six minutes." (the default dispatch cadence,
 *    ADR 0058: a promise about when, never "immediately" and never "alerted") and "Tell the crew now." The API records a stop; it
 *    sends no alert itself. With no signal it reads "Not sent: no signal.", and a refusal "Not sent."
 *  - `data-emergency` marks it for the design gate: it is never the page's one primary action.
 *
 * The "Crews are notified within about six minutes" sentence is a promise about WHEN, so it is made only while it holds: during the
 * first six minutes after the stop started (the stop's own `started_at` against the screen's clock, replay or real). Hours later the
 * bar reads "Work stopped HH:MM" and "Tell the crew now." only. (The architect's ruling fixes the wording while the promise holds.)
 *
 * Hierarchy: the bar is the permanent emergency control, so it is not another ink button. It carries its own framing (a heavy rule
 * across the top, an octagon mark, a double frame inside the ink block) so it is told apart from the screen's primary action by
 * shape and weight, not only by its words. No colour outside the system, no shadow.
 *
 * Resuming is the opposite risk (a crew back in the heat), so it sits behind a confirm dialog, with "Keep work stopped" as the
 * focused default.
 */

const BAR = "fixed inset-x-0 bottom-0 z-10";
const INNER = "mx-auto max-w-110 border-t-4 border-ink px-4 pt-3 pb-[calc(var(--s-3)+env(safe-area-inset-bottom))]";
// The press target: an ink block with a second frame inside it (the stamp the screen's single primary action does not have).
const PRESS = "block w-full touch-manipulation rounded-sign bg-ink p-1 font-body text-ground";
const PRESS_FRAME =
  "flex min-h-16 w-full items-center justify-center gap-3 rounded-sign border-2 border-ground px-4 text-xl font-bold leading-(--sign-leading-text)";
const GHOST =
  "flex min-h-14 w-full touch-manipulation items-center justify-center rounded-sign border-2 border-ground px-4 font-body text-lg font-semibold text-ground";
const bdi = (chunks: ReactNode): ReactNode => <bdi>{chunks}</bdi>;

/** The emergency mark: an octagon (the stop sign's shape) round a solid square. Decorative: the words say it. Drawn here, not in the pictogram set. */
function StopMark({ className = "size-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" data-stop-mark="" className={`shrink-0 ${className}`}>
      <path fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinejoin="miter" d="M8.2 2.6h7.6l5.6 5.6v7.6l-5.6 5.6H8.2l-5.6-5.6V8.2z" />
      <path fill="currentColor" d="M8 8h8v8H8z" />
    </svg>
  );
}

function ResumeDialog({ crewName, at, onConfirm, onCancel }: { crewName: string; at: string; onConfirm: () => void; onCancel: () => void }) {
  const t = useTranslations("supervisor.stop");
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Closes the dialog for real before the bar drops it: a native dialog that is closed (not just unmounted) hands focus back to the
  // control that opened it ("Resume work"), which a keyboard or screen reader user needs.
  const close = (then: () => void): void => {
    const dialog = ref.current;
    if (dialog !== null) {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    }
    then();
  };

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    // A real browser opens it modally (focus is trapped, Escape closes it); an engine without the method gets the plain `open` attribute.
    if (typeof dialog.showModal === "function") {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }
    cancelRef.current?.focus();
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onCancel}
      className="m-auto w-[min(92vw,26rem)] rounded-sign border border-edge bg-panel p-6 text-ink backdrop:bg-ground/80"
    >
      <h2 id={titleId} className="font-display text-xl font-medium leading-(--sign-leading-text)">
        {t.rich("resumeTitle", { crew: crewName, bdi })}
      </h2>
      <p className="mt-2 text-base text-ink-2">{t.rich("resumeBody", { time: at, bdi })}</p>
      <div className="mt-6 flex flex-col gap-3">
        <button
          ref={cancelRef}
          type="button"
          onClick={() => {
            close(onCancel);
          }}
          className={`${ACTION_SECONDARY} min-h-14 w-full text-lg`}>
          {t("resumeCancel")}
        </button>
        <button
          type="button"
          onClick={() => {
            close(onConfirm);
          }}
          className={`${ACTION_SECONDARY} min-h-14 w-full text-lg`}
        >
          {t("resumeConfirm")}
        </button>
      </div>
    </dialog>
  );
}

export interface StopWorkBarProps {
  /** The crew's name, or null while it is not known (the bar then names the crew by its id: the press still works, the id is what is sent). */
  readonly crewName: string | null;
  /** The stop state of the crew; null when there is no crew to stop (the list did not load, or the site has no crews). */
  readonly work: StopWorkOf | null;
  /** What to say when there is no crew to stop. */
  readonly noCrew: "unavailable" | "none";
}

export function StopWorkBar({ crewName, work, noCrew }: StopWorkBarProps) {
  const t = useTranslations("supervisor.stop");
  const time = useTimeFormat();
  const [confirming, setConfirming] = useState(false);
  const clock = useClock();
  // The target is always named: the crew's name, else its id, so the button and the confirmation never read as a bare "the crew".
  const label = crewName ?? work?.crewId ?? "";
  const at = work?.at === null || work?.at === undefined ? "" : time(new Date(work.at));
  // The six-minute promise holds only for a recent stop. A start time we cannot read makes no promise; one in the future (the replay
  // clock is fixed while a real replay server's runs on) counts as recent.
  const startedMs = work?.at === null || work?.at === undefined ? Number.NaN : Date.parse(work.at);
  const withinNotifyWindow = !Number.isNaN(startedMs) && clock.getTime() - startedMs < NOTIFY_WINDOW_MS;

  if (work === null) {
    return (
      <div data-emergency="" className={BAR}>
        <div className={`${INNER} bg-ground`}>
          <p role="status" className="py-2 text-lg font-semibold text-ink">
            {noCrew === "none" ? t("noCrews") : t("noCrew")}
          </p>
        </div>
      </div>
    );
  }

  const stopped = work.state === "stopped";
  const undoOpen = stopped && work.undoSecondsLeft > 0;

  if (stopped) {
    return (
      <div data-emergency="" data-stop-state={undoOpen ? "undo" : "stopped"} className={BAR}>
        <div className={`${INNER} border-ink bg-ink text-ground`}>
          <div role="status" className="flex flex-col gap-1 pb-3">
            {undoOpen ? (
              <p className="text-lg font-semibold leading-(--sign-leading-text)">{t.rich("recorded", { crew: label, time: at, bdi })}</p>
            ) : (
              <>
                <p className="flex items-center gap-3 text-lg font-semibold leading-(--sign-leading-text)">
                  <StopMark className="size-6" />
                  <span>{t.rich("stoppedBar", { time: at, bdi })}</span>
                </p>
                <p className="text-base leading-(--sign-leading-text)">
                  {t.rich(withinNotifyWindow ? "stoppedDetail" : "stoppedDetailLate", { crew: label, bdi })}
                </p>
              </>
            )}
            {work.undoFailed ? <p className="text-base font-semibold leading-(--sign-leading-text)">{t("undoFailed")}</p> : null}
            {work.resumeFailed ? <p className="text-base font-semibold leading-(--sign-leading-text)">{t("resumeFailed")}</p> : null}
            {work.noActiveStop ? <p className="text-base leading-(--sign-leading-text)">{t("noActiveStop")}</p> : null}
          </div>
          {undoOpen ? (
            <button type="button" onClick={work.undo} className={GHOST}>
              {t("undo", { seconds: String(work.undoSecondsLeft) })}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setConfirming(true);
              }}
              className={GHOST}
            >
              {t("resume")}
            </button>
          )}
        </div>
        {confirming && !undoOpen ? (
          <ResumeDialog
            crewName={label}
            at={at}
            onCancel={() => {
              setConfirming(false);
            }}
            onConfirm={() => {
              setConfirming(false);
              work.resume();
            }}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div data-emergency="" data-stop-state={work.state} className={BAR}>
      <div className={`${INNER} bg-ground`}>
        {work.state === "queued" ? (
          <div role="alert" className="flex flex-col gap-1 pb-3 text-ink">
            <p className="text-lg font-semibold leading-(--sign-leading-text)">{t("queued")}</p>
            <p className="text-base leading-(--sign-leading-text) text-ink-2">{t.rich("queuedDetail", { crew: label, bdi })}</p>
          </div>
        ) : work.state === "failed" ? (
          <div role="alert" className="flex flex-col gap-1 pb-3 text-ink">
            <p className="text-lg font-semibold leading-(--sign-leading-text)">{t("failed")}</p>
            <p className="text-base leading-(--sign-leading-text) text-ink-2">{t("failedDetail")}</p>
          </div>
        ) : (
          <p role="status" className="sr-only">
            {work.state === "sending" ? t("sending") : ""}
          </p>
        )}
        {/* A resume that found no stop (404) is neither "resumed" nor a failure: the crew list decides what the bar reads. */}
        {work.noActiveStop ? (
          <p role="status" data-no-active-stop="" className="pb-3 text-base leading-(--sign-leading-text) text-ink-2">
            {t("noActiveStop")}
          </p>
        ) : null}
        <button type="button" aria-busy={work.state === "sending"} onClick={work.stop} className={PRESS}>
          <span className={PRESS_FRAME}>
            {work.state === "sending" ? <Spinner className="size-7" /> : <StopMark />}
            <span>{t.rich("button", { crew: label, bdi })}</span>
          </span>
        </button>
      </div>
    </div>
  );
}
