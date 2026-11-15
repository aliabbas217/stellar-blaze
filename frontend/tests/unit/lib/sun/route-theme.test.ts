import { sunScript } from "@/components/shell/theme-script";
import { applyRouteTheme, decideTheme, isFieldPath, setTheme } from "@/lib/sun/route-theme";
import { THEME_COLORS } from "@/lib/sun/theme-colors";
import { DEMO_STORAGE_KEY, THEME_STORAGE_KEY } from "@/lib/sun/theme-storage";

/*
 * Client navigation does not re-run the inline sun script (Task 1 finding), so the shells re-apply the theme with
 * this module. It is a second implementation of the script's decision, so the last block runs the real script and
 * this module over the same inputs and requires the same answer: a change to one that is not made to the other fails.
 */

const NOON_DUBAI = new Date("2026-09-03T08:00:00Z"); // 12:00 in the UAE: the sun is up
const MIDNIGHT_DUBAI = new Date("2026-09-03T20:00:00Z"); // 00:00 the next day: the sun is down

function meta(): HTMLMetaElement {
  const element = document.createElement("meta");
  element.name = "theme-color";
  element.content = THEME_COLORS.night;
  document.head.append(element);
  return element;
}

afterEach(() => {
  vi.doUnmock("@/lib/sun/solar");
  window.history.pushState({}, "", "/");
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  delete document.documentElement.dataset["theme"];
  document.head.querySelectorAll("meta[name=theme-color]").forEach((element) => {
    element.remove();
  });
});

describe("isFieldPath", () => {
  it.each(["/en/worker", "/ur/worker/alerts", "/en/supervisor", "/ar/supervisor/crews/crew-b", "/en/worker/"])(
    "%s is a field path",
    (path) => {
      expect(isFieldPath(path)).toBe(true);
    },
  );

  it.each(["/en", "/en/replay", "/en/replay/try", "/en/hse", "/en/workers", "/en/dev/worker", "/worker", "/en/supervisors"])(
    "%s is not",
    (path) => {
      expect(isFieldPath(path)).toBe(false);
    },
  );
});

describe("decideTheme", () => {
  const base = { override: null, contrastMore: false, demo: "replay", nowMs: NOON_DUBAI.getTime() } as const;

  it("an unexpired override wins over everything", () => {
    expect(decideTheme({ ...base, override: { theme: "night", until: base.nowMs + 1 }, contrastMore: true })).toBe("night");
    expect(decideTheme({ ...base, override: { theme: "sun", until: base.nowMs + 1 }, demo: "live" })).toBe("sun");
  });

  it("an expired override is ignored", () => {
    expect(decideTheme({ ...base, override: { theme: "night", until: base.nowMs } })).toBe("sun");
  });

  it("prefers-contrast: more means sun", () => {
    expect(decideTheme({ ...base, contrastMore: true, demo: "live" })).toBe("sun");
  });

  it("replay is daytime by construction: sun", () => {
    expect(decideTheme({ ...base, nowMs: MIDNIGHT_DUBAI.getTime() })).toBe("sun");
  });

  it("live asks the sun: the caller must supply the elevation", () => {
    expect(decideTheme({ ...base, demo: "live" })).toBe("solar");
  });
});

describe("setTheme", () => {
  it("sets data-theme and the browser chrome colour for sun, removes both for night", () => {
    const chrome = meta();
    setTheme("sun");
    expect(document.documentElement.dataset["theme"]).toBe("sun");
    expect(chrome.content).toBe(THEME_COLORS.sun);

    setTheme("night");
    expect(document.documentElement.dataset["theme"]).toBeUndefined();
    expect(chrome.content).toBe(THEME_COLORS.night);
  });

  it("returns whether anything changed", () => {
    meta();
    expect(setTheme("night")).toBe(false);
    expect(setTheme("sun")).toBe(true);
    expect(setTheme("sun")).toBe(false);
  });
});

