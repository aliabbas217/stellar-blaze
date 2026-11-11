import {
  API_CACHE_NAME,
  API_CACHE_NAMES,
  OFFLINE_API_ALLOW_LIST,
  clearApiCaches,
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
