import { readFileSync } from "node:fs";
import path from "node:path";
import {
  API_CACHE_NAME,
  API_CACHE_NAMES,
  EXPIRATION_DB_NAME,
  OFFLINE_API_ALLOW_LIST,
  clearApiCaches,
  deleteExpirationMetadata,
  isCachedApiPath,
} from "@/features/pwa/api-cache";

/*
 * The service worker keeps exactly two API responses for offline use: today's forecast of one site and the risk
 * policy. Everything else under /api/v1 must stay out of Cache Storage, so a push subscription call or a crew
 * timeline is never kept on a phone that several workers may use (ADR 0004/0009).
 */

describe("OFFLINE_API_ALLOW_LIST", () => {
  // A governance pin: this list is the whole of what the app may keep on the device. Changing it is a decision
  // (ADR 0004/0009), so this assertion has to be edited on purpose, in the same change as the decision.
  it("is exactly the forecast of one site and the risk policy", () => {
    expect(OFFLINE_API_ALLOW_LIST.map((pattern) => pattern.source)).toEqual([
      String.raw`^\/api\/v1\/sites\/[^/]+\/forecast\/today$`,
      String.raw`^\/api\/v1\/risk-policy$`,
    ]);
  });
});

describe("isCachedApiPath", () => {
  it.each(["/api/v1/sites/site-1/forecast/today", "/api/v1/sites/0b7e2c1a-77aa/forecast/today", "/api/v1/risk-policy"])(
    "%s is cached for offline use",
    (pathname) => {
      expect(isCachedApiPath(pathname)).toBe(true);
    },
  );

  it.each([
    "/api/v1/sites",
    "/api/v1/sites/site-1",
    "/api/v1/sites/site-1/crews",
    "/api/v1/sites/site-1/forecast",
    "/api/v1/sites/site-1/forecast/tomorrow",
    "/api/v1/sites/site-1/forecast/today/extra",
    "/api/v1/sites//forecast/today",
    "/api/v1/sites/a/b/forecast/today",
    "/api/v1/risk-policy/extra",
    "/api/v1/risk-policy.json",
    "/api/v1/crews/crew-1/timeline",
    "/api/v1/push/subscriptions",
    "/api/healthz",
    "/en/api/v1/risk-policy",
    "/risk-policy",
  ])("%s is not", (pathname) => {
    expect(isCachedApiPath(pathname)).toBe(false);
  });
});

/** An in-memory CacheStorage: only what clearApiCaches uses (`delete`), plus `keys` for the assertions. */
function fakeStorage(names: string[]) {
  const open = new Set(names);
  return {
    delete: vi.fn((name: string) => Promise.resolve(open.delete(name))),
    keys: () => [...open].sort(),
  };
}

