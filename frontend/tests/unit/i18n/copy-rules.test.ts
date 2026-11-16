import { readFileSync } from "node:fs";
import path from "node:path";
import { LOCALES, flatten, placeholders, richTags, choiceShape } from "../../../scripts/i18n-sync.mjs";

/*
 * F2 Task 22: the copy rules of the plan, asserted on the whole catalogue of every locale (every string in messages/*.json is visible
 * copy somewhere; the data keys that are not copy live in code, never here). The same three patterns run in the browser on the
 * rendered page of each view (tests/e2e/gate.ts, the "copy" check), so a string composed at run time is covered there.
 *
 *  - no em dash and no en dash (US copy rule; the other five languages do not use them either)
 *  - no `ADR \d`, `HANDOFF`, `B1`, `B2`, `B3` jargon in product copy (critique fix 10)
 *  - Western digits only, in every locale: times, temperatures and levels never switch script
 *  - the same ICU arguments, rich tags and choice structure in every locale as in en, key by key
 */

const MESSAGES = path.resolve(import.meta.dirname, "../../../messages");
const load = (locale: string): Map<string, string> => flatten(JSON.parse(readFileSync(path.join(MESSAGES, `${locale}.json`), "utf8")));
const catalogues = Object.fromEntries(LOCALES.map((locale) => [locale, load(locale)]));
const en = catalogues["en"] as Map<string, string>;

const DASH = /[–—]/;
const JARGON = /ADR \d|HANDOFF|\bB[123]\b/;
// Arabic-Indic, Extended Arabic-Indic (Urdu), Devanagari and Bengali digit blocks.
const NON_WESTERN_DIGIT = /[٠-٩۰-۹०-९০-৯]/;

describe.each(LOCALES)("copy rules: %s", (locale) => {
  const flat = catalogues[locale] as Map<string, string>;

  it("test_en_copy_rules: no em or en dash, no ADR, HANDOFF or B1-B3 jargon", () => {
    const hits = [...flat].filter(([, text]) => DASH.test(text) || JARGON.test(text)).map(([key, text]) => `${key}: ${text}`);
    expect(hits).toEqual([]);
  });

  it("uses Western digits only", () => {
    expect([...flat].filter(([, text]) => NON_WESTERN_DIGIT.test(text)).map(([key]) => key)).toEqual([]);
  });

  it("has no empty string and no leading or trailing space", () => {
    expect([...flat].filter(([, text]) => text.trim() === "" || text !== text.trim()).map(([key]) => key)).toEqual([]);
  });
});

describe("copy rules: the detectors see what they claim to (an empty result means something)", () => {
  it("flags an em dash, an en dash, each jargon form, and every non-Western digit block", () => {
    for (const text of ["a — b", "a – b"]) expect(DASH.test(text), text).toBe(true);
    for (const text of ["see ADR 0058", "HANDOFF note", "per B2 spec", "B3 says", "B1"]) expect(JARGON.test(text), text).toBe(true);
    for (const text of ["٣", "۳", "३", "৩"]) expect(NON_WESTERN_DIGIT.test(text), text).toBe(true);
    for (const text of ["Bay 1", "ABC1", "2026", "WBGT"]) expect(JARGON.test(text) || NON_WESTERN_DIGIT.test(text), text).toBe(false);
  });
});

describe.each(LOCALES.filter((locale) => locale !== "en"))("test_placeholders_equal: %s against en", (locale) => {
  const flat = catalogues[locale] as Map<string, string>;

  it("has the same ICU arguments, the same rich tags (byte for byte, with their number) and the same choice arguments on every key", () => {
    const wrong: string[] = [];
    for (const [key, source] of en) {
      const text = flat.get(key) ?? "";
      if (placeholders(text).join() !== placeholders(source).join()) wrong.push(`${key}: arguments`);
      if (richTags(text).join() !== richTags(source).join()) wrong.push(`${key}: tags`);
      if (choiceShape(text).join() !== choiceShape(source).join()) wrong.push(`${key}: choice`);
      // The braces themselves: a placeholder written `{ name }` or with a changed case is a different argument at run time.
      if ((text.match(/\{[^}]*\}/g) ?? []).sort().join("|") !== (source.match(/\{[^}]*\}/g) ?? []).sort().join("|")) wrong.push(`${key}: placeholder text`);
    }
    expect(wrong).toEqual([]);
  });
});
