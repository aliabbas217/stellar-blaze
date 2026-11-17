import { IDBFactory } from "fake-indexeddb";
import {
  clearStopsFor,
  discardExpiredStops,
  dismissExpiredFor,
  drainStopOutbox,
  enqueueStop,
  expiredStops,
  isStopExpired,
  OUTBOX_CLOCK_SKEW_MS,
  OUTBOX_IO_TIMEOUT_MS,
  OUTBOX_ROW_TTL_MS,
  pendingStops,
  STOP_OUTBOX_DB,
  stopExpiry,
} from "@/features/supervisor/stop-outbox";
import { refusingDelete, refusingGet } from "./outbox-faults";

/*
 * The Stop outbox's expiry rules (F2 W6 fix round 1): a stale row never swallows a fresh press (I2), a clock that was ahead never keeps a
 * row alive (I3), an expired stop stays as a durable notice (a tombstone in the same store) until it is dismissed, and a failed discard
 * never costs a fresh row its send (minor 1). Real IndexedDB (fake-indexeddb), as in stop-outbox.test.ts.
 */

const minutesAgo = (minutes: number): Date => new Date(Date.now() - minutes * 60 * 1000);

/** Writes a row exactly as given (bypassing `enqueueStop`): a stale, skewed or damaged row as an earlier build or a clock change could leave. */
async function addRaw(factory: IDBFactory, row: Record<string, unknown>): Promise<void> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(STOP_OUTBOX_DB, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("stops", { keyPath: "key", autoIncrement: true });
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(new Error("open failed"));
    };
  });
  await new Promise<void>((resolve) => {
    const transaction = database.transaction("stops", "readwrite");
    transaction.objectStore("stops").add(row);
    transaction.oncomplete = () => {
      resolve();
    };
  });
  database.close();
}

