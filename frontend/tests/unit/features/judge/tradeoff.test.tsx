import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { useTranslations } from "next-intl";
import { renderWithIntl } from "../../../utils/intl";
import { makeFormat, toPlanRows, toPolicyRows, type PlanScoreboard, type PolicyScoreboard } from "@/features/judge/adapters";
import { policyTradeoff } from "@/features/judge/policy-tradeoff";
import type { JudgeT } from "@/features/judge/season-view";
import { policyTableText } from "@/features/judge/table-text";

/*
 * The honest reading under the Warnings table (review item I1): generated from the rows of the scored file, so a clause cannot be untrue for
 * the data. The comparison words are computed from the numbers; the tests flip numbers in a copy of the file and the words flip with them.
 * Every number it prints is asserted equal to the committed file AND, where the submission ledger is on this machine, to the ledger's own value.
 */

const root = path.resolve(import.meta.dirname, "../../../..");
const real = JSON.parse(readFileSync(path.join(root, "data/eval/2026/policy_scoreboard.json"), "utf8")) as PolicyScoreboard;
const format = makeFormat("en");
const FORBIDDEN = /calibrated|catches 90|fewer alerts than|best overall|highest CSI|beats every|beats ADOSH|robust|consistently|improved over static|untouched/i;

const LEDGER = process.env["SB_LEDGER"] ?? "D:/dev/stellar-blaze/docs/submission/numbers.json";
const ledger: Readonly<Record<string, { value: number; lo?: number; hi?: number }>> | null = existsSync(LEDGER)
  ? (JSON.parse(readFileSync(LEDGER, "utf8")) as { entries: Record<string, { value: number; lo?: number; hi?: number }> }).entries
  : null;

function run<T>(use: (t: JudgeT) => T): T {
  let out: T | undefined;
  function Probe() {
    out = use(useTranslations("judge.scoreboard"));
    return null;
  }
  renderWithIntl(<Probe />);
  if (out === undefined) throw new Error("probe did not run");
  return out;
}

function edit(change: (rows: PolicyScoreboard["leads"][number]["rows"]) => void, lead = 1): PolicyScoreboard {
  const copy = structuredClone(real);
  const rows = copy.leads.find((l) => l.lead_days === lead)?.rows;
  if (rows === undefined) throw new Error(`no lead ${String(lead)}`);
  change(rows);
  return copy;
}

const row = (rows: PolicyScoreboard["leads"][number]["rows"], id: string) => {
  const found = rows.find((r) => r.policy === id);
  if (found === undefined) throw new Error(id);
  return found;
};

