/*
 * The Stop work outbox (F2 Task 19, ruling on safety): a stop pressed with no signal is written here, to IndexedDB
 * `sb-stop-outbox-v1`, and sent when the phone is back online or the app is opened again. A row is the crew id and the
 * time on the phone's clock: nothing else, no person, no reason text, no level.
 *
 * Two rules the screen relies on:
 *  - a row here is NOT a recorded stop. The screen says "Not sent" for as long as a row is waiting, and says "recorded" only
 *    after the API has answered 2xx. Nothing in this module can report a send: `drainStopOutbox` calls the sender it is
 *    given and removes a row only when that sender says it is done.
 *  - a worker's "remove my data" never touches it. That flow (the profile store's `revoke`) clears named caches and the
 *    service worker's expiration rows, never a database by sweep. The outbox belongs to the supervisor role.
 *
 * Two limits keep the outbox from becoming a hazard of its own (W6): every operation is bounded (`OUTBOX_IO_TIMEOUT_MS`, a hung
 * IndexedDB is a failure, not a wait), and a row older than `OUTBOX_ROW_TTL_MS` is never sent (it is discarded and reported, so the
 * screen can tell the supervisor).
 *
 * The factory is a parameter (default: the browser's `indexedDB`) so a test can hand in its own.
 */

export const STOP_OUTBOX_DB = "sb-stop-outbox-v1";
const STORE = "stops";
const VERSION = 1;

export interface QueuedStop {
  /** The row's key (auto-increment); never shown. */
  readonly key: number;
  readonly crewId: string;
  /** ISO time on the phone's clock when the button was pressed. */
  readonly clientTime: string;
}

type Factory = Pick<IDBFactory, "open">;

function defaultFactory(): Factory | undefined {
  return typeof indexedDB === "undefined" ? undefined : indexedDB;
}

/**
 * How long one outbox operation (open and transaction together) may take before it is given up as failed. A hung IndexedDB (no
 * `success`, no `error`: a stalled disk, a browser that never answers) must not hold a safety action: Stop work awaits the outbox, so
 * an unbounded wait would leave the bar on "sending" or ignore every press (W6.1). A timeout rejects like any other failure, and
 * the screen then reads "Not sent. Tell the crew now." and lets the next press through.
 */
export const OUTBOX_IO_TIMEOUT_MS = 3_000;

/**
 * How old a waiting row may be and still be sent: 60 minutes on the phone's clock (W6.2). A stop that waited longer may no longer
 * apply (the crew was stopped and resumed on another phone meanwhile), and sending it would stop a working crew. An older row is
 * discarded instead and the screen says so; the supervisor decides whether to press Stop work again.
 */
export const OUTBOX_ROW_TTL_MS = 60 * 60 * 1000;

/**
 * Runs `work` in one transaction of a fresh connection and resolves with its result once the transaction has committed. Bounded by
 * `OUTBOX_IO_TIMEOUT_MS` for the whole of it: past that, the call rejects, the transaction is aborted (so a write that was reported
 * as failed does not land later) and the connection is closed, including one that opens only after the deadline.
 */
function inTransaction<T>(factory: Factory, mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let over = false;
    let database: IDBDatabase | undefined;
    let transaction: IDBTransaction | undefined;
    // The first of: the transaction's end, a failure, the deadline. Whatever comes after is ignored. `abort` cancels a transaction that
    // is not finished (a failure or the deadline), so a write reported as failed does not land later.
    const end = (outcome: { readonly value: T } | { readonly error: Error }, abort: boolean): void => {
      if (over) return;
      over = true;
      clearTimeout(timer);
      if (abort) {
        try {
          transaction?.abort();
        } catch {
          // Already committed or aborted: nothing to cancel.
        }
      }
      database?.close();
      if ("error" in outcome) reject(outcome.error);
      else resolve(outcome.value);
    };
    const failure = (error: unknown, fallback: string): Error => (error instanceof Error ? error : new Error(fallback));
    const timer = setTimeout(() => {
      end({ error: new Error(`The stop outbox timed out after ${String(OUTBOX_IO_TIMEOUT_MS)} ms.`) }, true);
    }, OUTBOX_IO_TIMEOUT_MS);

    try {
      const request = factory.open(STOP_OUTBOX_DB, VERSION);
      request.onupgradeneeded = () => {
        const upgrading = request.result;
        if (!upgrading.objectStoreNames.contains(STORE)) upgrading.createObjectStore(STORE, { keyPath: "key", autoIncrement: true });
      };
      request.onsuccess = () => {
        database = request.result;
        // The deadline passed while the browser was still opening: nobody is waiting for this connection any more.
        if (over) {
          database.close();
          return;
        }
        try {
          transaction = database.transaction(STORE, mode);
          const pending = work(transaction.objectStore(STORE));
          transaction.oncomplete = () => {
            end({ value: pending.result }, false);
          };
          transaction.onerror = () => {
            end({ error: failure(transaction?.error, "The stop outbox transaction failed.") }, true);
          };
          transaction.onabort = () => {
            end({ error: failure(transaction?.error, "The stop outbox transaction was aborted.") }, true);
          };
        } catch (error) {
          end({ error: failure(error, "The stop outbox transaction failed.") }, true);
        }
      };
      request.onerror = () => {
        end({ error: failure(request.error, "The stop outbox could not be opened.") }, false);
      };
      request.onblocked = () => {
        end({ error: new Error("The stop outbox is blocked by another connection.") }, false);
      };
    } catch (error) {
      end({ error: failure(error, "The stop outbox could not be opened.") }, false);
    }
  });
}