describe("I2: a fresh press is never swallowed by a row the next drain would discard", () => {
  it("a stale row of the same crew is replaced in the same transaction: the fresh stop is SENT, and only it", async () => {
    const factory = new IDBFactory();
    await enqueueStop("crew-a", minutesAgo(61), { factory });
    await enqueueStop("crew-a", new Date(), { factory });

    const rows = await pendingStops(factory);
    expect(rows).toHaveLength(1);
    expect(isStopExpired(rows[0]?.clientTime ?? "", Date.now())).toBe(false);

    const sent: string[] = [];
    const result = await drainStopOutbox((row) => {
      sent.push(row.crewId);
      return Promise.resolve("done");
    }, factory);
    expect(sent).toEqual(["crew-a"]);
    expect(result.done).toHaveLength(1);
    expect(result.expired).toEqual([]);
  });

  it("a stale row of ANOTHER crew is left alone, and a fresh row still dedupes: one row per crew", async () => {
    const factory = new IDBFactory();
    await enqueueStop("crew-b", minutesAgo(90), { factory });
    await enqueueStop("crew-a", new Date(), { factory });
    await enqueueStop("crew-a", new Date(), { factory });

    const rows = await pendingStops(factory);
    expect(rows.map((row) => row.crewId).sort()).toEqual(["crew-a", "crew-b"]);
  });

  it("a row of the crew whose time cannot be read does not swallow the press either", async () => {
    const factory = new IDBFactory();
    await addRaw(factory, { crewId: "crew-a", clientTime: "not a time" });
    await enqueueStop("crew-a", new Date(), { factory });

    const rows = await pendingStops(factory);
    expect(rows.map((row) => row.crewId)).toEqual(["crew-a"]);
    expect(Number.isFinite(Date.parse(rows[0]?.clientTime ?? ""))).toBe(true);
  });

  it("a row from a phone clock far ahead (beyond the skew) does not swallow the press", async () => {
    const factory = new IDBFactory();
    await addRaw(factory, { crewId: "crew-a", clientTime: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString() });
    await enqueueStop("crew-a", new Date(), { factory });

    const send = vi.fn(() => Promise.resolve("done" as const));
    await drainStopOutbox(send, factory);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("I3: a clock that was ahead (negative age) never keeps a row alive for ever", () => {
  const now = Date.parse("2026-11-15T10:00:00Z");

  it("names the skew: 5 minutes", () => {
    expect(OUTBOX_CLOCK_SKEW_MS).toBe(5 * 60 * 1000);
  });

  it("isStopExpired: exactly the TTL and exactly the skew ahead are fresh; one millisecond more either way is expired", () => {
    const at = (offset: number): string => new Date(now + offset).toISOString();
    expect(isStopExpired(at(-OUTBOX_ROW_TTL_MS), now)).toBe(false);
    expect(isStopExpired(at(-OUTBOX_ROW_TTL_MS - 1), now)).toBe(true);
    expect(isStopExpired(at(OUTBOX_CLOCK_SKEW_MS), now)).toBe(false);
    expect(isStopExpired(at(OUTBOX_CLOCK_SKEW_MS + 1), now)).toBe(true);
    expect(isStopExpired("not a time", now)).toBe(true);
  });

  it("drain: a row +skew ahead is sent, +skew+1 ms is never sent and is reported expired; so is a row 30 minutes ahead (clock corrected)", async () => {
    const factory = new IDBFactory();
    await addRaw(factory, { crewId: "crew-edge", clientTime: new Date(now + OUTBOX_CLOCK_SKEW_MS).toISOString() });
    await addRaw(factory, { crewId: "crew-over", clientTime: new Date(now + OUTBOX_CLOCK_SKEW_MS + 1).toISOString() });
    await addRaw(factory, { crewId: "crew-far", clientTime: new Date(now + 30 * 60 * 1000).toISOString() });
    const sent: string[] = [];

    const result = await drainStopOutbox(
      (row) => {
        sent.push(row.crewId);
        return Promise.resolve("keep");
      },
      factory,
      now,
    );

    expect(sent).toEqual(["crew-edge"]);
    expect(result.expired.map((row) => row.crewId)).toEqual(["crew-over", "crew-far"]);
    expect((await pendingStops(factory)).map((row) => row.crewId)).toEqual(["crew-edge"]);
  });
});

describe("expiry tombstones: an expired stop stays as a notice until it is dismissed, and is never sent", () => {
  it("an expired row becomes a tombstone in the same store: not pending, not sent, listed as expired, with its crew name", async () => {
    const factory = new IDBFactory();
    await enqueueStop("crew-a", minutesAgo(120), { factory, crewName: "Crew A" });
    await enqueueStop("crew-b", minutesAgo(1), { factory, crewName: "Crew B" });

    const old = await discardExpiredStops(factory);

    expect(old.map((row) => row.crewId)).toEqual(["crew-a"]);
    expect((await pendingStops(factory)).map((row) => row.crewId)).toEqual(["crew-b"]);
    const kept = await expiredStops(factory);
    expect(kept.map((row) => [row.crewId, row.crewName])).toEqual([["crew-a", "Crew A"]]);
    // A second pass finds nothing new to report: a tombstone is reported once.
    expect(await discardExpiredStops(factory)).toEqual([]);
  });

  it("the tombstone survives a reload (a new connection) and a drain never sends it", async () => {
    const factory = new IDBFactory();
    await enqueueStop("crew-a", minutesAgo(120), { factory });
    await discardExpiredStops(factory);
    const send = vi.fn(() => Promise.resolve("done" as const));

    const result = await drainStopOutbox(send, factory);

    expect(send).not.toHaveBeenCalled();
    expect(result).toEqual({ done: [], expired: [] });
    expect((await expiredStops(factory)).map((row) => row.crewId)).toEqual(["crew-a"]);
  });

  it("dismissing removes it for good, and only that crew's tombstones", async () => {
    const factory = new IDBFactory();
    await enqueueStop("crew-a", minutesAgo(120), { factory });
    await enqueueStop("crew-b", minutesAgo(130), { factory });
    await discardExpiredStops(factory);

    await dismissExpiredFor("crew-a", { factory });

    expect((await expiredStops(factory)).map((row) => row.crewId)).toEqual(["crew-b"]);
  });

  it("a tombstone does not block a fresh press for its crew, and a recorded stop (clearStopsFor) leaves the notice alone", async () => {
    const factory = new IDBFactory();
    await enqueueStop("crew-a", minutesAgo(120), { factory });
    await discardExpiredStops(factory);

    await enqueueStop("crew-a", new Date(), { factory });
    expect((await pendingStops(factory)).map((row) => row.crewId)).toEqual(["crew-a"]);

    await clearStopsFor("crew-a", factory);
    expect(await pendingStops(factory)).toEqual([]);
    expect((await expiredStops(factory)).map((row) => row.crewId)).toEqual(["crew-a"]);
  });

  it("enqueueStop stores the crew's display name when given, and nothing else is added", async () => {
    const factory = new IDBFactory();
    await enqueueStop("crew-b", minutesAgo(5), { factory, crewName: "Crew B" });

    const rows = await pendingStops(factory);
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual(["clientTime", "crewId", "crewName", "key"]);
    expect(rows[0]?.crewName).toBe("Crew B");
  });
});

describe("W6 minor 1: a failed discard never costs the rows that were sent or discarded", () => {
  it("returns the rows already marked and leaves the one that failed (and the rest) for the next round", async () => {
    const real = new IDBFactory();
    await enqueueStop("crew-a", minutesAgo(120), { factory: real });
    await enqueueStop("crew-b", minutesAgo(121), { factory: real });
    await enqueueStop("crew-c", minutesAgo(122), { factory: real });
    const keys = (await pendingStops(real)).map((row) => row.key);
    const failing = refusingGet(real, (key) => key === keys[1]);

    const old = await discardExpiredStops(failing);

    // Every expired row is reported, the ones the store could not mark too (told from memory, marked next round).
    expect(old.map((row) => row.crewId)).toEqual(["crew-a", "crew-b", "crew-c"]);
    expect((await expiredStops(real)).map((row) => row.crewId)).toEqual(["crew-a"]);
    // The next round, with the store healthy again, marks the rest.
    expect((await discardExpiredStops(real)).map((row) => row.crewId)).toEqual(["crew-b", "crew-c"]);
  });

  it("a drain whose discard failed still sends the fresh rows this round, and never sends the expired one", async () => {
    const real = new IDBFactory();
    await enqueueStop("crew-old", minutesAgo(120), { factory: real });
    await enqueueStop("crew-new", minutesAgo(2), { factory: real });
    const [oldRow] = await pendingStops(real);
    const failing = refusingGet(real, (key) => key === oldRow?.key);
    const sent: string[] = [];

    const result = await drainStopOutbox((row) => {
      sent.push(row.crewId);
      return Promise.resolve("done");
    }, failing);

    expect(sent).toEqual(["crew-new"]);
    expect(result.done.map((row) => row.crewId)).toEqual(["crew-new"]);
    // The row that could not be marked is still reported (item 2): told from memory, never sent.
    expect(result.expired.map((row) => row.crewId)).toEqual(["crew-old"]);
    expect(result.expired[0]?.expiredKind).toBe("lapsed");
  });
});

/** Runs `change` on the row stored under `key`, through its own connection: what ANOTHER tab does to the store between this tab's read and send. */
async function changeRaw(factory: IDBFactory, key: number, change: (row: Record<string, unknown>) => Record<string, unknown> | null): Promise<void> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(STOP_OUTBOX_DB, 1);
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(new Error("open failed"));
    };
  });
  await new Promise<void>((resolve) => {
    const transaction = database.transaction("stops", "readwrite");
    const store = transaction.objectStore("stops");
    const found = store.get(key) as IDBRequest<Record<string, unknown>>;
    found.onsuccess = () => {
      const next = change(found.result);
      if (next === null) store.delete(key);
      else store.put(next);
    };
    transaction.oncomplete = () => {
      resolve();
    };
  });
  database.close();
}

