import { readFileSync } from "node:fs";
import path from "node:path";
import {
  CLAIM_PREFIXES,
  ENGLISH_BY_DESIGN_PREFIXES,
  LOCALES,
  STATUSES,
  TARGET_LOCALES,
  deriveManifest,
  flatten,
  isClaimKey,
  isEnglishByDesign,
  manifestEntries,
  releaseProblems,
  type Catalogues,
  type Manifest,
} from "../../../scripts/i18n-sync.mjs";

/*
 * F2 Task 22. messages/review-manifest.json is the native reviewer's list: every key of every non-en catalogue with its review
 * status and whether it is a safety string (read from en `_meta.safety_keys`, never retyped). These tests pin what the file may
 * say about the data it describes, so a status cannot drift from the catalogues, and a release (SB_REQUIRE_TRANSLATED=1) cannot
 * ship a Tier 1 string that is still English.
 *
 * Tier 1 (worker, supervisor, levels, states, shell, alerts, common, the landing) is machine-drafted into five languages.
 * Tier 2 (the claims surfaces: scoreboard, frontier, proof, day, try, governance, states.proof, and the dev pages) stays English by
 * design: a machine translation of a verifier-checked sentence would be an unverified claim (controller ruling, 2026-11-15).
 */

const MESSAGES = path.resolve(import.meta.dirname, "../../../messages");
const read = (name: string): unknown => JSON.parse(readFileSync(path.join(MESSAGES, name), "utf8"));
const catalogues = Object.fromEntries(LOCALES.map((locale) => [locale, read(`${locale}.json`)])) as Catalogues;
const manifest = read("review-manifest.json") as Manifest;
const entries = manifestEntries(manifest);
const enFlat = flatten(catalogues["en"]);
const safetyKeys = (catalogues["en"] as unknown as { _meta: { safety_keys: string[] } })._meta.safety_keys;

describe("review manifest: it lists every non-en key", () => {
  it("test_review_manifest_lists_every_non_en_key: each locale has exactly en's keys, once", () => {
    for (const locale of TARGET_LOCALES) {
      const listed = entries.filter((entry) => entry.locale === locale).map((entry) => entry.key);
      expect(new Set(listed).size, `${locale}: no key listed twice`).toBe(listed.length);
      expect([...listed].sort(), locale).toEqual([...enFlat.keys()].sort());
    }
    expect(entries.some((entry) => entry.locale === "en"), "en is the source and is not in the list").toBe(false);
  });

  it("uses only the four statuses, and a boolean safety flag on every entry", () => {
    for (const entry of entries) {
      expect(STATUSES, `${entry.locale}.${entry.key}`).toContain(entry.status);
      expect(typeof entry.safety, `${entry.locale}.${entry.key}`).toBe("boolean");
    }
  });

  it("flags exactly the keys of en _meta.safety_keys as safety: true, in every locale", () => {
    expect(safetyKeys.length).toBeGreaterThan(0);
    for (const locale of TARGET_LOCALES) {
      const flagged = entries.filter((entry) => entry.locale === locale && entry.safety).map((entry) => entry.key);
      expect([...flagged].sort(), locale).toEqual([...safetyKeys].sort());
    }
  });

  it("test_disclosures_are_safety_keys: the clinical-review and what-the-app-does-when-closed disclosures are flagged (fix round 1: they were not)", () => {
    // `worker.today.draftWording` is the Today clinical-review disclosure now that the badge is gone; the two `limitation` lines tell a
    // worker what a closed app will and will not warn about (an inexact translation there misleads about protection).
    for (const key of ["worker.today.draftWording", "today.limitation", "alerts.limitation"]) {
      expect(enFlat.has(key), `${key} exists in en`).toBe(true);
      expect(safetyKeys, key).toContain(key);
      for (const locale of TARGET_LOCALES)
        expect(entries.find((entry) => entry.locale === locale && entry.key === key)?.safety, `${locale}.${key}`).toBe(true);
    }
  });

  it("is what the catalogues say today (a stale manifest fails: run `pnpm i18n:sync`)", () => {
    expect(deriveManifest(catalogues, manifest)).toEqual(manifest);
  });

  it("is small enough for the large-file hook (500 KB), with room to grow", () => {
    const bytes = readFileSync(path.join(MESSAGES, "review-manifest.json")).byteLength;
    expect(bytes).toBeLessThan(300 * 1024);
  });
});

