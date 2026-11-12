import {
  createProfileStore,
  isRevokeComplete,
  PROFILE_STORAGE_KEY,
  REVOKE_STEP_TIMEOUT_MS,
  type ProfileEffects,
  type PushRegistration,
} from "@/features/profile/store";
import { CONSENT_VERSION, type Profile } from "@/features/profile/profile-shape";
import {
  clearRevokeIncomplete,
  endRevokeActivity,
  INCOMPLETE_KEY,
  markRevokeIncomplete,
  readRevokeActive,
  readRevokeIncomplete,
  subscribeRevokeActive,
  subscribeRevokeIncomplete,
} from "@/features/profile/revoke-marker";
import {
  forgetPendingDelete,
  hasUnpersistedPendingDeletes,
  PENDING_DELETE_KEY,
  readPendingDeletes,
  rememberPendingDelete,
} from "@/features/push/pending-delete";

/*
 * The on-device store (ADR 0004): the push registration (Task 7) and the worker's profile (Task 8), persisted under
 * sb-profile-v1. A "reload" here is a fresh import of the module, because the store reads localStorage when it is
 * created. Revoking and changing site reach the browser (push, Cache Storage, IndexedDB), so those paths run on a store
 * built with fake effects.
 */

const registration: PushRegistration = { serverId: "sub-1", endpoint: "https://push.example/send/abc", siteId: "site-demo-mussafah" };

const profile: Profile = {
  consentVersion: CONSENT_VERSION,
  consentedAt: "2026-11-11T08:30:00.000Z",
  siteId: "site-demo-mussafah",
  crewId: "crew-a",
  workloadClass: "heavy",
  heatWorkStartDate: "2026-10-01",
  clothingCode: "work_clothes",
};

async function freshStore() {
  vi.resetModules();
  return (await import("@/features/profile/store")).useProfile;
}

/** Lets go of every owed registration id and of the marker, including any kept only in memory by a test that refused storage. */
function forgetEverythingOwed(): void {
  vi.restoreAllMocks();
  for (const id of readPendingDeletes()) forgetPendingDelete(id);
  clearRevokeIncomplete();
  while (readRevokeActive()) endRevokeActivity();
}

beforeEach(() => {
  forgetEverythingOwed();
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  forgetEverythingOwed();
});

describe("useProfile (push slice)", () => {
  it("starts with no profile and no push registration", async () => {
    const store = await freshStore();
    expect(store.getState().profile).toBeNull();
    expect(store.getState().push).toBeNull();
  });

  it("persists a push registration under sb-profile-v1 and restores it after a reload", async () => {
    const first = await freshStore();
    first.getState().setPush(registration);

    expect(JSON.parse(localStorage.getItem(PROFILE_STORAGE_KEY) ?? "null")).toMatchObject({ state: { push: registration } });

    const reloaded = await freshStore();
    expect(reloaded.getState().push).toEqual(registration);
    expect(reloaded.getState().profile).toBeNull();
  });

  it("persists the two slices and no action", async () => {
    const store = await freshStore();
    store.getState().setPush(registration);
    const stored = JSON.parse(localStorage.getItem(PROFILE_STORAGE_KEY) ?? "{}") as { state: object };
    expect(Object.keys(stored.state).sort()).toEqual(["profile", "push"]);
  });

  it("clears the registration when set to null, and a reload stays cleared", async () => {
    const first = await freshStore();
    first.getState().setPush(registration);
    first.getState().setPush(null);

    expect((await freshStore()).getState().push).toBeNull();
  });

  it("treats corrupt JSON in storage as no registration, without throwing", async () => {
    localStorage.setItem(PROFILE_STORAGE_KEY, "{not json");
    const store = await freshStore();
    expect(store.getState().push).toBeNull();
    expect(store.getState().profile).toBeNull();
  });

  it.each([
    ["a push of the wrong shape", { state: { push: { serverId: 7, endpoint: "e", siteId: "s" } }, version: 1 }],
    ["a push missing a field", { state: { push: { serverId: "x", endpoint: "e" } }, version: 1 }],
    ["a push that is not an object", { state: { push: "yes" }, version: 1 }],
    ["no state", { version: 1 }],
  ])("drops %s", async (_name, stored) => {
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(stored));
    expect((await freshStore()).getState().push).toBeNull();
  });

  it("keeps working in memory when localStorage is blocked", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });

    const store = await freshStore();
    expect(() => {
      store.getState().setPush(registration);
    }).not.toThrow();
    expect(store.getState().push).toEqual(registration);
  });
});

describe("useProfile (the worker's profile)", () => {
  it("save keeps the profile and a reload restores it", async () => {
    const first = await freshStore();
    first.getState().save(profile);
    expect(first.getState().profile).toEqual(profile);

    expect(JSON.parse(localStorage.getItem(PROFILE_STORAGE_KEY) ?? "null")).toMatchObject({ state: { profile }, version: 1 });

    const reloaded = await freshStore();
    expect(reloaded.getState().profile).toEqual(profile);
  });

  it("restores the profile and the push registration side by side", async () => {
    const first = await freshStore();
    first.getState().save(profile);
    first.getState().setPush(registration);

    const reloaded = (await freshStore()).getState();
    expect(reloaded.profile).toEqual(profile);
    expect(reloaded.push).toEqual(registration);
  });

  it("a second save replaces the first", async () => {
    const first = await freshStore();
    first.getState().save(profile);
    first.getState().save({ ...profile, workloadClass: "light", crewId: null });

    expect((await freshStore()).getState().profile).toEqual({ ...profile, workloadClass: "light", crewId: null });
  });

  it("reads a state saved by Task 7, before the profile existed (no profile key)", async () => {
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify({ state: { push: registration }, version: 1 }));
    const state = (await freshStore()).getState();
    expect(state.profile).toBeNull();
    expect(state.push).toEqual(registration);
  });

  it("reads a profile saved with no push key", async () => {
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify({ state: { profile }, version: 1 }));
    const state = (await freshStore()).getState();
    expect(state.profile).toEqual(profile);
    expect(state.push).toBeNull();
  });

  it("treats corrupt JSON in storage as no profile, without throwing", async () => {
    localStorage.setItem(PROFILE_STORAGE_KEY, "{not json");
    const store = await freshStore();
    expect(store.getState().profile).toBeNull();
  });

  it("treats a truncated write as no profile", async () => {
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify({ state: { profile }, version: 1 }).slice(0, 60));
    expect((await freshStore()).getState().profile).toBeNull();
  });

  it.each([
    ["an unknown workload class", { ...profile, workloadClass: "extreme" }],
    ["an empty site", { ...profile, siteId: "" }],
    ["a consent from another version of the text", { ...profile, consentVersion: "2026-01-01" }],
    ["an impossible start date", { ...profile, heatWorkStartDate: "2026-02-30" }],
    ["a missing field", Object.fromEntries(Object.entries(profile).filter(([key]) => key !== "clothingCode"))],
    ["a string", "heavy"],
    ["null", null],
    ["an array", [profile]],
  ])("drops a stored profile with %s, and keeps the push slice", async (_name, stored) => {
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify({ state: { profile: stored, push: registration }, version: 1 }));
    const state = (await freshStore()).getState();
    expect(state.profile).toBeNull();
    expect(state.push).toEqual(registration);
  });

  it("keeps a profile in memory and does not throw when localStorage refuses the write", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    const store = await freshStore();
    expect(() => {
      store.getState().save(profile);
    }).not.toThrow();
    expect(store.getState().profile).toEqual(profile);
  });

  it("stores no field beyond the profile's seven (nothing about a person's name or id)", async () => {
    const store = await freshStore();
    store.getState().save(profile);
    const stored = JSON.parse(localStorage.getItem(PROFILE_STORAGE_KEY) ?? "{}") as { state: { profile: object } };
    expect(Object.keys(stored.state.profile).sort()).toEqual(
      ["clothingCode", "consentVersion", "consentedAt", "crewId", "heatWorkStartDate", "siteId", "workloadClass"].sort(),
    );
  });
});

