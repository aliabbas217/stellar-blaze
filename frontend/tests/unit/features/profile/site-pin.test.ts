import { act, renderHook } from "@testing-library/react";
import {
  nextSitePin,
  PROFILE_STORAGE_KEY,
  publishSitePin,
  readDeviceFlags,
  readSitePin,
  resetSitePinForTests,
  toSitePin,
  useHasProfile,
  useHasPush,
  useSitePin,
} from "@/features/profile/site-pin";
import { CONSENT_VERSION } from "@/features/profile/profile-shape";
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

describe("the device flags (F2 W1): is there a profile, is there a push registration, asked without the store", () => {
  const PROFILE = { workloadClass: "moderate" };
  const PUSH = { serverId: "s", endpoint: "https://push.example/1", siteId: "site-demo-mussafah" };

  it("reads both flags from what is stored, and both are false with nothing stored or on corrupt JSON", () => {
    expect(readDeviceFlags()).toEqual({ hasProfile: false, hasPush: false });
    store({ profile: PROFILE, push: null, site: null });
    expect(readDeviceFlags()).toEqual({ hasProfile: true, hasPush: false });
    store({ profile: null, push: PUSH, site: null });
    expect(readDeviceFlags()).toEqual({ hasProfile: false, hasPush: true });
    localStorage.setItem(PROFILE_STORAGE_KEY, "{not json");
    expect(readDeviceFlags()).toEqual({ hasProfile: false, hasPush: false });
  });

  it("a flag says only that a value is there: a profile of the wrong type is not one", () => {
    store({ profile: "yes", push: 4, site: null });
    expect(readDeviceFlags()).toEqual({ hasProfile: false, hasPush: false });
  });

  it("gives the same object while nothing changed (a snapshot compared by identity must not make React loop)", () => {
    store({ profile: PROFILE, push: null, site: null });
    expect(readDeviceFlags()).toBe(readDeviceFlags());
  });

  it("follows the store: saving a profile and registering push flip the flags, and revoke takes them back", async () => {
    const profileStore = createProfileStore({ effects: fakeEffects() });
    const flags = renderHook(() => ({ profile: useHasProfile(), push: useHasPush() }));
    expect(flags.result.current).toEqual({ profile: false, push: false });
    act(() => {
      profileStore.getState().save({
        consentVersion: CONSENT_VERSION,
        consentedAt: "2026-11-11T08:30:00.000Z",
        siteId: "site-demo-mussafah",
        crewId: null,
        workloadClass: "moderate",
        heatWorkStartDate: "2026-11-01",
        clothingCode: "work_clothes",
      });
      profileStore.getState().setPush(PUSH);
    });
    expect(flags.result.current).toEqual({ profile: true, push: true });
    await act(async () => {
      await profileStore.getState().revoke();
    });
    expect(flags.result.current).toEqual({ profile: false, push: false });
  });

  it("another tab's change (a storage event) is read again", () => {
    const flags = renderHook(() => useHasProfile());
    expect(flags.result.current).toBe(false);
    store({ profile: PROFILE, push: null, site: null });
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: PROFILE_STORAGE_KEY }));
    });
    expect(flags.result.current).toBe(true);
  });
});

describe("nextSitePin: the contacts survive choosing the same site again, and never another site's", () => {
  const CONTACTS = { supervisorPhone: "+12025550143", firstAiderPhone: null };

  it("keeps the stored contacts for the same site, drops them for another, and takes new ones when given", () => {
    const current = { siteId: "site-a", crewId: null, contacts: CONTACTS };
    expect(nextSitePin(current, "site-a", "crew-1")).toEqual({ siteId: "site-a", crewId: "crew-1", contacts: CONTACTS });
    expect(nextSitePin(current, "site-b", null)).toEqual({ siteId: "site-b", crewId: null });
    const fresh = { supervisorPhone: null, firstAiderPhone: "+12025550144" };
    expect(nextSitePin(current, "site-a", null, fresh)).toEqual({ siteId: "site-a", crewId: null, contacts: fresh });
    expect(nextSitePin(null, "site-a", null)).toEqual({ siteId: "site-a", crewId: null });
  });

  it("toSiteContacts keeps a readable save date and drops one that is not a date, keeping the numbers either way", async () => {
    const { toSiteContacts } = await import("@/features/profile/site-pin");
    expect(toSiteContacts({ ...CONTACTS, savedAt: "2026-11-12T08:00:00.000Z" })).toEqual({ ...CONTACTS, savedAt: "2026-11-12T08:00:00.000Z" });
    expect(toSiteContacts({ ...CONTACTS, savedAt: "yesterday" })).toEqual(CONTACTS);
    expect(toSiteContacts({ ...CONTACTS, savedAt: 5 })).toEqual(CONTACTS);
    expect(toSiteContacts(CONTACTS)).toEqual(CONTACTS);
  });

  it("sameContacts ignores the save date: a new date alone is not a changed number", async () => {
    const { sameContacts } = await import("@/features/profile/site-pin");
    expect(sameContacts({ ...CONTACTS, savedAt: "2026-11-12T08:00:00.000Z" }, { ...CONTACTS, savedAt: "2026-11-13T08:00:00.000Z" })).toBe(true);
  });
});
