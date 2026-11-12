import {
  createProfileStore,
  PROFILE_STORAGE_KEY,
  REVOKE_STEP_TIMEOUT_MS,
  type ProfileEffects,
  type PushRegistration,
} from "@/features/profile/store";
import { CONSENT_VERSION, type Profile } from "@/features/profile/profile-shape";

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

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
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
    clearApiCaches: vi.fn(() => Promise.resolve()),
    deleteApiCacheMetadata: vi.fn(() => Promise.resolve("deleted")),
    ...overrides,
  };
}

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
    expect(outcome).toEqual({ failed: [] });
  });

  it("hands unsubscribe the registration id that was stored before the state was cleared", async () => {
    const effects = fakeEffects();
    const store = createProfileStore({ effects });
    store.getState().setPush(registration);

    await store.getState().revoke();

    expect(effects.unsubscribe).toHaveBeenCalledWith("sub-1");
  });

  it("still turns the browser's subscription off when no registration id is stored", async () => {
    const effects = fakeEffects();
    const store = createProfileStore({ effects });
    store.getState().save(profile);

    await store.getState().revoke();

    expect(effects.unsubscribe).toHaveBeenCalledTimes(1);
    expect(effects.unsubscribe).toHaveBeenCalledWith(null);
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

  it("clears the API caches and deletes Serwist's expiration metadata", async () => {
    const effects = fakeEffects();
    const store = createProfileStore({ effects });
    store.getState().save(profile);

    await store.getState().revoke();

    expect(effects.clearApiCaches).toHaveBeenCalledTimes(1);
    expect(effects.deleteApiCacheMetadata).toHaveBeenCalledTimes(1);
  });

  it("has already cleared the local data when the first effect starts: nothing waits on the network", async () => {
    const seen: { profile: Profile | null; push: PushRegistration | null; stored: string | null }[] = [];
    const holder: { store?: ReturnType<typeof createProfileStore> } = {};
    const effects = fakeEffects({
      unsubscribe: vi.fn(() => {
        const state = holder.store?.getState();
        seen.push({ profile: state?.profile ?? null, push: state?.push ?? null, stored: localStorage.getItem(PROFILE_STORAGE_KEY) });
        return Promise.resolve();
      }),
    });
    holder.store = createProfileStore({ effects });
    holder.store.getState().save(profile);
    holder.store.getState().setPush(registration);

    await holder.store.getState().revoke();

    expect(seen).toEqual([{ profile: null, push: null, stored: null }]);
  });

  it("clears local data even when unsubscribe fails, and reports that alerts may still be on", async () => {
    const effects = fakeEffects({ unsubscribe: vi.fn(() => Promise.reject(new Error("offline"))) });
    const store = createProfileStore({ effects });
    store.getState().save(profile);
    store.getState().setPush(registration);

    const outcome = await store.getState().revoke();

    expect(store.getState().profile).toBeNull();
    expect(localStorage.getItem(PROFILE_STORAGE_KEY)).toBeNull();
    expect(outcome).toEqual({ failed: ["alerts"] });
    expect(effects.clearApiCaches).toHaveBeenCalledTimes(1);
  });

  it("clears local data and still unsubscribes when the cache clearing fails", async () => {
    const effects = fakeEffects({ clearApiCaches: vi.fn(() => Promise.reject(new Error("quota"))) });
    const store = createProfileStore({ effects });
    store.getState().save(profile);

    const outcome = await store.getState().revoke();

    expect(store.getState().profile).toBeNull();
    expect(outcome).toEqual({ failed: ["cache"] });
    expect(effects.unsubscribe).toHaveBeenCalledTimes(1);
    expect(effects.deleteApiCacheMetadata).toHaveBeenCalledTimes(1);
  });

  it("reports a failed deletion of the expiration metadata as a cache failure", async () => {
    const effects = fakeEffects({ deleteApiCacheMetadata: vi.fn(() => Promise.reject(new Error("blocked"))) });
    const store = createProfileStore({ effects });
    store.getState().save(profile);

    expect(await store.getState().revoke()).toEqual({ failed: ["cache"] });
    expect(effects.clearApiCaches).toHaveBeenCalledTimes(1);
  });

  it("survives an effect that throws instead of rejecting", async () => {
    const effects = fakeEffects({
      unsubscribe: vi.fn(() => {
        throw new TypeError("no service worker");
      }),
    });
    const store = createProfileStore({ effects });
    store.getState().save(profile);

    expect(await store.getState().revoke()).toEqual({ failed: ["alerts"] });
    expect(store.getState().profile).toBeNull();
  });

  it("does not wait forever for an effect that never settles", async () => {
    vi.useFakeTimers();
    const effects = fakeEffects({ unsubscribe: vi.fn(() => new Promise<void>(() => undefined)) });
    const store = createProfileStore({ effects });
    store.getState().save(profile);

    const pending = store.getState().revoke();
    await vi.advanceTimersByTimeAsync(REVOKE_STEP_TIMEOUT_MS);

    expect(await pending).toEqual({ failed: ["alerts"] });
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
    expect(effects.clearApiCaches).toHaveBeenCalledTimes(1);
  });

  it("can run again after it finished (a retry after a failure)", async () => {
    const effects = fakeEffects({ unsubscribe: vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined) });
    const store = createProfileStore({ effects });
    store.getState().save(profile);

    expect(await store.getState().revoke()).toEqual({ failed: ["alerts"] });
    expect(await store.getState().revoke()).toEqual({ failed: [] });
    expect(effects.unsubscribe).toHaveBeenCalledTimes(2);
  });

  it("works on an empty store: nothing stored, nothing to fail", async () => {
    const effects = fakeEffects();
    const store = createProfileStore({ effects });

    expect(await store.getState().revoke()).toEqual({ failed: [] });
    expect(localStorage.getItem(PROFILE_STORAGE_KEY)).toBeNull();
  });
});