describe("review manifest: Tier 1 is translated, Tier 2 is English by design", () => {
  it("no Tier 1 key is untranslated in any locale", () => {
    const untranslated = entries.filter((entry) => entry.status === "untranslated" && !isEnglishByDesign(entry.key));
    expect(untranslated.map((entry) => `${entry.locale}.${entry.key}`)).toEqual([]);
  });

  it("every claims-surface key is english-by-design and its text is en's, byte for byte, in every locale", () => {
    const claims = [...enFlat.keys()].filter(isClaimKey);
    expect(claims.length, "the claims surfaces are found").toBeGreaterThan(300);
    for (const locale of TARGET_LOCALES) {
      const flat = flatten(catalogues[locale]);
      for (const key of claims) {
        expect(flat.get(key), `${locale}.${key}`).toBe(enFlat.get(key));
        const entry = entries.find((candidate) => candidate.locale === locale && candidate.key === key);
        expect(entry?.status, `${locale}.${key}`).toBe("english-by-design");
      }
    }
  });

  it("a Tier 2 dev-page key that was translated before is machine-draft; one still English is english-by-design (the status says what the text is)", () => {
    const dev = [...enFlat.keys()].filter((key) => isEnglishByDesign(key) && !isClaimKey(key));
    expect(dev.length).toBeGreaterThan(0);
    for (const locale of TARGET_LOCALES) {
      const flat = flatten(catalogues[locale]);
      for (const key of dev) {
        const entry = entries.find((candidate) => candidate.locale === locale && candidate.key === key);
        expect(entry?.status, `${locale}.${key}`).toBe(flat.get(key) === enFlat.get(key) ? "english-by-design" : "machine-draft");
      }
    }
  });

  it("every machine-draft entry differs from en, except a string that is the same in every language (a name, a unit, a time format)", () => {
    for (const locale of TARGET_LOCALES) {
      const flat = flatten(catalogues[locale]);
      for (const entry of entries.filter((candidate) => candidate.locale === locale && candidate.status === "machine-draft")) {
        if (flat.get(entry.key) !== enFlat.get(entry.key)) continue;
        expect(entry.note, `${locale}.${entry.key} is machine-draft but equals en: say why in its note`).toMatch(/same in every language/);
      }
    }
  });

  it("the policy prefixes: the claims surfaces are in the English-by-design list", () => {
    for (const prefix of ["judge.scoreboard.", "judge.frontier.", "judge.proof.", "judge.day.", "judge.try.", "judge.governance.", "states.proof."]) {
      expect(CLAIM_PREFIXES, prefix).toContain(prefix);
      expect(ENGLISH_BY_DESIGN_PREFIXES, prefix).toContain(prefix);
    }
  });
});

describe("review manifest: shortened-for-fit log", () => {
  it("every note is a shortened-for-fit record with the real lengths, and none sits on an untranslated key", () => {
    for (const entry of entries.filter((candidate) => candidate.note?.startsWith("shortened for fit"))) {
      const flat = flatten(catalogues[entry.locale as keyof Catalogues]);
      expect(entry.english_len, `${entry.locale}.${entry.key}`).toBe(enFlat.get(entry.key)?.length);
      expect(entry.translated_len, `${entry.locale}.${entry.key}`).toBe(flat.get(entry.key)?.length);
      expect(entry.translated_len, `${entry.locale}.${entry.key}`).toBeLessThan((entry.english_len ?? 0) + 1);
      expect(entry.status, `${entry.locale}.${entry.key}`).toBe("machine-draft");
      // A safety key may only be shortened when the meaning is exactly kept, and the note must say so.
      if (entry.safety) expect(entry.note, `${entry.locale}.${entry.key}: a shortened safety string says the meaning is kept`).toMatch(/meaning exactly kept/);
    }
  });
});

describe("review manifest: the release flag (SB_REQUIRE_TRANSLATED=1)", () => {
  const tiny = (en: object, ar: object): Catalogues => ({ en, ar }) as unknown as Catalogues;

  it("test_no_untranslated_when_release_flag: fails on a Tier 1 key that is still English", () => {
    const left = deriveManifest(tiny({ a: { b: "Hello" } }, { a: { b: "Hello" } }), null);
    expect(manifestEntries(left).map((row) => row.status)).toEqual(["untranslated"]);
    expect(releaseProblems(left).join(" | ")).toMatch(/ar.a.b/);
  });

  it("passes a Tier 2 english-by-design key and a Tier 1 machine draft", () => {
    const claim = deriveManifest(tiny({ judge: { scoreboard: { x: "Hello" } } }, { judge: { scoreboard: { x: "Hello" } } }), null);
    expect(manifestEntries(claim).map((row) => row.status)).toEqual(["english-by-design"]);
    expect(releaseProblems(claim)).toEqual([]);
    const drafted = deriveManifest(tiny({ a: { b: "Hello" } }, { a: { b: "Salam" } }), null);
    expect(manifestEntries(drafted).map((row) => row.status)).toEqual(["machine-draft"]);
    expect(releaseProblems(drafted)).toEqual([]);
  });

  it("the real manifest passes the release check today (no Tier 1 untranslated)", () => {
    expect(releaseProblems(manifest)).toEqual([]);
  });
});
