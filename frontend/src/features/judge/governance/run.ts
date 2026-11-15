import type { Outcome } from "./answer";
import type { AuditRow, RecordedView, RefusalAnswer } from "./recorded-view";

/*
 * What the governance screen draws, decided in one place and shared by the server-rendered first paint and the interactive
 * island: the same function runs with no live input (first paint) and with the page's own call and the API's log (island), so
 * the two can never disagree about which run is on screen. Imports only types: it ships in neither graph as code of its own.
 *
 *   steps 1 to 4 are ONE run: the one this page just made once there is one, the recorded run before. The API's own log rows
 *   (what earlier sends wrote, possibly by other visitors) never replace a recorded step: before a live run they sit in their
 *   own block, "Live rows from the demo API".
 */

/** The worker list shows the newest rows only, with the count: a demo that is pressed often must not grow the page without end. */
export const MAX_ROWS = 3;

export type GovernanceState = "loading" | "recorded" | "live" | "empty" | "unauthorized" | "limited" | "failed" | "unexpected";

export interface RunInput {
  readonly recorded: RecordedView | null;
  /** This page's latest call: when it was sent and what came back (null while it runs). Null before any send. */
  readonly live: { readonly sentAt: string; readonly outcome: Outcome | null } | null;
  /** The last call that was REFUSED (the run steps 1 to 4 show). It stays on screen while a later call runs or fails (401, 429, network). */
  readonly lastRun: { readonly sentAt: string; readonly answer: RefusalAnswer } | null;
  /** The API's own log rows, newest first (empty before the island has read them). */
  readonly apiRows: readonly AuditRow[];
  readonly pending: boolean;
}

export interface RunModel {
  readonly state: GovernanceState;
  readonly runLive: boolean;
  readonly outcome: Outcome | null;
  readonly requestSentAt: string | null;
  readonly answer: RefusalAnswer | null;
  readonly auditRow: AuditRow | null;
  readonly logRows: readonly AuditRow[];
  readonly shownRows: readonly AuditRow[];
  readonly apiRows: readonly AuditRow[];
  readonly shownApiRows: readonly AuditRow[];
  readonly showApiBlock: boolean;
}

export function deriveRun({ recorded, live, lastRun, apiRows, pending }: RunInput): RunModel {
  const outcome = live?.outcome ?? null;
  const liveAnswer: RefusalAnswer | null = lastRun?.answer ?? null;
  const runLive = liveAnswer !== null;
  const logRows: readonly AuditRow[] = runLive ? apiRows : (recorded?.entries ?? []);
  const auditRow: AuditRow | null = runLive ? (apiRows[0] ?? null) : (recorded?.entries[0] ?? null);

  const state: GovernanceState = pending
    ? "loading"
    : outcome !== null && outcome.kind !== "refused"
      ? outcome.kind
      : runLive
        ? logRows.length === 0
          ? "empty"
          : "live"
        : recorded === null
          ? "empty"
          : "recorded";

  return {
    state,
    runLive,
    outcome,
    requestSentAt: runLive && lastRun !== null ? lastRun.sentAt : (recorded?.request.sentAt ?? null),
    answer: liveAnswer ?? recorded?.answer ?? null,
    auditRow,
    logRows,
    shownRows: logRows.slice(0, MAX_ROWS),
    apiRows,
    shownApiRows: apiRows.slice(0, MAX_ROWS),
    showApiBlock: !runLive && apiRows.length > 0,
  };
}
