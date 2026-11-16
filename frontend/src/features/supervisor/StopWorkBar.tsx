"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode, type RefCallback } from "react";
import { Spinner } from "@/components/states/Spinner";
import { ACTION_SECONDARY } from "@/components/states/actions";
import { useClock } from "@/features/demo/useClock";
import { NOTIFY_WINDOW_MS, type StopNotices, type StopWorkOf } from "@/features/supervisor/useStopWork";
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

/**
 * The bar is fixed, so the page must end above it, and the bar's height is not a constant: it grows with the stop's state and with every
 * expiry notice. The bar publishes its own height as this custom property on the root (the page pads its bottom with it, see
 * `BAR_CLEARANCE`), kept current by a ResizeObserver and removed when the bar goes. Until the first measure the pages fall back to the
 * clearance the bar needed before notices existed, so a server-rendered page never starts with no room.
 */
export const BAR_HEIGHT_VAR = "--stop-bar-height";
/** The class a page puts on its content so the last row scrolls clear of the bar (the fallback is the old fixed `pb-60`, 15rem). */
export const BAR_CLEARANCE = "pb-[var(--stop-bar-height,15rem)]";

function useBarHeightPublisher(): RefCallback<HTMLDivElement> {
  return useCallback((bar: HTMLDivElement | null) => {
    if (bar === null) return undefined;
    const root = document.documentElement;
    const publish = (): void => {
      root.style.setProperty(BAR_HEIGHT_VAR, `${String(Math.ceil(bar.getBoundingClientRect().height))}px`);
    };
    publish();
    // An engine without ResizeObserver keeps the height of the first measure; the bar still never leaves the screen (see `NOTICES_MAX`).
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(publish);
    observer?.observe(bar);
    return () => {
      observer?.disconnect();
      root.style.removeProperty(BAR_HEIGHT_VAR);
    };
  }, []);
}

/**
 * The notices are at most 40 % of the viewport and scroll inside that: with several expired crews on a short screen (a phone in landscape,
 * 390 x 667) a bar of unbounded height would push the Stop button, or the first notice and its Close button, off the screen, and a fixed bar
 * cannot be scrolled to. The Stop button never moves out of view; the notices scroll behind a keyboard-focusable region.
 */
const NOTICES_MAX = "max-h-[40dvh] overflow-y-auto overscroll-contain";
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

