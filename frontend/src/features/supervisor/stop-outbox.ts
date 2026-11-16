/*
 * The Stop work outbox (F2 Task 19, ruling on safety): a stop pressed with no signal is written here, to IndexedDB
 * `sb-stop-outbox-v1`, and sent when the phone is back online or the app is opened again. A row is the crew id (and the crew's name as the
 * button showed it) and the time on the phone's clock: nothing else, no person, no reason text, no level.
 *
 * Two rules the screen relies on:
 *  - a row here is NOT a recorded stop. The screen says "Not sent" for as long as a row is waiting, and says "recorded" only
 *    after the API has answered 2xx. Nothing in this module can report a send: `drainStopOutbox` calls the sender it is
 *    given and removes a row only when that sender says it is done.
 *  - a worker's "remove my data" never touches it. That flow (the profile store's `revoke`) clears named caches and the
 *    service worker's expiration rows, never a database by sweep. The outbox belongs to the supervisor role.
 *
 * Two limits keep the outbox from becoming a hazard of its own (W6): every operation is bounded (`OUTBOX_IO_TIMEOUT_MS`, a hung
 * IndexedDB is a failure, not a wait), and a row older than `OUTBOX_ROW_TTL_MS` (or further ahead of the clock than
 * `OUTBOX_CLOCK_SKEW_MS`, or with no readable time) is never sent: it becomes a tombstone (`expiredAt` and why, `expiredKind`, in the same
 * store) that the screen shows as a notice until it is dismissed. A tombstone holds the crew id and name, two times and the reason, no
 * person: the outbox stays outside a worker's "remove my data".
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
  /** The crew's name as the Stop button showed it, when it was known at the press (a notice about the stop names the crew with it). */
  readonly crewName?: string;
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
 * kept as an expiry notice instead and the screen says so; the supervisor decides whether to press Stop work again.
 */
export const OUTBOX_ROW_TTL_MS = 60 * 60 * 1000;

/**
 * How far AHEAD of the phone's clock a row's time may be and still count as fresh: 5 minutes. A row further ahead was written by a clock
 * that was wrong (or has been corrected since), so its age is unknown: it is treated like an expired row (never sent, reported), since a
 * negative age would otherwise keep it "fresh" for as long as the clock stays behind it.
 */
export const OUTBOX_CLOCK_SKEW_MS = 5 * 60 * 1000;

/**
 * Runs `work` in one transaction of a fresh connection and resolves with its result once the transaction has committed. Bounded by
 * `OUTBOX_IO_TIMEOUT_MS` for the whole of it: past that, the call rejects, the transaction is aborted (so a write that was reported
 * as failed does not land later) and the connection is closed, including one that opens only after the deadline.
 *
 * KNOWN LIMIT: `abort()` cannot cancel a transaction that is already committing (it throws, swallowed below). A commit that stalls past
 * the deadline is therefore reported failed ("Not sent") and may still land afterwards. That is safe, not silent: the API's stop is
 * idempotent, the screen has already told the supervisor to tell the crew, and a landed row is bounded by the TTL.
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
 * Why a stop was never sent, which decides what the notice may say. "lapsed": it truly waited longer than `OUTBOX_ROW_TTL_MS`. "clock": its
 * stored time was ahead of the phone's clock beyond the skew, or unreadable, so the wait is unknown and "it waited 60 minutes" would be false.
 */
export type ExpiryKind = "lapsed" | "clock";

/** A stop that was never sent and is told to the supervisor: the row, and why (see `ExpiryKind`). */
export interface ExpiredStop extends QueuedStop {
  readonly expiredKind: ExpiryKind;
}

/** A row as stored: a tombstone (`expiredAt` set) is an expired stop kept for the notice, never a stop to send. A tombstone written before `expiredKind` existed has none and reads "lapsed". */
interface StoredStop extends QueuedStop {
  readonly expiredAt?: string;
  readonly expiredKind?: ExpiryKind;
}

const isTombstone = (row: StoredStop): boolean => typeof row.expiredAt === "string";
const hasCrew = (row: StoredStop): boolean => typeof row.crewId === "string";
const hasTime = (row: StoredStop): boolean => typeof row.clientTime === "string" && Number.isFinite(Date.parse(row.clientTime));
const kindOf = (row: StoredStop): ExpiryKind => (row.expiredKind === "clock" ? "clock" : "lapsed");

