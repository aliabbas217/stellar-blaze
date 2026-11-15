import { IDBFactory } from "fake-indexeddb";
import { drainStopOutbox, enqueueStop, outboxAvailable, pendingStops, STOP_OUTBOX_DB } from "@/features/supervisor/stop-outbox";

/*
 * The Stop work outbox (F2 Task 19, ruling on safety): a stop pressed with no signal is kept in IndexedDB `sb-stop-outbox-v1` as
 * the crew id and the phone's clock time, and sent later. These tests run against a real IndexedDB implementation
 * (fake-indexeddb), not a hand-written fake: the transactions, the upgrade and the persistence across connections are the point.
 */

const NOON = new Date("2026-09-03T08:00:00Z");

describe("stop outbox", () => {
  it("writes a stop as the crew id and the client time, and nothing else", async () => {
    const factory = new IDBFactory();
    await enqueueStop("crew-b", NOON, factory);

    const rows = await pendingStops(factory);
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual(["clientTime", "crewId", "key"]);
    expect(rows[0]).toMatchObject({ crewId: "crew-b", clientTime: "2026-09-03T08:00:00.000Z" });
  });

  it("uses the database name the ruling fixes, sb-stop-outbox-v1", async () => {
    const factory = new IDBFactory();
    await enqueueStop("crew-b", NOON, factory);

    const names = (await factory.databases()).map((database) => database.name);
    expect(names).toEqual([STOP_OUTBOX_DB]);
    expect(STOP_OUTBOX_DB).toBe("sb-stop-outbox-v1");
  });

  it("test_stop_outbox_survives_reload: a new connection reads what an earlier one wrote, oldest first", async () => {
    const factory = new IDBFactory();
    await enqueueStop("crew-b", new Date("2026-09-03T08:00:00Z"), factory);
    await enqueueStop("crew-a", new Date("2026-09-03T08:01:00Z"), factory);

    // Each call opens and closes its own connection: this is what a reloaded page does.
    expect((await pendingStops(factory)).map((row) => row.crewId)).toEqual(["crew-b", "crew-a"]);
  });

  it("an empty outbox has nothing to drain and never calls the sender", async () => {
    const send = vi.fn(() => Promise.resolve("done" as const));
    expect(await drainStopOutbox(send, new IDBFactory())).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });

  it("drain removes a row only when the sender says done: a row that must stay is still there next time", async () => {
    const factory = new IDBFactory();
    await enqueueStop("crew-b", NOON, factory);
    await enqueueStop("crew-a", NOON, factory);

    const done = await drainStopOutbox((row) => Promise.resolve(row.crewId === "crew-b" ? "done" : "keep"), factory);

    expect(done.map((row) => row.crewId)).toEqual(["crew-b"]);
    expect((await pendingStops(factory)).map((row) => row.crewId)).toEqual(["crew-a"]);
  });

  it("never reports a stop as sent by itself: a sender that fails leaves every row", async () => {
    const factory = new IDBFactory();
    await enqueueStop("crew-b", NOON, factory);

    await expect(drainStopOutbox(() => Promise.reject(new Error("offline")), factory)).rejects.toThrow("offline");
    expect(await pendingStops(factory)).toHaveLength(1);
  });

  it("one drain runs at a time: a second call joins the first and each row is sent once", async () => {
    const factory = new IDBFactory();
    await enqueueStop("crew-b", NOON, factory);
    const send = vi.fn(() => Promise.resolve("done" as const));

    const [first, second] = await Promise.all([drainStopOutbox(send, factory), drainStopOutbox(send, factory)]);

    expect(send).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
    expect(await pendingStops(factory)).toEqual([]);
  });

  it("with no IndexedDB there is no outbox: a stop cannot be kept, and says so", async () => {
    expect(outboxAvailable(undefined)).toBe(false);
    await expect(enqueueStop("crew-b", NOON, undefined)).rejects.toThrow(/cannot be kept/);
    expect(await pendingStops(undefined)).toEqual([]);
  });
});