export function ResumeDialog({ crewName, at, onConfirm, onCancel }: { crewName: string; at: string; onConfirm: () => void; onCancel: () => void }) {
  const t = useTranslations("supervisor.stop");
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  // The dialog ends once, whichever way it ends: a button closes it natively, and the native `close` event that follows must not call
  // the cancel handler a second time (nor, after Resume work, call it at all).
  const ended = useRef(false);

  // Closes the dialog for real before the bar drops it: a native dialog that is closed (not just unmounted) hands focus back to the
  // control that opened it ("Resume work"), which a keyboard or screen reader user needs.
  const close = (then: () => void): void => {
    ended.current = true;
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
      onClose={() => {
        // Escape (or the browser closing it): the same as "Keep work stopped", once.
        if (ended.current) return;
        ended.current = true;
        onCancel();
      }}
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
  /**
   * The expiry notices (of every crew, not only the bar's) and how to dismiss one. Separate from `work` because a notice is told on every
   * screen that has the bar, including when there is no crew to stop.
   */
  readonly notices: StopNotices;
  /** What to say when there is no crew to stop. */
  readonly noCrew: "unavailable" | "none";
}

// `rule` is the hairline under the notices: without it the last notice runs into the state line below it ("Not sent. Tell the crew now."), which reads as part of that notice.
const NOTICE_LIGHT = { text: "text-ink-2", rule: "border-hair", close: `${ACTION_SECONDARY} min-h-11 shrink-0 px-4 text-base` } as const;
const NOTICE_DARK = {
  text: "text-ground",
  rule: "border-ground",
  close:
    "flex min-h-11 shrink-0 touch-manipulation items-center justify-center rounded-sign border-2 border-ground px-4 font-body text-base font-semibold text-ground",
} as const;

/**
 * The stops that expired unsent, one notice per crew, until dismissed. The status region is ALWAYS mounted (empty when there is
 * nothing to say): a live region that is inserted already filled is not announced, one that is filled after it exists is. "Close"
 * is the shell's existing label; each button is described by its own notice so a screen reader hears which one it closes.
 */
function ExpiredNotices({ notices, tone }: { notices: StopNotices; tone: typeof NOTICE_LIGHT | typeof NOTICE_DARK }) {
  const t = useTranslations("supervisor.stop");
  const shell = useTranslations("shell");
  const prefix = useId();
  return (
    // With notices the region scrolls (NOTICES_MAX), so it is a focusable scroll container: a keyboard user can reach the notices below the fold of it.
    <div
      role="status"
      data-expired-stops=""
      {...(notices.expired.length === 0 ? {} : { tabIndex: 0 })}
      className={notices.expired.length === 0 ? undefined : `mb-3 flex flex-col gap-3 border-b pb-3 ${tone.rule} ${NOTICES_MAX}`}
    >
      {notices.expired.map((notice) => {
        const id = `${prefix}-${notice.crewId}`;
        return (
          <div key={notice.crewId} data-expired-stop={notice.crewId} className="flex items-start justify-between gap-3">
            <p id={id} className={`text-base leading-(--sign-leading-text) ${tone.text}`}>
              {t.rich("expired", { crew: notice.crewName, bdi })}
            </p>
            <button
              type="button"
              aria-describedby={id}
              onClick={() => {
                notices.dismissExpired(notice.crewId);
              }}
              className={tone.close}
            >
              {shell("close")}
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function StopWorkBar({ crewName, work, notices, noCrew }: StopWorkBarProps) {
  const t = useTranslations("supervisor.stop");
  const time = useTimeFormat();
  const [confirming, setConfirming] = useState(false);
  const clock = useClock();
  const publishHeight = useBarHeightPublisher();
  // The target is always named: the crew's name, else its id, so the button and the confirmation never read as a bare "the crew".
  const label = crewName ?? work?.crewId ?? "";
  const at = work?.at === null || work?.at === undefined ? "" : time(new Date(work.at));
  // The six-minute promise holds only for a recent stop. A start time we cannot read makes no promise; one in the future (the replay
  // clock is fixed while a real replay server's runs on) counts as recent.
  const startedMs = work?.at === null || work?.at === undefined ? Number.NaN : Date.parse(work.at);
  const withinNotifyWindow = !Number.isNaN(startedMs) && clock.getTime() - startedMs < NOTIFY_WINDOW_MS;

  if (work === null) {
    return (
      <div ref={publishHeight} data-emergency="" className={BAR}>
        <div className={`${INNER} bg-ground`}>
          <ExpiredNotices notices={notices} tone={NOTICE_LIGHT} />
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
      <div ref={publishHeight} data-emergency="" data-stop-state={undoOpen ? "undo" : "stopped"} className={BAR}>
        <div className={`${INNER} border-ink bg-ink text-ground`}>
          <ExpiredNotices notices={notices} tone={NOTICE_DARK} />
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
    <div ref={publishHeight} data-emergency="" data-stop-state={work.state} className={BAR}>
      <div className={`${INNER} bg-ground`}>
        <ExpiredNotices notices={notices} tone={NOTICE_LIGHT} />
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
        <button type="button" aria-busy={work.state === "sending" || work.busy} onClick={work.stop} className={PRESS}>
          <span className={PRESS_FRAME}>
            {work.state === "sending" ? <Spinner className="size-7" /> : <StopMark />}
            <span>{t.rich("button", { crew: label, bdi })}</span>
          </span>
        </button>
      </div>
    </div>
  );
}