/**
 * Why a row's time puts it out of reach of a send, on the phone's clock (`now`, ms), or null while it is fresh. No readable time: "clock"
 * (the wait is unknown; it wins over every other reason). More than `OUTBOX_CLOCK_SKEW_MS` AHEAD of the clock (a negative age: the clock was
 * wrong when it was written, or has been corrected since; exactly the skew is still fresh): "clock". Older than `OUTBOX_ROW_TTL_MS` (exactly
 * the TTL is still fresh): "lapsed".
 */
export function stopExpiry(clientTime: string, now: number = Date.now()): ExpiryKind | null {
  const written = Date.parse(clientTime);
  if (!Number.isFinite(written)) return "clock";
  const age = now - written;
  if (age < -OUTBOX_CLOCK_SKEW_MS) return "clock";
  return age > OUTBOX_ROW_TTL_MS ? "lapsed" : null;
}

/** Whether a row's time puts it out of reach of a send (`stopExpiry` is not null). */
export function isStopExpired(clientTime: string, now: number = Date.now()): boolean {
  return stopExpiry(clientTime, now) !== null;
}

/** What `enqueueStop` may be given besides the stop itself: a test's IndexedDB, and the label the Stop button showed. */
export interface EnqueueOptions {
  readonly factory?: Factory | undefined;
  readonly crewName?: string | undefined;
}

/**
 * Writes one stop. One row per crew: a crew whose stop is already waiting gets no second row (a second press changes nothing the
 * API would not do once; the check and the write are one transaction, so two presses cannot both miss each other). Rejects when
 * the row could not be committed: the caller must then say "Not sent", never "queued".
 *
 * The same transaction first removes the crew's rows that the next drain would discard (older than the TTL, ahead of the clock, or with
 * no readable time): a fresh press is never swallowed by a stale row (I2). A tombstone (an expired stop shown as a notice) is neither
 * a waiting stop nor removed here: dismissing it is the screen's. `crewName` is the label the Stop button shows, kept so a notice about
 * this stop can name the crew after a reload with no crews list.
 */
export async function enqueueStop(crewId: string, clientTime: Date, options: EnqueueOptions = {}): Promise<void> {
  const { factory = defaultFactory(), crewName } = options;
  if (factory === undefined) throw new Error("No IndexedDB: the stop cannot be kept.");
  const row = { crewId, clientTime: clientTime.toISOString(), ...(crewName === undefined || crewName === "" ? {} : { crewName }) };
  await inTransaction(factory, "readwrite", (store) => {
    const existing = store.getAll() as IDBRequest<StoredStop[]>;
    existing.onsuccess = () => {
      const now = Date.now();
      let waiting = false;
      for (const other of existing.result) {
        if (other.crewId !== crewId || isTombstone(other)) continue;
        if (!hasTime(other) || isStopExpired(other.clientTime, now)) store.delete(other.key);
        else waiting = true;
      }
      if (!waiting) store.add(row);
    };
    return existing;
  });
}

/**
 * Removes every waiting stop of one crew: its stop is recorded (a direct send answered, or the crews list shows it), so a row
 * left behind would stop the crew AGAIN at the next app open, after a resume. Safe to call with nothing waiting. Tombstones stay.
 */
export async function clearStopsFor(crewId: string, factory: Factory | undefined = defaultFactory()): Promise<void> {
  if (factory === undefined) return;
  await inTransaction(factory, "readwrite", (store) => {
    const existing = store.getAll() as IDBRequest<StoredStop[]>;
    existing.onsuccess = () => {
      for (const waiting of existing.result) if (waiting.crewId === crewId && !isTombstone(waiting)) store.delete(waiting.key);
    };
    return existing;
  });
}

/**
 * Every waiting stop, oldest first. A row whose time cannot be read is left out: its age is unknown, so it is neither shown as
 * waiting nor ever sent (rows are written only by `enqueueStop`, with an ISO time; an unreadable one is damage, not a stop). A tombstone
 * is not waiting either.
 */
export async function pendingStops(factory: Factory | undefined = defaultFactory()): Promise<QueuedStop[]> {
  return (await waitingRows(factory)).filter(hasTime);
}

