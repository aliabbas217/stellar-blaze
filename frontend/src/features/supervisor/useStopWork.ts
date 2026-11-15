"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clearStopMutation, postStop, stopMutation } from "@/api/queries";
import { ApiProblem } from "@/api/problem";
import type { components } from "@/api/schema";
import {
  clearStopsFor,
  discardExpiredStops,
  dismissExpiredFor,
  drainStopOutbox,
  enqueueStop,
  expiredStops,
  isStopExpired,
  OUTBOX_ROW_TTL_MS,
  outboxAvailable,
  pendingStops,
  type DrainResult,
  type QueuedStop,
  type SendResult,
} from "@/features/supervisor/stop-outbox";

/*
 * Stop work, as state (F2 Task 19). It is the one safety action of the crews screen, so its rules are the point:
 *
 *  - It never waits: `stop()` is callable in every state, whatever the screen is loading, whatever failed (a plan that did
 *    not validate, a sign-off in flight, a 429). A press while a send is in flight is ignored (the API's stop is idempotent
 *    while a stop is active, so nothing is lost; the label never changes and nothing is disabled).
 *  - It is never shown as delivered when it was not. "stopped" is entered only after the API answered 2xx, and even then the
 *    words are "Stop recorded" (the API records a stop; it does not alert anyone, ADR 0058). With no signal the stop is kept
 *    in the outbox and the state is "queued", which the screen words "Not sent". A refusal (429, a server failure, a stop
 *    that could not even be kept) is "failed", worded "Not sent".
 *  - It has a 10 second undo, which calls `delete_crew_stop`, and a later "resume", the same call. Neither is shown as done
 *    unless the API answered 2xx. A 404 (the stop is gone: already resumed elsewhere, or a demo reset started a new epoch) is a
 *    neutral "no active stop found" and a refetch of the crew: the server's answer decides what the bar reads next.
 *
 * Safety actions never wait (W5 I1): the stop and the undo/resume requests carry a bounded signal (`STOP_TIMEOUT_MS`,
 * `CLEAR_STOP_TIMEOUT_MS`), and a timeout is read exactly like no signal: the stop is kept in the outbox, the bar reads "Not sent"
 * and the next press goes out. A stop that did reach the server meanwhile is shown from the crews list the refetch brings back.
 *
 * The outbox is bounded too (W6): every IndexedDB operation gives up after `OUTBOX_IO_TIMEOUT_MS` and reads as "Not sent", so a hung
 * store can neither hold the single-flight flag nor leave the bar on "sending". A waiting row older than `OUTBOX_ROW_TTL_MS` is never
 * sent (the crew may have been stopped and resumed elsewhere meanwhile). It becomes an expiry notice for THAT crew, wherever the
 * supervisor is on the screen: the notice is a tombstone in the outbox, so it survives a reload and stays until the supervisor dismisses it
 * (`dismissExpired`), presses Stop for that crew again, or undoes or resumes it. The expiry is found at app open, by a drain, by ONE timer
 * set for the earliest waiting row (no polling), and when the page comes back (`visibilitychange`, `pageshow`): the queued state of a
 * row that expired is cleared in the same step, so the bar never says "kept on this phone" and "expired" about one stop.
 *
 * The server's own view of the crew (`server`, from the crews list) is merged in: a stop that is active after a reload, or
 * recorded by another phone, reads "stopped" here too, without an undo window.
 */

type CrewStop = components["schemas"]["CrewStop"];

/** The undo window after a stop is recorded: ten seconds, then the bar reads "Work stopped" with "Resume work". */
export const UNDO_SECONDS = 10;
const UNDO_MS = UNDO_SECONDS * 1000;

/**
 * How long after a stop started the screen may say "Crews are notified within about six minutes" (the default dispatch cadence, ADR 0058).
 * Later the sentence is a stale promise and the bar drops it.
 */
export const NOTIFY_WINDOW_MS = 6 * 60 * 1000;

export type StopState = "idle" | "sending" | "stopped" | "queued" | "failed";
export type StopFailure = "rate-limited" | "other";

