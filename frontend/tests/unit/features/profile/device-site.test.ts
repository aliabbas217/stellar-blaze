import { act, renderHook } from "@testing-library/react";
import { createProfileStore, PROFILE_STORAGE_KEY, useProfile, type ProfileEffects } from "@/features/profile/store";
import { useDeviceSite } from "@/features/profile/useDeviceSite";
import {
  clearRevokeIncomplete,
  endRevokeActivity,
  readRevokeActive,
} from "@/features/profile/revoke-marker";
import { forgetPendingDelete, readPendingDeletes } from "@/features/push/pending-delete";

/*
 * The device's site pin (F2 Task 3, C7): which site, and optionally which crew, this phone is pinned to. It lives in the
 * F1 profile store beside the profile and the push registration, under the same key, and is taken back by revoke() with
 * them: a worker who removes their data from the phone must not stay pinned to a crew.
 */

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
  forgetEverythingOwed();
});

describe("the site slice of the profile store", () => {
  it("starts unpinned", () => {
    expect(createProfileStore({ effects: fakeEffects() }).getState().site).toBeNull();
  });

  it("chooseSite stores the pin under sb-profile-v1 and a reload restores it", () => {
    const first = createProfileStore({ effects: fakeEffects() });
    first.getState().chooseSite({ siteId: "site-demo-mussafah", crewId: "crew-b" });

    expect(JSON.parse(localStorage.getItem(PROFILE_STORAGE_KEY) ?? "null")).toMatchObject({
      state: { site: { siteId: "site-demo-mussafah", crewId: "crew-b" } },
    });
    expect(createProfileStore({ effects: fakeEffects() }).getState().site).toEqual({
      siteId: "site-demo-mussafah",
      crewId: "crew-b",
    });
  });

  it("a pin without a crew is valid", () => {
    const store = createProfileStore({ effects: fakeEffects() });
    store.getState().chooseSite({ siteId: "site-demo-mussafah", crewId: null });
    expect(createProfileStore({ effects: fakeEffects() }).getState().site).toEqual({ siteId: "site-demo-mussafah", crewId: null });
  });

  it.each([
    ["a pin of the wrong shape", { siteId: 7, crewId: null }],
    ["a pin with an empty site", { siteId: "", crewId: null }],
    ["a pin whose crew is a number", { siteId: "s", crewId: 4 }],
    ["a pin that is not an object", "yes"],
  ])("drops %s read back from storage", (_name, site) => {
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify({ state: { site }, version: 1 }));
    expect(createProfileStore({ effects: fakeEffects() }).getState().site).toBeNull();
  });

  it("a state saved before the pin existed reads as unpinned", () => {
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify({ state: { profile: null, push: null }, version: 1 }));
    expect(createProfileStore({ effects: fakeEffects() }).getState().site).toBeNull();
  });

  it("test_revoke_clears_site_pin: revoke() takes the pin back, in memory and in storage, and a reload stays unpinned", async () => {
    const store = createProfileStore({ effects: fakeEffects() });
    store.getState().chooseSite({ siteId: "site-demo-mussafah", crewId: "crew-b" });

    const outcome = await store.getState().revoke();

    expect(outcome).toEqual({ failed: [], pending: false });
    expect(store.getState().site).toBeNull();
    expect(localStorage.getItem(PROFILE_STORAGE_KEY)).toBeNull();
    expect(createProfileStore({ effects: fakeEffects() }).getState().site).toBeNull();
  });

  it("another tab's revoke removes the pin here too", () => {
    const thisTab = createProfileStore({ effects: fakeEffects() });
    thisTab.getState().chooseSite({ siteId: "site-demo-mussafah", crewId: null });
    const epoch = thisTab.getState().revokeEpoch;

    localStorage.removeItem(PROFILE_STORAGE_KEY);
    window.dispatchEvent(new StorageEvent("storage", { key: PROFILE_STORAGE_KEY }));

    return vi.waitFor(() => {
      expect(thisTab.getState().site).toBeNull();
      expect(thisTab.getState().revokeEpoch).toBe(epoch + 1);
    });
  });

  it("clearSite drops only the pin", () => {
    const store = createProfileStore({ effects: fakeEffects() });
    store.getState().chooseSite({ siteId: "site-demo-mussafah", crewId: null });
    store.getState().setPush({ serverId: "sub-1", endpoint: "https://push.example/a", siteId: "site-demo-mussafah" });

    store.getState().clearSite();

    expect(store.getState().site).toBeNull();
    expect(store.getState().push).not.toBeNull();
  });
});

describe("useDeviceSite", () => {
  beforeEach(() => {
    useProfile.setState({ site: null });
  });

  it("exposes the pin, choose() and clear()", () => {
    const { result } = renderHook(() => useDeviceSite());
    expect(result.current).toMatchObject({ siteId: null, crewId: null });

    act(() => {
      result.current.choose("site-demo-mussafah", "crew-b");
    });
    expect(result.current).toMatchObject({ siteId: "site-demo-mussafah", crewId: "crew-b" });
    expect(useProfile.getState().site).toEqual({ siteId: "site-demo-mussafah", crewId: "crew-b" });

    act(() => {
      result.current.clear();
    });
    expect(result.current).toMatchObject({ siteId: null, crewId: null });
  });
});