/** Fake browser effects, each a spy that can be made to fail or hang. */
function fakeEffects(overrides: Partial<ProfileEffects> = {}) {
  return {
    unsubscribe: vi.fn<ProfileEffects["unsubscribe"]>(() => Promise.resolve()),
    deleteRegistration: vi.fn<ProfileEffects["deleteRegistration"]>(() => Promise.resolve(true)),
    clearCaches: vi.fn(() => Promise.resolve()),
    clearCacheMetadata: vi.fn(() => Promise.resolve("cleared")),
    deviceDataRemains: vi.fn<ProfileEffects["deviceDataRemains"]>(() => Promise.resolve(false)),
    ...overrides,
  };
}

const COMPLETE = { failed: [], pending: false };

describe("revoke", () => {
  it("empties the storage key, clears both slices and calls unsubscribe once", async () => {
    const effects = fakeEffects();
    const store = createProfileStore({ effects });
    store.getState().save(profile);
    store.getState().setPush(registration);
    expect(localStorage.getItem(PROFILE_STORAGE_KEY)).not.toBeNull();

    const outcome = await store.getState().revoke();

    expect(localStorage.getItem(PROFILE_STORAGE_KEY)).toBeNull();
    expect(store.getState().profile).toBeNull();
    expect(store.getState().push).toBeNull();
    expect(effects.unsubscribe).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual(COMPLETE);
    expect(isRevokeComplete(outcome)).toBe(true);
  });

  it("asks the API to delete the registration that was stored before the state was cleared", async () => {
    const effects = fakeEffects();
    const store = createProfileStore({ effects });
    store.getState().setPush(registration);

    await store.getState().revoke();

    expect(effects.deleteRegistration).toHaveBeenCalledExactlyOnceWith("sub-1");
  });

  it("still turns the browser's subscription off when no registration id is stored, and asks the API nothing", async () => {
    const effects = fakeEffects();
    const store = createProfileStore({ effects });
    store.getState().save(profile);

    await store.getState().revoke();

    expect(effects.unsubscribe).toHaveBeenCalledTimes(1);
    expect(effects.deleteRegistration).not.toHaveBeenCalled();
  });

  it("a reload after revoking finds nothing", async () => {
    const store = createProfileStore({ effects: fakeEffects() });
    store.getState().save(profile);
    store.getState().setPush(registration);
    await store.getState().revoke();

    const reloaded = createProfileStore({ effects: fakeEffects() }).getState();
    expect(reloaded.profile).toBeNull();
    expect(reloaded.push).toBeNull();
  });

  it("clears the device's caches (API and page caches) and Serwist's expiration record", async () => {
    const effects = fakeEffects();
    const store = createProfileStore({ effects });
    store.getState().save(profile);

    await store.getState().revoke();

    expect(effects.clearCaches).toHaveBeenCalledTimes(1);
    expect(effects.clearCacheMetadata).toHaveBeenCalledTimes(1);
  });

  it("has already cleared the local data when the first effect starts: nothing waits on the network", async () => {
    const seen: { profile: Profile | null; push: PushRegistration | null; stored: string | null; pending: string | null }[] = [];
    const holder: { store?: ReturnType<typeof createProfileStore> } = {};
    const effects = fakeEffects({
      unsubscribe: vi.fn(() => {
        const state = holder.store?.getState();
        seen.push({
          profile: state?.profile ?? null,
          push: state?.push ?? null,
          stored: localStorage.getItem(PROFILE_STORAGE_KEY),
          pending: localStorage.getItem(PENDING_DELETE_KEY),
        });
        return Promise.resolve();
      }),
    });
    holder.store = createProfileStore({ effects });
    holder.store.getState().save(profile);
    holder.store.getState().setPush(registration);

    await holder.store.getState().revoke();

    // The profile and push state are gone, and the registration's id is already written where a retry will find it.
    expect(seen).toEqual([{ profile: null, push: null, stored: null, pending: JSON.stringify(["sub-1"]) }]);
  });

  it("clears local data even when unsubscribe fails, and reports that alerts may still be on", async () => {
    const effects = fakeEffects({ unsubscribe: vi.fn(() => Promise.reject(new Error("offline"))) });
    const store = createProfileStore({ effects });
    store.getState().save(profile);
    store.getState().setPush(registration);

    const outcome = await store.getState().revoke();

    expect(store.getState().profile).toBeNull();
    expect(localStorage.getItem(PROFILE_STORAGE_KEY)).toBeNull();
    expect(outcome).toEqual({ failed: ["alerts"], pending: false });
    expect(isRevokeComplete(outcome)).toBe(false);
    expect(effects.clearCaches).toHaveBeenCalledTimes(1);
    // The API's registration is deleted all the same: a failed browser step does not skip it.
    expect(effects.deleteRegistration).toHaveBeenCalledExactlyOnceWith("sub-1");
  });

  it("clears local data and still unsubscribes when the cache clearing fails", async () => {
    const effects = fakeEffects({ clearCaches: vi.fn(() => Promise.reject(new Error("quota"))) });
    const store = createProfileStore({ effects });
    store.getState().save(profile);

    const outcome = await store.getState().revoke();

    expect(store.getState().profile).toBeNull();
    expect(outcome).toEqual({ failed: ["cache"], pending: false });
    expect(isRevokeComplete(outcome)).toBe(false);
    expect(effects.unsubscribe).toHaveBeenCalledTimes(1);
    // The whole clearing is tried twice before it is reported as failed.
    expect(effects.clearCaches).toHaveBeenCalledTimes(2);
    expect(effects.clearCacheMetadata).toHaveBeenCalledTimes(2);
  });

  it("reports a failed clearing of the expiration metadata as a cache failure, and never as done", async () => {
    const effects = fakeEffects({ clearCacheMetadata: vi.fn(() => Promise.reject(new Error("aborted"))) });
    const store = createProfileStore({ effects });
    store.getState().save(profile);

    const outcome = await store.getState().revoke();

    expect(outcome).toEqual({ failed: ["cache"], pending: false });
    expect(isRevokeComplete(outcome)).toBe(false);
    expect(effects.clearCaches).toHaveBeenCalledTimes(2);
  });

  it("survives an effect that throws instead of rejecting", async () => {
    const effects = fakeEffects({
      unsubscribe: vi.fn(() => {
        throw new TypeError("no service worker");
      }),
    });
    const store = createProfileStore({ effects });
    store.getState().save(profile);

    expect(await store.getState().revoke()).toEqual({ failed: ["alerts"], pending: false });
    expect(store.getState().profile).toBeNull();
  });

  it("does not wait forever for an effect that never settles", async () => {
    vi.useFakeTimers();
    const effects = fakeEffects({ unsubscribe: vi.fn(() => new Promise<void>(() => undefined)) });
    const store = createProfileStore({ effects });
    store.getState().save(profile);

    const pending = store.getState().revoke();
    await vi.advanceTimersByTimeAsync(REVOKE_STEP_TIMEOUT_MS);

    expect(await pending).toEqual({ failed: ["alerts"], pending: false });
    expect(store.getState().profile).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports when the stored data could not be removed (a blocked localStorage.removeItem)", async () => {
    const store = createProfileStore({ effects: fakeEffects() });
    store.getState().save(profile);
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });

    const outcome = await store.getState().revoke();

    expect(outcome.failed).toContain("storage");
    expect(isRevokeComplete(outcome)).toBe(false);
    expect(store.getState().profile).toBeNull();
  });

  it("joins a revoke that is already running instead of starting another", async () => {
    let finish: () => void = () => undefined;
    const effects = fakeEffects({
      unsubscribe: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      ),
    });
    const store = createProfileStore({ effects });
    store.getState().setPush(registration);

    const first = store.getState().revoke();
    const second = store.getState().revoke();
    finish();

    expect(await first).toEqual(await second);
    expect(effects.unsubscribe).toHaveBeenCalledTimes(1);
    expect(effects.clearCaches).toHaveBeenCalledTimes(1);
  });

  it("can run again after it finished (a retry after a failure)", async () => {
    const effects = fakeEffects({ unsubscribe: vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined) });
    const store = createProfileStore({ effects });
    store.getState().save(profile);

    expect(await store.getState().revoke()).toEqual({ failed: ["alerts"], pending: false });
    expect(await store.getState().revoke()).toEqual(COMPLETE);
    expect(effects.unsubscribe).toHaveBeenCalledTimes(2);
  });

  it("works on an empty store: nothing stored, nothing to fail", async () => {
    const effects = fakeEffects();
    const store = createProfileStore({ effects });

    expect(await store.getState().revoke()).toEqual(COMPLETE);
    expect(localStorage.getItem(PROFILE_STORAGE_KEY)).toBeNull();
  });
});

