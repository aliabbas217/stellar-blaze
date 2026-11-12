import {
  clearRevokeIncomplete,
  INCOMPLETE_KEY,
  markRevokeIncomplete,
  readRevokeIncomplete,
  subscribeRevokeIncomplete,
} from "@/features/profile/revoke-marker";

/*
 * The durable "data may remain" marker (ruling R36): written before a revoke starts, removed only when every step has
 * finished, and read back after a reload. It holds a version, a time and the names of unfinished steps: no personal data.
 */

beforeEach(() => {
  localStorage.clear();
  clearRevokeIncomplete();
});

afterEach(() => {
  vi.restoreAllMocks();
  clearRevokeIncomplete();
});

describe("the marker", () => {
  it("is absent until it is written", () => {
    expect(readRevokeIncomplete()).toBeNull();
  });

  it("holds a version, a time and step names, and nothing else", () => {
    markRevokeIncomplete(["cache", "alerts"]);
    const stored = JSON.parse(localStorage.getItem(INCOMPLETE_KEY) ?? "null") as Record<string, unknown>;
    expect(Object.keys(stored).sort()).toEqual(["at", "steps", "v"]);
    expect(stored["v"]).toBe(1);
    expect(stored["steps"]).toEqual(["alerts", "cache"]);
    expect(Number.isNaN(Date.parse(String(stored["at"])))).toBe(false);
  });

  it("is read back after a reload (a fresh read of the same storage)", () => {
    markRevokeIncomplete(["storage"]);
    expect(readRevokeIncomplete()).toMatchObject({ steps: ["storage"] });
  });

  it("can name no step: only the API's confirmation of a registration is outstanding", () => {
    markRevokeIncomplete([]);
    expect(readRevokeIncomplete()).toMatchObject({ steps: [] });
    expect(readRevokeIncomplete()).not.toBeNull();
  });

  it("is removed by clear", () => {
    markRevokeIncomplete(["cache"]);
    clearRevokeIncomplete();
    expect(readRevokeIncomplete()).toBeNull();
    expect(localStorage.getItem(INCOMPLETE_KEY)).toBeNull();
  });

  it("is the same object while nothing changed, and a new one when it does (useSyncExternalStore needs that)", () => {
    markRevokeIncomplete(["cache"]);
    const first = readRevokeIncomplete();
    expect(readRevokeIncomplete()).toBe(first);
    markRevokeIncomplete(["alerts"]);
    expect(readRevokeIncomplete()).not.toBe(first);
  });

  it.each([
    ["corrupt JSON", "{not json"],
    ["another version", JSON.stringify({ v: 2, at: "2026-11-11T08:30:00.000Z", steps: [] })],
    ["a step that does not exist", JSON.stringify({ v: 1, at: "2026-11-11T08:30:00.000Z", steps: ["everything"] })],
    ["no time", JSON.stringify({ v: 1, steps: [] })],
    ["steps that are not a list", JSON.stringify({ v: 1, at: "2026-11-11T08:30:00.000Z", steps: "cache" })],
    ["a string", JSON.stringify("cache")],
    ["null", "null"],
  ])("reads %s as no marker, without throwing", (_name, stored) => {
    localStorage.setItem(INCOMPLETE_KEY, stored);
    expect(readRevokeIncomplete()).toBeNull();
  });

  it("is kept in memory when localStorage refuses the write, so this page still says so", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    markRevokeIncomplete(["cache"]);
    expect(readRevokeIncomplete()).toMatchObject({ steps: ["cache"] });
  });

  it("is kept in memory when a write is accepted but does not take (read-back differs)", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => undefined);
    markRevokeIncomplete(["alerts"]);
    expect(localStorage.getItem(INCOMPLETE_KEY)).toBeNull();
    expect(readRevokeIncomplete()).toMatchObject({ steps: ["alerts"] });
  });

  it("does not throw when localStorage is blocked for reading, writing and removing", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    expect(() => {
      markRevokeIncomplete(["cache"]);
    }).not.toThrow();
    expect(readRevokeIncomplete()).not.toBeNull();
    expect(() => {
      clearRevokeIncomplete();
    }).not.toThrow();
    expect(readRevokeIncomplete()).toBeNull();
  });
});

describe("subscribeRevokeIncomplete", () => {
  it("calls back when the marker is written or cleared here", () => {
    const onChange = vi.fn();
    const stop = subscribeRevokeIncomplete(onChange);
    markRevokeIncomplete(["cache"]);
    clearRevokeIncomplete();
    expect(onChange).toHaveBeenCalledTimes(2);
    stop();
  });

  it("calls back when another tab changes it (a storage event for its key, or for a cleared storage)", () => {
    const onChange = vi.fn();
    const stop = subscribeRevokeIncomplete(onChange);
    window.dispatchEvent(new StorageEvent("storage", { key: INCOMPLETE_KEY, storageArea: localStorage }));
    window.dispatchEvent(new StorageEvent("storage", { key: null, storageArea: localStorage }));
    expect(onChange).toHaveBeenCalledTimes(2);
    stop();
  });

  it("ignores another key", () => {
    const onChange = vi.fn();
    const stop = subscribeRevokeIncomplete(onChange);
    window.dispatchEvent(new StorageEvent("storage", { key: "sb-profile-v1", storageArea: localStorage }));
    expect(onChange).not.toHaveBeenCalled();
    stop();
  });

  it("stops calling back after the unsubscribe", () => {
    const onChange = vi.fn();
    subscribeRevokeIncomplete(onChange)();
    markRevokeIncomplete(["cache"]);
    window.dispatchEvent(new StorageEvent("storage", { key: INCOMPLETE_KEY, storageArea: localStorage }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