/** What the crews list says about the crew, and when that answer was fetched (TanStack Query's `dataUpdatedAt`). */
export interface ServerStop {
  readonly stopped: boolean;
  readonly activeStopId: string | null;
  readonly stoppedAt: string | null;
  readonly asOf: number;
}

/** A stop this phone kept that was NEVER sent and has expired, about one crew, named as the Stop button names it. */
export interface ExpiredNotice {
  readonly crewId: string;
  readonly crewName: string;
}

/** The expiry notices of every crew (not only the bar's), and how the supervisor dismisses one. */
export interface StopNotices {
  readonly expired: readonly ExpiredNotice[];
  readonly dismissExpired: (crewId: string) => void;
}

export interface StopWork extends StopNotices {
  readonly state: StopState;
  readonly stopId: string | null;
  readonly undoSecondsLeft: number;
  /** ISO time the stop was recorded (the server's), or the phone's time while it is only queued. */
  readonly at: string | null;
  readonly failure: StopFailure | null;
  /** The last undo or resume was not sent: say so, the stop still stands. */
  readonly undoFailed: boolean;
  readonly resumeFailed: boolean;
  /** The last undo or resume found no stop to clear (404): said neutrally until the crew list says otherwise. */
  readonly noActiveStop: boolean;
  /** An offline press is waiting on the outbox (a slow store): the state is still idle, the button is busy (aria-busy, no new wording). */
  readonly busy: boolean;
  readonly stop: () => void;
  readonly undo: () => void;
  readonly resume: () => void;
}

type LocalState =
  | { readonly kind: "idle" }
  | { readonly kind: "sending" }
  | { readonly kind: "stopped"; readonly stopId: string; readonly at: string; readonly undoUntil: number; readonly confirmedAt: number }
  | { readonly kind: "queued"; readonly at: string; readonly queuedAt: number }
  | { readonly kind: "failed"; readonly reason: StopFailure };

/** What this phone knows about a stop, and which crew it is about: a state for another crew is no state for this one. */
type Local = LocalState & { readonly crewId: string | null };

const IDLE = { kind: "idle", crewId: null } as const;

/** The prefixes of the keys whose answers a stop, an undo or a resume changes. */
const CREW_STATE_KEYS = [["crews"], ["crew-timeline"], ["crew-day-plan"]] as const;

/** The expired stop being told for a crew: when its row was written, and the crew's name if the row kept one. */
interface ExpiredRecord {
  readonly clientTime: string;
  readonly crewName: string | null;
}

/** What an expired stop is reported with: the crew and the row's time, and the name the press kept (the key is never needed). */
type ExpiredRow = Pick<QueuedStop, "crewId" | "clientTime" | "crewName">;

/** Removes a crew's waiting rows from the outbox (its stop is recorded, so they are spent); true once they are gone. */
async function dropRows(crewId: string): Promise<boolean> {
  try {
    await clearStopsFor(crewId);
    return true;
  } catch {
    return false;
  }
}

/** The API gave no answer (or a server failure): the request may have landed, so the server's list decides what is true. */
function outcomeUnknown(error: unknown): boolean {
  return error instanceof ApiProblem && (error.problem.status === 0 || error.problem.status >= 500);
}

/** What a drained row means for the outbox: sent or refused for good is done; anything that may work later stays. */
function resultOf(error: unknown): SendResult {
  if (!(error instanceof ApiProblem)) return "keep";
  const status = error.problem.status;
  // No answer, throttled, a server failure, or not signed in: the same stop may work next time. Anything else the API refused for good.
  return status === 0 || status === 429 || status === 401 || status === 403 || status >= 500 ? "keep" : "done";
}

/**
 * What this phone still holds about a stop, or idle: a stop that the crews list, fetched after it, no longer shows (a demo reset,
 * a stop cleared on another phone), and a queued stop the list now shows as recorded (sent from elsewhere), are over.
 */
