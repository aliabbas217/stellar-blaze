import { IDBFactory } from "fake-indexeddb";
import {
  clearStopsFor,
  discardExpiredStops,
  drainStopOutbox,
  enqueueStop,
  OUTBOX_IO_TIMEOUT_MS,
  OUTBOX_ROW_TTL_MS,
  outboxAvailable,
  pendingStops,
  STOP_OUTBOX_DB,
} from "@/features/supervisor/stop-outbox";

/*
 * The Stop work outbox (F2 Task 19, ruling on safety): a stop pressed with no signal is kept in IndexedDB `sb-stop-outbox-v1` as
 * the crew id and the phone's clock time, and sent later. These tests run against a real IndexedDB implementation
 * (fake-indexeddb), not a hand-written fake: the transactions, the upgrade and the persistence across connections are the point.
 */

/** A phone-clock time a few minutes ago: inside the outbox TTL whenever the test runs. */
const justNow = (): Date => new Date(Date.now() - 5 * 60 * 1000);
const NOON = justNow();

describe("stop outbox", () => {
  it("writes a stop as the crew id and the client time, and nothing else", async () => {
    const factory = new IDBFactory();
    await enqueueStop("crew-b", NOON, { factory });

    const rows = await pendingStops(factory);
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual(["clientTime", "crewId", "key"]);
    expect(rows[0]).toMatchObject({ crewId: "crew-b", clientTime: NOON.toISOString() });
  });

  it("uses the database name the ruling fixes, sb-stop-outbox-v1", async () => {
    const factory = new IDBFactory();
    await enqueueStop("crew-b", NOON, { factory });

    const names = (await factory.databases()).map((database) => database.name);
    expect(names).toEqual([STOP_OUTBOX_DB]);
    expect(STOP_OUTBOX_DB).toBe("sb-stop-outbox-v1");
  });

  it("test_stop_outbox_survives_reload: a new connection reads what an earlier one wrote, oldest first", async () => {
    const factory = new IDBFactory();
    await enqueueStop("crew-b", new Date("2026-09-03T08:00:00Z"), { factory });
    await enqueueStop("crew-a", new Date("2026-09-03T08:01:00Z"), { factory });

    // Each call opens and closes its own connection: this is what a reloaded page does.
    expect((await pendingStops(factory)).map((row) => row.crewId)).toEqual(["crew-b", "crew-a"]);
  });

  it("an empty outbox has nothing to drain and never calls the sender", async () => {
    const send = vi.fn(() => Promise.resolve("done" as const));
    expect(await drainStopOutbox(send, new IDBFactory())).toEqual({ done: [], expired: [] });
    expect(send).not.toHaveBeenCalled();
  });

  it("drain removes a row only when the sender says done: a row that must stay is still there next time", async () => {
    const factory = new IDBFactory();
    await enqueueStop("crew-b", NOON, { factory });
    await enqueueStop("crew-a", NOON, { factory });

    const { done } = await drainStopOutbox((row) => Promise.resolve(row.crewId === "crew-b" ? "done" : "keep"), factory);

    expect(done.map((row) => row.crewId)).toEqual(["crew-b"]);
    expect((await pendingStops(factory)).map((row) => row.crewId)).toEqual(["crew-a"]);
  });

  it("never reports a stop as sent by itself: a sender that fails leaves every row", async () => {
    const factory = new IDBFactory();
    await enqueueStop("crew-b", NOON, { factory });

    await expect(drainStopOutbox(() => Promise.reject(new Error("offline")), factory)).rejects.toThrow("offline");
    expect(await pendingStops(factory)).toHaveLength(1);
  });

  it("one drain runs at a time: a second call joins the first and each row is sent once", async () => {
    const factory = new IDBFactory();
    await enqueueStop("crew-b", NOON, { factory });
    const send = vi.fn(() => Promise.resolve("done" as const));

    const [first, second] = await Promise.all([drainStopOutbox(send, factory), drainStopOutbox(send, factory)]);

    expect(send).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
    expect(first.done).toHaveLength(1);
    expect(await pendingStops(factory)).toEqual([]);
  });

  it("with no IndexedDB there is no outbox: a stop cannot be kept, and says so", async () => {
    expect(outboxAvailable(undefined)).toBe(false);
    await expect(enqueueStop("crew-b", NOON, { factory: undefined })).rejects.toThrow(/cannot be kept/);
    expect(await pendingStops(undefined)).toEqual([]);
  });
});

/** A factory whose `open` never answers: no `success`, no `error`, no `blocked` (a hung IndexedDB). */
function hungOpen(): { factory: Pick<IDBFactory, "open">; opens: () => number } {
  let opens = 0;
  return {
    factory: {
      open: () => {
        opens += 1;
        return {} as IDBOpenDBRequest;
      },
    },
    opens: () => opens,
  };
}

/** A factory whose database opens but whose transactions never complete, error or abort by themselves (a stalled disk). */
function stalledTransaction(): { factory: Pick<IDBFactory, "open">; closed: () => number; aborted: () => number } {
  let closed = 0;
  let aborted = 0;
  const database = {
    objectStoreNames: { contains: () => true },
    transaction: () => ({
      objectStore: () => ({ getAll: () => ({}), add: () => ({}), delete: () => ({}) }),
      abort: () => {
        aborted += 1;
      },
    }),
    close: () => {
      closed += 1;
    },
  } as unknown as IDBDatabase;
  return {
    factory: {
      open: () => {
        const request = {} as IDBOpenDBRequest;
        queueMicrotask(() => {
          Object.defineProperty(request, "result", { value: database });
          request.onsuccess?.(new Event("success"));
        });
        return request;
      },
    },
    closed: () => closed,
    aborted: () => aborted,
  };
}

