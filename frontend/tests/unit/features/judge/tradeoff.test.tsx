import { readFileSync } from "node:fs";
import path from "node:path";
import { useTranslations } from "next-intl";
import { renderWithIntl } from "../../../utils/intl";
import { makeFormat, toPolicyRows, type PolicyScoreboard } from "@/features/judge/adapters";
import { policyTradeoff } from "@/features/judge/policy-tradeoff";
import type { JudgeT } from "@/features/judge/season-view";
import { policyTableText } from "@/features/judge/table-text";

/*
 * The Warnings trade-off paragraph (review item I1): generated from the rows of the scored file, so a clause cannot be untrue for the
 * data. The comparison words are computed from the numbers; the tests flip numbers in a copy of the file and the words flip with them.
 */

const root = path.resolve(import.meta.dirname, "../../../..");
const real = JSON.parse(readFileSync(path.join(root, "data/eval/2026/policy_scoreboard.json"), "utf8")) as PolicyScoreboard;
const format = makeFormat("en");
const FORBIDDEN = /calibrated|catches 90|fewer alerts than|best overall|highest CSI|beats every|beats ADOSH|robust|consistently|improved over static|untouched/i;

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

function edit(change: (rows: PolicyScoreboard["leads"][number]["rows"]) => void): PolicyScoreboard {
  const copy = structuredClone(real);
  const rows = copy.leads.find((l) => l.lead_days === 1)?.rows;
  if (rows === undefined) throw new Error("no lead 1");
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

  it("states the mixed truth with every number from the file", () => {
    const rows = real.leads.find((l) => l.lead_days === 1)?.rows ?? [];
    const v = (id: string, key: "missed_danger_hours" | "false_alarm_hours") => format.one(row(rows, id)[key].value);
    expect(text).toContain(`missed ${v("P3_protect", "missed_danger_hours")}`);
    // fewer than ban only and raw ADOSH, more than the fixed 32 rule; false alarms fewer than the fixed rule, more than raw ADOSH
    expect(text).toContain(`fewer than ban only (${v("P0", "missed_danger_hours")})`);
    expect(text).toContain(`fewer than ADOSH zones on the raw forecast (${v("P2", "missed_danger_hours")})`);
    expect(text).toContain(`more than the fixed 32 °C rule (${v("P1", "missed_danger_hours")})`);
    expect(text).toContain(`fewer than the fixed 32 °C rule (${v("P1", "false_alarm_hours")})`);
    expect(text).toContain(`more than ADOSH zones on the raw forecast (${v("P2", "false_alarm_hours")})`);
    expect(text).toContain("protective threshold (theta 0.30)");
    // at theta 0.45 the intervals of P3 and raw ADOSH overlap on both counts in this file
    expect(text).toContain("balanced threshold (theta 0.45)");
    expect(text).toContain("cannot be told apart");
    expect(text).not.toMatch(FORBIDDEN);
  });

  it("flips a clause when the file says the opposite (the sentence cannot be untrue for the data)", () => {
    const flipped = edit((rows) => {
      row(rows, "P1").missed_danger_hours.value = 99; // now the fixed rule misses MORE than ours
      row(rows, "P2").false_alarm_hours.value = 500; // now raw ADOSH raises MORE false alarms than ours
    });
    const out = run((t) => policyTradeoff(flipped, 1, format, t)) ?? "";
    expect(out).toContain("fewer than the fixed 32 °C rule (99.0)");
    expect(out).toContain("fewer than ADOSH zones on the raw forecast (500.0)");
    expect(out).not.toContain("more than the fixed 32 °C rule (99.0)");
  });

  it("says 'the same as' for a tie, and drops the balanced sentence when the intervals do not overlap", () => {
    const tied = edit((rows) => {
      row(rows, "P0").missed_danger_hours.value = row(rows, "P3_protect").missed_danger_hours.value;
      const b = row(rows, "P3_balanced").missed_danger_hours;
      if (b.ci !== null) b.ci = { lo: 1000, hi: 1001 };
    });
    const out = run((t) => policyTradeoff(tied, 1, format, t)) ?? "";
    expect(out).toMatch(/the same as ban only \(/);
    expect(out).not.toContain("cannot be told apart");
  });

  it("is null when a policy row is missing from the file", () => {
    const missing = edit((rows) => {
      rows.splice(
        rows.findIndex((r) => r.policy === "P1"),
        1,
      );
    });
    expect(run((t) => policyTradeoff(missing, 1, format, t))).toBeNull();
  });
});

describe("the Warnings rows name their policy code, and the baseline carries no made-up interval", () => {
  const rows = run((t) => toPolicyRows(real, 1, { file: { path: "eval/2026/policy_scoreboard.json", sha256: "a".repeat(64) }, format, text: policyTableText(t) }));

  it("puts the code of each policy in its description so the verdict sentences can be decoded", () => {
    const sub = (id: string) => rows.find((r) => r.id === id)?.sublabel ?? "";
    expect(sub("P0")).toMatch(/^P0\. /);
    expect(sub("P1")).toMatch(/^P1\. /);
    expect(sub("P2")).toMatch(/^P2\. /);
    expect(sub("P3_protect")).toMatch(/^P3, protective\. /);
    expect(sub("P3_balanced")).toMatch(/^P3, balanced\. /);
  });

  it("prints 'baseline, no interval' where the baseline's interval is a single point, never '0% to 0%'", () => {
    const p0 = rows.find((r) => r.id === "P0");
    const intervals = (p0?.cells ?? []).map((c) => c.interval ?? "");
    expect(intervals.some((i) => i === "baseline, no interval")).toBe(true);
    for (const i of intervals) expect(i).not.toMatch(/0(\.0)?%? to 0(\.0)?%?$/);
    // a real interval elsewhere is untouched
    expect(rows.find((r) => r.id === "P1")?.cells[0]?.interval).toMatch(/^95% interval \d/);
  });
});
