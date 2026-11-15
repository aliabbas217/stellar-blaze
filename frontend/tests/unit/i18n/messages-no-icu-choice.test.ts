import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/*
 * Guard for next.config.ts `messages.precompile` (next-intl `experimental.messages.precompile`, F2 Part 0): the ICU parser is
 * compiled out of the client, which took 9.3 KB gzip off every route. The option is experimental, and the whole suite of
 * messages in use today is plain interpolation (`{name}`) and rich tags (`<bdi>{x}</bdi>`); nobody has run a `plural`, `select` or
 * `selectordinal` through the precompiled path in a production build. If one is added without that proof it could render wrong
 * (or not at all) only in the built app, where unit tests do not look.
 *
 * So this test fails when a catalogue introduces an ICU choice (plural, select, selectordinal) that is not listed below, and a
 * key is listed only together with an e2e on the PRODUCTION build that renders it in a locale with more than one plural form
 * (Arabic and Urdu have them). Listing a key here without that e2e defeats the guard: say which spec covers it.
 */

/** Message key (dotted path) -> the e2e spec that renders it on the precompiled path. Empty on purpose. */
const COVERED_BY_E2E: Readonly<Record<string, string>> = {};

const CHOICE = /\{\s*[A-Za-z_][\w]*\s*,\s*(plural|select|selectordinal)\s*,/;

function walk(node: unknown, path: string, found: { path: string; text: string }[]): void {
  if (typeof node === "string") {
    if (CHOICE.test(node)) found.push({ path, text: node });
    return;
  }
  if (typeof node === "object" && node !== null) {
    for (const [key, value] of Object.entries(node)) walk(value, path === "" ? key : `${path}.${key}`, found);
  }
}

const DIR = join(process.cwd(), "messages");
const FILES = readdirSync(DIR).filter((name) => name.endsWith(".json"));

describe("messages carry no ICU plural or select outside the e2e-covered list (precompile is experimental)", () => {
  it("the catalogues are found", () => {
    expect(FILES.length).toBeGreaterThanOrEqual(6);
  });

  it.each(FILES)("%s has no uncovered plural, select or selectordinal", (file) => {
    const found: { path: string; text: string }[] = [];
    walk(JSON.parse(readFileSync(join(DIR, file), "utf8")) as unknown, "", found);
    const uncovered = found.filter(({ path }) => !(path in COVERED_BY_E2E));
    expect(
      uncovered,
      `${file}: next-intl's precompiled messages are experimental; add an e2e on the production build for each of these keys, then list it in COVERED_BY_E2E`,
    ).toEqual([]);
  });

  it("the detector itself sees a plural, a select and a selectordinal (so an empty result means something)", () => {
    for (const text of ["{n, plural, one {# day} other {# days}}", "{ gender , select, male {he} other {they}}", "{n, selectordinal, one {#st} other {#th}}"]) {
      expect(CHOICE.test(text), text).toBe(true);
    }
    for (const text of ["Work {work} min, rest {rest} min in shade", "until <bdi>{time}</bdi>"]) expect(CHOICE.test(text), text).toBe(false);
  });
});