describe("revoke: a registration the API has not confirmed deleting (ruling R32)", () => {
  it("is not done while the DELETE fails: the id, and only the id, is kept under its own key", async () => {
    const effects = fakeEffects({ deleteRegistration: vi.fn(() => Promise.resolve(false)) });
    const store = createProfileStore({ effects });
    store.getState().save(profile);
    store.getState().setPush(registration);

    const outcome = await store.getState().revoke();

    expect(outcome).toEqual({ failed: [], pending: true });
    expect(isRevokeComplete(outcome)).toBe(false);
    expect(localStorage.getItem(PENDING_DELETE_KEY)).toBe(JSON.stringify(["sub-1"]));
    // Nothing else about the worker or the subscription survives: not the endpoint, the site or the profile.
    expect(localStorage.getItem(PROFILE_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(PENDING_DELETE_KEY)).not.toContain("push.example");
    expect(localStorage.getItem(PENDING_DELETE_KEY)).not.toContain("site-demo");
  });

  it("a retry finds the id, and is not done until the DELETE succeeds", async () => {
    const deleteRegistration = vi.fn<ProfileEffects["deleteRegistration"]>(() => Promise.resolve(false));
    const store = createProfileStore({ effects: fakeEffects({ deleteRegistration }) });
    store.getState().setPush(registration);

    expect(await store.getState().revoke()).toEqual({ failed: [], pending: true });

    // The second revoke has no stored registration at all: the id comes from the pending key.
    expect(store.getState().push).toBeNull();
    expect(await store.getState().revoke()).toEqual({ failed: [], pending: true });
    expect(deleteRegistration).toHaveBeenCalledTimes(2);
    expect(deleteRegistration).toHaveBeenNthCalledWith(2, "sub-1");

    deleteRegistration.mockResolvedValue(true);
    const outcome = await store.getState().revoke();

    expect(outcome).toEqual(COMPLETE);
    expect(isRevokeComplete(outcome)).toBe(true);
    expect(localStorage.getItem(PENDING_DELETE_KEY)).toBeNull();
  });

  it("retries ids left by an earlier session, whatever the store holds now", async () => {
    localStorage.setItem(PENDING_DELETE_KEY, JSON.stringify(["sub-old-1", "sub-old-2"]));
    const effects = fakeEffects();
    const store = createProfileStore({ effects });

    const outcome = await store.getState().revoke();

    expect(vi.mocked(effects.deleteRegistration).mock.calls.map(([id]) => id)).toEqual(["sub-old-1", "sub-old-2"]);
    expect(outcome).toEqual(COMPLETE);
    expect(localStorage.getItem(PENDING_DELETE_KEY)).toBeNull();
  });

  it("keeps only the ids the API did not confirm", async () => {
    localStorage.setItem(PENDING_DELETE_KEY, JSON.stringify(["sub-a", "sub-b"]));
    const effects = fakeEffects({ deleteRegistration: vi.fn((id: string) => Promise.resolve(id !== "sub-b")) });
    const store = createProfileStore({ effects });
    store.getState().setPush(registration);

    expect(await store.getState().revoke()).toEqual({ failed: [], pending: true });
    expect(localStorage.getItem(PENDING_DELETE_KEY)).toBe(JSON.stringify(["sub-b"]));
  });

  it("reports both failures when the browser step failed and the DELETE is unconfirmed", async () => {
    const effects = fakeEffects({
      unsubscribe: vi.fn(() => Promise.reject(new Error("no worker"))),
      deleteRegistration: vi.fn(() => Promise.resolve(false)),
    });
    const store = createProfileStore({ effects });
    store.getState().setPush(registration);

    expect(await store.getState().revoke()).toEqual({ failed: ["alerts"], pending: true });
  });

  it("is pending, not done, when the DELETE never answers: the id stays for the next time", async () => {
    vi.useFakeTimers();
    const effects = fakeEffects({ deleteRegistration: vi.fn(() => new Promise<boolean>(() => undefined)) });
    const store = createProfileStore({ effects });
    store.getState().setPush(registration);

    const running = store.getState().revoke();
    await vi.advanceTimersByTimeAsync(REVOKE_STEP_TIMEOUT_MS);

    const outcome = await running;
    expect(outcome.pending).toBe(true);
    expect(outcome.failed).toContain("alerts");
    expect(localStorage.getItem(PENDING_DELETE_KEY)).toBe(JSON.stringify(["sub-1"]));
  });

  it("writes the id before the profile is cleared, so a page that dies mid-revoke still owes the DELETE", () => {
    const store = createProfileStore({ effects: fakeEffects({ unsubscribe: vi.fn(() => new Promise<void>(() => undefined)) }) });
    store.getState().setPush(registration);
    store.getState().save(profile);

    void store.getState().revoke();

    expect(localStorage.getItem(PENDING_DELETE_KEY)).toBe(JSON.stringify(["sub-1"]));
    expect(localStorage.getItem(PROFILE_STORAGE_KEY)).toBeNull();
  });
});

describe("revoke epoch and other tabs (ruling R34)", () => {
  it("counts every revoke, and is never persisted", async () => {
    const store = createProfileStore({ effects: fakeEffects() });
    expect(store.getState().revokeEpoch).toBe(0);
    store.getState().save(profile);

    await store.getState().revoke();
    expect(store.getState().revokeEpoch).toBe(1);
    await store.getState().revoke();
    expect(store.getState().revokeEpoch).toBe(2);

    store.getState().save(profile);
    expect(Object.keys((JSON.parse(localStorage.getItem(PROFILE_STORAGE_KEY) ?? "{}") as { state: object }).state).sort()).toEqual(["profile", "push"]);
  });

  /** What the browser does in the other tab when it changes localStorage. */
  function storageEvent(key: string | null = PROFILE_STORAGE_KEY) {
    window.dispatchEvent(new StorageEvent("storage", { key, storageArea: localStorage }));
  }

  it("a revoke in another tab empties this tab's memory, so this tab cannot write the data back", async () => {
    const thisTab = createProfileStore({ effects: fakeEffects() });
    thisTab.getState().save(profile);
    thisTab.getState().setPush(registration);
    // The same phone, another tab: a second store over the same localStorage.
    const otherTab = createProfileStore({ effects: fakeEffects() });
    expect(otherTab.getState().profile).toEqual(profile);

    await otherTab.getState().revoke();
    storageEvent();

    expect(thisTab.getState().profile).toBeNull();
    expect(thisTab.getState().push).toBeNull();
    // Without the listener this write would bring the revoked profile back from this tab's stale memory.
    thisTab.getState().setPush({ serverId: "sub-2", endpoint: "https://push.example/send/new", siteId: "site-demo-mussafah" });
    const stored = JSON.parse(localStorage.getItem(PROFILE_STORAGE_KEY) ?? "{}") as { state: { profile: unknown } };
    expect(stored.state.profile).toBeNull();
    expect(thisTab.getState().profile).toBeNull();
  });

  it("counts that as a revoke here too, so an in-flight subscribe in this tab can tell", async () => {
    const thisTab = createProfileStore({ effects: fakeEffects() });
    thisTab.getState().save(profile);
    const otherTab = createProfileStore({ effects: fakeEffects() });
    const before = thisTab.getState().revokeEpoch;

    await otherTab.getState().revoke();
    storageEvent();

    await vi.waitFor(() => {
      expect(thisTab.getState().revokeEpoch).toBe(before + 1);
    });
  });

  it("takes a profile saved in another tab, and a cleared localStorage (key null)", () => {
    const thisTab = createProfileStore({ effects: fakeEffects() });
    createProfileStore({ effects: fakeEffects() }).getState().save(profile);
    storageEvent();
    expect(thisTab.getState().profile).toEqual(profile);

    localStorage.clear();
    storageEvent(null);
    expect(thisTab.getState().profile).toBeNull();
  });

  it("ignores a change to any other key", () => {
    const thisTab = createProfileStore({ effects: fakeEffects() });
    thisTab.getState().save(profile);
    localStorage.removeItem(PROFILE_STORAGE_KEY);

    storageEvent("something-else");

    expect(thisTab.getState().profile).toEqual(profile);
  });

  it("does not write back what it read, so two tabs cannot send each other's changes round and round", () => {
    const thisTab = createProfileStore({ effects: fakeEffects() });
    const writer = vi.spyOn(Storage.prototype, "setItem");
    createProfileStore({ effects: fakeEffects() }).getState().save(profile);
    writer.mockClear();

    storageEvent();

    expect(thisTab.getState().profile).toEqual(profile);
    expect(writer).not.toHaveBeenCalled();
  });

  it("does not move the epoch when nothing was removed", async () => {
    const thisTab = createProfileStore({ effects: fakeEffects() });
    createProfileStore({ effects: fakeEffects() }).getState().save(profile);
    storageEvent();
    await Promise.resolve();
    expect(thisTab.getState().revokeEpoch).toBe(0);
  });
});

describe("save: a change of site", () => {
  it("clears the device's caches and the expiration record when the saved site differs from the stored one", async () => {
    const effects = fakeEffects();
    const store = createProfileStore({ effects });
    store.getState().save(profile);
    expect(effects.clearCaches).not.toHaveBeenCalled();

    store.getState().save({ ...profile, siteId: "site-demo-jebel-ali" });
    await vi.waitFor(() => {
      expect(effects.clearCaches).toHaveBeenCalledTimes(1);
    });

    expect(effects.clearCacheMetadata).toHaveBeenCalledTimes(1);
    expect(store.getState().profile?.siteId).toBe("site-demo-jebel-ali");
  });

  it("does not clear anything on the first save: there is no earlier site, and the policy the form just used must stay cached", () => {
    const effects = fakeEffects();
    const store = createProfileStore({ effects });
    store.getState().save(profile);
    expect(effects.clearCaches).not.toHaveBeenCalled();
    expect(effects.clearCacheMetadata).not.toHaveBeenCalled();
  });

  it("does not clear anything when only the crew, the work or the clothing changes", () => {
    const effects = fakeEffects();
    const store = createProfileStore({ effects });
    store.getState().save(profile);
    store.getState().save({ ...profile, crewId: null, workloadClass: "light", clothingCode: "other" });
    expect(effects.clearCaches).not.toHaveBeenCalled();
  });

  it("compares with the profile restored from storage after a reload", () => {
    createProfileStore({ effects: fakeEffects() }).getState().save(profile);

    const effects = fakeEffects();
    const reloaded = createProfileStore({ effects });
    reloaded.getState().save({ ...profile, siteId: "site-demo-jebel-ali" });

    expect(effects.clearCaches).toHaveBeenCalledTimes(1);
  });

  it("still saves, and does not throw or leave an unhandled rejection, when the clearing fails", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const effects = fakeEffects({ clearCaches: vi.fn(() => Promise.reject(new Error("quota"))) });
    const store = createProfileStore({ effects });
    store.getState().save(profile);

    expect(() => {
      store.getState().save({ ...profile, siteId: "site-demo-jebel-ali" });
    }).not.toThrow();
    await vi.waitFor(() => {
      expect(logged).toHaveBeenCalledTimes(1);
    });

    expect(store.getState().profile?.siteId).toBe("site-demo-jebel-ali");
  });
});

