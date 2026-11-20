/*
 * Rule ids to message keys. The API names a rule by an internal id (`P-H7.cap60`, `STOP.red`); a judge or a supervisor reads a plain-language
 * name first and the id second, as a small code an auditor can still cite. The names are messages (`judge.try.rules.*` for the claims surface,
 * `supervisor.plan.rules.*` for the crew screens), so this map holds only the key; the id has a dot in it and a message key cannot.
 *
 * The ids are the ruleset's own `[clauses.entries]` (backend/rulesets/ae-heat-2026.1.toml) plus `P-H7.cycle`, the id a plan segment of a
 * work-rest cycle carries (it has no clause entry). tests/unit/lib/copy/rule-names.test.ts reads the ruleset and fails when an id has no
 * name here, so a new rule never reaches a screen as a bare code unnoticed. An id this map does not know has no name: callers show the
 * code alone, never a guess.
 */
export const RULE_NAME_KEYS = {
  "P-H1": "pH1",
  "P-H1a": "pH1a",
  "P-H2.daily": "pH2Daily",
  "P-H2.weekly": "pH2Weekly",
  "P-H3": "pH3",
  "P-H4": "pH4",
  "P-H5.hours": "pH5Hours",
  "P-H5.run": "pH5Run",
  "P-H5.window": "pH5Window",
  "P-H5.ban_season": "pH5BanSeason",
  "P-H7.cap60": "pH7Cap60",
  "P-H7.run": "pH7Run",
  "P-H7.lone": "pH7Lone",
  "P-H7.unacclimatised": "pH7Unacclimatised",
  "P-H7.cycle": "pH7Cycle",
  "P-H8.ramp": "pH8Ramp",
  "P-H8.heavy7": "pH8Heavy7",
  "P-H10": "pH10",
  "STOP.red": "stopRed",
  "STOP.no_acclimatised": "stopNoAcclimatised",
  "FALLBACK.high": "fallbackHigh",
} as const;

export type RuleNameKey = (typeof RULE_NAME_KEYS)[keyof typeof RULE_NAME_KEYS];

/** The message key of a rule's name, or null for an id with no name (an own-property check: `constructor` is not a rule). */
export function ruleNameKey(ruleId: string): RuleNameKey | null {
  return Object.hasOwn(RULE_NAME_KEYS, ruleId) ? RULE_NAME_KEYS[ruleId as keyof typeof RULE_NAME_KEYS] : null;
}
