import { sunScript } from "@/components/shell/theme-script";
import { solarElevationDeg, UAE_CENTROID } from "@/lib/sun/solar";
import { THEME_COLORS } from "@/lib/sun/theme-colors";
import { DEMO_STORAGE_KEY, THEME_STORAGE_KEY } from "@/lib/sun/theme-storage";

/*
 * solarElevationDeg is the "is the sun up at the site" decision of sun mode (DESIGN.md section 6). The expected
 * signs below come from the published Abu Dhabi day length (about 06:30 to 17:25 local in mid November,
 * about 05:55 to 18:50 in early September), so each probe sits at least half an hour from the horizon.
 */

describe("solarElevationDeg", () => {
  const at = (iso: string) => solarElevationDeg(UAE_CENTROID.lat, UAE_CENTROID.lon, new Date(iso));

  it("is the UAE centroid from the journeys document", () => {
    expect(UAE_CENTROID).toEqual({ lat: 24.4, lon: 54.4 });
  });

  it("is above the horizon at 11:10 GST on the replay-season day (2026-09-03T07:10Z)", () => {
    expect(at("2026-09-03T07:10:00Z")).toBeGreaterThan(60);
  });

  it("is below the horizon at 19:00 GST on 14 November (2026-11-14T15:00Z)", () => {
    expect(at("2026-11-14T15:00:00Z")).toBeLessThan(0);
  });

  it.each([
    ["2026-11-14T02:00:00Z", "06:00 GST in November, before sunrise", -1],
    ["2026-11-14T03:30:00Z", "07:30 GST in November, after sunrise", 1],
    ["2026-11-14T13:00:00Z", "17:00 GST in November, before sunset", 1],
    ["2026-11-14T14:15:00Z", "18:15 GST in November, after sunset", -1],
    ["2026-09-03T14:00:00Z", "18:00 GST in early September, before sunset", 1],
    ["2026-09-03T15:30:00Z", "19:30 GST in early September, after sunset", -1],
    ["2026-09-03T00:00:00Z", "04:00 GST, deep night", -1],
  ] as const)("has the right sign at %s (%s)", (iso, _label, sign) => {
    expect(Math.sign(at(iso))).toBe(sign);
  });

  it("peaks near local solar noon at about 90 minus the declination offset (June solstice: about 89 degrees)", () => {
    // Solar noon at 54.4 E is about 08:22Z; June 21 declination is +23.44, latitude 24.4: elevation about 89.
    const noon = at("2026-06-21T08:22:00Z");
    expect(noon).toBeGreaterThan(87);
    expect(noon).toBeLessThanOrEqual(90);
  });

  it("is about 42 degrees at noon on the December solstice", () => {
    // 90 - (24.4 + 23.44) = 42.16
    expect(at("2026-12-21T08:22:00Z")).toBeCloseTo(42.2, 0);
  });

  it("depends on the longitude: the same instant is higher in the east of the country than in the west", () => {
    const instant = new Date("2026-11-14T13:20:00Z");
    expect(solarElevationDeg(24.4, 56.4, instant)).toBeLessThan(solarElevationDeg(24.4, 51.6, instant));
  });
});

// ---------- the inline script ----------

/**
 * Runs the script's source with an indirect eval in the test realm. A real inline <script> would run in jsdom's own
 * realm, where vitest's fake Date does not reach; the document, location and localStorage it touches are the same
 * objects in both. The script catches everything itself, so an exception out of here is a bug in it.
 */
function run(): void {
  (0, eval)(sunScript);
}

function visit(pathname: string): void {
  window.history.replaceState(null, "", pathname);
}

function setOverride(theme: "sun" | "night", untilMs: number): void {
  window.localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify({ theme, until: untilMs }));
}

function stubContrastMore(matches: boolean): void {
  vi.stubGlobal(
    "matchMedia",
    (query: string) => ({ matches: matches && query === "(prefers-contrast: more)", media: query }) as MediaQueryList,
  );
}

const html = () => document.documentElement.dataset["theme"];
const NIGHT_INSTANT = "2026-11-14T15:00:00Z"; // 19:00 GST, sun below the horizon
const DAY_INSTANT = "2026-11-14T08:00:00Z"; // 12:00 GST, sun above the horizon
const HOUR = 3_600_000;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(DAY_INSTANT));
  const meta = document.createElement("meta");
  meta.name = "theme-color";
  meta.content = THEME_COLORS.night;
  document.head.append(meta);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
  delete document.documentElement.dataset["theme"];
  document.head.querySelectorAll("meta[name=theme-color]").forEach((m) => {
    m.remove();
  });
  visit("/");
});

