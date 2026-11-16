// Keeps the five non-English catalogues in step with messages/en.json and maintains the native reviewer's list.
//
//   node scripts/i18n-sync.mjs            copies every key en has and a catalogue lacks into that catalogue as the English text
//                                         (so a view task adds its keys to en alone), then rewrites messages/review-manifest.json.
//                                         Idempotent. Refuses (writes nothing) when a catalogue holds a key en does not.
//   node scripts/i18n-sync.mjs --check    writes nothing; exits 1 when a key is missing or extra, a placeholder set or a rich tag
//                                         differs from en, a claims-surface string is not en's, the manifest is stale, and, with
//                                         SB_REQUIRE_TRANSLATED=1, when a Tier 1 key is still English (the release gate).
//   --root <dir>                          the frontend directory to work in (default: this script's parent)
//
// Run as `pnpm i18n:sync` and `pnpm i18n:check`. The review manifest is the reviewer's work list: every key of every non-en locale
// with a status and a safety flag (read from en `_meta.safety_keys`, never retyped here).
//
// TIERS (controller ruling, F2 Task 22). Tier 1, everything not named below, is machine-drafted into ar, ur, hi, bn and ne.
// Tier 2 stays English in the five catalogues by design: the claims surfaces (`CLAIM_PREFIXES`) carry numbers the verifier checks
// and verdicts that come verbatim from English files, so a machine translation of them would be an unverified claim. The dev pages
// (`DEV_PREFIXES`) are not product copy. Both are `english-by-design` for as long as their text is en's.
//
// STATUSES. untranslated: still English text that should have been translated (Tier 1). machine-draft: translated by a machine,
// awaiting a native reviewer. english-by-design: Tier 2, en's own text. reviewed: a native reviewer signed it off (set by hand in
// the manifest; a sync keeps it).
//
// THE FILE. Grouped (locale, status, safety) with one key per line, not one object per key: the per-key list the review reads as
// `manifestEntries()` would be 484 KB for 5,005 entries, a hair under the 500 KB large-file hook, and it would grow with every
// string. Grouped it is about a third of that, and a reviewer reads one list per status.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** @typedef {{ [key: string]: string | Tree }} Tree */
/** @typedef {{ en: Tree } & { [locale: string]: Tree }} Catalogues */
/** @typedef {{ safety: string[], other: string[] }} Group */
/** @typedef {{ key: string, note: string, english_len?: number, translated_len?: number }} Note */
/** @typedef {{ generated_by: string, source: string, locales: { [locale: string]: { [status: string]: Group } & { notes: Note[] } } }} Manifest */
/** @typedef {{ locale: string, key: string, status: string, safety: boolean, note?: string, english_len?: number, translated_len?: number }} Entry */

export const SOURCE_LOCALE = "en";
export const TARGET_LOCALES = ["ar", "ur", "hi", "bn", "ne"];
export const LOCALES = [SOURCE_LOCALE, ...TARGET_LOCALES];
export const STATUSES = ["untranslated", "machine-draft", "english-by-design", "reviewed"];

/** The claims surfaces: English in every catalogue, verbatim. A test fails when one of these differs from en. */
export const CLAIM_PREFIXES = ["judge.scoreboard.", "judge.frontier.", "judge.proof.", "judge.day.", "judge.try.", "judge.governance.", "states.proof."];
/** The dev pages (design kit, specimen): not product copy. */
export const DEV_PREFIXES = ["common.kit.", "common.specimen.", "common.spineKit."];
export const ENGLISH_BY_DESIGN_PREFIXES = [...CLAIM_PREFIXES, ...DEV_PREFIXES];

/**
 * Tier 1 keys whose text is the same in every language, so equal to en is correct and not a leftover: a product name, the language
 * names in their own scripts, a time format and a unit. Each is listed, never matched by a pattern, so a new English string cannot
 * hide here.
 */
export const INVARIANT_KEYS = [
  "common.appName",
  "shell.locales.en",
  "shell.locales.ar",
  "shell.locales.ur",
  "shell.locales.hi",
  "shell.locales.bn",
  "shell.locales.ne",
  "shell.field.pendingClock",
  "states.stamp.dev2025",
  "judge.landing.field.degrees",
];
export const INVARIANT_NOTE = "same in every language (a name, a unit or a format)";

