import { ALSO_NEEDS_DRAFT_MARKER, actionPlan, alsoPictogram } from "@/features/today/action-codes";

/*
 * What an hour's action codes become on the Today screen (F2 Task 16). The words are messages; here only the meaning: which
 * lead, which numbers, which list. Nothing is invented: a number comes from the code, an unknown code is dropped.
 */

describe("actionPlan", () => {
  it("test_unknown_action_code_falls_back_to_site_rules: no code, or only codes nobody reviewed", () => {
    expect(actionPlan([])).toEqual({ lead: { kind: "siteRules" }, also: [] });
    expect(actionPlan(["wibble", "cycle.x"])).toEqual({ lead: { kind: "siteRules" }, also: [] });
  });

  it("a work-rest cycle carries its own numbers", () => {
    expect(actionPlan(["cycle.high.heavy.20-40"]).lead).toEqual({ kind: "cycle", workMinutes: 20, restMinutes: 40 });
    expect(actionPlan(["cycle.medium.moderate.45-15"]).lead).toEqual({ kind: "cycle", workMinutes: 45, restMinutes: 15 });
  });

  it.each(["cycle.high.heavy.20-30", "cycle.high.heavy.60-0", "cycle.high.heavy.0-60x", "cycle.high.heavy.a-b"])(
    "a cycle that is not one hour (%s) is not guessed at",
    (code) => {
      expect(actionPlan([code]).lead).toEqual({ kind: "siteRules" });
    },
  );

  it("water is only ever 'drink water': no litres and no interval, whatever the code says", () => {
    expect(actionPlan(["fluids.over-1.2l"]).also).toEqual(["water"]);
    expect(actionPlan(["water_every_15_min"]).also).toEqual(["water"]);
    expect(actionPlan(["fluids.over-1.2l"]).lead).toEqual({ kind: "siteRules" });
  });

  it("never work alone comes only from its code", () => {
    expect(actionPlan(["no-lone-work"]).also).toEqual(["buddy"]);
    expect(actionPlan(["cycle.high.heavy.20-40"]).also).toEqual([]);
  });

  it("the most protective lead wins: stop over a cycle over plain shade", () => {
    expect(actionPlan(["rest_in_shade", "cycle.high.heavy.20-40", "stop-work"]).lead).toEqual({ kind: "stop" });
    expect(actionPlan(["rest_in_shade", "cycle.high.heavy.20-40"]).lead.kind).toBe("cycle");
    expect(actionPlan(["rest_in_shade"]).lead).toEqual({ kind: "shade" });
  });

  // Found in the first run against the real B3: an orange hour carries one cycle per workload, the LIGHT one first
  // (`cycle.high.light.45-15`, then `cycle.high.heavy.20-40`). Today knows no workload at site level, so it must lead with the
  // most protective cycle, never the first in the array (the first would tell a heavy crew to work 45 and rest 15).
  it("with a cycle for every workload the most protective one leads, whatever the order", () => {
    const light = "cycle.high.light.45-15";
    const heavy = "cycle.high.heavy.20-40";
    expect(actionPlan([light, heavy]).lead).toEqual({ kind: "cycle", workMinutes: 20, restMinutes: 40 });
    expect(actionPlan([heavy, light]).lead).toEqual({ kind: "cycle", workMinutes: 20, restMinutes: 40 });
    // equal work minutes cannot differ in rest (a cycle is one hour), and a cycle still beats shade and loses to a stop
    expect(actionPlan(["rest_in_shade", light, heavy, "stop-work"]).lead).toEqual({ kind: "stop" });
    expect(actionPlan(["rest_in_shade", light, heavy]).lead).toEqual({ kind: "cycle", workMinutes: 20, restMinutes: 40 });
  });

  // The four codes B3's real ruleset sends that had no wording (found in the first live run, F2 Task 24b item 9). Each is now the
  // ADOSH Table 1 text the ruleset's clause cites, verbatim; the lines are under the draft marker and add no advice of their own.
  it.each([
    ["self-paced-work", "selfPaced"],
    ["no-unacclimatised", "noUnacclimatised"],
    ["high-risk-induction", "induction"],
    ["personal-water-bottle-2l", "bottle"],
  ] as const)("test_four_ruleset_codes_have_a_line: %s is the '%s' line, leads nothing, and wears the draft marker", (code, item) => {
    expect(actionPlan([code])).toEqual({ lead: { kind: "siteRules" }, also: [item] });
    expect(ALSO_NEEDS_DRAFT_MARKER.has(item)).toBe(true);
    // never mistaken for the water prompt (the bottle code contains the word "water"; the line is the bottle duty, not a quantity to drink)
    if (code === "personal-water-bottle-2l") expect(actionPlan([code]).also).not.toContain("water");
  });

  it("an Orange hour of the real ruleset lists every code once, in the ruleset's order", () => {
    const orange = [
      "cycle.high.light.45-15",
      "cycle.high.heavy.20-40",
      "no-lone-work",
      "no-unacclimatised",
      "fluids.over-1.2l",
      "high-risk-induction",
      "personal-water-bottle-2l",
    ];
    expect(actionPlan(orange)).toEqual({
      lead: { kind: "cycle", workMinutes: 20, restMinutes: 40 },
      also: ["buddy", "noUnacclimatised", "water", "induction", "bottle"],
    });
    expect(actionPlan(["self-paced-work", "fluids.light.600ml-1l"]).also).toEqual(["selfPaced", "water"]);
  });

  it("every line has a pictogram, and the older two keep theirs", () => {
    expect(alsoPictogram("water")).toBe("water");
    expect(alsoPictogram("buddy")).toBe("buddy");
    expect(alsoPictogram("bottle")).toBe("water");
  });

  it("an unknown code beside known ones is ignored, and the list has each item once", () => {
    expect(actionPlan(["wibble", "no-lone-work", "fluids.a", "water_every_15_min", "no-lone-work"])).toEqual({
      lead: { kind: "siteRules" },
      also: ["buddy", "water"],
    });
  });
});