describe("W6 fix 2, item 8: why a stop expired (stopExpiry), told apart so a notice never says something false", () => {
  const now = Date.parse("2026-11-15T10:00:00Z");
  const at = (offset: number): string => new Date(now + offset).toISOString();

  it("older than the TTL is 'lapsed'; ahead of the clock beyond the skew is 'clock'; unreadable is 'clock'; the two edges are fresh", () => {
    expect(stopExpiry(at(-OUTBOX_ROW_TTL_MS - 1), now)).toBe("lapsed");
    expect(stopExpiry(at(-OUTBOX_ROW_TTL_MS), now)).toBeNull();
    expect(stopExpiry(at(OUTBOX_CLOCK_SKEW_MS + 1), now)).toBe("clock");
    expect(stopExpiry(at(OUTBOX_CLOCK_SKEW_MS), now)).toBeNull();
    expect(stopExpiry(at(10 * 60 * 1000), now)).toBe("clock");
    expect(stopExpiry("not a time", now)).toBe("clock");
    expect(stopExpiry("", now)).toBe("clock");
  });

  it("the marker writes the reason on the tombstone, and expiredStops reads it back", async () => {
    const factory = new IDBFactory();
    await addRaw(factory, { crewId: "crew-old", clientTime: new Date(Date.now() - 2 * OUTBOX_ROW_TTL_MS).toISOString(), crewName: "Crew Old" });
    await addRaw(factory, { crewId: "crew-ahead", clientTime: new Date(Date.now() + 10 * 60 * 1000).toISOString() });

    const found = await discardExpiredStops(factory);

    expect(found.map((row) => [row.crewId, row.expiredKind])).toEqual([
      ["crew-old", "lapsed"],
      ["crew-ahead", "clock"],
    ]);
    expect((await expiredStops(factory)).map((row) => [row.crewId, row.expiredKind])).toEqual([
      ["crew-old", "lapsed"],
      ["crew-ahead", "clock"],
    ]);
  });

  it("a row with an UNREADABLE time is no longer dropped silently: it becomes a 'clock' tombstone, never sent", async () => {
    const factory = new IDBFactory();
    await addRaw(factory, { crewId: "crew-x", clientTime: "garbage" });
    const send = vi.fn(() => Promise.resolve("done" as const));

    const result = await drainStopOutbox(send, factory);

    expect(send).not.toHaveBeenCalled();
    expect(result.expired.map((row) => [row.crewId, row.expiredKind])).toEqual([["crew-x", "clock"]]);
    expect((await expiredStops(factory)).map((row) => [row.crewId, row.expiredKind])).toEqual([["crew-x", "clock"]]);
    expect(await pendingStops(factory)).toEqual([]);
  });

  it("a tombstone written before this round has no kind and reads 'lapsed'", async () => {
    const factory = new IDBFactory();
    await addRaw(factory, { crewId: "crew-a", clientTime: at(-2 * OUTBOX_ROW_TTL_MS), expiredAt: at(0) });

    expect((await expiredStops(factory)).map((row) => [row.crewId, row.expiredKind])).toEqual([["crew-a", "lapsed"]]);
  });

  it("dismissing one kind leaves the other; dismissing without a kind removes both", async () => {
    const factory = new IDBFactory();
    await addRaw(factory, { crewId: "crew-a", clientTime: at(-2 * OUTBOX_ROW_TTL_MS), expiredAt: at(0), expiredKind: "lapsed" });
    await addRaw(factory, { crewId: "crew-a", clientTime: at(0), expiredAt: at(0), expiredKind: "clock" });

    await dismissExpiredFor("crew-a", { factory, kind: "clock" });
    expect((await expiredStops(factory)).map((row) => row.expiredKind)).toEqual(["lapsed"]);

    await dismissExpiredFor("crew-a", { factory });
    expect(await expiredStops(factory)).toEqual([]);
  });

  it("item 2: dismissing also removes an expired row that was never marked (so a notice shown from memory does not come back), and never a fresh row", async () => {
    const factory = new IDBFactory();
    await enqueueStop("crew-a", minutesAgo(120), { factory });
    await enqueueStop("crew-b", minutesAgo(2), { factory });
    await enqueueStop("crew-c", minutesAgo(130), { factory });

    await dismissExpiredFor("crew-a", { factory });
    await dismissExpiredFor("crew-b", { factory });

    expect((await pendingStops(factory)).map((row) => row.crewId)).toEqual(["crew-b", "crew-c"]);
    expect(await expiredStops(factory)).toEqual([]);
  });
});