describe("revoke: the owed registration id could not be written down (ruling R36, N1)", () => {
  afterEach(forgetEverythingOwed);

  /** A registration is stored, and then the phone refuses every write: what revoke starts from. */
  function storeThatCannotWrite(effects: ReturnType<typeof fakeEffects>, how: "throws" | "drops") {
    const store = createProfileStore({ effects });
    store.getState().setPush(registration);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      if (how === "throws") throw new DOMException("full", "QuotaExceededError");
    });
    return store;
  }

  it.each(["throws", "drops"] as const)("asks the API to delete it straight away (storage %s the write), and is complete when the API confirms", async (how) => {
    const effects = fakeEffects();
    const store = storeThatCannotWrite(effects, how);

    const outcome = await store.getState().revoke();

    expect(effects.deleteRegistration).toHaveBeenCalledExactlyOnceWith("sub-1");
    expect(outcome).toEqual(COMPLETE);
    expect(hasUnpersistedPendingDeletes()).toBe(false);
  });

  it.each(["throws", "drops"] as const)(
    "is never an all-clear while the API has not confirmed it and it exists nowhere but in memory (storage %s the write)",
    async (how) => {
      const effects = fakeEffects({ deleteRegistration: vi.fn(() => Promise.resolve(false)) });
      const store = storeThatCannotWrite(effects, how);

      const outcome = await store.getState().revoke();

      expect(outcome).toEqual({ failed: ["storage"], pending: true });
      expect(isRevokeComplete(outcome)).toBe(false);
      // Still owed, and a second revoke in this page asks again.
      vi.mocked(effects.deleteRegistration).mockResolvedValue(true);
      expect(await store.getState().revoke()).toEqual(COMPLETE);
      expect(effects.deleteRegistration).toHaveBeenCalledTimes(2);
    },
  );
});

