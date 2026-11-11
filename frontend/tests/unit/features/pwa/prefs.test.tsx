import { render, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "../../../../messages/en.json";
import { LocalePrefs } from "@/features/pwa/LocalePrefs";
import { PREFS_CACHE_NAME, PREFS_PATH, readLocalePref, writeLocalePref, type PrefsStorage } from "@/features/pwa/prefs";

/*
 * The locale handoff between the page and the service worker. The worker cannot read localStorage or ask the page, and
 * a push can arrive with no page open, so the page leaves the locale in Cache Storage on every render.
 */

/** An in-memory Cache Storage: the caches by name, each a map from key to the response put under it. */
function memoryStorage(): PrefsStorage & { names: () => string[]; keys: (name: string) => string[] } {
  const caches = new Map<string, Map<string, Response>>();
  return {
    open: (name) => {
      const entries = caches.get(name) ?? new Map<string, Response>();
      caches.set(name, entries);
      return Promise.resolve({
        put: (request, response) => {
          entries.set(request, response);
          return Promise.resolve();
        },
        match: (request) => Promise.resolve(entries.get(request)?.clone()),
      });
    },
    names: () => [...caches.keys()],
    keys: (name) => [...(caches.get(name)?.keys() ?? [])],
  };
}

describe("writeLocalePref and readLocalePref", () => {
  it("round-trips the locale through the sb-prefs cache at /__sb/prefs", async () => {
    const storage = memoryStorage();

    await writeLocalePref("ur", storage);

    expect(storage.names()).toEqual([PREFS_CACHE_NAME]);
    expect(storage.keys(PREFS_CACHE_NAME)).toEqual([PREFS_PATH]);
    expect(await readLocalePref(storage)).toBe("ur");
  });

  it("uses the names the plan fixes: cache sb-prefs, key /__sb/prefs", () => {
    expect(PREFS_CACHE_NAME).toBe("sb-prefs");
    expect(PREFS_PATH).toBe("/__sb/prefs");
  });

  it("keeps the latest locale when the worker switches language", async () => {
    const storage = memoryStorage();
    await writeLocalePref("ur", storage);
    await writeLocalePref("hi", storage);
    expect(await readLocalePref(storage)).toBe("hi");
  });

  it("defaults to en when nothing was ever stored", async () => {
    expect(await readLocalePref(memoryStorage())).toBe("en");
  });

  it("defaults to en when there is no Cache Storage at all", async () => {
    expect(await readLocalePref(undefined)).toBe("en");
  });

  it("defaults to en when the stored value is not a locale object, and never rejects", async () => {
    for (const body of ["not json", "[]", "null", '{"locale":7}', "{}"]) {
      const storage: PrefsStorage = {
        open: () => Promise.resolve({ put: () => Promise.resolve(), match: () => Promise.resolve(new Response(body)) }),
      };
      expect(await readLocalePref(storage), body).toBe("en");
    }
  });

  it("defaults to en when Cache Storage throws, because a notification must still show", async () => {
    const storage: PrefsStorage = { open: () => Promise.reject(new Error("blocked")) };
    expect(await readLocalePref(storage)).toBe("en");
  });

  it("rejects a write that fails, so the caller can decide (the page ignores it)", async () => {
    const storage: PrefsStorage = { open: () => Promise.reject(new Error("blocked")) };
    await expect(writeLocalePref("ur", storage)).rejects.toThrow("blocked");
  });

  it("does nothing, without error, where Cache Storage does not exist", async () => {
    await expect(writeLocalePref("ur", undefined)).resolves.toBeUndefined();
  });
});

describe("LocalePrefs", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("writes the rendered locale to the worker's cache and renders nothing", async () => {
    const storage = memoryStorage();
    vi.stubGlobal("caches", storage);

    const { container } = render(
      <NextIntlClientProvider locale="ur" messages={enMessages}>
        <LocalePrefs />
      </NextIntlClientProvider>,
    );

    await waitFor(async () => {
      expect(await readLocalePref(storage)).toBe("ur");
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("does not throw when Cache Storage refuses the write", async () => {
    const open = vi.fn(() => Promise.reject(new Error("blocked")));
    vi.stubGlobal("caches", { open });

    render(
      <NextIntlClientProvider locale="ar" messages={enMessages}>
        <LocalePrefs />
      </NextIntlClientProvider>,
    );

    await waitFor(() => {
      expect(open).toHaveBeenCalled();
    });
  });
});
