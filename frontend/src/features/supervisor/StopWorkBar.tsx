"use client";

import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Spinner } from "@/components/states/Spinner";
import { ACTION_SECONDARY } from "@/components/states/actions";
import type { StopWork } from "@/features/supervisor/useStopWork";
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
 * Resuming is the opposite risk (a crew back in the heat), so it sits behind a confirm dialog, with "Keep work stopped" as the
 * focused default.
 */

const BAR = "fixed inset-x-0 bottom-0 z-10";
const INNER = "mx-auto max-w-110 border-t border-edge px-4 pt-3 pb-[calc(var(--s-3)+env(safe-area-inset-bottom))]";
const PRESS =
  "flex min-h-14 w-full touch-manipulation items-center justify-center gap-3 rounded-sign bg-ink px-4 font-body text-lg font-semibold text-ground";
const GHOST =
  "flex min-h-14 w-full touch-manipulation items-center justify-center rounded-sign border-2 border-ground px-4 font-body text-lg font-semibold text-ground";
const bdi = (chunks: ReactNode): ReactNode => <bdi>{chunks}</bdi>;

function ResumeDialog({ crewName, at, onConfirm, onCancel }: { crewName: string; at: string; onConfirm: () => void; onCancel: () => void }) {
  const t = useTranslations("supervisor.stop");
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);

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
      onCancel={onCancel}
      className="m-auto w-[min(92vw,26rem)] rounded-sign border border-edge bg-panel p-6 text-ink backdrop:bg-ground/80"
    >
      <h2 id={titleId} className="font-display text-xl font-medium leading-(--sign-leading-text)">
        {t.rich("resumeTitle", { crew: crewName, bdi })}
      </h2>
      <p className="mt-2 text-base text-ink-2">{t.rich("resumeBody", { time: at, bdi })}</p>
      <div className="mt-6 flex flex-col gap-3">
        <button ref={cancelRef} type="button" onClick={onCancel} className={`${ACTION_SECONDARY} min-h-14 w-full text-lg`}>
          {t("resumeCancel")}
        </button>
        <button type="button" onClick={onConfirm} className={`${ACTION_SECONDARY} min-h-14 w-full text-lg`}>
          {t("resumeConfirm")}
        </button>
      </div>
    </dialog>
  );
}

export interface StopWorkBarProps {
  /** The crew's name, or null while it is not known (the press still works: the crew id is what is sent). */
  readonly crewName: string | null;
  /** The stop state of the crew; null when there is no crew to stop (the list did not load, or the site has no crews). */
  readonly work: StopWork | null;
  /** What to say when there is no crew to stop. */
  readonly noCrew: "unavailable" | "none";
}

export function StopWorkBar({ crewName, work, noCrew }: StopWorkBarProps) {
  const t = useTranslations("supervisor.stop");
  const time = useTimeFormat();
  const [confirming, setConfirming] = useState(false);
  const label = crewName ?? t("theCrew");
  const at = work?.at === null || work?.at === undefined ? "" : time(new Date(work.at));

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
                <p className="text-lg font-semibold leading-(--sign-leading-text)">{t.rich("stoppedBar", { time: at, bdi })}</p>
                <p className="text-base leading-(--sign-leading-text)">{t.rich("stoppedDetail", { crew: label, bdi })}</p>
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
          {work.state === "sending" ? <Spinner className="size-6" /> : null}
          <span>{crewName === null ? t("buttonGeneric") : t.rich("button", { crew: crewName, bdi })}</span>
        </button>
      </div>
    </div>
  );
}