describe("revoke: the clearing is checked afterwards (ruling R36, N2)", () => {
  it("clears again when a response written meanwhile brought a cache back, and is complete once a second look finds nothing", async () => {
    const effects = fakeEffects({ deviceDataRemains: vi.fn().mockResolvedValueOnce(true).mockResolvedValue(false) });
    const store = createProfileStore({ effects });
    store.getState().save(profile);

    const outcome = await store.getState().revoke();

    expect(effects.clearCaches).toHaveBeenCalledTimes(2);
    expect(effects.clearCacheMetadata).toHaveBeenCalledTimes(2);
    expect(effects.deviceDataRemains).toHaveBeenCalledTimes(2);
    expect(outcome).toEqual(COMPLETE);
  });

  it("reports the cache as not cleared when it is still there after the second clearing", async () => {
    const effects = fakeEffects({ deviceDataRemains: vi.fn(() => Promise.resolve(true)) });
    const store = createProfileStore({ effects });
    store.getState().save(profile);

    const outcome = await store.getState().revoke();

    expect(effects.clearCaches).toHaveBeenCalledTimes(2);
    expect(outcome).toEqual({ failed: ["cache"], pending: false });
    expect(isRevokeComplete(outcome)).toBe(false);
  });

  it("does not call the clearing done when it cannot check: not knowing is not an all-clear", async () => {
    const effects = fakeEffects({ deviceDataRemains: vi.fn(() => Promise.reject(new Error("storage unavailable"))) });
    const store = createProfileStore({ effects });
    store.getState().save(profile);

    expect(await store.getState().revoke()).toEqual({ failed: ["cache"], pending: false });
  });

  it("looks only after both the caches and the expiration record have been dealt with", async () => {
    const order: string[] = [];
    const effects = fakeEffects({
      clearCaches: vi.fn(async () => {
        await Promise.resolve();
        order.push("caches");
      }),
      clearCacheMetadata: vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        order.push("metadata");
        return "cleared";
      }),
      deviceDataRemains: vi.fn(() => {
        order.push("check");
        return Promise.resolve(false);
      }),
    });
    const store = createProfileStore({ effects });
    store.getState().save(profile);

    await store.getState().revoke();

    expect(order).toEqual(["caches", "metadata", "check"]);
  });

  it("tries the whole clearing once more when it failed the first time, and is complete if that works", async () => {
    const effects = fakeEffects({ clearCaches: vi.fn().mockRejectedValueOnce(new Error("quota")).mockResolvedValue(undefined) });
    const store = createProfileStore({ effects });
    store.getState().save(profile);

    expect(await store.getState().revoke()).toEqual(COMPLETE);
    expect(effects.clearCaches).toHaveBeenCalledTimes(2);
  });

  it("checks a clearing after a change of site too", async () => {
    const effects = fakeEffects();
    const store = createProfileStore({ effects });
    store.getState().save(profile);
    store.getState().save({ ...profile, siteId: "site-demo-jebel-ali" });

    await vi.waitFor(() => {
      expect(effects.deviceDataRemains).toHaveBeenCalledTimes(1);
    });
  });
});

