import { PROFILE_STORAGE_KEY, type PushRegistration } from "@/features/profile/store";

/*
 * Task 7's slice of the on-device store: the push registration, persisted under sb-profile-v1. Task 8 extends it with
 * the profile. A "reload" here is a fresh import of the module, because the store reads localStorage when it is created.
 */

const registration: PushRegistration = { serverId: "sub-1", endpoint: "https://push.example/send/abc", siteId: "site-demo-mussafah" };

async function freshStore() {
  vi.resetModules();
  return (await import("@/features/profile/store")).useProfile;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
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

  it("persists only the push slice: no action, no profile key", async () => {
    const store = await freshStore();
    store.getState().setPush(registration);
    expect(Object.keys((JSON.parse(localStorage.getItem(PROFILE_STORAGE_KEY) ?? "{}") as { state: object }).state)).toEqual(["push"]);
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

  it("ignores a stored profile: until Task 8 there is none to restore", async () => {
    const stored = { state: { push: null, profile: { workloadClass: "heavy" } }, version: 1 };
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(stored));
    expect((await freshStore()).getState().profile).toBeNull();
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
