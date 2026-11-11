import { THEME_STORAGE_KEY, themeScript } from "@/components/shell/theme-script";

/*
 * The script runs inline in <head> before first paint, so it is exercised here exactly as the browser
 * runs it: as an inline <script> element added to the (jsdom) document, against its real localStorage.
 * An uncaught error inside an inline script surfaces as a window "error" event, so those are collected.
 */

const uncaught: ErrorEvent[] = [];
const collect = (event: ErrorEvent): void => {
  uncaught.push(event);
};

function runThemeScript(): void {
  const script = document.createElement("script");
  script.textContent = themeScript;
  document.head.append(script);
  script.remove();
}

beforeEach(() => {
  uncaught.length = 0;
  window.addEventListener("error", collect);
});

afterEach(() => {
  window.removeEventListener("error", collect);
  vi.restoreAllMocks();
  window.localStorage.clear();
  delete document.documentElement.dataset["theme"];
});

describe("theme script", () => {
  it("uses the documented storage key", () => {
    expect(THEME_STORAGE_KEY).toBe("sb-theme");
  });

  it.each(["light", "dark"] as const)("applies a stored %s override", (choice) => {
    window.localStorage.setItem(THEME_STORAGE_KEY, choice);
    runThemeScript();
    expect(document.documentElement.dataset["theme"]).toBe(choice);
  });

  it.each([null, "system", "", "Dark", "purple", "<script>"])(
    "leaves the system default alone for %j",
    (stored) => {
      if (stored !== null) window.localStorage.setItem(THEME_STORAGE_KEY, stored);
      runThemeScript();
      expect(document.documentElement.dataset["theme"]).toBeUndefined();
    },
  );

  it("does not throw when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    runThemeScript();
    expect(uncaught).toEqual([]);
    expect(document.documentElement.dataset["theme"]).toBeUndefined();
  });

  it("really ran the script (a guard against a vacuous pass)", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    runThemeScript();
    expect(uncaught).toEqual([]);
    expect(document.documentElement.dataset["theme"]).toBe("dark");
  });
});