describe("the durable 'data may remain' marker (ruling R36, N3)", () => {
  afterEach(forgetEverythingOwed);

  it("is written before the first step starts, naming every step as not yet finished", async () => {
    const seen: (string | null)[] = [];
    const effects = fakeEffects({
      unsubscribe: vi.fn(() => {
        seen.push(localStorage.getItem(INCOMPLETE_KEY));
        return Promise.resolve();
      }),
    });
    const store = createProfileStore({ effects });
    store.getState().save(profile);

    await store.getState().revoke();

    const marker = JSON.parse(seen[0] ?? "null") as { steps: string[] };
    expect(marker.steps).toEqual(["storage", "alerts", "cache"]);
  });

  it("is removed when every step finished", async () => {
    const store = createProfileStore({ effects: fakeEffects() });
    store.getState().save(profile);

    await store.getState().revoke();

    expect(localStorage.getItem(INCOMPLETE_KEY)).toBeNull();
    expect(readRevokeIncomplete()).toBeNull();
  });

  it("is left, naming only the steps that failed, when one did not finish", async () => {
    const effects = fakeEffects({ clearCaches: vi.fn(() => Promise.reject(new Error("quota"))) });
    const store = createProfileStore({ effects });
    store.getState().save(profile);

    await store.getState().revoke();

    expect(readRevokeIncomplete()?.steps).toEqual(["cache"]);
  });

  it("is left, naming no step, when only the API's confirmation of a registration is outstanding", async () => {
    const effects = fakeEffects({ deleteRegistration: vi.fn(() => Promise.resolve(false)) });
    const store = createProfileStore({ effects });
    store.getState().setPush(registration);

    await store.getState().revoke();

    expect(readRevokeIncomplete()).not.toBeNull();
    expect(readRevokeIncomplete()?.steps).toEqual([]);
  });

  it("holds no personal data and no id: a version, a time and step names", async () => {
    const effects = fakeEffects({ unsubscribe: vi.fn(() => Promise.reject(new Error("offline"))) });
    const store = createProfileStore({ effects });
    store.getState().save(profile);
    store.getState().setPush(registration);

    await store.getState().revoke();

    const raw = localStorage.getItem(INCOMPLETE_KEY) ?? "";
    expect(Object.keys(JSON.parse(raw) as object).sort()).toEqual(["at", "steps", "v"]);
    for (const secret of ["sub-1", "site-demo", "crew-a", "heavy", "work_clothes", "push.example"]) expect(raw).not.toContain(secret);
  });

  describe("resume (Alerts opens, and the app reconciles its push state)", () => {
    it("does nothing, and touches nothing, when no revoke is unfinished and nothing is owed", async () => {
      const effects = fakeEffects();
      const store = createProfileStore({ effects });

      expect(await store.getState().resume()).toBeNull();

      for (const effect of Object.values(effects)) expect(effect).not.toHaveBeenCalled();
    });

    it("clears the caches and the expiration record again, checks them, and removes the marker", async () => {
      markRevokeIncomplete(["cache"]);
      const effects = fakeEffects();
      const store = createProfileStore({ effects });

      const outcome = await store.getState().resume();

      expect(effects.clearCaches).toHaveBeenCalledTimes(1);
      expect(effects.clearCacheMetadata).toHaveBeenCalledTimes(1);
      expect(effects.deviceDataRemains).toHaveBeenCalledTimes(1);
      expect(outcome).toEqual(COMPLETE);
      expect(readRevokeIncomplete()).toBeNull();
    });

    it("never touches the profile, the push state or the browser's subscription: the worker may have set up again since", async () => {
      markRevokeIncomplete(["cache", "alerts"]);
      const effects = fakeEffects();
      const store = createProfileStore({ effects });
      store.getState().save(profile);
      store.getState().setPush(registration);

      await store.getState().resume();

      expect(store.getState().profile).toEqual(profile);
      expect(store.getState().push).toEqual(registration);
      expect(effects.unsubscribe).not.toHaveBeenCalled();
      expect(localStorage.getItem(PROFILE_STORAGE_KEY)).not.toBeNull();
    });

    it("keeps the marker, naming what is left, when a step it cannot finish by itself was unfinished (the browser's subscription)", async () => {
      markRevokeIncomplete(["alerts", "cache"]);
      const store = createProfileStore({ effects: fakeEffects() });

      const outcome = await store.getState().resume();

      expect(outcome).toEqual({ failed: ["alerts"], pending: false });
      expect(readRevokeIncomplete()?.steps).toEqual(["alerts"]);
    });

    it("does not clear the caches again when the cache step had finished: a new session's cache is not its business", async () => {
      markRevokeIncomplete(["alerts"]);
      const effects = fakeEffects();
      const store = createProfileStore({ effects });

      await store.getState().resume();

      expect(effects.clearCaches).not.toHaveBeenCalled();
      expect(effects.clearCacheMetadata).not.toHaveBeenCalled();
    });

    it("keeps the cache step in the marker when the clearing fails again", async () => {
      markRevokeIncomplete(["cache"]);
      const effects = fakeEffects({ clearCaches: vi.fn(() => Promise.reject(new Error("quota"))) });
      const store = createProfileStore({ effects });

      expect(await store.getState().resume()).toEqual({ failed: ["cache"], pending: false });
      expect(readRevokeIncomplete()?.steps).toEqual(["cache"]);
    });

    it("keeps the cache step when the second look still finds data", async () => {
      markRevokeIncomplete(["cache"]);
      const effects = fakeEffects({ deviceDataRemains: vi.fn(() => Promise.resolve(true)) });
      const store = createProfileStore({ effects });

      expect(await store.getState().resume()).toEqual({ failed: ["cache"], pending: false });
    });

    it("retries the registrations owed to the API, and removes the marker once the API has confirmed them", async () => {
      markRevokeIncomplete([]);
      localStorage.setItem(PENDING_DELETE_KEY, JSON.stringify(["sub-owed"]));
      const effects = fakeEffects();
      const store = createProfileStore({ effects });

      const outcome = await store.getState().resume();

      expect(effects.deleteRegistration).toHaveBeenCalledExactlyOnceWith("sub-owed");
      expect(outcome).toEqual(COMPLETE);
      expect(readRevokeIncomplete()).toBeNull();
      expect(localStorage.getItem(PENDING_DELETE_KEY)).toBeNull();
    });

    it("keeps the marker while the API still does not confirm", async () => {
      markRevokeIncomplete([]);
      localStorage.setItem(PENDING_DELETE_KEY, JSON.stringify(["sub-owed"]));
      const effects = fakeEffects({ deleteRegistration: vi.fn(() => Promise.resolve(false)) });
      const store = createProfileStore({ effects });

      expect(await store.getState().resume()).toEqual({ failed: [], pending: true });
      expect(readRevokeIncomplete()).not.toBeNull();
    });

    it("retries an owed registration even when no revoke was unfinished, and leaves no marker behind", async () => {
      localStorage.setItem(PENDING_DELETE_KEY, JSON.stringify(["sub-owed"]));
      const effects = fakeEffects({ deleteRegistration: vi.fn(() => Promise.resolve(false)) });
      const store = createProfileStore({ effects });

      expect(await store.getState().resume()).toBeNull();

      expect(effects.deleteRegistration).toHaveBeenCalledTimes(1);
      expect(effects.clearCaches).not.toHaveBeenCalled();
      expect(readRevokeIncomplete()).toBeNull();
    });

    it("keeps 'storage' in the marker when an owed id is still only in memory", async () => {
      markRevokeIncomplete([]);
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => undefined);
      rememberPendingDelete("sub-memory");
      vi.restoreAllMocks();
      const effects = fakeEffects({ deleteRegistration: vi.fn(() => Promise.resolve(false)) });
      const store = createProfileStore({ effects });

      const outcome = await store.getState().resume();

      expect(outcome).toEqual({ failed: ["storage"], pending: true });
    });

    it("waits for a revoke that is running instead of racing it", async () => {
      let finish: () => void = () => undefined;
      const effects = fakeEffects({
        unsubscribe: vi.fn(
          () =>
            new Promise<void>((resolve) => {
              finish = resolve;
            }),
        ),
      });
      const store = createProfileStore({ effects });
      store.getState().setPush(registration);

      const revoking = store.getState().revoke();
      const resuming = store.getState().resume();
      finish();

      expect(await resuming).toEqual(await revoking);
      expect(effects.clearCaches).toHaveBeenCalledTimes(1);
    });

    it("runs one resume at a time", async () => {
      markRevokeIncomplete(["cache"]);
      let release: () => void = () => undefined;
      const effects = fakeEffects({
        clearCaches: vi.fn(
          () =>
            new Promise<void>((resolve) => {
              release = resolve;
            }),
        ),
      });
      const store = createProfileStore({ effects });

      const first = store.getState().resume();
      const second = store.getState().resume();
      await vi.waitFor(() => {
        expect(effects.clearCaches).toHaveBeenCalledTimes(1);
      });
      release();

      expect(await first).toEqual(await second);
      expect(effects.clearCaches).toHaveBeenCalledTimes(1);
    });
  });
});

