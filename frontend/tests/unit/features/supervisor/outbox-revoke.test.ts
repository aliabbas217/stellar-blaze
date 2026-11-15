import { IDBFactory } from "fake-indexeddb";
import { createProfileStore } from "@/features/profile/store";
import { enqueueStop, pendingStops, STOP_OUTBOX_DB } from "@/features/supervisor/stop-outbox";

/*
 * The supervisor's Stop outbox is not the worker's data (F2 global constraints: "the supervisor Stop outbox belongs to the
 * supervisor role and is not touched by a worker revoke"). F1's `revoke()` takes back the worker's profile, push registration,
 * site pin and the caches and expiration rows the service worker made. This runs the REAL revoke, with the browser's own
 * effects (not fakes), on a phone that also holds a queued stop, against a real IndexedDB implementation: the queued stop is
 * still there afterwards and no database was deleted.
 */

describe("a worker's revoke never touches the stop outbox", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("test_worker_revoke_leaves_the_stop_outbox: the queued stop survives a real revoke(), and no database is deleted", async () => {
    const factory = new IDBFactory();
    const deleted: string[] = [];
    const opened: string[] = [];
    const originalDelete = factory.deleteDatabase.bind(factory);
    factory.deleteDatabase = (name: string) => {
      deleted.push(name);
      return originalDelete(name);
    };
    const originalOpen = factory.open.bind(factory);
    factory.open = (name: string, version?: number) => {
      opened.push(name);
      return originalOpen(name, version);
    };
    vi.stubGlobal("indexedDB", factory);
    await enqueueStop("crew-b", new Date("2026-09-03T08:00:00Z"), factory);

    // The default store: F1's real effects (caches, Serwist's expiration rows, the push registration), nothing replaced.
    const store = createProfileStore();
    store.getState().chooseSite({ siteId: "site-demo-mussafah", crewId: "crew-b" });
    const outcome = await store.getState().revoke();

    expect(outcome.failed).toEqual([]);
    expect(store.getState().site).toBeNull();
    // Non-vacuous: revoke did go to IndexedDB (Serwist's expiration rows) and left the outbox alone.
    expect(opened).toContain("serwist-expiration");
    expect(opened.filter((name) => name === STOP_OUTBOX_DB)).toHaveLength(1); // only the enqueue above
    expect(deleted).toEqual([]);
    expect((await factory.databases()).map((database) => database.name)).toContain(STOP_OUTBOX_DB);
    expect(await pendingStops(factory)).toMatchObject([{ crewId: "crew-b" }]);
  });
});