/**
 * Every row that is not a tombstone and names a crew, oldest first, INCLUDING a row whose time cannot be read: such a row is never sent and
 * never "waiting", but the supervisor must be told it was dropped (an `ExpiredStop` of kind "clock"), so the expiry code reads it too.
 */
async function waitingRows(factory: Factory | undefined): Promise<QueuedStop[]> {
  if (factory === undefined) return [];
  const rows = await inTransaction(factory, "readonly", (store) => store.getAll() as IDBRequest<StoredStop[]>);
  return rows.filter((row) => hasCrew(row) && !isTombstone(row)).sort((a, b) => a.key - b.key);
}

/** The expired stops still to be told to the supervisor (tombstones), oldest first: each is a notice until `dismissExpiredFor` removes it. */
export async function expiredStops(factory: Factory | undefined = defaultFactory()): Promise<ExpiredStop[]> {
  if (factory === undefined) return [];
  const rows = await inTransaction(factory, "readonly", (store) => store.getAll() as IDBRequest<StoredStop[]>);
  return rows
    .filter((row) => hasCrew(row) && isTombstone(row))
    .sort((a, b) => a.key - b.key)
    .map((row) => ({ ...row, expiredKind: kindOf(row) }));
}

/** What `dismissExpiredFor` may be told: one kind of notice only (default: both), and a test's IndexedDB. */
export interface DismissOptions {
  readonly kind?: ExpiryKind | undefined;
  readonly factory?: Factory | undefined;
}

/**
 * The supervisor has been told: removes the crew's tombstones for good (of one kind, or both), AND the crew's waiting rows that are expired
 * but were never marked (a store that could not write when they expired): otherwise a notice shown from memory would come back at the next
 * open, and a sweep that read the row before the dismissal could mark it afterwards. A waiting row that is still fresh is never touched.
 */
export async function dismissExpiredFor(crewId: string, options: DismissOptions = {}): Promise<void> {
  const { kind, factory = defaultFactory() } = options;
  if (factory === undefined) return;
  await inTransaction(factory, "readwrite", (store) => {
    const existing = store.getAll() as IDBRequest<StoredStop[]>;
    existing.onsuccess = () => {
      const now = Date.now();
      for (const row of existing.result) {
        if (row.crewId !== crewId) continue;
        const why = isTombstone(row) ? kindOf(row) : stopExpiry(row.clientTime, now);
        if (why !== null && (kind === undefined || kind === why)) store.delete(row.key);
      }
    };
    return existing;
  });
}

/**
 * Marks every waiting row that is expired (`stopExpiry`) as a tombstone, WITHOUT sending it, and returns ALL the expired rows it found
 * (oldest first), marked or not, so the screen can tell the supervisor: a row whose mark failed (a store that cannot write: quota) is told
 * from memory and marked next round, never lost. The tombstone keeps the crew id, its name, the two times and why (`expiredKind`), nothing
 * else, and stays until dismissed: a notice that lived only in memory was lost by a reload. A failure stops the marking of this round
 * (a hung store costs one deadline, not N); the drain skips an expired row it still finds, so it is never sent either way.
 * The screen calls this when it opens, offline too: a stop that will never be sent must not read "sent when it is back online".
 */
export async function discardExpiredStops(factory: Factory | undefined = defaultFactory(), now: number = Date.now()): Promise<ExpiredStop[]> {
  if (factory === undefined) return [];
  return reportExpiredRows(await waitingRows(factory), now, factory);
}

/** The marking half of `discardExpiredStops`, over rows already read: never rejects, returns every expired row (marked or not). */
async function reportExpiredRows(rows: readonly QueuedStop[], now: number, factory: Factory): Promise<ExpiredStop[]> {
  const expired = rows.flatMap((row): ExpiredStop[] => {
    const expiredKind = stopExpiry(row.clientTime, now);
    return expiredKind === null ? [] : [{ ...row, expiredKind }];
  });
  for (const row of expired) {
    try {
      await markExpired(row, now, factory);
    } catch {
      break;
    }
  }
  return expired;
}