describe("save: a change of site", () => {
  it("clears the API caches and the expiration metadata when the saved site differs from the stored one", async () => {
    const effects = fakeEffects();
    const store = createProfileStore({ effects });
    store.getState().save(profile);
    expect(effects.clearApiCaches).not.toHaveBeenCalled();

    store.getState().save({ ...profile, siteId: "site-demo-jebel-ali" });
    await vi.waitFor(() => {
      expect(effects.clearApiCaches).toHaveBeenCalledTimes(1);
    });

    expect(effects.deleteApiCacheMetadata).toHaveBeenCalledTimes(1);
    expect(store.getState().profile?.siteId).toBe("site-demo-jebel-ali");
  });

  it("does not clear anything on the first save: there is no earlier site, and the policy the form just used must stay cached", () => {
    const effects = fakeEffects();
    const store = createProfileStore({ effects });
    store.getState().save(profile);
    expect(effects.clearApiCaches).not.toHaveBeenCalled();
    expect(effects.deleteApiCacheMetadata).not.toHaveBeenCalled();
  });

  it("does not clear anything when only the crew, the work or the clothing changes", () => {
    const effects = fakeEffects();
    const store = createProfileStore({ effects });
    store.getState().save(profile);
    store.getState().save({ ...profile, crewId: null, workloadClass: "light", clothingCode: "other" });
    expect(effects.clearApiCaches).not.toHaveBeenCalled();
  });

  it("compares with the profile restored from storage after a reload", () => {
    createProfileStore({ effects: fakeEffects() }).getState().save(profile);

    const effects = fakeEffects();
    const reloaded = createProfileStore({ effects });
    reloaded.getState().save({ ...profile, siteId: "site-demo-jebel-ali" });

    expect(effects.clearApiCaches).toHaveBeenCalledTimes(1);
  });

  it("still saves, and does not throw or leave an unhandled rejection, when the clearing fails", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const effects = fakeEffects({ clearApiCaches: vi.fn(() => Promise.reject(new Error("quota"))) });
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
