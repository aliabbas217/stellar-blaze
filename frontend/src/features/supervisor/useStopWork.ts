"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clearStopMutation, postStop, stopMutation } from "@/api/queries";
import { ApiProblem } from "@/api/problem";
import type { components } from "@/api/schema";
import {
  clearStopsFor,
  drainStopOutbox,
  enqueueStop,
  outboxAvailable,
  pendingStops,
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

export interface StopWork {
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

/**
 * The stop waiting in the outbox for a crew (one row per crew). The outbox, not React state, is the truth about a queued stop:
 * it survives a reload, so after one the bar still says "Not sent" and a second press cannot write a second row.
 */
interface OutboxRow {
  readonly crewId: string;
  readonly at: string;
}

/** What this phone knows about a stop, and which crew it is about: a state for another crew is no state for this one. */
type Local = LocalState & { readonly crewId: string | null };

const IDLE = { kind: "idle", crewId: null } as const;

/** The prefixes of the keys whose answers a stop, an undo or a resume changes. */
const CREW_STATE_KEYS = [["crews"], ["crew-timeline"], ["crew-day-plan"]] as const;

/** Removes a crew's waiting rows from the outbox (its stop is recorded, so they are spent); true once they are gone. */
async function dropRows(crewId: string): Promise<boolean> {
  try {
    await clearStopsFor(crewId);
    return true;
  } catch {
    return false;
  }
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
 * that stop is over. `serverOf` is what the crews list says about a crew.
 */
export function useStopWork(candidateId: string | null, serverOf: (crewId: string) => ServerStop | null = () => null): StopWorkOf {
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
  // The stop kept in the outbox for this crew, read when the crew is known (a reload) and kept up to date by this hook's own writes.
  const [outboxRow, setOutboxRow] = useState<OutboxRow | null>(null);
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
  const sending = useRef(false);

  const stopMutationOptions = useMemo(() => stopMutation(crewId ?? ""), [crewId]);
  const clearMutationOptions = useMemo(() => clearStopMutation(crewId ?? ""), [crewId]);
  const stopCall = useMutation(stopMutationOptions);
  const clearCall = useMutation(clearMutationOptions);
  const { mutateAsync: sendStop } = stopCall;
  const { mutateAsync: sendClear } = clearCall;

  const refresh = useCallback(() => {
    for (const queryKey of CREW_STATE_KEYS) void queryClient.invalidateQueries({ queryKey });
  }, [queryClient]);

  const stop = (): void => {
    if (crewId === null || sending.current) return;
    // Pressed again with no signal while this crew's stop is already kept: one row is enough, the outbox sends it once.
    if (local.kind === "queued" && typeof navigator !== "undefined" && !navigator.onLine) return;
    sending.current = true;
    setUndoFailedFor(null);
    setResumeFailedFor(null);
    setResumed(null);
    setGone(null);
    const pressedAt = new Date();

    const queue = async (): Promise<void> => {
      // No signal: the stop is kept on this phone. It is "queued" only once the row is committed; if it cannot be kept, it is failed.
      try {
        if (!outboxAvailable()) throw new Error("no outbox");
        await enqueueStop(crewId, pressedAt);
        // The row is the queued state (one row per crew); local state falls back to idle so the outbox row is what the bar reads.
        setOutboxRow({ crewId, at: pressedAt.toISOString() });
        setLocal({ kind: "idle" });
      } catch {
        setLocal({ kind: "failed", reason: "other" });
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
        void dropRows(crewId).then((gone) => {
          if (gone) setOutboxRow((row) => (row !== null && row.crewId === crewId ? null : row));
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
    outboxRow !== null && outboxRow.crewId === crewId
      ? { kind: "queued", at: outboxRow.at, queuedAt: Date.parse(outboxRow.at), crewId }
      : null;
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
    }
  };

  const undo = (): void => {
    if (local.kind !== "stopped" || Date.now() >= local.undoUntil) return;
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

  // After a reload: a stop still waiting in the outbox is "Not sent" again, not a plain idle button. The read never clears a row this
  // hook has just written (a press can land before the read does).
  useEffect(() => {
    if (crewId === null || !outboxAvailable()) return;
    let live = true;
    void pendingStops()
      .then((rows) => {
        const row = rows.find((candidate) => candidate.crewId === crewId);
        if (!live || row === undefined) return;
        setOutboxRow({ crewId, at: row.clientTime });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [crewId]);

  // The crews list shows the stop a waiting row was for: sending it later would stop the crew again after a resume.
  useEffect(() => {
    if (!rowSpent || crewId === null) return;
    void dropRows(crewId).then((gone) => {
      if (gone) setOutboxRow((row) => (row !== null && row.crewId === crewId ? null : row));
    });
  }, [rowSpent, crewId]);

  // The crew the bar is about NOW, for a drain that finishes after the bar moved to another crew (the demo's stand-in crew gives way
  // to the focal one when the list arrives). A drain is single-flight and shared, so its closure may belong to an earlier effect run.
  const latestCrew = useRef<string | null>(crewId);
  useEffect(() => {
    latestCrew.current = crewId;
  }, [crewId]);

  // The outbox drains when the app opens and whenever the phone comes back online. It never reports a send by itself: a row is
  // removed only after the API answered, and the bar says "recorded" only for the stop the API returned. It reconciles with the
  // LATEST crew and always refreshes: the server's answer decides what the bar reads, even if the crew changed mid-drain.
  useEffect(() => {
    if (crewId === null) return;
    const drain = async (): Promise<void> => {
      // Offline there is nothing to send: the rows wait for the `online` event instead of each opening a request that must fail.
      if (typeof navigator !== "undefined" && !navigator.onLine) return;
      const recorded = new Map<string, CrewStop>();
      let done: readonly { readonly crewId: string }[];
      try {
        done = await drainStopOutbox(async (row) => {
          try {
            recorded.set(row.crewId, await postStop(row.crewId, { reason_code: "heat" }));
            return "done";
          } catch (error) {
            return resultOf(error);
          }
        });
      } catch {
        return;
      }
      if (done.length === 0) return;
      refresh();
      const latest = latestCrew.current;
      if (latest === null) return;
      if (done.some((row) => row.crewId === latest)) setOutboxRow((row) => (row !== null && row.crewId === latest ? null : row));
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
  }, [crewId, refresh]);

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
      stop,
      undo,
      resume,
    };
  }
  const base = { crewId, stopId: null, undoSecondsLeft: 0, undoFailed: false, resumeFailed, noActiveStop, stop, undo, resume } as const;
  if (local.kind === "sending") return { ...base, state: "sending", at: null, failure: null };
  if (local.kind === "queued") return { ...base, state: "queued", at: local.at, failure: null };
  if (local.kind === "failed") return { ...base, state: "failed", at: null, failure: local.reason };
  if (serverStopId !== null) {
    return { ...base, state: "stopped", stopId: serverStopId, at: server?.stoppedAt ?? null, failure: null };
  }
  return { ...base, state: "idle", at: null, failure: null };
}