describe("the epoch moves without writing (ruling R37, M3)", () => {
  it("a revoke in another tab does not make this tab write the key back", async () => {
    const thisTab = createProfileStore({ effects: fakeEffects() });
    thisTab.getState().save(profile);
    const otherTab = createProfileStore({ effects: fakeEffects() });

    await otherTab.getState().revoke();
    expect(localStorage.getItem(PROFILE_STORAGE_KEY)).toBeNull();
    window.dispatchEvent(new StorageEvent("storage", { key: PROFILE_STORAGE_KEY, storageArea: localStorage }));

    await vi.waitFor(() => {
      expect(thisTab.getState().revokeEpoch).toBe(1);
    });
    expect(localStorage.getItem(PROFILE_STORAGE_KEY)).toBeNull();
  });
});

/** A promise a test settles by hand. */
function gate<T = void>() {
  let open: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

describe("a removal that is running is not a removal that failed (ruling R36, NB1)", () => {
  it("is active from before the marker is written until after its last word, and not a moment longer", async () => {
    const seen: { event: string; active: boolean; marker: string | null }[] = [];
    const stopMarker = subscribeRevokeIncomplete(() => {
      seen.push({ event: "marker", active: readRevokeActive(), marker: localStorage.getItem(INCOMPLETE_KEY) });
    });
    const stopActive = subscribeRevokeActive(() => {
      seen.push({ event: readRevokeActive() ? "on" : "off", active: readRevokeActive(), marker: localStorage.getItem(INCOMPLETE_KEY) });
    });
    const store = createProfileStore({ effects: fakeEffects() });
    store.getState().save(profile);

    await store.getState().revoke();
    stopMarker();
    stopActive();

    // On first. Then the marker is written (the screen would read it, and must already know a removal is running)...
    expect(seen[0]).toMatchObject({ event: "on", active: true });
    expect(seen[1]).toMatchObject({ event: "marker", active: true });
    // ...and it goes off only after the marker has been cleared: a complete removal leaves nothing to misread.
    expect(seen.at(-1)).toMatchObject({ event: "off", active: false, marker: null });
  });

  it("is active while the effects run, with the marker already naming every step", async () => {
    const mid: { active: boolean; marker: string | null }[] = [];
    const effects = fakeEffects({
      unsubscribe: vi.fn(() => {
        mid.push({ active: readRevokeActive(), marker: localStorage.getItem(INCOMPLETE_KEY) });
        return Promise.resolve();
      }),
    });
    const store = createProfileStore({ effects });
    store.getState().save(profile);

    await store.getState().revoke();

    expect(mid).toHaveLength(1);
    expect(mid[0]?.active).toBe(true);
    expect(JSON.parse(mid[0]?.marker ?? "null")).toMatchObject({ steps: ["storage", "alerts", "cache"] });
    expect(readRevokeActive()).toBe(false);
  });

  it.each([
    ["an effect fails", { unsubscribe: vi.fn(() => Promise.reject(new Error("offline"))) }],
    [
      "an effect throws",
      {
        clearCaches: vi.fn(() => {
          throw new TypeError("no caches");
        }),
      },
    ],
    ["the check cannot be made", { deviceDataRemains: vi.fn(() => Promise.reject(new Error("unavailable"))) }],
  ])("is not left on when %s", async (_name, overrides) => {
    const store = createProfileStore({ effects: fakeEffects(overrides) });
    store.getState().save(profile);

    const outcome = await store.getState().revoke();

    expect(isRevokeComplete(outcome)).toBe(false);
    expect(readRevokeActive()).toBe(false);
  });

  it("is not left on when an effect never answers: the step limit ends it", async () => {
    vi.useFakeTimers();
    const effects = fakeEffects({ unsubscribe: vi.fn(() => new Promise<void>(() => undefined)) });
    const store = createProfileStore({ effects });
    store.getState().save(profile);

    const running = store.getState().revoke();
    expect(readRevokeActive()).toBe(true);
    await vi.advanceTimersByTimeAsync(REVOKE_STEP_TIMEOUT_MS);
    await running;

    expect(readRevokeActive()).toBe(false);
  });

  it("counts a revoke that joins a running one once", async () => {
    const hold = gate();
    const effects = fakeEffects({ unsubscribe: vi.fn(() => hold.promise) });
    const store = createProfileStore({ effects });
    store.getState().setPush(registration);

    const first = store.getState().revoke();
    const second = store.getState().revoke();
    hold.open();
    await Promise.all([first, second]);

    expect(readRevokeActive()).toBe(false);
  });

  it("is active while resume finishes an unfinished removal, and not afterwards", async () => {
    markRevokeIncomplete(["cache"]);
    const mid: boolean[] = [];
    const effects = fakeEffects({
      clearCaches: vi.fn(() => {
        mid.push(readRevokeActive());
        return Promise.resolve();
      }),
    });
    const store = createProfileStore({ effects });

    await store.getState().resume();

    expect(mid).toEqual([true]);
    expect(readRevokeActive()).toBe(false);
  });

  it("is never active for a quiet resume (an owed registration alone): there is nothing to announce", async () => {
    localStorage.setItem(PENDING_DELETE_KEY, JSON.stringify(["sub-owed"]));
    const mid: boolean[] = [];
    const effects = fakeEffects({
      deleteRegistration: vi.fn(() => {
        mid.push(readRevokeActive());
        return Promise.resolve(true);
      }),
    });
    const store = createProfileStore({ effects });

    await store.getState().resume();

    expect(mid).toEqual([false]);
  });

  it("is not left on when resume is superseded by a revoke", async () => {
    markRevokeIncomplete(["cache"]);
    const hold = gate();
    const effects = fakeEffects({
      clearCaches: vi
        .fn()
        .mockImplementationOnce(() => hold.promise)
        .mockResolvedValue(undefined),
    });
    const store = createProfileStore({ effects });

    const resuming = store.getState().resume();
    await store.getState().revoke();
    hold.open();
    await resuming;

    expect(readRevokeActive()).toBe(false);
  });
});

describe("revoke and resume do not overlap (ruling R36, NB2)", () => {
  /** A store whose first cache clearing (the resume's) waits for the test, and whose revoke waits on a second gate. */
  function overlapping() {
    markRevokeIncomplete(["cache", "alerts"]);
    const resumeClearing = gate();
    const revokeBrowserStep = gate();
    const effects = fakeEffects({
      clearCaches: vi
        .fn()
        .mockImplementationOnce(() => resumeClearing.promise)
        .mockResolvedValue(undefined),
      unsubscribe: vi.fn(() => revokeBrowserStep.promise),
    });
    return { store: createProfileStore({ effects }), effects, resumeClearing, revokeBrowserStep };
  }

  it("a resume that ends after a revoke began does not erase the revoke's marker, and tells the page nothing", async () => {
    const { store, resumeClearing, revokeBrowserStep } = overlapping();
    const resuming = store.getState().resume();
    store.getState().save(profile);
    const revoking = store.getState().revoke();
    const writtenByRevoke = readRevokeIncomplete();
    expect(writtenByRevoke?.steps).toEqual(["storage", "alerts", "cache"]);

    resumeClearing.open();
    expect(await resuming).toBeNull();

    // The resume saw nothing left to do and would have cleared the marker: the revoke is still running and owns it.
    expect(readRevokeIncomplete()).toEqual(writtenByRevoke);
    expect(localStorage.getItem(INCOMPLETE_KEY)).not.toBeNull();

    revokeBrowserStep.open();
    expect(await revoking).toEqual(COMPLETE);
    expect(readRevokeIncomplete()).toBeNull();
  });

  it("a resume that ends after a revoke has finished does not write the old steps back", async () => {
    const { store, resumeClearing, revokeBrowserStep } = overlapping();
    const resuming = store.getState().resume();
    const revoking = store.getState().revoke();
    revokeBrowserStep.open();
    expect(await revoking).toEqual(COMPLETE);
    expect(readRevokeIncomplete()).toBeNull();

    resumeClearing.open();
    expect(await resuming).toBeNull();

    // The marker the resume read named "alerts"; written back now, it would claim an unfinished removal that finished.
    expect(readRevokeIncomplete()).toBeNull();
    expect(localStorage.getItem(INCOMPLETE_KEY)).toBeNull();
  });

  it("a resume that ends after a revoke began does not hide the revoke's own failure", async () => {
    markRevokeIncomplete(["cache"]);
    const resumeClearing = gate();
    const effects = fakeEffects({
      clearCaches: vi
        .fn()
        .mockImplementationOnce(() => resumeClearing.promise)
        .mockRejectedValue(new Error("quota")),
    });
    const store = createProfileStore({ effects });

    const resuming = store.getState().resume();
    const outcome = await store.getState().revoke();
    resumeClearing.open();
    await resuming;

    expect(outcome).toEqual({ failed: ["cache"], pending: false });
    expect(readRevokeIncomplete()?.steps).toEqual(["cache"]);
  });

  it("resume works as before once a revoke has finished", async () => {
    const effects = fakeEffects({ clearCaches: vi.fn(() => Promise.reject(new Error("quota"))) });
    const store = createProfileStore({ effects });
    await store.getState().revoke();
    expect(readRevokeIncomplete()?.steps).toEqual(["cache"]);

    vi.mocked(effects.clearCaches).mockResolvedValue(undefined);

    expect(await store.getState().resume()).toEqual(COMPLETE);
    expect(readRevokeIncomplete()).toBeNull();
  });

  it("a revoke does not wait for a resume: the worker's tap is not held up", async () => {
    const { store, effects, revokeBrowserStep } = overlapping();
    void store.getState().resume();
    const revoking = store.getState().revoke();

    await vi.waitFor(() => {
      expect(effects.unsubscribe).toHaveBeenCalledTimes(1);
    });
    revokeBrowserStep.open();
    await revoking;
  });
});