function settled(stored: Local, server: ServerStop | null): Local {
  if (server !== null && stored.kind === "stopped" && server.asOf > stored.confirmedAt && !server.stopped) return IDLE;
  if (server !== null && stored.kind === "queued" && server.asOf > stored.queuedAt && server.stopped) return IDLE;
  return stored;
}

/** The stop state returned with the crew it is about: the bar names that crew, not the one that happens to rank first now. */
export type StopWorkOf = StopWork & { readonly crewId: string | null };

/**
 * `candidateId` is the crew that needs the supervisor first. The state is the candidate's, unless a stop is under way for another
 * crew (the stop raised that crew to red, and the ranking may have moved): then it stays with the crew it was pressed for, until
 * that stop is over. `serverOf` is what the crews list says about a crew; `nameOf` is the crew's name as the screen shows it (null when the
 * list does not know the crew), kept with a queued stop and used to name a crew in an expiry notice.
 */
export function useStopWork(
  candidateId: string | null,
  serverOf: (crewId: string) => ServerStop | null = () => null,
  nameOf: (crewId: string) => string | null = () => null,
): StopWorkOf {
  const queryClient = useQueryClient();
  const [stored, setStored] = useState<Local>(IDLE);
  const heldAfterList = stored.crewId === null ? IDLE : settled(stored, serverOf(stored.crewId));
  const crewId = heldAfterList.kind !== "idle" && heldAfterList.crewId !== null ? heldAfterList.crewId : candidateId;
  const server = crewId === null ? null : serverOf(crewId);
  const setLocal = useCallback(
    (next: LocalState) => {
      setStored({ ...next, crewId });
    },
    [crewId],
  );
  // The stops waiting in the outbox, by crew: crew id -> the row's time. The outbox, not React state, is the truth about a queued stop:
  // it survives a reload, so after one the bar still says "Not sent" and a second press cannot write a second row. Every crew is held
  // (not only the bar's), so the one timer below can watch the earliest of them.
  const [outboxRows, setOutboxRows] = useState<Readonly<Record<string, string>>>({});
  const outboxAt = crewId === null ? undefined : outboxRows[crewId];
  const [now, setNow] = useState(() => Date.now());
  // The crew a failed undo or resume was about (null: none), so a failure never follows the bar to another crew.
  const [undoFailedFor, setUndoFailedFor] = useState<string | null>(null);
  const [resumeFailedFor, setResumeFailedFor] = useState<string | null>(null);
  const undoFailed = crewId !== null && undoFailedFor === crewId;
  const resumeFailed = crewId !== null && resumeFailedFor === crewId;
  // A resume the crews list has not caught up with yet: until a list newer than this arrives, a server "stopped" is stale.
  const [resumed, setResumed] = useState<{ readonly crewId: string | null; readonly at: number } | null>(null);
  const resumedAt = resumed !== null && resumed.crewId === crewId ? resumed.at : null;
  // The crew an undo or resume found no stop for (404), and when: shown until a crew list newer than that says the crew is stopped again.
  const [gone, setGone] = useState<{ readonly crewId: string | null; readonly at: number } | null>(null);
  // Stops this phone kept that were never sent and have expired, by crew, until the supervisor dismisses them.
  const [expiredRows, setExpiredRows] = useState<Readonly<Record<string, ExpiredRecord>>>({});
  // An offline press is waiting on the outbox (a slow store): the button is busy, with no new wording.
  const [queuing, setQueuing] = useState(false);
  const sending = useRef(false);
  // What the supervisor has done since an asynchronous check started, by crew (a counter): a check that began before a press, an undo, a
  // resume or a dismissal must not bring back a notice that action ended.
  const actions = useRef(0);
  const lastAction = useRef(new Map<string, number>());

  const stopMutationOptions = useMemo(() => stopMutation(crewId ?? ""), [crewId]);
  const clearMutationOptions = useMemo(() => clearStopMutation(crewId ?? ""), [crewId]);
  const stopCall = useMutation(stopMutationOptions);
  const clearCall = useMutation(clearMutationOptions);
  const { mutateAsync: sendStop } = stopCall;
  const { mutateAsync: sendClear } = clearCall;

  const refresh = useCallback(() => {
    for (const queryKey of CREW_STATE_KEYS) void queryClient.invalidateQueries({ queryKey });
  }, [queryClient]);

  /** Tells the supervisor of stops that expired. With `since`, a crew the supervisor has acted on after that point is left out. */
  const noteExpired = useCallback((rows: readonly ExpiredRow[], since?: number): void => {
    const fresh = since === undefined ? rows : rows.filter((row) => (lastAction.current.get(row.crewId) ?? 0) <= since);
    if (fresh.length === 0) return;
    setExpiredRows((known) => {
      const next = { ...known };
      // The latest row per crew is the one the notice is about.
      for (const row of fresh) {
        const earlier = next[row.crewId];
        if (earlier === undefined || Date.parse(row.clientTime) >= Date.parse(earlier.clientTime)) {
          next[row.crewId] = { clientTime: row.clientTime, crewName: row.crewName ?? earlier?.crewName ?? null };
        }
      }
      return next;
    });
  }, []);

  /** Rows that expired are no longer waiting: the bar must not call them "kept on this phone" (only a row with the same time: a newer press stays). */
  const forgetRows = useCallback((rows: readonly { readonly crewId: string; readonly at: string }[]): void => {
    if (rows.length === 0) return;
    setOutboxRows((known) => withoutRows(known, rows));
  }, [setOutboxRows]);

  /** The supervisor is done with a crew's notice (a new press, an undo, a resume, or Close): gone from the screen and from the outbox. */
  const dismissFor = useCallback((id: string): void => {
    actions.current += 1;
    lastAction.current.set(id, actions.current);
    setExpiredRows((known) => (known[id] === undefined ? known : Object.fromEntries(Object.entries(known).filter(([key]) => key !== id))));
    if (outboxAvailable()) void dismissExpiredFor(id).catch(() => undefined);
  }, []);

  const stop = (): void => {
    if (crewId === null || sending.current) return;
    // Pressed again with no signal while this crew's stop is already kept: one row is enough, the outbox sends it once. A row that has
    // expired meanwhile (no timer or event has run yet) is not "kept": the press goes through and replaces it.
    if (local.kind === "queued" && typeof navigator !== "undefined" && !navigator.onLine && !isStopExpired(local.at)) return;
    sending.current = true;
    dismissFor(crewId);
    setUndoFailedFor(null);
    setResumeFailedFor(null);
    setResumed(null);
    setGone(null);
    const pressedAt = new Date();
    const crewName = nameOf(crewId) ?? undefined;

    const queue = async (): Promise<void> => {
      // No signal: the stop is kept on this phone. It is "queued" only once the row is committed; if it cannot be kept, it is failed.
      setQueuing(true);
      try {
        if (!outboxAvailable()) throw new Error("no outbox");
        await enqueueStop(crewId, pressedAt, undefined, crewName);
        // The row is the queued state (one row per crew); local state falls back to idle so the outbox row is what the bar reads.
        setOutboxRows((known) => ({ ...known, [crewId]: pressedAt.toISOString() }));
        setLocal({ kind: "idle" });
      } catch {
        setLocal({ kind: "failed", reason: "other" });
      } finally {
        setQueuing(false);
      }
    };

    const run = async (): Promise<void> => {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        await queue();
        return;
      }
      setLocal({ kind: "sending" });
      try {
        const recorded = await sendStop({ reason_code: "heat" });
        const at = Date.now();
        setLocal({ kind: "stopped", stopId: recorded.id, at: recorded.started_at, undoUntil: at + UNDO_MS, confirmedAt: at });
        setNow(at);
        refresh();
        // Recorded: a row left from an earlier no-signal press would stop the crew again after a resume.
        void dropRows(crewId).then((spent) => {
          if (spent) setOutboxRows((known) => withoutCrew(known, crewId));
        });
      } catch (error) {
        const status = error instanceof ApiProblem ? error.problem.status : -1;
        if (status === 0) {
          await queue();
          // No answer is not "not recorded": the request may have landed. The refetch brings the server's truth (a stop it did record
          // reads as a stop, not as "queued"), so a timeout can never leave a recorded stop shown as unsent.
          refresh();
        } else setLocal({ kind: "failed", reason: status === 429 ? "rate-limited" : "other" });
      }
    };
    void run().finally(() => {
      sending.current = false;
    });
  };

  // Derived, never synchronised by an effect: a state for another crew is idle, and the crews list wins over local state once it
  // is newer than that state and disagrees (`settled`).
  const own: LocalState = stored.crewId === crewId ? settled(stored, server) : IDLE;
  const queuedRow: Local | null =
    crewId !== null && outboxAt !== undefined ? { kind: "queued", at: outboxAt, queuedAt: Date.parse(outboxAt), crewId } : null;
  const local: LocalState = own.kind !== "idle" ? own : queuedRow === null ? IDLE : settled(queuedRow, server);
  // The crews list shows the stop the row was waiting to send: the row is spent (see the effect below).
  const rowSpent = own.kind === "idle" && queuedRow !== null && settled(queuedRow, server).kind === "idle";

  const stale = resumedAt !== null && server !== null && server.asOf <= resumedAt;
  // Said while the crew list has not yet answered after the 404, and after it only while it agrees that nothing is stopped.
  const noActiveStop = gone !== null && gone.crewId === crewId && !(server !== null && server.stopped && server.asOf > gone.at);
  const serverStopId = server !== null && server.stopped && !stale ? server.activeStopId : null;

  // The server's id wins once its list is newer than this phone's own record and names another stop: another phone resumed and
  // stopped again, and the id this phone remembers would 404 forever ("fails forever" class).
  const serverNewer = server !== null && local.kind === "stopped" && server.asOf > local.confirmedAt;
  const currentStopId =
    local.kind === "stopped" ? (serverNewer && serverStopId !== null && serverStopId !== local.stopId ? serverStopId : local.stopId) : serverStopId;

  const clear = async (onDone: () => void, onFail: () => void): Promise<void> => {
    if (currentStopId === null) return;
    try {
      await sendClear(currentStopId);
      onDone();
      refresh();
    } catch (error) {
      if (error instanceof ApiProblem && error.problem.status === 404) {
        // No such stop: never "resumed" (the API did not clear anything). Ask the server what the crew's state is now.
        setGone({ crewId, at: Date.now() });
        refresh();
        return;
      }
      onFail();
      // No answer, or a server failure: the DELETE may have landed. The server's list says what is true; a failed undo or resume never
      // waits for the next scheduled refetch (the same rule as the stop path).
      if (outcomeUnknown(error)) refresh();
    }
  };

  const undo = (): void => {
    if (local.kind !== "stopped" || Date.now() >= local.undoUntil) return;
    if (crewId !== null) dismissFor(crewId);
    setUndoFailedFor(null);
    setGone(null);
    void clear(
      () => {
        setLocal({ kind: "idle" });
        setResumed({ crewId, at: Date.now() });
      },
      () => {
        setUndoFailedFor(crewId);
      },
    );
  };

  const resume = (): void => {
    if (crewId !== null) dismissFor(crewId);
    setResumeFailedFor(null);
    setGone(null);
    void clear(
      () => {
        setLocal({ kind: "idle" });
        setResumed({ crewId, at: Date.now() });
      },
      () => {
        setResumeFailedFor(crewId);
      },
    );
  };

  // The undo countdown: a clock tick only while there is a window to count down.
  const undoOpen = local.kind === "stopped" && local.undoUntil > now;
  useEffect(() => {
    if (!undoOpen) return;
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 250);
    return () => {
      clearInterval(timer);
    };
  }, [undoOpen]);

  // When the app opens (after a reload): stops that expired while it was closed are marked and told (offline too: they will never be
  // sent, so they must not read "sent when it is back online"), and every stop still waiting is "Not sent" again, not a plain idle
  // button. The three reads are independent: one failing never hides the others. The merge never overwrites a row this hook has just
  // written, and a check that started before the supervisor acted on a crew leaves that crew out.
  useEffect(() => {
    if (!outboxAvailable()) return;
    const since = actions.current;
    void (async () => {
      try {
        await discardExpiredStops();
      } catch {
        // The read failed: the reads below fail the same way or still find what they can.
      }
      try {
        noteExpired(await expiredStops(), since);
      } catch {
        // Nothing to tell from here.
      }
      try {
        const waiting = (await pendingStops())
          .filter((row) => !isStopExpired(row.clientTime, Date.now()) && (lastAction.current.get(row.crewId) ?? 0) <= since)
          .map((row): [string, string] => [row.crewId, row.clientTime]);
        setOutboxRows((known) => ({ ...Object.fromEntries(waiting), ...known }));
      } catch {
        // The waiting stops could not be read: a press still works, and the drain below still sends.
      }
    })();
  }, [noteExpired]);

  // The crews list shows the stop a waiting row was for: sending it later would stop the crew again after a resume.
  useEffect(() => {
    if (!rowSpent || crewId === null) return;
    void dropRows(crewId).then((spent) => {
      if (spent) setOutboxRows((known) => withoutCrew(known, crewId));
    });
  }, [rowSpent, crewId]);

  // A waiting row ages out while the page is open. ONE timer is set for the earliest row's expiry (no polling): it fires just after the
  // row passes `OUTBOX_ROW_TTL_MS`, tells the supervisor and clears the row's queued state, so the bar stops promising "sent when it is
  // back online" and the next press is not ignored. A phone that slept, or a page restored from the cache, may not have run the timer,
  // so coming back (`visibilitychange`, `pageshow`) re-checks the same way, and looks at every row in the store (another tab's too).
  useEffect(() => {
    const waiting = Object.entries(outboxRows);
    const sweepStore = async (): Promise<void> => {
      try {
        const rows = await discardExpiredStops();
        if (rows.length === 0) return;
        noteExpired(rows);
        forgetRows(rows.map((row) => ({ crewId: row.crewId, at: row.clientTime })));
      } catch {
        // The store could not be read: the rows already known are handled from memory below.
      }
    };
    const lapse = (): void => {
      const lapsed = waiting.filter(([, at]) => isStopExpired(at, Date.now()));
      if (lapsed.length > 0) {
        // From memory first: the notice never waits on a store that may be slow, and the store catches up through `sweepStore`.
        noteExpired(lapsed.map(([id, at]) => ({ crewId: id, clientTime: at })));
        forgetRows(lapsed.map(([id, at]) => ({ crewId: id, at })));
      }
      void sweepStore();
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = (): void => {
      const waits = waiting.map(([, at]) => (isStopExpired(at, Date.now()) ? 0 : Date.parse(at) + OUTBOX_ROW_TTL_MS - Date.now() + 1));
      if (waits.length === 0) return;
      timer = setTimeout(
        () => {
          if (waiting.some(([, at]) => isStopExpired(at, Date.now()))) lapse();
          else arm();
        },
        Math.max(0, Math.min(...waits)),
      );
    };
    arm();
    window.addEventListener("visibilitychange", lapse);
    window.addEventListener("pageshow", lapse);
    return () => {
      if (timer !== undefined) clearTimeout(timer);
      window.removeEventListener("visibilitychange", lapse);
      window.removeEventListener("pageshow", lapse);
    };
  }, [outboxRows, noteExpired, forgetRows]);

  // The crew the bar is about NOW, for a drain that finishes after the bar moved to another crew (the demo's stand-in crew gives way
  // to the focal one when the list arrives). A drain is single-flight and shared, so its closure may belong to an earlier effect run.
  const latestCrew = useRef<string | null>(crewId);
  useEffect(() => {
    latestCrew.current = crewId;
  }, [crewId]);

  // The outbox drains when the app opens and whenever the phone comes back online. It never reports a send by itself: a row is
  // removed only after the API answered, and the bar says "recorded" only for the stop the API returned. It reconciles with the
  // LATEST crew and always refreshes: the server's answer decides what the bar reads, even if the crew changed mid-drain. A row it finds
  // expired is told like any other expiry, for whichever crew it is about.
  useEffect(() => {
    if (crewId === null) return;
    const drain = async (): Promise<void> => {
      // Offline there is nothing to send: the rows wait for the `online` event instead of each opening a request that must fail.
      if (typeof navigator !== "undefined" && !navigator.onLine) return;
      const since = actions.current;
      const recorded = new Map<string, CrewStop>();
      // A send that got no answer may still have landed: the list then decides what the bar reads, not the row that stayed.
      const unanswered: string[] = [];
      let result: DrainResult;
      try {
        result = await drainStopOutbox(async (row) => {
          try {
            recorded.set(row.crewId, await postStop(row.crewId, { reason_code: "heat" }));
            return "done";
          } catch (error) {
            if (outcomeUnknown(error)) unanswered.push(row.crewId);
            return resultOf(error);
          }
        });
      } catch {
        return;
      }
      const { done, expired } = result;
      noteExpired(expired, since);
      forgetRows(expired.map((row) => ({ crewId: row.crewId, at: row.clientTime })));
      if (done.length > 0 || unanswered.length > 0) refresh();
      if (done.length === 0) return;
      setOutboxRows((known) => done.reduce((left, row) => withoutCrew(left, row.crewId), known));
      const latest = latestCrew.current;
      if (latest === null) return;
      const stop = recorded.get(latest);
      if (stop !== undefined) {
        setStored({ kind: "stopped", stopId: stop.id, at: stop.started_at, undoUntil: 0, confirmedAt: Date.now(), crewId: latest });
      }
    };
    void drain();
    const onOnline = (): void => {
      void drain();
    };
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("online", onOnline);
    };
  }, [crewId, refresh, noteExpired, forgetRows]);

  const expired: ExpiredNotice[] = Object.entries(expiredRows)
    .sort(([, a], [, b]) => (Date.parse(a.clientTime) - Date.parse(b.clientTime)) || 0)
    .map(([id, row]) => ({ crewId: id, crewName: row.crewName ?? nameOf(id) ?? id }));
  const notices = { expired, dismissExpired: dismissFor, busy: queuing } as const;

  if (local.kind === "stopped") {
    return {
      crewId,
      state: "stopped",
      stopId: currentStopId,
      undoSecondsLeft: Math.max(0, Math.ceil((local.undoUntil - now) / 1000)),
      at: local.at,
      failure: null,
      undoFailed,
      resumeFailed,
      noActiveStop,
      ...notices,
      stop,
      undo,
      resume,
    };
  }
  const base = { crewId, stopId: null, undoSecondsLeft: 0, undoFailed: false, resumeFailed, noActiveStop, ...notices, stop, undo, resume } as const;
  if (local.kind === "sending") return { ...base, state: "sending", at: null, failure: null };
  if (local.kind === "queued") return { ...base, state: "queued", at: local.at, failure: null };
  if (local.kind === "failed") return { ...base, state: "failed", at: null, failure: local.reason };
  if (serverStopId !== null) {
    return { ...base, state: "stopped", stopId: serverStopId, at: server?.stoppedAt ?? null, failure: null };
  }
  return { ...base, state: "idle", at: null, failure: null };
}

/** The rows map without the rows that were spent or expired (matched on crew AND time: a newer row for the same crew stays). */
function withoutRows(
  known: Readonly<Record<string, string>>,
  rows: readonly { readonly crewId: string; readonly at: string }[],
): Readonly<Record<string, string>> {
  return Object.fromEntries(Object.entries(known).filter(([id, at]) => !rows.some((row) => row.crewId === id && row.at === at)));
}

/** The rows map without one crew (the same map when it was not there). */
function withoutCrew(rows: Readonly<Record<string, string>>, crewId: string): Readonly<Record<string, string>> {
  if (rows[crewId] === undefined) return rows;
  return Object.fromEntries(Object.entries(rows).filter(([id]) => id !== crewId));
}