describe("W6 fix 2, item 3: the drain judges every row by a live clock and by what the store holds NOW", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("a slow first send pushes the second row past the TTL: it is NOT sent, becomes a tombstone, and is reported as lapsed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const factory = new IDBFactory();
    await enqueueStop("crew-a", minutesAgo(59), { factory, crewName: "Crew A" });
    await enqueueStop("crew-b", minutesAgo(59), { factory, crewName: "Crew B" });
    const sent: string[] = [];

    const result = await drainStopOutbox((row) => {
      sent.push(row.crewId);
      // The request took two minutes: crew-b, 59 minutes old when the drain began, is 61 now.
      vi.setSystemTime(Date.now() + 2 * 60 * 1000);
      return Promise.resolve("done");
    }, factory);

    expect(sent).toEqual(["crew-a"]);
    expect(result.done.map((row) => row.crewId)).toEqual(["crew-a"]);
    expect(result.expired.map((row) => [row.crewId, row.expiredKind, row.crewName])).toEqual([["crew-b", "lapsed", "Crew B"]]);
    expect((await expiredStops(factory)).map((row) => row.crewId)).toEqual(["crew-b"]);
    expect(await pendingStops(factory)).toEqual([]);
  });

  it("an injected clock function is read at every judgement (a fixed number stays one instant)", async () => {
    const factory = new IDBFactory();
    const base = Date.parse("2026-11-15T10:00:00Z");
    await addRaw(factory, { crewId: "crew-a", clientTime: new Date(base - OUTBOX_ROW_TTL_MS + 1000).toISOString() });
    await addRaw(factory, { crewId: "crew-b", clientTime: new Date(base - OUTBOX_ROW_TTL_MS + 1000).toISOString() });
    let reading = base;
    const sent: string[] = [];

    const result = await drainStopOutbox(
      (row) => {
        sent.push(row.crewId);
        reading = base + 5_000;
        return Promise.resolve("keep");
      },
      factory,
      () => reading,
    );

    expect(sent).toEqual(["crew-a"]);
    expect(result.expired.map((row) => row.crewId)).toEqual(["crew-b"]);
  });

  it("two tabs: a row another connection tombstoned between this drain's read and its send is NOT sent, and its tombstone is not deleted", async () => {
    const factory = new IDBFactory();
    await enqueueStop("crew-a", minutesAgo(5), { factory });
    await enqueueStop("crew-b", minutesAgo(5), { factory });
    const [, second] = await pendingStops(factory);
    const sent: string[] = [];

    const result = await drainStopOutbox(async (row) => {
      sent.push(row.crewId);
      // Tab B, while tab A's first request is in flight: marks crew-b's row as expired.
      await changeRaw(factory, second?.key ?? -1, (stored) => ({ ...stored, expiredAt: new Date().toISOString(), expiredKind: "lapsed" }));
      return "done";
    }, factory);

    expect(sent).toEqual(["crew-a"]);
    expect(result.done.map((row) => row.crewId)).toEqual(["crew-a"]);
    expect((await expiredStops(factory)).map((row) => row.crewId)).toEqual(["crew-b"]);
  });

  it("two tabs: a row another connection removed between the read and the send is not sent", async () => {
    const factory = new IDBFactory();
    await enqueueStop("crew-a", minutesAgo(5), { factory });
    await enqueueStop("crew-b", minutesAgo(5), { factory });
    const [, second] = await pendingStops(factory);
    const sent: string[] = [];

    await drainStopOutbox(async (row) => {
      sent.push(row.crewId);
      await changeRaw(factory, second?.key ?? -1, () => null);
      return "done";
    }, factory);

    expect(sent).toEqual(["crew-a"]);
  });
});

