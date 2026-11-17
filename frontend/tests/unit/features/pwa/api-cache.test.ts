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
  deviceDataRemains,
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

interface FakeRow {
  readonly id: string;
  readonly cacheName: string;
}

interface FakeDatabaseOptions {
  /** False: opening creates the database (an `upgradeneeded` event), as it does for a name that was never used. */
  exists?: boolean;
  /** The rows of Serwist's "cache-entries" store: the cache each belongs to and its key. */
  rows?: FakeRow[];
  /** The object stores the database has. */
  stores?: string[];
  /** Whether "cache-entries" has the "cacheName" index. */
  indexed?: boolean;
  /** How many `open` calls fail before one succeeds. */
  failOpens?: number;
  /** The clearing transaction aborts. */
  failTransaction?: boolean;
}

type Handler = (() => void) | null;

interface FakeRequest {
  result: unknown;
  error: DOMException | null;
  onsuccess: Handler;
  onerror: Handler;
}

const row = (cacheName: string, n: number): FakeRow => ({ id: `${cacheName}|https://app.example/${String(n)}`, cacheName });

/** One row for each cache Serwist's worker keeps, so that a clearing can be told from a wipe. */
const WORKER_ROWS: FakeRow[] = [
  row("sb-api", 1),
  row("sb-api", 2),
  row("apis", 1),
  row("pages", 1),
  row("pages-rsc", 1),
  row("pages-rsc-prefetch", 1),
  row("others", 1),
  row("others", 2),
  row("static-font-assets", 1),
  row("static-font-assets", 2),
  row("static-js-assets", 1),
];

/**
 * An IDBFactory with one database, `serwist-expiration`: its "cache-entries" store with a "cacheName" index, rows kept in
 * memory, and just enough of `open`, `transaction`, `index().openKeyCursor()`, `index().count()`, `delete()` and `close()`
 * for the module under test. Requests settle in microtasks, as the browser's do, and a transaction completes when its last
 * request has.
 */
