import { act, renderHook } from "@testing-library/react";
import { PROFILE_STORAGE_KEY, publishSitePin, readSitePin, resetSitePinForTests, toSitePin, useSitePin } from "@/features/profile/site-pin";
import { createProfileStore, type ProfileEffects } from "@/features/profile/store";
import { clearRevokeIncomplete, endRevokeActivity, readRevokeActive } from "@/features/profile/revoke-marker";
import { forgetPendingDelete, readPendingDeletes } from "@/features/push/pending-delete";

/*
 * The worker header reads the site pin without the profile store (F2 Part 0): a read-only view over localStorage plus what the
 * store publishes. These tests pin that the two agree on every way the pin changes, including a phone whose storage is blocked.
 */

function fakeEffects(): ProfileEffects {
  return {
    unsubscribe: vi.fn(() => Promise.resolve()),
    deleteRegistration: vi.fn(() => Promise.resolve(true)),
    clearCaches: vi.fn(() => Promise.resolve()),
    clearCacheMetadata: vi.fn(() => Promise.resolve("cleared" as const)),
    deviceDataRemains: vi.fn(() => Promise.resolve(false)),
  };
}

function settle(): void {
  vi.restoreAllMocks();
  for (const id of readPendingDeletes()) forgetPendingDelete(id);
  clearRevokeIncomplete();
  while (readRevokeActive()) endRevokeActivity();
}

beforeEach(() => {
  settle();
  localStorage.clear();
  resetSitePinForTests();
});

afterEach(() => {
  settle();
  resetSitePinForTests();
});

const PIN = { siteId: "site-demo-mussafah", crewId: "crew-b" };

function store(state: unknown): void {
  localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify({ state, version: 1 }));
}

describe("toSitePin", () => {
  it("accepts a site with a crew or with none", () => {
    expect(toSitePin(PIN)).toEqual(PIN);
    expect(toSitePin({ siteId: "s", crewId: null })).toEqual({ siteId: "s", crewId: null });
  });

  it.each([null, undefined, "yes", 4, {}, { siteId: "" }, { siteId: 7, crewId: null }, { siteId: "s", crewId: 4 }, { siteId: "s", crewId: "" }])(
    "rejects %j",
    (value) => {
      expect(toSitePin(value)).toBeNull();
    },
  );
});

describe("readSitePin", () => {
  it("reads the pin the store persisted", () => {
    store({ profile: null, push: null, site: PIN });
    expect(readSitePin()).toEqual(PIN);
  });

  it("is null for no storage, a state saved before the pin existed, a bad shape and corrupt JSON", () => {
    expect(readSitePin()).toBeNull();
    store({ profile: null, push: null });
    expect(readSitePin()).toBeNull();
    store({ site: { siteId: 7, crewId: null } });
    expect(readSitePin()).toBeNull();
    localStorage.setItem(PROFILE_STORAGE_KEY, "{not json");
    expect(readSitePin()).toBeNull();
  });

  it("returns the same object while the stored text is the same (useSyncExternalStore compares snapshots by identity)", () => {
    store({ site: PIN });
    expect(readSitePin()).toBe(readSitePin());
  });

  it("survives blocked storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    expect(readSitePin()).toBeNull();
  });
});

describe("what the store publishes", () => {
  it("chooseSite, clearSite and revoke are each seen by the reader at once", async () => {
    const profile = createProfileStore({ effects: fakeEffects() });
    profile.getState().chooseSite(PIN);
    expect(readSitePin()).toEqual(PIN);

    profile.getState().clearSite();
    expect(readSitePin()).toBeNull();

    profile.getState().chooseSite(PIN);
    await profile.getState().revoke();
    expect(readSitePin()).toBeNull();
    expect(localStorage.getItem(PROFILE_STORAGE_KEY)).toBeNull();
  });

  it("a phone that blocks storage still shows the pin the store holds in memory", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    createProfileStore({ effects: fakeEffects() }).getState().chooseSite(PIN);
    expect(readSitePin()).toEqual(PIN);
  });

  it("another tab's change drops what was published and the stored value is read again", () => {
    publishSitePin(PIN);
    store({ site: { siteId: "other", crewId: null } });
    expect(readSitePin()).toEqual(PIN);

    const { result } = renderHook(() => useSitePin());
    expect(result.current).toEqual(PIN);
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: PROFILE_STORAGE_KEY }));
    });
    expect(result.current).toEqual({ siteId: "other", crewId: null });
  });

  it("another tab removing the data clears the pin here", () => {
    store({ site: PIN });
    const { result } = renderHook(() => useSitePin());
    expect(result.current).toEqual(PIN);
    localStorage.removeItem(PROFILE_STORAGE_KEY);
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: PROFILE_STORAGE_KEY }));
    });
    expect(result.current).toBeNull();
  });

  it("ignores a storage event for another key", () => {
    publishSitePin(PIN);
    const { result } = renderHook(() => useSitePin());
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "something-else" }));
    });
    expect(result.current).toEqual(PIN);
  });
});

describe("useSitePin", () => {
  it("re-renders when the store changes the pin", () => {
    const profile = createProfileStore({ effects: fakeEffects() });
    const { result } = renderHook(() => useSitePin());
    expect(result.current).toBeNull();
    act(() => {
      profile.getState().chooseSite(PIN);
    });
    expect(result.current).toEqual(PIN);
    act(() => {
      profile.getState().clearSite();
    });
    expect(result.current).toBeNull();
  });
});