describe("clearApiCaches", () => {
  it("deletes the allow-listed responses' cache and the cache the default Serwist rule used to fill", async () => {
    expect(API_CACHE_NAMES).toEqual([API_CACHE_NAME, "apis"]);
    const storage = fakeStorage([API_CACHE_NAME, "apis", "serwist-precache-v2", "pages", "others"]);
    await clearApiCaches(storage);
    expect(storage.keys()).toEqual(["others", "pages", "serwist-precache-v2"]);
  });

  it("is a no-op for caches that do not exist", async () => {
    const storage = fakeStorage(["pages"]);
    await clearApiCaches(storage);
    expect(storage.keys()).toEqual(["pages"]);
  });

  it("resolves quietly where Cache Storage does not exist (an insecure page, or no browser)", async () => {
    await expect(clearApiCaches(undefined)).resolves.toBeUndefined();
  });

  it("uses the browser's CacheStorage by default", async () => {
    const storage = fakeStorage([API_CACHE_NAME]);
    vi.stubGlobal("caches", storage);
    try {
      await clearApiCaches();
      expect(storage.keys()).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does not hide a failure: a caller that is revoking consent must know the data may still be there", async () => {
    const storage = { delete: vi.fn(() => Promise.reject(new Error("storage unavailable"))) };
    await expect(clearApiCaches(storage)).rejects.toThrow("storage unavailable");
  });

  it("still tries every cache when one deletion fails", async () => {
    const storage = {
      delete: vi.fn((name: string) => (name === API_CACHE_NAME ? Promise.reject(new Error("boom")) : Promise.resolve(true))),
    };
    await expect(clearApiCaches(storage)).rejects.toThrow("boom");
    expect(storage.delete).toHaveBeenCalledTimes(API_CACHE_NAMES.length);
  });
});

/**
 * An IDBFactory whose `deleteDatabase` hands back a request the test settles by hand, like the browser does: through
 * `onsuccess`, `onerror` and `onblocked`.
 */
function fakeFactory() {
  const request: {
    onsuccess: (() => void) | null;
    onerror: (() => void) | null;
    onblocked: (() => void) | null;
    error: DOMException | null;
  } = { onsuccess: null, onerror: null, onblocked: null, error: null };
  const factory = { deleteDatabase: vi.fn<IDBFactory["deleteDatabase"]>(() => request as unknown as IDBOpenDBRequest) };
  return { factory, request };
}

describe("deleteExpirationMetadata", () => {
  it("deletes Serwist's expiration database, and says so once the browser has", async () => {
    const { factory, request } = fakeFactory();
    const done = deleteExpirationMetadata(factory);
    request.onsuccess?.();
    await expect(done).resolves.toBe("deleted");
    expect(factory.deleteDatabase).toHaveBeenCalledExactlyOnceWith("serwist-expiration");
  });

  it("names the database the installed Serwist writes its URL timestamps to", () => {
    // ExpirationPlugin keeps the URL and fetch time of every cached entry, for every cache it expires, in one
    // IndexedDB database. Clearing Cache Storage does not touch it, and a renamed database in a later Serwist would
    // silently stop being deleted: this fails first.
    expect(EXPIRATION_DB_NAME).toBe("serwist-expiration");
    const source = readFileSync(path.resolve(import.meta.dirname, "../../../../node_modules/serwist/dist/index.mjs"), "utf8");
    expect(source).toContain(`const DB_NAME = "serwist-expiration";`);
  });

  it("does not wait for a service worker that still holds the database open: the deletion is queued", async () => {
    // The worker opens the database on its first cached response and never closes it (Serwist's CacheTimestampsModel
    // keeps the connection), so while the worker runs, deleteDatabase fires `blocked` and completes only when the
    // browser stops the worker. Waiting for that would hang the screen.
    const { factory, request } = fakeFactory();
    const done = deleteExpirationMetadata(factory);
    request.onblocked?.();
    await expect(done).resolves.toBe("queued");
  });

  it("keeps the answer it gave when the queued deletion completes later", async () => {
    const { factory, request } = fakeFactory();
    const done = deleteExpirationMetadata(factory);
    request.onblocked?.();
    request.onsuccess?.();
    await expect(done).resolves.toBe("queued");
  });

  it("does not hide a failure: a caller that is revoking consent must know the data may still be there", async () => {
    const { factory, request } = fakeFactory();
    request.error = new DOMException("denied", "UnknownError");
    const done = deleteExpirationMetadata(factory);
    request.onerror?.();
    await expect(done).rejects.toBe(request.error);
  });

  it("rejects when the browser throws instead of answering (a SecurityError on a blocked origin)", async () => {
    const factory = {
      deleteDatabase: vi.fn(() => {
        throw new DOMException("blocked", "SecurityError");
      }),
    };
    await expect(deleteExpirationMetadata(factory)).rejects.toThrow("blocked");
  });

  it("rejects with a real error when the browser reports a failure without one", async () => {
    const { factory, request } = fakeFactory();
    const done = deleteExpirationMetadata(factory);
    request.onerror?.();
    await expect(done).rejects.toBeInstanceOf(Error);
  });

  it("resolves quietly where IndexedDB does not exist", async () => {
    await expect(deleteExpirationMetadata(undefined)).resolves.toBe("deleted");
  });

  it("uses the browser's indexedDB by default", async () => {
    const { factory, request } = fakeFactory();
    vi.stubGlobal("indexedDB", factory);
    try {
      const done = deleteExpirationMetadata();
      request.onsuccess?.();
      await expect(done).resolves.toBe("deleted");
      expect(factory.deleteDatabase).toHaveBeenCalledWith(EXPIRATION_DB_NAME);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