describe("sunScript", () => {
  it("uses the documented storage keys", () => {
    expect(THEME_STORAGE_KEY).toBe("sb-theme");
    expect(DEMO_STORAGE_KEY).toBe("sb-demo");
  });

  it("sets sun on /en/worker (replay mode, the default, assumes the replay moment is daytime)", () => {
    vi.setSystemTime(new Date(NIGHT_INSTANT)); // even with the real clock after sunset
    visit("/en/worker");
    run();
    expect(html()).toBe("sun");
  });

  it.each(["/en/worker", "/ur/worker/alerts", "/ar/supervisor", "/hi/supervisor/crews"])(
    "sets sun on the field path %s",
    (pathname) => {
      visit(pathname);
      run();
      expect(html()).toBe("sun");
    },
  );

  it.each(["/en/replay", "/en", "/en/hse", "/en/workshop", "/en/dev/specimen", "/worker", "/en/x/worker"])(
    "does not set it on the desk or unrelated path %s",
    (pathname) => {
      visit(pathname);
      run();
      expect(html()).toBeUndefined();
    },
  );

  it("never sets it on a desk path, even with an unexpired sun override", () => {
    visit("/en/replay");
    setOverride("sun", Date.now() + HOUR);
    run();
    expect(html()).toBeUndefined();
  });

  describe("live mode (sb-demo = live): the sun's elevation decides", () => {
    beforeEach(() => {
      window.localStorage.setItem(DEMO_STORAGE_KEY, "live");
      visit("/en/worker");
    });

    it("sets sun while the sun is above the horizon at the UAE centroid", () => {
      vi.setSystemTime(new Date(DAY_INSTANT));
      run();
      expect(html()).toBe("sun");
    });

    it("leaves night after sunset", () => {
      vi.setSystemTime(new Date(NIGHT_INSTANT));
      run();
      expect(html()).toBeUndefined();
    });

    it("sets sun under prefers-contrast: more even after sunset", () => {
      vi.setSystemTime(new Date(NIGHT_INSTANT));
      stubContrastMore(true);
      run();
      expect(html()).toBe("sun");
    });

    it("stays night after sunset when prefers-contrast is not more", () => {
      vi.setSystemTime(new Date(NIGHT_INSTANT));
      stubContrastMore(false);
      run();
      expect(html()).toBeUndefined();
    });
  });

  describe("the override { theme, until }", () => {
    beforeEach(() => {
      visit("/en/worker");
    });

    it("honours an unexpired sun override in live mode after sunset", () => {
      window.localStorage.setItem(DEMO_STORAGE_KEY, "live");
      vi.setSystemTime(new Date(NIGHT_INSTANT));
      setOverride("sun", Date.now() + HOUR);
      run();
      expect(html()).toBe("sun");
    });

    it("honours an unexpired night override in replay mode (where the default would be sun)", () => {
      setOverride("night", Date.now() + HOUR);
      run();
      expect(html()).toBeUndefined();
    });

    it("honours an unexpired night override even under prefers-contrast: more", () => {
      setOverride("night", Date.now() + HOUR);
      stubContrastMore(true);
      run();
      expect(html()).toBeUndefined();
    });

    it("ignores an expired night override: the replay default (sun) applies again", () => {
      setOverride("night", Date.now() - 1);
      run();
      expect(html()).toBe("sun");
    });

    it("ignores an expired sun override: live mode after sunset is night again", () => {
      window.localStorage.setItem(DEMO_STORAGE_KEY, "live");
      vi.setSystemTime(new Date(NIGHT_INSTANT));
      setOverride("sun", Date.now() - 1);
      run();
      expect(html()).toBeUndefined();
    });

    it.each([
      "not json",
      "{}",
      '{"theme":"purple","until":9999999999999}',
      '{"theme":"sun"}',
      '{"theme":"sun","until":"tomorrow"}',
      "null",
      "42",
    ])("ignores the malformed override %j", (stored) => {
      window.localStorage.setItem(THEME_STORAGE_KEY, stored);
      window.localStorage.setItem(DEMO_STORAGE_KEY, "live");
      vi.setSystemTime(new Date(NIGHT_INSTANT));
      run();
      expect(html()).toBeUndefined();
    });
  });

  describe("the browser chrome colour", () => {
    const themeColor = () => document.head.querySelector<HTMLMetaElement>("meta[name=theme-color]")?.content;

    it("follows sun when the script sets it", () => {
      visit("/en/worker");
      run();
      expect(themeColor()).toBe(THEME_COLORS.sun);
    });

    it("stays the night colour when it does not", () => {
      visit("/en/replay");
      run();
      expect(themeColor()).toBe(THEME_COLORS.night);
    });
  });

  it("does not throw when storage is unavailable, and falls back to the replay default (sun)", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    visit("/en/worker");
    run();
    expect(html()).toBe("sun");
  });

  it("really ran the script (a guard against a vacuous pass)", () => {
    visit("/en/worker");
    run();
    expect(html()).toBe("sun");
  });
});
