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

function open(factory: Factory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(STOP_OUTBOX_DB, VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE, { keyPath: "key", autoIncrement: true });
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error("The stop outbox could not be opened."));
    };
    request.onblocked = () => {
      reject(new Error("The stop outbox is blocked by another connection."));
    };
  });
}

/** Runs `work` in one transaction and resolves with its result when the transaction has committed. */
async function inTransaction<T>(factory: Factory, mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await open(factory);
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE, mode);
      const request = work(transaction.objectStore(STORE));
      transaction.oncomplete = () => {
        resolve(request.result);
      };
      transaction.onerror = () => {
        reject(transaction.error ?? new Error("The stop outbox transaction failed."));
      };
      transaction.onabort = () => {
        reject(transaction.error ?? new Error("The stop outbox transaction was aborted."));
      };
    });
  } finally {
    database.close();
  }
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

/** Every waiting stop, oldest first. */
export async function pendingStops(factory: Factory | undefined = defaultFactory()): Promise<QueuedStop[]> {
  if (factory === undefined) return [];
  const rows = await inTransaction(factory, "readonly", (store) => store.getAll() as IDBRequest<QueuedStop[]>);
  return rows.filter((row) => typeof row.crewId === "string" && typeof row.clientTime === "string").sort((a, b) => a.key - b.key);
}

async function removeStop(key: number, factory: Factory): Promise<void> {
  await inTransaction(factory, "readwrite", (store) => store.delete(key));
}

/** What the sender says about one row: it is done (sent, or refused for good), or it must stay for next time. */
export type SendResult = "done" | "keep";

let draining: Promise<QueuedStop[]> | null = null;

/**
 * Sends every waiting stop, oldest first, through `send`, and removes a row only when `send` answers "done". Resolves with
 * the rows that were done. One drain runs at a time (a second call joins the first), and a failure leaves the rest where
 * it is: the next reconnect or app open tries again. Two tabs may both send the same row; the API's stop is idempotent
 * while a stop is active (it answers 201 with the same body), so that is harmless.
 */
export function drainStopOutbox(send: (stop: QueuedStop) => Promise<SendResult>, factory: Factory | undefined = defaultFactory()): Promise<QueuedStop[]> {
  if (factory === undefined) return Promise.resolve([]);
  if (draining !== null) return draining;
  const run = (async (): Promise<QueuedStop[]> => {
    const done: QueuedStop[] = [];
    for (const row of await pendingStops(factory)) {
      if ((await send(row)) !== "done") continue;
      await removeStop(row.key, factory);
      done.push(row);
    }
    return done;
  })();
  draining = run.finally(() => {
    draining = null;
  });
  return draining;
}