/** Turns one waiting row into its tombstone, in one transaction (the row may have been removed meanwhile: then nothing is written back). */
async function markExpired(stop: ExpiredStop, now: number, factory: Factory): Promise<void> {
  await inTransaction(factory, "readwrite", (store) => {
    const found = store.get(stop.key) as IDBRequest<StoredStop | undefined>;
    found.onsuccess = () => {
      const row = found.result;
      if (row !== undefined && !isTombstone(row)) store.put({ ...row, expiredAt: new Date(now).toISOString(), expiredKind: stop.expiredKind });
    };
    return found;
  });
}

async function removeStop(key: number, factory: Factory): Promise<void> {
  await inTransaction(factory, "readwrite", (store) => store.delete(key));
}

/** One row as it is stored now (undefined: it is gone). */
async function readRow(key: number, factory: Factory): Promise<StoredStop | undefined> {
  return inTransaction(factory, "readonly", (store) => store.get(key) as IDBRequest<StoredStop | undefined>);
}

/** What the sender says about one row: it is done (sent, or refused for good), or it must stay for next time. */
export type SendResult = "done" | "keep";

/**
 * What one drain did: the rows that were sent (or refused for good) and removed, and the rows that were too old to send (told from memory
 * even when the store could not mark them; the ones it could are tombstones).
 */
export interface DrainResult {
  readonly done: QueuedStop[];
  readonly expired: ExpiredStop[];
}

let draining: Promise<DrainResult> | null = null;

/**
 * Sends every waiting stop that is not expired, oldest first, through `send`, and removes a row only when `send` answers "done". An
 * expired row is marked a tombstone WITHOUT being sent and comes back in `expired`; if marking fails the row is still skipped (and still
 * told), and the fresh rows are sent this round. One drain runs at a time (a second call joins the first), and a failure leaves the rest
 * where it is: the next reconnect or app open tries again. Two tabs may both send the same row; the API's stop is idempotent while a stop
 * is active (it answers 201 with the same body), so that is harmless.
 *
 * `now` is the clock the rows are judged by: by default the phone's live `Date.now()`, read again at every judgement (the read can take up to
 * the deadline, each send up to the request timeout), so a row that was 59 minutes 59 seconds old when the drain started is NOT sent past its
 * 60 minutes. A test injects a function (one reading per judgement) or a fixed number (one instant for the whole drain). Immediately before
 * each send the row is also read again: if another connection (another tab) removed it or marked it expired meanwhile it is skipped, so one
 * tab never sends a stop another tab has just told the supervisor was not sent.
 */
export function drainStopOutbox(
  send: (stop: QueuedStop) => Promise<SendResult>,
  factory: Factory | undefined = defaultFactory(),
  now: number | (() => number) = Date.now,
): Promise<DrainResult> {
  if (factory === undefined) return Promise.resolve({ done: [], expired: [] });
  if (draining !== null) return draining;
  const clock = typeof now === "number" ? (): number => now : now;
  const run = (async (): Promise<DrainResult> => {
    const done: QueuedStop[] = [];
    // One read (a hung store costs one deadline, not two). Marking the expired rows never rejects: a row that could not be marked is
    // skipped below, and the fresh rows are sent this round.
    const rows = await waitingRows(factory);
    const expired = await reportExpiredRows(rows, clock(), factory);
    const known = new Set(expired.map((row) => row.key));
    for (const row of rows) {
      if (known.has(row.key)) continue;
      let current: StoredStop | undefined;
      try {
        current = await readRow(row.key, factory);
      } catch {
        // The store cannot be read: nothing can be verified or removed now. The rest wait for the next round.
        break;
      }
      if (current === undefined || isTombstone(current)) continue;
      // The live clock, after the read above: a row that aged out while it waited its turn is told, not sent.
      const late = await reportExpiredRows([row], clock(), factory);
      if (late.length > 0) {
        expired.push(...late);
        continue;
      }
      if ((await send(row)) !== "done") continue;
      // The API answered: the row is done whether or not it can be removed. A failed delete must not reject the drain (the caller would lose
      // `done` and `expired`, and a recorded stop would never be shown as recorded): the row stays, is sent again next round (idempotent), and
      // the round stops here since the store is not writable.
      done.push(row);
      try {
        await removeStop(row.key, factory);
      } catch {
        break;
      }
    }
    return { done, expired };
  })();
  draining = run.finally(() => {
    draining = null;
  });
  return draining;
}