const SHORTENED = "shortened for fit";

export const isClaimKey = (/** @type {string} */ key) => CLAIM_PREFIXES.some((prefix) => key.startsWith(prefix));
export const isEnglishByDesign = (/** @type {string} */ key) => ENGLISH_BY_DESIGN_PREFIXES.some((prefix) => key.startsWith(prefix));
export const isInvariant = (/** @type {string} */ key) => INVARIANT_KEYS.includes(key);

/** Leaf strings of a catalogue by dotted path, in file order, with the top-level `_meta` block left out. */
export function flatten(/** @type {unknown} */ node, prefix = "", out = new Map()) {
  if (typeof node === "string") {
    out.set(prefix, node);
  } else if (node !== null && typeof node === "object" && !Array.isArray(node)) {
    for (const [key, value] of Object.entries(node)) {
      if (prefix === "" && key === "_meta") continue;
      flatten(value, prefix === "" ? key : `${prefix}.${key}`, out);
    }
  } else {
    throw new Error(`messages: "${prefix}" is not a string or an object`);
  }
  return /** @type {Map<string, string>} */ (out);
}

/** Argument names of an ICU message: `{k}`, `{n, number}` and `{count, plural, ...}` all yield their first token. Sorted, unique. */
export function placeholders(/** @type {string} */ message) {
  const names = new Set();
  for (const m of message.matchAll(/\{\s*([A-Za-z_]\w*)\s*[,}]/g)) if (m[1] !== undefined) names.add(m[1]);
  return [...names].sort();
}

/** Rich-text tags (`<bdi>`, `</bdi>`) with their multiplicity, sorted: a translation must keep every wrapper. */
export function richTags(/** @type {string} */ message) {
  return [...message.matchAll(/<\/?[A-Za-z][A-Za-z0-9]*\s*\/?>/g)].map((m) => m[0]).sort();
}