/** Whether this browser can hold an outbox at all (private modes and old engines cannot). */
export function outboxAvailable(factory: Factory | undefined = defaultFactory()): boolean {
  return factory !== undefined;
}

/**
 * Writes one stop. One row per crew: a crew whose stop is already waiting gets no second row (a second press changes nothing the
 * API would not do once; the check and the write are one transaction, so two presses cannot both miss each other). Rejects when
 * the row could not be committed: the caller must then say "Not sent", never "queued".
 */
export async function enqueueStop(crewId: string, clientTime: Date, factory: Factory | undefined = defaultFactory()): Promise<void> {
  if (factory === undefined) throw new Error("No IndexedDB: the stop cannot be kept.");
  const row = { crewId, clientTime: clientTime.toISOString() };
  await inTransaction(factory, "readwrite", (store) => {
    const existing = store.getAll() as IDBRequest<QueuedStop[]>;
    existing.onsuccess = () => {
      if (!existing.result.some((waiting) => waiting.crewId === crewId)) store.add(row);
    };
    return existing;
  });
}

/**
 * Removes every waiting stop of one crew: its stop is recorded (a direct send answered, or the crews list shows it), so a row
 * left behind would stop the crew AGAIN at the next app open, after a resume. Safe to call with nothing waiting.
 */
export async function clearStopsFor(crewId: string, factory: Factory | undefined = defaultFactory()): Promise<void> {
  if (factory === undefined) return;
  await inTransaction(factory, "readwrite", (store) => {
    const existing = store.getAll() as IDBRequest<QueuedStop[]>;
    existing.onsuccess = () => {
      for (const waiting of existing.result) if (waiting.crewId === crewId) store.delete(waiting.key);
    };
    return existing;
  });
}

/**
 * Every waiting stop, oldest first. A row whose time cannot be read is left out: its age is unknown, so it is neither shown as
 * waiting nor ever sent (rows are written only by `enqueueStop`, with an ISO time; an unreadable one is damage, not a stop).
 */
export async function pendingStops(factory: Factory | undefined = defaultFactory()): Promise<QueuedStop[]> {
  if (factory === undefined) return [];
  const rows = await inTransaction(factory, "readonly", (store) => store.getAll() as IDBRequest<QueuedStop[]>);
  return rows
    .filter((row) => typeof row.crewId === "string" && typeof row.clientTime === "string" && Number.isFinite(Date.parse(row.clientTime)))
    .sort((a, b) => a.key - b.key);
}

/** Whether a row has waited longer than `OUTBOX_ROW_TTL_MS` on the phone's clock (`now`, ms). Exactly the TTL is still fresh. */
function expired(row: QueuedStop, now: number): boolean {
  return now - Date.parse(row.clientTime) > OUTBOX_ROW_TTL_MS;
}

/**
 * Removes every row older than the TTL, WITHOUT sending it, and returns them (oldest first) so the screen can say they expired. The
 * screen calls this when it opens, offline too: a stop that will never be sent must not read "sent when it is back online".
 */
export async function discardExpiredStops(factory: Factory | undefined = defaultFactory(), now: number = Date.now()): Promise<QueuedStop[]> {
  if (factory === undefined) return [];
  const old = (await pendingStops(factory)).filter((row) => expired(row, now));
  for (const row of old) await removeStop(row.key, factory);
  return old;
}

async function removeStop(key: number, factory: Factory): Promise<void> {
  await inTransaction(factory, "readwrite", (store) => store.delete(key));
}

/** What the sender says about one row: it is done (sent, or refused for good), or it must stay for next time. */
export type SendResult = "done" | "keep";

/** What one drain did: the rows that were sent (or refused for good) and removed, and the rows that were too old to send, removed unsent. */
export interface DrainResult {
  readonly done: QueuedStop[];
  readonly expired: QueuedStop[];
}

let draining: Promise<DrainResult> | null = null;

/**
 * Sends every waiting stop younger than the TTL, oldest first, through `send`, and removes a row only when `send` answers "done". A
 * row older than the TTL is removed WITHOUT being sent (`discardExpiredStops`) and comes back in `expired`. One drain runs at a time
 * (a second call joins the first), and a failure leaves the rest where it is: the next reconnect or app open tries again. Two tabs
 * may both send the same row; the API's stop is idempotent while a stop is active (it answers 201 with the same body), so that is
 * harmless. `now` is the phone's clock (ms).
 */
export function drainStopOutbox(
  send: (stop: QueuedStop) => Promise<SendResult>,
  factory: Factory | undefined = defaultFactory(),
  now: number = Date.now(),
): Promise<DrainResult> {
  if (factory === undefined) return Promise.resolve({ done: [], expired: [] });
  if (draining !== null) return draining;
  const run = (async (): Promise<DrainResult> => {
    const done: QueuedStop[] = [];
    const old = await discardExpiredStops(factory, now);
    for (const row of await pendingStops(factory)) {
      if ((await send(row)) !== "done") continue;
      await removeStop(row.key, factory);
      done.push(row);
    }
    return { done, expired: old };
  })();
  draining = run.finally(() => {
    draining = null;
  });
  return draining;
}