describe("W6 fix 3, item 2: a delete that fails after a successful send never loses the drain's result", () => {
  it("the drain resolves with the row as done, stops the round (the rest wait), and the next drain finds the row again", async () => {
    const real = new IDBFactory();
    await enqueueStop("crew-a", minutesAgo(5), { factory: real });
    await enqueueStop("crew-b", minutesAgo(5), { factory: real });
    await enqueueStop("crew-c", minutesAgo(130), { factory: real });
    const [first] = await pendingStops(real);
    const sent: string[] = [];

    const result = await drainStopOutbox(
      (row) => {
        sent.push(row.crewId);
        return Promise.resolve("done");
      },
      refusingDelete(real, (key) => key === first?.key),
    );

    // The send answered: it is done whether or not the row could be removed. The round stops there, so crew-b waits and is not sent.
    expect(sent).toEqual(["crew-a"]);
    expect(result.done.map((row) => row.crewId)).toEqual(["crew-a"]);
    // The expired row was found before the send and is reported with the result (its mark is separate from the delete).
    expect(result.expired.map((row) => row.crewId)).toEqual(["crew-c"]);
    expect((await pendingStops(real)).map((row) => row.crewId)).toEqual(["crew-a", "crew-b"]);
  });
});

describe("W6 minor 5: the known limit of the deadline", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("a commit already under way cannot be cancelled by abort(): past the deadline the call is still reported failed (it may land later; the API is idempotent, the TTL bounds it)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let closed = 0;
    const database = {
      objectStoreNames: { contains: () => true },
      transaction: () => ({
        objectStore: () => ({ getAll: () => ({}), add: () => ({}), delete: () => ({}) }),
        abort: () => {
          // What a browser does for a transaction that is already committing.
          throw new DOMException("The transaction is not active.", "InvalidStateError");
        },
      }),
      close: () => {
        closed += 1;
      },
    } as unknown as IDBDatabase;
    const factory: Pick<IDBFactory, "open"> = {
      open: () => {
        const request = {} as IDBOpenDBRequest;
        queueMicrotask(() => {
          Object.defineProperty(request, "result", { value: database });
          request.onsuccess?.(new Event("success"));
        });
        return request;
      },
    };

    const outcome = expect(enqueueStop("crew-b", minutesAgo(5), { factory })).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(OUTBOX_IO_TIMEOUT_MS);
    await outcome;

    expect(closed).toBe(1);
  });
});