function fakeIndexedDb(options: FakeDatabaseOptions = {}) {
  const { exists = true, stores = ["cache-entries"], indexed = true, failOpens = 0 } = options;
  const rows: FakeRow[] = [...(options.rows ?? WORKER_ROWS)];
  const log = {
    created: false,
    aborted: false,
    closed: 0,
    transactions: [] as { stores: string[]; mode: string; durability: string | undefined }[],
  };
  let remainingFailures = failOpens;

  function transaction(names: string | string[], mode: string, transactionOptions?: { durability?: string }) {
    const wanted = [names].flat();
    for (const name of wanted) if (!stores.includes(name)) throw new DOMException(`No object store ${name}`, "NotFoundError");
    log.transactions.push({ stores: wanted, mode, durability: transactionOptions?.durability });

    let pending = 0;
    let finished = false;
    let aborted = false;
    const handle: { oncomplete: Handler; onabort: Handler; onerror: Handler; error: DOMException | null } = {
      oncomplete: null,
      onabort: null,
      onerror: null,
      error: null,
    };
    const check = () => {
      queueMicrotask(() => {
        if (finished || aborted || pending > 0) return;
        finished = true;
        handle.oncomplete?.();
      });
    };
    const newRequest = (): FakeRequest => ({ result: undefined, error: null, onsuccess: null, onerror: null });
    /** A request that does `work` in a microtask and then counts as settled. */
    const settle = (work: (request: FakeRequest) => void) => {
      pending += 1;
      const request = newRequest();
      queueMicrotask(() => {
        if (aborted) return;
        work(request);
        request.onsuccess?.();
        pending -= 1;
        check();
      });
      return request;
    };

    if (options.failTransaction === true) {
      queueMicrotask(() => {
        aborted = true;
        handle.error = new DOMException("quota", "QuotaExceededError");
        handle.onabort?.();
      });
    }

    const index = (indexName: string) => {
      if (!indexed || indexName !== "cacheName") throw new DOMException(`No index ${indexName}`, "NotFoundError");
      return {
        count: (key: string) =>
          settle((request) => {
            request.result = rows.filter((candidate) => candidate.cacheName === key).length;
          }),
        openKeyCursor: (key: string) => {
          pending += 1;
          const request = newRequest();
          const matching = rows.filter((candidate) => candidate.cacheName === key).map((candidate) => candidate.id);
          const step = (at: number) => {
            if (aborted) return;
            if (at >= matching.length) {
              request.result = null;
              request.onsuccess?.();
              pending -= 1;
              check();
              return;
            }
            request.result = {
              primaryKey: matching[at],
              continue: () => {
                queueMicrotask(() => {
                  step(at + 1);
                });
              },
            };
            request.onsuccess?.();
          };
          queueMicrotask(() => {
            step(0);
          });
          return request;
        },
      };
    };

    const objectStore = () => ({
      index,
      delete: (id: string) =>
        settle(() => {
          const at = rows.findIndex((candidate) => candidate.id === id);
          if (at >= 0) rows.splice(at, 1);
        }),
    });

    return Object.assign(handle, { objectStore });
  }

  const database = {
    objectStoreNames: stores,
    close: () => {
      log.closed += 1;
    },
    transaction,
  };

  const factory = {
    open: vi.fn((name: string) => {
      expect(name).toBe("serwist-expiration");
      const request: FakeRequest & { onupgradeneeded: Handler; transaction: { abort: () => void } } = {
        result: database,
        error: null,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
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

const names = (rows: FakeRow[]) => rows.map((candidate) => candidate.cacheName);
const KEPT = ["static-font-assets", "static-font-assets", "static-js-assets"];

describe("clearExpirationMetadata", () => {
  it("deletes the rows of the caches revoke clears, by the cacheName index, and keeps the rows of the caches it keeps", async () => {
    // Static asset caches survive a revoke; their rows must too, or their entries would never expire.
    const { factory, rows, log } = fakeIndexedDb();
    await expect(clearExpirationMetadata(factory)).resolves.toBe("cleared");
    expect(names(rows)).toEqual(KEPT);
    expect(log.closed).toBe(1);
  });

  it("uses one strict-durability write transaction on the cache-entries store only", async () => {
    const { factory, log } = fakeIndexedDb();
    await clearExpirationMetadata(factory);
    expect(log.transactions).toEqual([{ stores: ["cache-entries"], mode: "readwrite", durability: "strict" }]);
  });

  it("completes while a service worker holds its own connection open: it never asks for the database to be deleted", async () => {
    // Serwist's worker opens this database on its first cached response and never closes it, so deleteDatabase would be
    // `blocked` until the browser stops the worker, and would leave a request in the queue that holds up the worker's
    // next open. Clearing rows needs no cooperation from the worker: it completes when the transaction does.
    const { factory } = fakeIndexedDb();
    expect(Object.keys(factory)).toEqual(["open"]);
    await expect(clearExpirationMetadata(factory)).resolves.toBe("cleared");
  });

  it("is a clean no-op when there is no row to delete", async () => {
    const { factory, rows } = fakeIndexedDb({ rows: [row("static-js-assets", 1)] });
    await expect(clearExpirationMetadata(factory)).resolves.toBe("cleared");
    expect(names(rows)).toEqual(["static-js-assets"]);
  });

  it("does not create the database when it does not exist", async () => {
    const { factory, log } = fakeIndexedDb({ exists: false });
    await expect(clearExpirationMetadata(factory)).resolves.toBe("absent");
    expect(log.aborted).toBe(true);
    expect(log.transactions).toEqual([]);
  });

  it("resolves for a database with no object store at all", async () => {
    const { factory, log } = fakeIndexedDb({ stores: [] });
    await expect(clearExpirationMetadata(factory)).resolves.toBe("cleared");
    expect(log.transactions).toEqual([]);
    expect(log.closed).toBe(1);
  });

  it("rejects, deleting nothing, when Serwist's store is not the one it knows (a changed Serwist is not guessed at)", async () => {
    const { factory, rows } = fakeIndexedDb({ stores: ["something-new"] });
    await expect(clearExpirationMetadata(factory)).rejects.toThrow(/cache-entries/);
    expect(rows).toHaveLength(WORKER_ROWS.length);
  });

  it("rejects, deleting nothing, when the store has no cacheName index", async () => {
    const { factory, rows } = fakeIndexedDb({ indexed: false });
    await expect(clearExpirationMetadata(factory)).rejects.toThrow(/index/);
    expect(rows).toHaveLength(WORKER_ROWS.length);
  });

  it("tries once more when the first attempt fails", async () => {
    const { factory, rows } = fakeIndexedDb({ failOpens: 1 });
    await expect(clearExpirationMetadata(factory)).resolves.toBe("cleared");
    expect(factory.open).toHaveBeenCalledTimes(2);
    expect(names(rows)).toEqual(KEPT);
  });

  it("does not hide a failure: after the second attempt it rejects, because the data may still be there", async () => {
    const { factory, rows } = fakeIndexedDb({ failOpens: 2 });
    await expect(clearExpirationMetadata(factory)).rejects.toThrow("denied");
    expect(factory.open).toHaveBeenCalledTimes(2);
    expect(rows).toHaveLength(WORKER_ROWS.length);
  });

  it("rejects, and lets go of the connection each time, when the clearing transaction aborts", async () => {
    const { factory, rows, log } = fakeIndexedDb({ failTransaction: true });
    await expect(clearExpirationMetadata(factory)).rejects.toThrow("quota");
    expect(log.closed).toBe(2);
    expect(rows).toHaveLength(WORKER_ROWS.length);
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
      expect(names(rows)).toEqual(KEPT);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("names the database, the store and the index the installed Serwist writes its URL timestamps to", () => {
    // ExpirationPlugin keeps the URL and fetch time of every entry of every cache it expires, in this one database.
    // Clearing Cache Storage does not touch it, and a renamed database, store or index in a later Serwist would silently
    // stop being cleared: this fails first.
    expect(EXPIRATION_DB_NAME).toBe("serwist-expiration");
    const source = readFileSync(SERWIST_CORE, "utf8");
    expect(source).toContain(`const DB_NAME = "serwist-expiration";`);
    expect(source).toContain(`const CACHE_OBJECT_STORE = "cache-entries";`);
    expect(source).toContain(`objStore.createIndex("cacheName", "cacheName", { unique: false });`);
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

describe("deviceDataRemains: what the verification after a clearing looks at", () => {
  const cachesWith = (...present: string[]) => ({ keys: () => Promise.resolve(present) });

  it("is true when a cache revoke clears exists again (a response written after the clearing)", async () => {
    const { factory } = fakeIndexedDb({ rows: [] });
    await expect(deviceDataRemains(cachesWith("serwist-precache-v2", "sb-api"), factory)).resolves.toBe(true);
  });

  it.each(DEVICE_CACHE_NAMES)("is true for the %s cache alone", async (name) => {
    const { factory } = fakeIndexedDb({ rows: [] });
    await expect(deviceDataRemains(cachesWith(name), factory)).resolves.toBe(true);
  });

  it("is true when an expiration row of one of those caches exists again, even with no cache", async () => {
    const { factory } = fakeIndexedDb({ rows: [row("sb-api", 1)] });
    await expect(deviceDataRemains(cachesWith(), factory)).resolves.toBe(true);
  });

  it("is false when only the caches and rows revoke keeps are left", async () => {
    const { factory, log } = fakeIndexedDb({ rows: [row("static-font-assets", 1), row("static-js-assets", 1)] });
    await expect(deviceDataRemains(cachesWith("serwist-precache-v2", "sb-prefs", "static-font-assets"), factory)).resolves.toBe(false);
    expect(log.transactions).toEqual([{ stores: ["cache-entries"], mode: "readonly", durability: undefined }]);
  });

  it("is false, without creating the database, when there is none", async () => {
    const { factory, log } = fakeIndexedDb({ exists: false });
    await expect(deviceDataRemains(cachesWith(), factory)).resolves.toBe(false);
    expect(log.aborted).toBe(true);
  });

  it("does not open the database at all when a cache already answers", async () => {
    const { factory } = fakeIndexedDb();
    await deviceDataRemains(cachesWith("pages"), factory);
    expect(factory.open).not.toHaveBeenCalled();
  });

  it("rejects when it cannot tell: not knowing is not 'cleared'", async () => {
    const { factory } = fakeIndexedDb({ failOpens: 1 });
    await expect(deviceDataRemains(cachesWith(), factory)).rejects.toThrow("denied");
    const broken = { keys: () => Promise.reject(new Error("storage unavailable")) };
    await expect(deviceDataRemains(broken, fakeIndexedDb().factory)).rejects.toThrow("storage unavailable");
  });

  it("is false where neither Cache Storage nor IndexedDB exists", async () => {
    await expect(deviceDataRemains(undefined, undefined)).resolves.toBe(false);
  });

  it("uses the browser's CacheStorage and indexedDB by default", async () => {
    const { factory } = fakeIndexedDb({ rows: [row("pages", 1)] });
    vi.stubGlobal("caches", cachesWith());
    vi.stubGlobal("indexedDB", factory);
    try {
      await expect(deviceDataRemains()).resolves.toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