describe("policyTradeoff on the real 2026 Warnings file", () => {
  const text = run((t) => policyTradeoff(real, 1, format, t));
  const rows = real.leads.find((l) => l.lead_days === 1)?.rows ?? [];
  const v = (id: string, key: "missed_danger_hours" | "false_alarm_hours") => format.one(row(rows, id)[key].value);

  it("states the mixed truth with every number from the file, in plain words (no code, no theta)", () => {
    // the fixed rule misses the fewest danger hours and raises the most false alarms of every row of the file
    expect(text).toContain(`The fixed 32 °C rule misses the fewest danger hours (${v("P1", "missed_danger_hours")}) but raises the most false alarms (${v("P1", "false_alarm_hours")}).`);
    // the regulator's zones raise fewer false alarms than ours at the protective setting and miss more, the missed hours' ranges overlapping
    expect(text).toContain(
      `The regulator's zones on the raw forecast raise fewer false alarms than Stellar Blaze at the protective setting (${v("P2", "false_alarm_hours")} hours against ${v("P3_protect", "false_alarm_hours")}) and miss more danger hours (${v("P2", "missed_danger_hours")} against ${v("P3_protect", "missed_danger_hours")}; the likely ranges overlap).`,
    );
    // at the balanced setting the intervals of ours and the regulator's zones overlap on both counts in this file
    expect(text).toContain(
      `At the balanced setting Stellar Blaze and the regulator's zones cannot be told apart: danger hours missed ${v("P3_balanced", "missed_danger_hours")} and ${v("P2", "missed_danger_hours")}, false-alarm hours ${v("P3_balanced", "false_alarm_hours")} and ${v("P2", "false_alarm_hours")}, with overlapping likely ranges.`,
    );
    expect(text).not.toMatch(FORBIDDEN);
    expect(text).not.toMatch(/\btheta\b|\bP[0-3]\b|ADOSH zones on the raw|ban only|95%/);
  });

  it("prints exactly the numbers the submission ledger holds (the relations the owner stated, checked against the data)", () => {
    const printed = (text ?? "").match(/\d+\.\d/g) ?? [];
    // the fixed rule (19.0, 276.5), the regulator's zones against ours (74.5, 183.5, 80.5, 45.5), the balanced setting against the regulator's zones (96.5, 80.5, 73.5, 74.5)
    expect([...printed].sort()).toEqual(["19.0", "276.5", "74.5", "183.5", "80.5", "45.5", "96.5", "80.5", "73.5", "74.5"].sort());
    // each value is the file's, with the ledger's key beside it
    const pairs: [string, string, number][] = [
      ["P1", "missed_danger_hours", 19],
      ["P1", "false_alarm_hours", 276.5],
      ["P2", "false_alarm_hours", 74.5],
      ["P3_protect", "false_alarm_hours", 183.5],
      ["P2", "missed_danger_hours", 80.5],
      ["P3_protect", "missed_danger_hours", 45.5],
      ["P3_balanced", "missed_danger_hours", 96.5],
      ["P3_balanced", "false_alarm_hours", 73.5],
    ];
    for (const [id, key, value] of pairs) {
      expect(row(rows, id)[key as "missed_danger_hours"].value, `${id} ${key}`).toBe(value);
      if (ledger !== null) expect(ledger[`warn.l1.${id}.${key}`]?.value, `ledger ${id} ${key}`).toBe(value);
    }
  });

  it("flips a clause when the file says the opposite (the sentence cannot be untrue for the data)", () => {
    const flipped = edit((rs) => {
      row(rs, "P2").false_alarm_hours.value = 500; // now the regulator's zones raise MORE false alarms than ours
      row(rs, "P2").missed_danger_hours.value = 10; // and miss FEWER danger hours
    });
    const out = run((t) => policyTradeoff(flipped, 1, format, t)) ?? "";
    expect(out).toContain("raise more false alarms than Stellar Blaze at the protective setting (500.0 hours against 183.5");
    expect(out).toContain("miss fewer danger hours (10.0 against 45.5");
    expect(out).not.toContain("raise fewer false alarms");
  });

  it("leaves the fixed rule's extremes out when the file does not show them, and drops the balanced sentence when the intervals do not overlap", () => {
    const tied = edit((rs) => {
      row(rs, "P0").missed_danger_hours.value = row(rs, "P1").missed_danger_hours.value; // ban only misses no more than the fixed rule: no longer the fewest
      const b = row(rs, "P3_balanced").missed_danger_hours;
      if (b.ci !== null) b.ci = { lo: 1000, hi: 1001 };
    });
    const out = run((t) => policyTradeoff(tied, 1, format, t)) ?? "";
    expect(out).not.toContain("misses the fewest danger hours");
    expect(out).not.toContain("cannot be told apart");
    expect(out).toContain("The regulator's zones on the raw forecast");
  });

  it("says 'the same number' for a tie", () => {
    const tie = edit((rs) => {
      row(rs, "P2").false_alarm_hours.value = row(rs, "P3_protect").false_alarm_hours.value;
    });
    expect(run((t) => policyTradeoff(tie, 1, format, t))).toContain("raise the same number of false alarms as Stellar Blaze at the protective setting");
  });

  it("test_tradeoff_overlap_qualifier: a compared pair whose likely ranges overlap says so, one whose ranges do not does not", () => {
    const ci = (id: string, key: "missed_danger_hours" | "false_alarm_hours") => row(rows, id)[key].ci;
    const overlaps = (a: { lo: number; hi: number } | null, b: { lo: number; hi: number } | null) => a !== null && b !== null && a.lo <= b.hi && b.lo <= a.hi;
    // the real file: the regulator's zones and ours overlap on missed hours but not on false alarms
    expect(overlaps(ci("P3_protect", "missed_danger_hours"), ci("P2", "missed_danger_hours"))).toBe(true);
    expect(overlaps(ci("P3_protect", "false_alarm_hours"), ci("P2", "false_alarm_hours"))).toBe(false);
    expect(text).toMatch(/\(80\.5 against 45\.5; the likely ranges overlap\)/);
    expect(text).not.toMatch(/hours against 183\.5; the likely ranges overlap\)/);
    // the fixed rule and ours overlap on both counts in this file, and the sentence says "both"
    expect(overlaps(ci("P1", "missed_danger_hours"), ci("P3_protect", "missed_danger_hours"))).toBe(true);
    expect(overlaps(ci("P1", "false_alarm_hours"), ci("P3_protect", "false_alarm_hours"))).toBe(true);
    expect(text).toContain("Its likely ranges overlap those of our protective setting on both counts.");

    // pull every other range away from ours: no qualifier at all, and the direction words are unchanged
    const apart = edit((rs) => {
      for (const id of ["P0", "P1", "P2"]) {
        for (const key of ["missed_danger_hours", "false_alarm_hours"] as const) {
          const metric = row(rs, id)[key];
          metric.ci = { lo: metric.value + 5000, hi: metric.value + 5001 };
        }
      }
    });
    const out = run((t) => policyTradeoff(apart, 1, format, t)) ?? "";
    expect(out).not.toContain("overlap");
    expect(out).toContain("raise fewer false alarms");
    expect(out).not.toMatch(FORBIDDEN);
    // and one whose ranges all overlap ours: every qualifier is there
    const together = edit((rs) => {
      const ours = row(rs, "P3_protect");
      for (const id of ["P0", "P1", "P2"]) {
        for (const key of ["missed_danger_hours", "false_alarm_hours"] as const) {
          const metric = row(rs, id)[key];
          metric.ci = { lo: ours[key].value - 1, hi: ours[key].value + 1 };
        }
      }
    });
    const all = run((t) => policyTradeoff(together, 1, format, t)) ?? "";
    expect(all).toContain("on both counts");
    expect(all.match(/the likely ranges overlap\)/g)).toHaveLength(2);
    expect(all).not.toMatch(FORBIDDEN);
  });

  it("is null when a policy row is missing from the file", () => {
    const missing = edit((rs) => {
      rs.splice(
        rs.findIndex((r) => r.policy === "P1"),
        1,
      );
    });
    expect(run((t) => policyTradeoff(missing, 1, format, t))).toBeNull();
  });

  it("reads the same on the stricter forecast (lead 2), from that lead's own rows", () => {
    const lead2 = run((t) => policyTradeoff(real, 2, format, t)) ?? "";
    const rs = real.leads.find((l) => l.lead_days === 2)?.rows ?? [];
    expect(lead2).toContain(
      `misses the fewest danger hours (${format.one(row(rs, "P1").missed_danger_hours.value)}) but raises the most false alarms (${format.one(row(rs, "P1").false_alarm_hours.value)})`,
    );
    expect(lead2).toContain(`(${format.one(row(rs, "P2").false_alarm_hours.value)} hours against ${format.one(row(rs, "P3_protect").false_alarm_hours.value)})`);
  });
});

