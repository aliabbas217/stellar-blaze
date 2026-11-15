import { readFileSync } from "node:fs";
import path from "node:path";
import { renderSyntheticFiles, SYNTHETIC_MODEL_ID, syntheticPlans, syntheticPolicy, syntheticDay } from "../../../fixtures/eval/synthetic";

const DIR = path.join(process.cwd(), "tests", "fixtures", "eval");

describe("synthetic eval fixtures", () => {
  it.each(Object.entries(renderSyntheticFiles()))(
    "%s.synthetic.json is what the typed builder produces (run scripts/write-synthetic-eval.mjs after a contract change)",
    (name, text) => {
      expect(readFileSync(path.join(DIR, `${name}.synthetic.json`), "utf8")).toBe(text);
    },
  );

  it("labels every provenance block SIMULATED with the synthetic model id: they can never pass for a result", () => {
    for (const file of [syntheticPolicy(), syntheticPlans(), syntheticDay()]) {
      expect(file.provenance.label).toBe("SIMULATED");
      expect(file.provenance.model_id).toBe(SYNTHETIC_MODEL_ID);
      expect(file.evaluation_set).toBe("dev_2025");
    }
    expect(SYNTHETIC_MODEL_ID).toBe("synthetic-shape-fixture");
  });

  it("has the shape the screens draw: a 10-day season, P0-P3 at five leads, four sensitivity cells, merged naive and ban-only", () => {
    const policy = syntheticPolicy();
    expect(policy.n_days).toBe(10);
    expect(policy.leads.map((l) => l.lead_days)).toEqual([1, 2, 3, 5, 7]);
    expect(policy.leads[0]?.rows.map((r) => r.policy)).toEqual(["P0", "P1", "P2", "P3_protect", "P3_balanced"]);
    expect(policy.leads.filter((l) => l.headline)).toHaveLength(1);
    expect(policy.sensitivity).toHaveLength(4);
    expect(policy.sensitivity.filter((c) => c.headline)).toHaveLength(1);

    const plans = syntheticPlans();
    expect(plans.rows.map((r) => r.plan)).toEqual(["naive", "ban_only", "rule_raw", "rule_corrected"]);
    expect(plans.identical_by_construction).toEqual(["naive", "ban_only"]);
    expect(plans.rows[0]).toEqual({ ...plans.rows[1], plan: "naive" });

    const day = syntheticDay();
    expect(day.hours).toHaveLength(9);
    expect(day.hours.map((h) => h.ban_weight)).toEqual([1, 1, 0.5, 0, 0, 1, 1, 1, 1]);
  });
});
