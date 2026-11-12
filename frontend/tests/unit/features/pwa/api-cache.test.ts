import { readFileSync } from "node:fs";
import path from "node:path";
import {
  API_CACHE_NAME,
  API_CACHE_NAMES,
  DEVICE_CACHE_NAMES,
  DOCUMENT_CACHE_NAMES,
  EXPIRATION_DB_NAME,
  OFFLINE_API_ALLOW_LIST,
  clearApiCaches,
  clearDeviceCaches,
  clearExpirationMetadata,
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

const SERWIST_DEFAULT_CACHE = path.resolve(import.meta.dirname, "../../../../node_modules/@serwist/turbopack/dist/index.worker.mjs");
const SERWIST_CORE = path.resolve(import.meta.dirname, "../../../../node_modules/serwist/dist/index.mjs");

describe("DOCUMENT_CACHE_NAMES", () => {
  it("are the caches Serwist's defaultCache fills with pages, their data and the catch-all, whose URLs can carry ?site=<id>", () => {
    expect(DOCUMENT_CACHE_NAMES).toEqual(["pages", "pages-rsc", "pages-rsc-prefetch", "others"]);
    expect(DEVICE_CACHE_NAMES).toEqual([...API_CACHE_NAMES, ...DOCUMENT_CACHE_NAMES]);
  });

  it("match the names in the installed Serwist defaultCache: a rename would silently leave a cache undeleted", () => {
    const source = readFileSync(SERWIST_DEFAULT_CACHE, "utf8");
    expect(source).toContain(`rscPrefetch: "pages-rsc-prefetch"`);
    expect(source).toContain(`rsc: "pages-rsc"`);
    expect(source).toContain(`html: "pages"`);
    expect(source).toContain(`cacheName: "others"`);
    expect(source).toContain(`cacheName: "apis"`);
  });

  it("leave the precache, the locale preference and the static asset caches alone", () => {
    for (const kept of ["serwist-precache-v2-https://app.example/", "sb-prefs", "static-font-assets", "static-js-assets", "next-static-js-assets"]) {
      expect(DEVICE_CACHE_NAMES).not.toContain(kept);
    }
  });
});

describe("clearDeviceCaches", () => {
  it("deletes the API caches and the page caches, and keeps the precache so the app still opens offline", async () => {
    const storage = fakeStorage([...DEVICE_CACHE_NAMES, "serwist-precache-v2-https://app.example/", "sb-prefs", "static-font-assets"]);
    await clearDeviceCaches(storage);
    expect(storage.keys()).toEqual(["sb-prefs", "serwist-precache-v2-https://app.example/", "static-font-assets"]);
  });

  it("still tries every cache when one deletion fails, and then reports the failure", async () => {
    const storage = { delete: vi.fn((name: string) => (name === "pages" ? Promise.reject(new Error("boom")) : Promise.resolve(true))) };
    await expect(clearDeviceCaches(storage)).rejects.toThrow("boom");
    expect(storage.delete).toHaveBeenCalledTimes(DEVICE_CACHE_NAMES.length);
  });

  it("resolves quietly where Cache Storage does not exist", async () => {
    await expect(clearDeviceCaches(undefined)).resolves.toBeUndefined();
  });

  it("uses the browser's CacheStorage by default", async () => {
    const storage = fakeStorage(["pages", "others", "sb-api"]);
    vi.stubGlobal("caches", storage);
    try {
      await clearDeviceCaches();
      expect(storage.keys()).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

interface FakeDatabaseOptions {
  /** False: opening creates the database (an `upgradeneeded` event), as it does for a name that was never used. */
  exists?: boolean;
  /** The object stores and how many rows each holds. */
  stores?: Record<string, number>;
  /** How many `open` calls fail before one succeeds. */
  failOpens?: number;
  /** The clearing transaction aborts. */
  failTransaction?: boolean;
}

type Handler = (() => void) | null;

/**
 * An IDBFactory with one database, `serwist-expiration`: just enough of `open`, `transaction`, `objectStore().clear()`
 * and `close()` for clearExpirationMetadata, settling its requests in a microtask like the browser does.
 */
function fakeIndexedDb(options: FakeDatabaseOptions = {}) {
  const { exists = true, stores = { "cache-entries": 3 }, failOpens = 0 } = options;
  const rows: Record<string, number> = { ...stores };
  const log = { created: false, aborted: false, closed: 0, transactions: [] as { names: string[]; mode: string }[] };
  let remainingFailures = failOpens;

  const database = {
    objectStoreNames: Object.keys(rows),
    close: () => {
      log.closed += 1;
    },
    transaction: (names: string[], mode: string) => {
      log.transactions.push({ names: [...names], mode });
      const transaction: { oncomplete: Handler; onerror: Handler; onabort: Handler; error: DOMException | null; objectStore: (name: string) => { clear: () => object } } = {
        oncomplete: null,
        onerror: null,
        onabort: null,
        error: null,
        objectStore: (name) => ({
          clear: () => {
            if (options.failTransaction !== true) rows[name] = 0;
            return {};
          },
        }),
      };
      queueMicrotask(() => {
        if (options.failTransaction === true) {
          transaction.error = new DOMException("quota", "QuotaExceededError");
          transaction.onabort?.();
        } else {
          transaction.oncomplete?.();
        }
      });
      return transaction;
    },
  };

  const factory = {
    open: vi.fn((name: string) => {
      expect(name).toBe("serwist-expiration");
      const request: { onsuccess: Handler; onerror: Handler; onupgradeneeded: Handler; result: typeof database; error: DOMException | null; transaction: { abort: () => void } } = {
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
        result: database,
        error: null,
        transaction: {
          abort: () => {
            log.aborted = true;
            queueMicrotask(() => {
              request.error = new DOMException("aborted", "AbortError");
              request.onerror?.();
            });
          },
        },
      };
      queueMicrotask(() => {
        if (remainingFailures > 0) {
          remainingFailures -= 1;
          request.error = new DOMException("denied", "UnknownError");
          request.onerror?.();
        } else if (!exists && !log.created) {
          log.created = true;
          request.onupgradeneeded?.();
        } else {
          request.onsuccess?.();
        }
      });
      return request as unknown as IDBOpenDBRequest;
    }),
  };
  return { factory, rows, log };
}

describe("clearExpirationMetadata", () => {
  it("empties every object store of Serwist's expiration database in one write transaction, and lets go of the connection", async () => {
    const { factory, rows, log } = fakeIndexedDb({ stores: { "cache-entries": 5, "something-new": 2 } });
    await expect(clearExpirationMetadata(factory)).resolves.toBe("cleared");
    expect(rows).toEqual({ "cache-entries": 0, "something-new": 0 });
    expect(log.transactions).toEqual([{ names: ["cache-entries", "something-new"], mode: "readwrite" }]);
    expect(log.closed).toBe(1);
  });

  it("completes while a service worker holds its own connection open: it never asks for the database to be deleted", async () => {
    // Serwist's worker opens this database on its first cached response and never closes it, so deleteDatabase would be
    // `blocked` until the browser stops the worker, and would leave a request in the queue that holds up the worker's
    // next open. Clearing the rows needs no cooperation from the worker: it completes when the transaction does.
    const { factory } = fakeIndexedDb();
    expect(Object.keys(factory)).toEqual(["open"]);
    await expect(clearExpirationMetadata(factory)).resolves.toBe("cleared");
  });

  it("does not create the database when it does not exist", async () => {
    const { factory, log } = fakeIndexedDb({ exists: false });
    await expect(clearExpirationMetadata(factory)).resolves.toBe("absent");
    expect(log.aborted).toBe(true);
    expect(log.transactions).toEqual([]);
  });

  it("resolves for a database with no object store", async () => {
    const { factory, log } = fakeIndexedDb({ stores: {} });
    await expect(clearExpirationMetadata(factory)).resolves.toBe("cleared");
    expect(log.transactions).toEqual([]);
    expect(log.closed).toBe(1);
  });

  it("tries once more when the first attempt fails", async () => {
    const { factory, rows } = fakeIndexedDb({ failOpens: 1 });
    await expect(clearExpirationMetadata(factory)).resolves.toBe("cleared");
    expect(factory.open).toHaveBeenCalledTimes(2);
    expect(rows).toEqual({ "cache-entries": 0 });
  });

  it("does not hide a failure: after the second attempt it rejects, because the data may still be there", async () => {
    const { factory, rows } = fakeIndexedDb({ failOpens: 2 });
    await expect(clearExpirationMetadata(factory)).rejects.toThrow("denied");
    expect(factory.open).toHaveBeenCalledTimes(2);
    expect(rows).toEqual({ "cache-entries": 3 });
  });

  it("rejects, and lets go of the connection each time, when the clearing transaction aborts", async () => {
    const { factory, log } = fakeIndexedDb({ failTransaction: true });
    await expect(clearExpirationMetadata(factory)).rejects.toThrow("quota");
    expect(log.closed).toBe(2);
  });

  it("rejects when the browser throws instead of answering (a SecurityError on a blocked origin)", async () => {
    const factory = {
      open: vi.fn(() => {
        throw new DOMException("blocked", "SecurityError");
      }),
    };
    await expect(clearExpirationMetadata(factory)).rejects.toThrow("blocked");
  });

  it("rejects with a real error when the browser reports a failure without one", async () => {
    const factory = {
      open: vi.fn(() => {
        const request: { onerror: Handler; error: null } = { onerror: null, error: null };
        queueMicrotask(() => request.onerror?.());
        return request as unknown as IDBOpenDBRequest;
      }),
    };
    await expect(clearExpirationMetadata(factory)).rejects.toBeInstanceOf(Error);
  });

  it("resolves quietly where IndexedDB does not exist", async () => {
    await expect(clearExpirationMetadata(undefined)).resolves.toBe("absent");
  });

  it("uses the browser's indexedDB by default", async () => {
    const { factory, rows } = fakeIndexedDb();
    vi.stubGlobal("indexedDB", factory);
    try {
      await expect(clearExpirationMetadata()).resolves.toBe("cleared");
      expect(rows).toEqual({ "cache-entries": 0 });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("names the database the installed Serwist writes its URL timestamps to", () => {
    // ExpirationPlugin keeps the URL and fetch time of every entry of every cache it expires, in this one database.
    // Clearing Cache Storage does not touch it, and a renamed database in a later Serwist would silently stop being
    // cleared: this fails first.
    expect(EXPIRATION_DB_NAME).toBe("serwist-expiration");
    expect(readFileSync(SERWIST_CORE, "utf8")).toContain(`const DB_NAME = "serwist-expiration";`);
  });

  it("pins why the page clears the rows itself: Serwist's own delete() empties one cache's rows, and its worker never closes the connection", () => {
    const source = readFileSync(SERWIST_CORE, "utf8");
    // `CacheExpiration.delete()` (what ExpirationPlugin.deleteCacheAndMetadata calls) only expires the rows of its own cache.
    expect(source).toContain("await this._timestampModel.expireEntries(Number.POSITIVE_INFINITY);");
    // And the worker's connection is cached and never closed, so a deleteDatabase from the page is blocked while it runs.
    expect(source).toContain("if (!this._db) this._db = await openDB(DB_NAME, 1,");
    expect(source).not.toContain("this._db.close()");
  });
});