/** `name:type` of every ICU choice (plural, select, selectordinal): the options differ per language, the arguments may not. */
export function choiceShape(/** @type {string} */ message) {
  return [...message.matchAll(/\{\s*([A-Za-z_]\w*)\s*,\s*(plural|select|selectordinal)\s*,/g)].map((m) => `${m[1]}:${m[2]}`).sort();
}

const NON_WESTERN_DIGITS = /[٠-٩۰-۹०-९০-৯]/;

/**
 * What is wrong with the catalogues themselves, one line each: a key missing or extra against en, a placeholder set, rich tag or ICU
 * choice that differs, an empty string, a non-Western digit, a claims-surface string that is not en's.
 * @returns {string[]}
 */
export function catalogueProblems(/** @type {Catalogues} */ catalogues) {
  const enFlat = flatten(catalogues.en);
  const problems = [];
  for (const [key, value] of enFlat) {
    if (value.trim() === "") problems.push(`en: ${key} is empty`);
    if (NON_WESTERN_DIGITS.test(value)) problems.push(`en: ${key} has a non-Western digit`);
  }
  for (const locale of TARGET_LOCALES) {
    const catalogue = catalogues[locale];
    if (catalogue === undefined) {
      problems.push(`${locale}: no catalogue`);
      continue;
    }
    const flat = flatten(catalogue);
    for (const key of enFlat.keys()) if (!flat.has(key)) problems.push(`${locale}: missing ${key}`);
    for (const key of flat.keys()) if (!enFlat.has(key)) problems.push(`${locale}: extra ${key}`);
    for (const [key, source] of enFlat) {
      const value = flat.get(key);
      if (value === undefined) continue;
      if (value.trim() === "") problems.push(`${locale}: ${key} is empty`);
      if (NON_WESTERN_DIGITS.test(value)) problems.push(`${locale}: ${key} has a non-Western digit`);
      if (placeholders(value).join() !== placeholders(source).join()) {
        problems.push(`${locale}: ${key} placeholders {${placeholders(value).join(", ")}} differ from en {${placeholders(source).join(", ")}}`);
      }
      if (richTags(value).join() !== richTags(source).join()) {
        problems.push(`${locale}: ${key} tags [${richTags(value).join(" ")}] differ from en [${richTags(source).join(" ")}]`);
      }
      if (choiceShape(value).join() !== choiceShape(source).join()) problems.push(`${locale}: ${key} ICU choice arguments differ from en`);
      if (isClaimKey(key) && value !== source) problems.push(`${locale}: ${key} is a claims-surface string and stays en's text`);
    }
  }
  return problems;
}

/** @returns {Group} */
const emptyGroup = () => ({ safety: [], other: [] });

/**
 * The manifest the catalogues describe, carrying over from `previous` only what a person decides: `reviewed` status and the
 * shortened-for-fit notes (their lengths are re-measured from the text, so they cannot go stale).
 * @param {Catalogues} catalogues
 * @param {Manifest | null} previous
 * @returns {Manifest}
 */
export function deriveManifest(catalogues, previous) {
  const enFlat = flatten(catalogues.en);
  const meta = /** @type {{ safety_keys?: string[] } | undefined} */ (/** @type {unknown} */ (catalogues.en["_meta"]));
  const safety = new Set(meta?.safety_keys ?? []);
  /** @type {Manifest["locales"]} */
  const locales = {};
  for (const locale of TARGET_LOCALES) {
    const catalogue = catalogues[locale];
    if (catalogue === undefined) continue;
    const flat = flatten(catalogue);
    const before = previous?.locales[locale];
    const reviewed = new Set([...(before?.["reviewed"]?.safety ?? []), ...(before?.["reviewed"]?.other ?? [])]);
    const carried = new Map((before?.notes ?? []).filter((note) => note.note.startsWith(SHORTENED)).map((note) => [note.key, note.note]));
    /** @type {{ [status: string]: Group }} */
    const groups = Object.fromEntries(STATUSES.map((status) => [status, emptyGroup()]));
    /** @type {Note[]} */
    const notes = [];
    for (const [key, source] of enFlat) {
      const value = flat.get(key);
      if (value === undefined) continue;
      const same = value === source;
      let status;
      if (reviewed.has(key)) status = "reviewed";
      else if (same && isEnglishByDesign(key)) status = "english-by-design";
      else if (same && !isInvariant(key)) status = "untranslated";
      else status = "machine-draft";
      groups[status]?.[safety.has(key) ? "safety" : "other"].push(key);
      if (same && isInvariant(key) && status === "machine-draft") notes.push({ key, note: INVARIANT_NOTE });
      const shortened = carried.get(key);
      if (shortened !== undefined && !same) notes.push({ key, note: shortened, english_len: source.length, translated_len: value.length });
    }
    locales[locale] = { ...groups, notes };
  }
  return { generated_by: "scripts/i18n-sync.mjs", source: SOURCE_LOCALE, locales };
}

/**
 * The manifest as one object per (locale, key): `{ locale, key, status, safety, note?, english_len?, translated_len? }`.
 * @param {Manifest} manifest
 * @returns {Entry[]}
 */
export function manifestEntries(manifest) {
  /** @type {Entry[]} */
  const entries = [];
  for (const [locale, groups] of Object.entries(manifest.locales)) {
    const notes = new Map(groups.notes.map((note) => [note.key, note]));
    for (const status of STATUSES) {
      const group = groups[status];
      if (group === undefined) continue;
      for (const [isSafety, keys] of /** @type {const} */ ([
        [true, group.safety],
        [false, group.other],
      ])) {
        for (const key of keys) {
          const { note, english_len, translated_len } = notes.get(key) ?? {};
          entries.push({
            locale,
            key,
            status,
            safety: isSafety,
            ...(note === undefined ? {} : { note }),
            ...(english_len === undefined ? {} : { english_len }),
            ...(translated_len === undefined ? {} : { translated_len }),
          });
        }
      }
    }
  }
  return entries;
}

/**
 * What blocks a release (SB_REQUIRE_TRANSLATED=1): a Tier 1 key still English. Tier 2 english-by-design never blocks.
 * @param {Manifest} manifest
 * @returns {string[]}
 */
export function releaseProblems(manifest) {
  return manifestEntries(manifest)
    .filter((entry) => entry.status === "untranslated" && !isEnglishByDesign(entry.key))
    .map((entry) => `${entry.locale}.${entry.key} is untranslated (Tier 1: machine-draft it, or mark it invariant in INVARIANT_KEYS with a reason)`);
}

/** The catalogue `locale` would have with every key of en: its own text where it has some, en's text where it has none. */
function withMissingKeys(/** @type {Tree} */ enTree, /** @type {Map<string, string>} */ own, /** @type {Tree | undefined} */ meta, prefix = "") {
  /** @type {Tree} */
  const out = {};
  for (const [key, value] of Object.entries(enTree)) {
    const dotted = prefix === "" ? key : `${prefix}.${key}`;
    if (prefix === "" && key === "_meta") {
      out[key] = meta ?? { review_status: "machine-draft" };
    } else if (typeof value === "string") {
      out[key] = own.get(dotted) ?? value;
    } else {
      out[key] = withMissingKeys(value, own, undefined, dotted);
    }
  }
  return out;
}

const render = (/** @type {unknown} */ value) => `${JSON.stringify(value, null, 2)}\n`;

function parseArgs(/** @type {string[]} */ argv) {
  const args = { check: false, root: path.join(path.dirname(fileURLToPath(import.meta.url)), "..") };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--check") args.check = true;
    else if (argv[i] === "--root") args.root = path.resolve(argv[(i += 1)] ?? "");
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  return args;
}

function load(/** @type {string} */ root) {
  const dir = path.join(root, "messages");
  const catalogues = /** @type {Catalogues} */ (Object.fromEntries(LOCALES.map((locale) => [locale, JSON.parse(readFileSync(path.join(dir, `${locale}.json`), "utf8"))])));
  const manifestFile = path.join(dir, "review-manifest.json");
  const manifestText = existsSync(manifestFile) ? readFileSync(manifestFile, "utf8") : null;
  return { dir, catalogues, manifestFile, manifestText, manifest: /** @type {Manifest | null} */ (manifestText === null ? null : JSON.parse(manifestText)) };
}

function main() {
  const { check, root } = parseArgs(process.argv.slice(2));
  const { dir, catalogues, manifestFile, manifestText, manifest } = load(root);
  const problems = catalogueProblems(catalogues);

  if (check) {
    const wanted = render(deriveManifest(catalogues, manifest));
    if (manifestText !== wanted) problems.push("messages/review-manifest.json is stale (run `pnpm i18n:sync`)");
    if (process.env["SB_REQUIRE_TRANSLATED"] === "1") problems.push(...releaseProblems(deriveManifest(catalogues, manifest)));
    if (problems.length > 0) {
      console.error(`i18n:check failed (${problems.length}):\n${problems.map((line) => `  ${line}`).join("\n")}`);
      process.exit(1);
    }
    console.log("i18n:check ok");
    return;
  }

  const extras = problems.filter((line) => /: extra /.test(line));
  if (extras.length > 0) {
    console.error(`i18n:sync refused: a catalogue holds a key en does not (remove it, or add it to en):\n${extras.map((line) => `  ${line}`).join("\n")}`);
    process.exit(1);
  }
  const enFlat = flatten(catalogues.en);
  for (const locale of TARGET_LOCALES) {
    const catalogue = /** @type {Tree} */ (catalogues[locale]);
    const own = flatten(catalogue);
    const added = [...enFlat.keys()].filter((key) => !own.has(key));
    if (added.length === 0) continue;
    const next = withMissingKeys(catalogues.en, own, /** @type {Tree | undefined} */ (catalogue["_meta"]));
    writeFileSync(path.join(dir, `${locale}.json`), render(next));
    catalogues[locale] = next;
    console.log(`${locale}: ${added.length} key(s) copied from en as English text (untranslated)`);
  }
  const wanted = render(deriveManifest(catalogues, manifest));
  if (wanted !== manifestText) writeFileSync(manifestFile, wanted);
  const entries = manifestEntries(JSON.parse(wanted));
  const counts = Object.fromEntries(STATUSES.map((status) => [status, entries.filter((entry) => entry.status === status).length]));
  console.log(`review-manifest.json: ${JSON.stringify(counts)}, safety ${entries.filter((entry) => entry.safety).length}`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main();
