import { readFileSync } from "node:fs";
import path from "node:path";
import { routing } from "@/i18n/routing";

/*
 * messages/*.json is the data layer of the UI: no user-visible string lives anywhere else.
 * en is authored; the other five files are machine drafts that must keep en's exact key set,
 * its ICU placeholders and the Western-digit rule, or a translation silently breaks a screen.
 */

const messagesDir = path.resolve(import.meta.dirname, "../../../messages");

type Json = string | number | boolean | null | Json[] | { readonly [key: string]: Json };
type Messages = { readonly [key: string]: Json };

function load(locale: string): Messages {
  return JSON.parse(readFileSync(path.join(messagesDir, `${locale}.json`), "utf8")) as Messages;
}

/** Leaf strings keyed by dotted path, with the `_meta` block left out. */
function flatten(node: Json, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  if (typeof node === "string") {
    out.set(prefix, node);
  } else if (node !== null && typeof node === "object" && !Array.isArray(node)) {
    for (const [key, value] of Object.entries(node)) {
      if (prefix === "" && key === "_meta") continue;
      for (const [k, v] of flatten(value, prefix === "" ? key : `${prefix}.${key}`)) out.set(k, v);
    }
  } else {
    throw new Error(`messages: "${prefix}" is not a string or an object`);
  }
  return out;
}

/** Argument names of an ICU message: `{k}`, `{n, number}` and `{count, plural, ...}` all yield their first token. */
function placeholders(message: string): string[] {
  const names = new Set<string>();
  for (const m of message.matchAll(/\{\s*([A-Za-z_]\w*)\s*[,}]/g)) {
    if (m[1] !== undefined) names.add(m[1]);
  }
  return [...names].sort();
}

const NAMESPACES = [
  "common",
  "shell",
  "worker",
  "today",
  "profile",
  "alerts",
  "push",
  "supervisor",
  "hse",
  "states",
  "levels",
  "actions",
  "offline",
  "judge",
] as const;

const en = load("en");
const enFlat = flatten(en);
const others = routing.locales.filter((l) => l !== "en");

describe("messages: structure", () => {
  it("has a file for each routed locale and the agreed top-level namespaces", () => {
    for (const locale of routing.locales) {
      expect(Object.keys(load(locale)).sort(), locale).toEqual([...NAMESPACES, "_meta"].sort());
    }
  });

  it("marks en as the source and every other file as a machine draft", () => {
    expect(en["_meta"]).toMatchObject({ review_status: "source" });
    for (const locale of others) {
      expect(load(locale)["_meta"], locale).toMatchObject({ review_status: "machine-draft" });
    }
  });

  it("lists the safety strings in _meta.safety_keys, and every listed key exists in all six catalogues (the clinical review manifest reads it)", () => {
    const listed = (en["_meta"] as { readonly safety_keys?: unknown }).safety_keys;
    expect(Array.isArray(listed)).toBe(true);
    const keys = listed as readonly unknown[];
    expect(keys.length).toBeGreaterThan(0);
    expect(new Set(keys).size, "no duplicates").toBe(keys.length);
    for (const locale of routing.locales) {
      const flat = flatten(load(locale));
      for (const key of keys) {
        expect(typeof key, `${locale}: ${String(key)}`).toBe("string");
        expect(flat.has(key as string), `${locale}: safety key ${String(key)} is not in the catalogue`).toBe(true);
      }
    }
    // The families the review pack names: the four action codes, the Stop strings, the unwell sheet, the protective lead, the alert strings.
    for (const key of [
      "worker.today.also.selfPaced",
      "worker.today.also.noUnacclimatised",
      "worker.today.also.induction",
      "worker.today.also.bottle",
      "supervisor.stop.recorded",
      "supervisor.stop.queued",
      "worker.unwell.steps.one",
      "worker.today.lead.protective",
      "worker.alert.doNow",
    ]) {
      expect(keys, key).toContain(key);
    }
    expect(keys.filter((key) => String(key).startsWith("supervisor.stop.")).length, "every Stop string").toBe(
      [...enFlat.keys()].filter((key) => key.startsWith("supervisor.stop.")).length,
    );
  });

  it("has no empty strings in en", () => {
    for (const [key, value] of enFlat) expect(value.trim(), key).not.toBe("");
  });
});

describe.each(others)("messages: %s against en", (locale) => {
  const flat = flatten(load(locale));

  it("has exactly the key set of en", () => {
    expect([...flat.keys()].sort()).toEqual([...enFlat.keys()].sort());
  });

  it("keeps the ICU placeholders of every message", () => {
    for (const [key, source] of enFlat) {
      expect(placeholders(flat.get(key) ?? ""), `${locale}: ${key}`).toEqual(placeholders(source));
    }
  });

  it("has no empty strings", () => {
    for (const [key, value] of flat) expect(value.trim(), `${locale}: ${key}`).not.toBe("");
  });

  it("uses Western digits only (times, temperatures and levels never switch script)", () => {
    // Arabic-Indic, Extended Arabic-Indic (Urdu), Devanagari and Bengali digit blocks.
    const nonWestern = /[٠-٩۰-۹०-९০-৯]/;
    for (const [key, value] of flat) expect(value, `${locale}: ${key}`).not.toMatch(nonWestern);
  });
});

describe("messages: copy fixed by the governance constraints", () => {
  it("carries the closed-app limitation text from ADR 0004 in en", () => {
    expect(enFlat.get("today.limitation")).toBe(
      "When the app is closed you get site and crew warnings only. Your personal risk shows when you open the app or tap a warning. It is worked out on this phone and never sent to the server.",
    );
  });

  it("offers the same limitation text on the alerts screen", () => {
    expect(enFlat.get("alerts.limitation")).toBe(enFlat.get("today.limitation"));
  });

  it("says what the alert subscription carries: the site and the optional crew, never 'anonymous' or 'nothing else'", () => {
    const server = enFlat.get("profile.consent.server");
    expect(server).toMatch(/crew/);
    expect(server).not.toMatch(/anonymous|nothing else/i);
  });

  it("keeps every action text a flagged draft placeholder (no invented safety wording)", () => {
    const actionKeys = [...enFlat.keys()].filter((k) => k.startsWith("actions."));
    expect(actionKeys.sort()).toEqual(["actions.draft", "actions.pending"]);
  });
});
