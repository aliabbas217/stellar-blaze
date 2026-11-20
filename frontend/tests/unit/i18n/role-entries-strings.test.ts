import { readFileSync } from "node:fs";
import path from "node:path";
import { CLAIMS_TRANSLATED_LOCALES, TARGET_LOCALES, flatten, isClaimKey, manifestEntries, type Manifest } from "../../../scripts/i18n-sync.mjs";

/*
 * Redesign S7: the strings of the role entries, the role badge, the safety view and the tour. Tier 1 (page chrome, the badge, the entries,
 * the safety view, the tour's buttons) are machine-drafted into all five other languages and listed in the manifest as machine-draft; the
 * tour's step sentences are Tier 2 (`judge.tour.steps.`): English everywhere by design, covered by CLAIM_PREFIXES and listed as such.
 */

const MESSAGES = path.resolve(import.meta.dirname, "../../../messages");
const load = (name: string) => JSON.parse(readFileSync(path.join(MESSAGES, `${name}.json`), "utf8")) as Record<string, unknown>;
const en = flatten(load("en"));
const manifest = JSON.parse(readFileSync(path.join(MESSAGES, "review-manifest.json"), "utf8")) as Manifest;
const entries = manifestEntries(manifest);

const TIER_2_PREFIX = "judge.tour.steps.";
const NEW_PREFIXES = ["shell.role.", "judge.roleEntry.", "judge.start.", "judge.tour.", "hse."];
const newKeys = [...en.keys()].filter((key) => NEW_PREFIXES.some((prefix) => key.startsWith(prefix)));
const tier1 = newKeys.filter((key) => !key.startsWith(TIER_2_PREFIX));
const tier2 = newKeys.filter((key) => key.startsWith(TIER_2_PREFIX));

describe("the S7 strings", () => {
  it("exist: the badge, both entries, the safety view and the tour", () => {
    expect(tier1).toHaveLength(39);
    expect(tier2).toHaveLength(14); // seven tour stops, a title and a sentence each (Try a plan added, audit M4; One day added, S13)
    for (const key of ["shell.role.crew", "shell.role.officer", "shell.role.switch", "judge.roleEntry.demoAccess", "hse.privacy", "hse.boundary.body", "judge.tour.open"]) {
      expect(en.has(key), key).toBe(true);
    }
    expect(en.get("judge.roleEntry.demoAccess")).toBe("Demo access. Anyone can enter.");
    expect(en.get("hse.privacy")).toBe("The service holds no individual worker health data.");
  });

  it("Tier 1: every key is translated, not copied, in all five other languages, with the same placeholders", () => {
    for (const locale of TARGET_LOCALES) {
      const flat = flatten(load(locale));
      for (const key of tier1) {
        const value = flat.get(key);
        expect(value, `${locale} ${key}`).toBeTypeOf("string");
        expect(value?.trim().length, `${locale} ${key}`).toBeGreaterThan(0);
        // Same as en would be an English leftover: none of these is a name or a unit that reads the same in every language.
        expect(value, `${locale} ${key} is still English`).not.toBe(en.get(key));
      }
    }
  });

  it("Tier 2: the tour's step sentences are English in every catalogue whose claims are not translated, and under a claims prefix; Arabic has its own words", () => {
    for (const key of tier2) {
      expect(isClaimKey(key), key).toBe(true);
      for (const locale of TARGET_LOCALES) {
        const value = flatten(load(locale)).get(key);
        if (CLAIMS_TRANSLATED_LOCALES.includes(locale)) expect(value, `${locale} ${key}`).not.toBe(en.get(key));
        else expect(value, `${locale} ${key}`).toBe(en.get(key));
      }
    }
  });

  it("the manifest lists every Tier 1 key as machine-draft and every Tier 2 key as english-by-design (machine-draft in Arabic), in each language", () => {
    for (const locale of TARGET_LOCALES) {
      const status = new Map(entries.filter((entry) => entry.locale === locale).map((entry) => [entry.key, entry.status]));
      for (const key of tier1) expect(status.get(key), `${locale} ${key}`).toBe("machine-draft");
      for (const key of tier2) expect(status.get(key), `${locale} ${key}`).toBe(CLAIMS_TRANSLATED_LOCALES.includes(locale) ? "machine-draft" : "english-by-design");
    }
  });

  it("carry none of the unledgered numbers, no dash, and no vendor product", () => {
    const text = newKeys.map((key) => en.get(key) ?? "").join(" ");
    for (const banned of ["1,624", "279", "139", "370 of 374", "Entra", "Microsoft"]) expect(text).not.toContain(banned);
    expect(text).not.toMatch(/[–—]/);
  });
});