describe("W6.1: IndexedDB never holds a safety action forever", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("names a short timeout: seconds, not minutes", () => {
    expect(OUTBOX_IO_TIMEOUT_MS).toBeGreaterThanOrEqual(1_000);
    expect(OUTBOX_IO_TIMEOUT_MS).toBeLessThanOrEqual(5_000);
  });

  it("an open that never answers makes enqueueStop reject exactly at the timeout (the bar then reads 'Not sent', never 'queued')", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { factory, opens } = hungOpen();
    let settled = false;
    const outcome = enqueueStop("crew-b", NOON, { factory }).then(
      () => "resolved",
      (error: unknown) => (error instanceof Error ? error.message : "rejected"),
    );
    void outcome.then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(OUTBOX_IO_TIMEOUT_MS - 1);
    expect(opens()).toBe(1);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(await outcome).toMatch(/timed out/i);
  });

  it("a transaction that never completes is abandoned after the timeout: aborted, its connection closed, and the call rejects", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const stalled = stalledTransaction();

    const outcome = expect(enqueueStop("crew-b", NOON, { factory: stalled.factory })).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(OUTBOX_IO_TIMEOUT_MS);
    await outcome;

    expect(stalled.aborted()).toBe(1);
    expect(stalled.closed()).toBe(1);
  });

  it("pendingStops and clearStopsFor are bounded the same way", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { factory } = hungOpen();

    const read = expect(pendingStops(factory)).rejects.toThrow(/timed out/i);
    const clear = expect(clearStopsFor("crew-b", factory)).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(OUTBOX_IO_TIMEOUT_MS);
    await Promise.all([read, clear]);
  });

  it("a drain that hit a hung open rejects, and the next drain is not stuck behind it (single-flight is released)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const hung = hungOpen();
    const send = vi.fn(() => Promise.resolve("done" as const));

    const first = expect(drainStopOutbox(send, hung.factory)).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(OUTBOX_IO_TIMEOUT_MS);
    await first;

    vi.useRealTimers();
    const healthy = new IDBFactory();
    await enqueueStop("crew-b", NOON, { factory: healthy });
    const second = await drainStopOutbox(send, healthy);
    expect(second.done.map((row) => row.crewId)).toEqual(["crew-b"]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("a healthy outbox does not leave a timer behind", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const factory = new IDBFactory();
    await enqueueStop("crew-b", NOON, { factory });
    await pendingStops(factory);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("W6.2: a row older than an hour is never sent", () => {
  const minutesAgo = (minutes: number): Date => new Date(Date.now() - minutes * 60 * 1000);

  it("names the TTL: 60 minutes", () => {
    expect(OUTBOX_ROW_TTL_MS).toBe(60 * 60 * 1000);
  });

  it("drain discards an old row without sending it, reports it as expired, and still sends a fresh row", async () => {
    const factory = new IDBFactory();
    await enqueueStop("crew-a", minutesAgo(61), { factory });
    await enqueueStop("crew-b", minutesAgo(59), { factory });
    const sent: string[] = [];

    const result = await drainStopOutbox((row) => {
      sent.push(row.crewId);
      return Promise.resolve("done");
    }, factory);

    expect(sent).toEqual(["crew-b"]);
    expect(result.expired.map((row) => row.crewId)).toEqual(["crew-a"]);
    expect(result.done.map((row) => row.crewId)).toEqual(["crew-b"]);
    expect(await pendingStops(factory)).toEqual([]);
  });

  it("the age is measured on the row's clientTime against the phone's clock: exactly 60 minutes is still sent, one millisecond more is not", async () => {
    const factory = new IDBFactory();
    const now = Date.parse("2026-11-15T10:00:00Z");
    await enqueueStop("crew-edge", new Date(now - OUTBOX_ROW_TTL_MS), { factory });
    await enqueueStop("crew-late", new Date(now - OUTBOX_ROW_TTL_MS - 1), { factory });
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
    expect(result.expired.map((row) => row.crewId)).toEqual(["crew-late"]);
    // The kept row stays; the expired one is gone.
    expect((await pendingStops(factory)).map((row) => row.crewId)).toEqual(["crew-edge"]);
  });

  it("discardExpiredStops removes only the old rows and returns them (the screen reads them on open, with no signal needed)", async () => {
    const factory = new IDBFactory();
    await enqueueStop("crew-a", minutesAgo(180), { factory });
    await enqueueStop("crew-b", minutesAgo(1), { factory });

    const expired = await discardExpiredStops(factory);

    expect(expired.map((row) => row.crewId)).toEqual(["crew-a"]);
    expect((await pendingStops(factory)).map((row) => row.crewId)).toEqual(["crew-b"]);
  });

  it("a row whose time cannot be read is not listed as pending (its age is unknown, so it is never sent)", async () => {
    const factory = new IDBFactory();
    await enqueueStop("crew-a", justNow(), { factory });
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
      transaction.objectStore("stops").add({ crewId: "crew-x", clientTime: "not a time" });
      transaction.oncomplete = () => {
        resolve();
      };
    });
    database.close();

    expect((await pendingStops(factory)).map((row) => row.crewId)).toEqual(["crew-a"]);
  });
});
