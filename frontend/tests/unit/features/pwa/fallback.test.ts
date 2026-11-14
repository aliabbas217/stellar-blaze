import { OFFLINE_URLS, PRECACHE_URLS, UNWELL_URLS, fallbackUrlFor, offlineFallbacks, offlineUrl, unwellUrl } from "@/features/pwa/fallback";
import { routing, type Locale } from "@/i18n/routing";

/*
 * The offline fallback decides which language a worker sees when the network is gone. A wrong answer
 * here sends an Urdu or Arabic reader to an English page (review focus 2), so the mapping is pinned for every
 * locale and for the paths that must NOT be read as a locale.
 */

const LOCALES: readonly Locale[] = routing.locales;

describe("fallbackUrlFor", () => {
  it.each([
    ["/ur/worker", "/ur/offline"],
    ["/ar/supervisor", "/ar/offline"],
    ["/hi/worker/alerts", "/hi/offline"],
    ["/xx/foo", "/en/offline"],
    ["/", "/en/offline"],
    ["", "/en/offline"],
  ])("%j -> %s", (pathname, expected) => {
    expect(fallbackUrlFor(pathname)).toBe(expected);
  });

  it.each(LOCALES)("keeps the locale of %s for its root, with and without the trailing slash", (locale) => {
    expect(fallbackUrlFor(`/${locale}`)).toBe(`/${locale}/offline`);
    expect(fallbackUrlFor(`/${locale}/`)).toBe(`/${locale}/offline`);
  });

  it.each(LOCALES)("answers in %s for the offline page itself", (locale) => {
    expect(fallbackUrlFor(`/${locale}/offline`)).toBe(`/${locale}/offline`);
  });

  it.each(["/urdu/worker", "/uru", "/enx/worker", "/UR/worker", "/Ur/worker", "/ur.json", "/worker/ur"])(
    "does not read %j as a locale (the first segment must equal one exactly, in lower case)",
    (pathname) => {
      expect(fallbackUrlFor(pathname)).toBe("/en/offline");
    },
  );
});

describe("OFFLINE_URLS", () => {
  it("has one offline page per routing locale, each once", () => {
    expect([...OFFLINE_URLS].sort()).toEqual(LOCALES.map((locale) => offlineUrl(locale)).sort());
    expect(new Set(OFFLINE_URLS).size).toBe(LOCALES.length);
  });
});

describe("the unwell call sheet in the precache (F2 Task 18, safety)", () => {
  it("test_unwell_precached_for_every_locale: /<locale>/worker/unwell, once each, for every routing locale", () => {
    expect([...UNWELL_URLS].sort()).toEqual(LOCALES.map((locale) => `/${locale}/worker/unwell`).sort());
    expect(new Set(UNWELL_URLS).size).toBe(LOCALES.length);
    for (const locale of LOCALES) {
      expect(unwellUrl(locale)).toBe(`/${locale}/worker/unwell`);
      expect(PRECACHE_URLS).toContain(unwellUrl(locale));
    }
  });

  it("the precache is the offline pages plus the sheets and nothing else (no personal or employer route)", () => {
    expect([...PRECACHE_URLS].sort()).toEqual([...OFFLINE_URLS, ...UNWELL_URLS].sort());
    expect(new Set(PRECACHE_URLS).size).toBe(PRECACHE_URLS.length);
    for (const url of PRECACHE_URLS) expect(url).not.toMatch(/api|supervisor|day-plan|stop|sign-off/);
  });

  it("leaves the offline fallback entries alone: still one per locale, only offline pages", () => {
    expect(offlineFallbacks().map((entry) => entry.url).sort()).toEqual([...OFFLINE_URLS].sort());
  });
});

describe("offlineFallbacks (the entries handed to Serwist)", () => {
  const fallbacks = offlineFallbacks();

  /** The URL of the first entry whose matcher accepts the request, which is how PrecacheFallbackPlugin picks one. */
  function chosen(destination: string, pathname: string): string | undefined {
    const request = { destination, url: `https://worker.example${pathname}` } as Request;
    return fallbacks.find((entry) => entry.matcher({ request }))?.url;
  }

  it("has an entry for every precached offline page and no other URL", () => {
    expect(fallbacks.map((entry) => entry.url).sort()).toEqual([...OFFLINE_URLS].sort());
  });

  it.each(LOCALES)("answers a document request under /%s/ with /%s/offline", (locale) => {
    expect(chosen("document", `/${locale}/supervisor`)).toBe(`/${locale}/offline`);
  });

  it("answers a document request with no known locale with /en/offline", () => {
    expect(chosen("document", "/")).toBe("/en/offline");
    expect(chosen("document", "/xx/foo")).toBe("/en/offline");
  });

  it("agrees with fallbackUrlFor on every path", () => {
    for (const pathname of ["/ur/worker", "/ar", "/", "/xx/a", "/bn/hse", "/ne/worker/alerts"]) {
      expect(chosen("document", pathname)).toBe(fallbackUrlFor(pathname));
    }
  });

  it.each(["", "image", "script", "style", "font", "iframe", "worker"])(
    "never answers a %j request with an HTML page (the caller expects JSON, an image or a script)",
    (destination) => {
      expect(chosen(destination, "/ur/api/v1/sites")).toBeUndefined();
      expect(chosen(destination, "/en/worker")).toBeUndefined();
    },
  );
});