describe("the Warnings rows are named without a policy code, and the baseline carries no made-up interval", () => {
  const rows = run((t) => toPolicyRows(real, 1, { file: { path: "eval/2026/policy_scoreboard.json", sha256: "a".repeat(64) }, format, text: policyTableText(t) }));

  it("names each way to warn in plain words, with no code in the label or the description", () => {
    const label = (id: string) => rows.find((r) => r.id === id)?.label ?? "";
    expect(["P0", "P1", "P2", "P3_protect", "P3_balanced"].map(label)).toEqual([
      "Midday break only",
      "Fixed 32 °C rule",
      "Regulator's zones, raw forecast",
      "Stellar Blaze, protective setting",
      "Stellar Blaze, balanced setting",
    ]);
    for (const r of rows) expect(`${r.label} ${r.sublabel}`, r.id).not.toMatch(/\bP[0-3]\b|theta/);
  });

  it("prints 'baseline, no interval' where the baseline's interval is a single point, never '0% to 0%'", () => {
    const p0 = rows.find((r) => r.id === "P0");
    const intervals = (p0?.cells ?? []).map((c) => c.interval ?? "");
    expect(intervals.some((i) => i === "baseline, no interval")).toBe(true);
    for (const i of intervals) expect(i).not.toMatch(/0(\.0)?%? to 0(\.0)?%?$/);
    // a real interval elsewhere is untouched
    expect(rows.find((r) => r.id === "P1")?.cells[0]?.interval).toMatch(/^likely range \d/);
  });
});

describe("the Plans card names its baseline and prints no made-up interval", () => {
  const plan = JSON.parse(readFileSync(path.join(root, "data/eval/2026/plan_scoreboard.json"), "utf8")) as PlanScoreboard;
  const rows = run((t) => toPlanRows(plan, { file: { path: "eval/2026/plan_scoreboard.json", sha256: "a".repeat(64) }, format, text: policyTableText(t) }));

  it("test_plans_baseline_no_interval: the merged ban-only row says 'baseline, no interval' where its interval is one point, never '0% to 0%' or '0 to 0'", () => {
    const merged = rows.find((r) => r.id === "merged");
    expect(merged).toBeDefined();
    const intervals = (merged?.cells ?? []).map((c) => c.interval ?? "");
    // share cycled to High (0%) and rest added against itself (0) are single points; the violation minutes and missed ticks are real intervals
    expect(intervals.filter((i) => i === "baseline, no interval")).toHaveLength(2);
    for (const i of intervals) expect(i).not.toMatch(/0(\.0)?%? to 0(\.0)?%?$/);
    expect(intervals.some((i) => /^likely range \d/.test(i))).toBe(true);
    // the other plans keep their measured intervals
    for (const id of ["rule_raw", "rule_corrected"]) {
      for (const c of rows.find((r) => r.id === id)?.cells ?? []) expect(c.interval ?? "").toMatch(/^likely range \d/);
    }
  });
});
