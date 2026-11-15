import { readFileSync } from "node:fs";
import path from "node:path";
import {
  makeFormat,
  pendingPlanRows,
  pendingPolicyRows,
  planClaim,
  policyClaim,
  toPlanRows,
  toPolicyRows,
  type AdapterContext,
  type PlanScoreboard,
  type PolicyScoreboard,
  type TableText,
} from "@/features/judge/adapters";

const fixtures = path.resolve(import.meta.dirname, "../../../fixtures/eval");
const policy = JSON.parse(readFileSync(path.join(fixtures, "policy_scoreboard.synthetic.json"), "utf8")) as PolicyScoreboard;
const plans = JSON.parse(readFileSync(path.join(fixtures, "plan_scoreboard.synthetic.json"), "utf8")) as PlanScoreboard;

const text: TableText = {
  row: (id) => ({ label: `label:${id}`, sub: `sub:${id}` }),
  what: (metric, row) => `${metric} | ${row}`,
  interval: (lo, hi) => `ci ${lo}..${hi}`,
};

const ctx: AdapterContext = {
  file: { path: "eval/2026/policy_scoreboard.json", sha256: "a".repeat(64) },
  format: makeFormat("en"),
  text,
};

describe("toPolicyRows", () => {
  const rows = toPolicyRows(policy, 1, ctx);

  it("lists P0, P1, P2 and the Stellar Blaze rows last, in the order of the file", () => {
    expect(rows.map((r) => r.id)).toEqual(["P0", "P1", "P2", "P3_protect", "P3_balanced"]);
    expect(rows.map((r) => r.ours)).toEqual([false, false, false, true, true]);
  });

  it("carries a balanced P3 line only when the file has one", () => {
    const lead = policy.leads.map((l) => ({ ...l, rows: l.rows.filter((r) => r.policy !== "P3_balanced") }));
    expect(toPolicyRows({ ...policy, leads: lead }, 1, ctx).map((r) => r.id)).toEqual(["P0", "P1", "P2", "P3_protect"]);
  });

  it("gives each number a proof from the file's provenance, a claim id and its interval", () => {
    const p3 = rows.find((r) => r.id === "P3_protect");
    const first = p3?.cells[0];
    expect(first?.proof?.claim).toBe("policy.p3.missed_danger_hours");
    expect(first?.proof?.file).toBe("eval/2026/policy_scoreboard.json");
    expect(first?.proof?.fileSha256).toBe("a".repeat(64));
    expect(first?.what).toBe("missed_danger_hours | label:P3_protect");
    expect(rows.every((r) => r.cells.length === 4)).toBe(true);
  });

  it("formats shares as percentages and hours with one decimal, Western digits", () => {
    const row = rows[0];
    const lead1 = policy.leads.find((l) => l.lead_days === 1)?.rows[0];
    expect(row?.cells[2]?.value).toBe(`${String(Math.round((lead1?.pod.value ?? 0) * 100))}%`);
    expect(row?.cells[0]?.value).toBe((lead1?.missed_danger_hours.value ?? 0).toFixed(1));
    const arabic = toPolicyRows(policy, 1, { ...ctx, format: makeFormat("ar") });
    expect(arabic[0]?.cells[0]?.value).toMatch(/^[0-9.,]+$/);
  });

  it("yields no proof when the provenance block is incomplete, so the table never shows the number", () => {
    const broken = toPolicyRows({ ...policy, provenance: { ...policy.provenance, git_sha: "" } }, 1, ctx);
    expect(broken.every((r) => r.cells.every((c) => c.proof === null))).toBe(true);
  });

  it("returns nothing for a lead the file does not carry", () => {
    expect(toPolicyRows({ ...policy, leads: [] }, 1, ctx)).toEqual([]);
  });
});

describe("toPlanRows", () => {
  it("test_plans_collapse_identical_rows", () => {
    const rows = toPlanRows(plans, ctx);
    expect(rows.map((r) => r.id)).toEqual(["merged", "rule_raw", "rule_corrected"]);
    expect(rows[0]?.label).toBe("label:merged");
    expect(rows.map((r) => r.ours)).toEqual([false, false, true]);
    // the merged row shows the numbers of the first plan of the group, and says which claim they are
    expect(rows[0]?.cells[0]?.proof?.claim).toBe("plan.naive.violation_minutes_per_season");
  });

  it("does not merge when the file names no identical plans", () => {
    const rows = toPlanRows({ ...plans, identical_by_construction: [] }, ctx);
    expect(rows.map((r) => r.id)).toEqual(["naive", "ban_only", "rule_raw", "rule_corrected"]);
    expect(rows[0]?.label).toBe("Ban only");
  });

  it("shows missed protection in minutes (the file counts 5-minute ticks)", () => {
    const rows = toPlanRows(plans, ctx);
    const raw = plans.rows.find((r) => r.plan === "rule_raw");
    expect(rows[1]?.cells[2]?.value).toBe(makeFormat("en").whole((raw?.missed_protection_ticks.value ?? 0) * 5));
  });
});

describe("pending rows", () => {
  it("name the policies and plans and carry no cells", () => {
    expect(pendingPolicyRows(text).map((r) => r.id)).toEqual(["P0", "P1", "P2", "P3_protect"]);
    expect(pendingPlanRows(text).map((r) => r.id)).toEqual(["merged", "rule_raw", "rule_corrected"]);
    expect(pendingPolicyRows(text).every((r) => r.cells.length === 0)).toBe(true);
  });
});

describe("claim ids", () => {
  it("are stable slugs", () => {
    expect(policyClaim("P3_protect", "missed_danger_hours")).toBe("policy.p3.missed_danger_hours");
    expect(policyClaim("P3_balanced", "pod")).toBe("policy.p3_balanced.pod");
    expect(policyClaim("P0", "far")).toBe("policy.p0.far");
    expect(planClaim("ban_only", "high_cycled_share")).toBe("plan.ban_only.high_cycled_share");
  });
});
