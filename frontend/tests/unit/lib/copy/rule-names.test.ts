import { readFileSync } from "node:fs";
import path from "node:path";
import { RULE_NAME_KEYS, ruleNameKey } from "@/lib/copy/rule-names";
import enMessages from "../../../../messages/en.json";

/*
 * Every rule id the API can send has a plain-language name (audit M2: judges saw `P-H7.cap60` and `STOP.red` with no words). The known
 * ids are the ruleset's own `[clauses.entries]` (the clause behind every rule the planner and the validator cite) plus the one id a
 * plan segment carries that has no clause entry (`P-H7.cycle`, the API's documented example). A new rule id in the ruleset with no name
 * fails here, so the screens never fall back to a bare code without a reviewer noticing.
 */

const RULESET = path.resolve(import.meta.dirname, "../../../../../backend/rulesets/ae-heat-2026.1.toml");
const SEGMENT_ONLY_IDS = ["P-H7.cycle"] as const;

function rulesetIds(): string[] {
  const text = readFileSync(RULESET, "utf8");
  return [...text.matchAll(/^\[clauses\.entries\."([^"]+)"\]/gm)].map((match) => match[1] ?? "");
}

describe("rule names: every known rule id has a name", () => {
  it("reads the ruleset's rule ids (a non-empty list: this test is not vacuous)", () => {
    const ids = rulesetIds();
    expect(ids.length).toBeGreaterThanOrEqual(20);
    expect(ids).toContain("STOP.red");
    expect(ids).toContain("P-H7.cap60");
  });

  it("test_every_ruleset_rule_id_has_a_name: a key of the ruleset with no entry in the name map fails", () => {
    const missing = [...rulesetIds(), ...SEGMENT_ONLY_IDS].filter((id) => ruleNameKey(id) === null);
    expect(missing).toEqual([]);
  });

  it("the map has no id the ruleset does not know (a retired rule leaves no dead name)", () => {
    const known = new Set<string>([...rulesetIds(), ...SEGMENT_ONLY_IDS]);
    expect(Object.keys(RULE_NAME_KEYS).filter((id) => !known.has(id))).toEqual([]);
  });

  it("every id has its name in both namespaces of en, and the name is words, not the id again", () => {
    const keys = Object.values(RULE_NAME_KEYS);
    expect(new Set(keys).size, "one message key per rule id").toBe(keys.length);
    for (const [id, key] of Object.entries(RULE_NAME_KEYS)) {
      for (const names of [enMessages.judge.try.rules, enMessages.supervisor.plan.rules] as Record<string, string>[]) {
        const name = names[key];
        expect(name, `${id} -> ${key}`).toBeTypeOf("string");
        expect(name?.trim().length ?? 0, id).toBeGreaterThan(8);
        expect(name, id).not.toContain(id);
        expect(name, id).not.toMatch(/P-H\d|STOP\.|FALLBACK\./);
      }
    }
  });

  it("an id the map does not know has no name (never an invented one)", () => {
    expect(ruleNameKey("P-H99.mystery")).toBeNull();
    expect(ruleNameKey("")).toBeNull();
    expect(ruleNameKey("constructor")).toBeNull();
    expect(ruleNameKey("toString")).toBeNull();
  });
});