describe("applyRouteTheme", () => {
  it("night on a path that is not a field path, even when sun was set before (field to desk on a client navigation)", async () => {
    const chrome = meta();
    setTheme("sun");

    await applyRouteTheme("/en/replay");

    expect(document.documentElement.dataset["theme"]).toBeUndefined();
    expect(chrome.content).toBe(THEME_COLORS.night);
  });

  it("sun on a field path in replay mode (desk to field on a client navigation)", async () => {
    const chrome = meta();

    await applyRouteTheme("/en/worker");

    expect(document.documentElement.dataset["theme"]).toBe("sun");
    expect(chrome.content).toBe(THEME_COLORS.sun);
  });

  it("honours the stored override on the way back to a field route", async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify({ theme: "night", until: Date.now() + 60_000 }));
    meta();

    await applyRouteTheme("/en/supervisor");

    expect(document.documentElement.dataset["theme"]).toBeUndefined();
  });

  it("live mode follows the sun at the UAE centroid", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    window.localStorage.setItem(DEMO_STORAGE_KEY, "live");
    meta();
    window.history.pushState({}, "", "/en/worker");

    vi.setSystemTime(NOON_DUBAI);
    await applyRouteTheme("/en/worker");
    expect(document.documentElement.dataset["theme"]).toBe("sun");

    vi.setSystemTime(MIDNIGHT_DUBAI);
    await applyRouteTheme("/en/worker");
    expect(document.documentElement.dataset["theme"]).toBeUndefined();
  });

  it("a navigation to a desk page while the solar module loads wins: sun is never left on a night-only page (live mode)", async () => {
    // The solar function is a dynamic import in live mode, so a field-to-desk navigation can land inside that window.
    vi.resetModules();
    let release: () => void = () => undefined;
    const loaded = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.doMock("@/lib/sun/solar", async () => {
      await loaded;
      return { solarElevationDeg: () => 40, UAE_CENTROID: { lat: 24.4, lon: 54.4 } };
    });
    window.localStorage.setItem(DEMO_STORAGE_KEY, "live");
    const chrome = meta();
    window.history.pushState({}, "", "/en/worker");

    const pending = applyRouteTheme("/en/worker");
    // The visitor leaves for a judge page; the desk shell has already put night on <html>.
    window.history.pushState({}, "", "/en/replay");
    setTheme("night");
    release();
    await pending;

    expect(document.documentElement.dataset["theme"]).toBeUndefined();
    expect(chrome.content).toBe(THEME_COLORS.night);
  });

  it("returns the theme it applied, and survives blocked storage", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    meta();
    await expect(applyRouteTheme("/en/worker")).resolves.toBe("sun");
  });
});

/**
 * Runs the real inline script, the repository's own string, in the test's realm. Not as a <script> element: jsdom would run
 * it in the window's separate realm, where the fake timers do not reach and `Date.now()` would be the real one.
 */
function runInlineScript(): void {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- the string is src/components/shell/theme-script.ts, not input
  const run = new Function(sunScript) as () => void;
  run();
}

describe("parity with the inline sun script", () => {
  interface Case {
    readonly name: string;
    readonly storage: Record<string, string>;
    readonly contrastMore: boolean;
    readonly now: Date;
  }

  const future = (now: Date): number => now.getTime() + 3_600_000;
  const past = (now: Date): number => now.getTime() - 1;

  const cases: Case[] = [];
  for (const now of [NOON_DUBAI, MIDNIGHT_DUBAI]) {
    const when = now === NOON_DUBAI ? "noon" : "midnight";
    for (const contrastMore of [false, true]) {
      for (const demo of [undefined, "replay", "live"]) {
        for (const override of [undefined, "sun-live", "night-live", "sun-expired", "night-expired", "garbage"]) {
          const storage: Record<string, string> = {};
          if (demo !== undefined) storage[DEMO_STORAGE_KEY] = demo;
          if (override === "sun-live") storage[THEME_STORAGE_KEY] = JSON.stringify({ theme: "sun", until: future(now) });
          if (override === "night-live") storage[THEME_STORAGE_KEY] = JSON.stringify({ theme: "night", until: future(now) });
          if (override === "sun-expired") storage[THEME_STORAGE_KEY] = JSON.stringify({ theme: "sun", until: past(now) });
          if (override === "night-expired") storage[THEME_STORAGE_KEY] = JSON.stringify({ theme: "night", until: past(now) });
          if (override === "garbage") storage[THEME_STORAGE_KEY] = "{not json";
          cases.push({
            name: `${when}, contrast ${String(contrastMore)}, demo ${String(demo)}, override ${String(override)}`,
            storage,
            contrastMore,
            now,
          });
        }
      }
    }
  }

  function stubContrast(contrastMore: boolean): void {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: contrastMore && query === "(prefers-contrast: more)", media: query }));
  }

  it("covers the whole matrix", () => {
    expect(cases).toHaveLength(2 * 2 * 3 * 6);
  });

  it.each(cases)("$name", async ({ storage, contrastMore, now }) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    stubContrast(contrastMore);
    window.history.pushState({}, "", "/en/worker");
    for (const [key, value] of Object.entries(storage)) window.localStorage.setItem(key, value);

    delete document.documentElement.dataset["theme"];
    runInlineScript();
    const fromScript = document.documentElement.dataset["theme"] === "sun" ? "sun" : "night";

    delete document.documentElement.dataset["theme"];
    const fromModule = await applyRouteTheme("/en/worker");

    expect(fromModule).toBe(fromScript);
  });
});
