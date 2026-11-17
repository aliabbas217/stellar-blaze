import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createTranslator } from "next-intl";
import { makeFormat, type PlanScoreboard, type PolicyScoreboard } from "@/features/judge/adapters";
import { plainPlanVerdicts, plainPolicyVerdicts, type PlainVerdict } from "@/features/judge/verdict-plain";
import { JARGON } from "../../../utils/jargon";
import messages from "../../../../messages/en.json";

/*
 * The plain verdicts (verdict-plain.ts), on the REAL committed 2026 files. What is pinned:
 *   1. every number in a sentence equals the field it was read from and, where the submission ledger is on this machine, the ledger's own value;
 *   2. "met" or "not met" is the file's own `outcome` flag, never a reading of the numbers (the tests flip the flag and keep the numbers, and
 *      flip the numbers and keep the flag);
 *   3. a difference whose paired interval includes zero is never called fewer or more;
 *   4. an incomplete record gets the neutral line and no number, and an id with no template the same;
 *   5. no sentence carries jargon, and none says the product beats anything.
 */

const root = path.resolve(import.meta.dirname, "../../../..");
const json = (file: string): unknown => JSON.parse(readFileSync(path.join(root, file), "utf8")) as unknown;
const policy = json("data/eval/2026/policy_scoreboard.json") as PolicyScoreboard;
const plans = json("data/eval/2026/plan_scoreboard.json") as PlanScoreboard;
const format = makeFormat("en");

const LEDGER = process.env["SB_LEDGER"] ?? "D:/dev/stellar-blaze/docs/submission/numbers.json";
interface LedgerEntry {
  readonly value: number;
  readonly lo?: number;
  readonly hi?: number;
}
const ledger: Readonly<Record<string, LedgerEntry>> | null = existsSync(LEDGER) ? (JSON.parse(readFileSync(LEDGER, "utf8")) as { entries: Record<string, LedgerEntry> }).entries : null;
const entry = (key: string): LedgerEntry => {
  const found = ledger?.[key];
  if (found === undefined) throw new Error(`ledger has no ${key}`);
  return found;
};

const translate = createTranslator({
  locale: "en",
  messages,
  namespace: "judge.scoreboard.verdict.plain",
  onError: (error) => {
    throw error;
  },
}) as unknown as (key: string, values?: Readonly<Record<string, string>>) => string;

const sentence = (verdict: PlainVerdict): string => verdict.lines.map((l) => translate(l.key, l.values)).join(" ");
const numbers = (text: string): string[] => text.match(/\d[\d,]*(?:\.\d+)?/g) ?? [];

const policyVerdicts = plainPolicyVerdicts(policy, format);
const planVerdicts = plainPlanVerdicts(plans, format);
const by = (list: readonly PlainVerdict[], id: string): PlainVerdict => {
  const found = list.find((v) => v.id === id);
  if (found === undefined) throw new Error(`no verdict ${id}`);
  return found;
};
const one = (n: number): string => format.one(n);
const whole = (n: number): string => format.whole(n);

/** The paired difference of a ledger entry as a reader reads it: the size without a sign, and the likely range in the same terms. */
function read(key: string, show: (n: number) => string, scale = 1): { a: string; lo: string; hi: string } {
  const e = entry(key);
  const abs = Math.abs(e.value * scale);
  const ends = [Math.abs((e.lo ?? NaN) * scale), Math.abs((e.hi ?? NaN) * scale)];
  return { a: show(abs), lo: show(Math.min(...ends)), hi: show(Math.max(...ends)) };
}

describe("every plain verdict of the real 2026 files", () => {
  it("has a plain sentence for all five checks, in the file's order, and none is the neutral line", () => {
    expect(policyVerdicts.map((v) => v.id)).toEqual(["H4", "H5", "H4-lead2"]);
    expect(planVerdicts.map((v) => v.id)).toEqual(["H6", "H7"]);
    for (const verdict of [...policyVerdicts, ...planVerdicts]) {
      expect(verdict.outcome, verdict.id).not.toBeNull();
      expect(sentence(verdict), verdict.id).not.toContain("under For auditors");
    }
  });

  it("says met or not met exactly as the file's flag does (H4, H4 on the stricter forecast, H6 and H7 met; H5 not met)", () => {
    const flags = [...policy.verdicts, ...plans.verdicts].map((v) => [v.id, v.outcome] as const);
    expect(flags).toEqual([
      ["H4", "supported"],
      ["H5", "negative"],
      ["H4-lead2", "supported"],
      ["H6", "supported"],
      ["H7", "supported"],
    ]);
    for (const verdict of [...policyVerdicts, ...planVerdicts]) {
      const file = [...policy.verdicts, ...plans.verdicts].find((v) => v.id === verdict.id);
      expect(verdict.outcome, verdict.id).toBe(file?.outcome === "supported" ? "met" : "notMet");
      const text = sentence(verdict);
      // the sentence says it in words: "was met" / "was not met", never one where the other belongs
      expect(/\bwas not met\b/.test(text), verdict.id).toBe(file?.outcome !== "supported");
      expect(/\bwas met\b/.test(text), verdict.id).toBe(file?.outcome === "supported");
    }
  });

  it("H5 reads as not met in plain words, says why from the file's own numbers, and does not claim to beat the regulator's zones", () => {
    const text = sentence(by(policyVerdicts, "H5"));
    expect(text).toBe(
      "Against the regulator's own zones on the raw forecast, our protective setting missed 35.0 fewer danger hours (likely range 19.5 to 54.0 fewer). It raised 109.0 more false-alarm hours (likely range 67.5 to 160.0 more). That is more extra false alarms than we had allowed in advance. This check was not met. We do not claim to beat the regulator's zones.",
    );
    // the only mention of beating is the disclaimer itself
    expect(text.replace("We do not claim to beat the regulator's zones.", "")).not.toMatch(/\bbeats?\b|better|best|outperform|wins?\b/i);
  });

  it("H4 and its stricter-forecast twin say what the file's paired intervals say, with the 'main check' only on the primary", () => {
    const h4 = sentence(by(policyVerdicts, "H4"));
    expect(h4).toBe(
      "Against the midday break alone, our protective setting missed 207.0 fewer danger hours (likely range 154.5 to 261.5 fewer). It raised 93.0 fewer false-alarm hours than the fixed 32 °C rule (likely range 37.0 to 148.5 fewer). This was the main check and it was met.",
    );
    const lead2 = sentence(by(policyVerdicts, "H4-lead2"));
    expect(lead2).toBe(
      "On the stricter forecast, issued by 18:00 the evening before: Against the midday break alone, our protective setting missed 202.0 fewer danger hours (likely range 150.5 to 255.0 fewer). It raised 75.5 fewer false-alarm hours than the fixed 32 °C rule (likely range 32.5 to 119.0 fewer). This check was met.",
    );
  });

  it("H6 and H7 name the crew as assumed, and show H7 in minutes as the table does (5-minute ticks times 5)", () => {
    expect(sentence(by(planVerdicts, "H6"))).toBe(
      "Against the midday break alone, the plan built from our corrected forecast had 31,735 fewer minutes worked against the rules, per worker per season (likely range 25,844 to 37,415 fewer). Real weather, assumed crew of 20 doing heavy work. This was the main check and it was met.",
    );
    expect(sentence(by(planVerdicts, "H7"))).toBe(
      "Against the plan built from the raw forecast, the plan built from our corrected forecast treated 2,930 fewer minutes as safer than the station's record (likely range 1,835 to 4,150 fewer). This check was met.",
    );
  });

  it("every number in every sentence is a number the template was given, formatted from the file's own fields", () => {
    const expected: Record<string, string[]> = {
      H4: [
        ...Object.values(fromFile(policy, "H4", 0, one)),
        ...Object.values(fromFile(policy, "H4", 1, one)),
        "32", // the fixed 32 °C rule's name
      ],
      H5: [...Object.values(fromFile(policy, "H5", 0, one)), ...Object.values(fromFile(policy, "H5", 1, one))],
      "H4-lead2": [...Object.values(fromFile(policy, "H4-lead2", 0, one)), ...Object.values(fromFile(policy, "H4-lead2", 1, one)), "32", "18", "00"],
      H6: [...Object.values(fromFile(plans, "H6", 0, whole)), String(plans.headcount)],
      H7: Object.values(fromFile(plans, "H7", 0, whole, 5)),
    };
    for (const verdict of [...policyVerdicts, ...planVerdicts]) {
      expect(numbers(sentence(verdict)).sort(), verdict.id).toEqual([...(expected[verdict.id] ?? [])].sort());
    }
  });

  it.runIf(ledger !== null)("every number equals the submission ledger's own value for the committed files", () => {
    const keys: Record<string, [string, (n: number) => string, number?][]> = {
      H4: [
        ["warn.H4.P3_protect_vs_P0.missed_danger_hours", one],
        ["warn.H4.P3_protect_vs_P1.false_alarm_hours", one],
      ],
      H5: [
        ["warn.H5.P3_protect_vs_P2.missed_danger_hours", one],
        ["warn.H5.P3_protect_vs_P2.false_alarm_hours", one],
      ],
      "H4-lead2": [
        ["warn.H4-lead2.P3_protect_vs_P0.missed_danger_hours", one],
        ["warn.H4-lead2.P3_protect_vs_P1.false_alarm_hours", one],
      ],
      H6: [["plan.H6.rule_corrected_vs_ban_only.violation_minutes_per_season", whole]],
      H7: [["plan.H7.rule_corrected_vs_rule_raw.missed_protection_ticks", whole, 5]],
    };
    for (const verdict of [...policyVerdicts, ...planVerdicts]) {
      const text = sentence(verdict);
      for (const [key, show, scale] of keys[verdict.id] ?? []) {
        const { a, lo, hi } = read(key, show, scale ?? 1);
        expect(text, `${verdict.id} ${key}`).toContain(`${a} `);
        expect(text, `${verdict.id} ${key}`).toContain(`likely range ${lo} to ${hi} `);
      }
    }
    // the crew size and the ledger's own flags
    expect(sentence(by(planVerdicts, "H6"))).toContain(`crew of ${String(entry("crew.size").value)} `);
    expect(entry("warn.H5.P3_protect_vs_P2.false_alarm_hours").value).toBeGreaterThan(0);
  });
});

/** The size and the likely range of comparison `index` of the verdict `id`, as a reader reads them, straight from the file. */
function fromFile(sb: PolicyScoreboard | PlanScoreboard, id: string, index: number, show: (n: number) => string, scale = 1): { a: string; lo: string; hi: string } {
  const comparison = sb.verdicts.find((v) => v.id === id)?.comparisons[index];
  if (comparison === undefined || comparison.difference.ci === null) throw new Error(`no comparison ${id}/${String(index)}`);
  const { value, ci } = comparison.difference;
  const ends = [Math.abs(ci.lo * scale), Math.abs(ci.hi * scale)];
  return { a: show(Math.abs(value * scale)), lo: show(Math.min(...ends)), hi: show(Math.max(...ends)) };
}

describe("met or not met is the file's flag, not a reading of the numbers", () => {
  const withOutcome = (outcome: "supported" | "negative"): PolicyScoreboard => {
    const copy = structuredClone(policy);
    for (const verdict of copy.verdicts) verdict.outcome = outcome;
    return copy;
  };

  it("flips with the flag while the numbers stay the same", () => {
    const allMet = plainPolicyVerdicts(withOutcome("supported"), format);
    const allNot = plainPolicyVerdicts(withOutcome("negative"), format);
    for (const verdict of allMet) expect(sentence(verdict), verdict.id).toMatch(/\bwas met\b/);
    for (const verdict of allNot) expect(sentence(verdict), verdict.id).toMatch(/\bwas not met\b/);
    // the numbers did not move
    for (let i = 0; i < allMet.length; i++) expect(numbers(sentence(allMet[i] as PlainVerdict)), String(i)).toEqual(numbers(sentence(allNot[i] as PlainVerdict)));
    // and a not-met H5 never loses the line that says we do not claim to beat the regulator's zones; a met one never gets it
    expect(sentence(by(allNot, "H5"))).toContain("We do not claim to beat the regulator's zones.");
    expect(sentence(by(allMet, "H5"))).not.toContain("We do not claim to beat");
  });

  it("does not turn a not-met flag into a met sentence when the numbers look good (H4 flagged negative reads not met)", () => {
    const copy = structuredClone(policy);
    const h4 = copy.verdicts.find((v) => v.id === "H4");
    if (h4 === undefined) throw new Error("no H4");
    h4.outcome = "negative";
    const text = sentence(by(plainPolicyVerdicts(copy, format), "H4"));
    expect(text).toContain("This was the main check and it was not met.");
    expect(text).not.toContain("it was met");
  });

  it("gives no reason for a not-met H5 when the numbers show none (the reason is computed, never assumed)", () => {
    const copy = structuredClone(policy);
    const h5 = copy.verdicts.find((v) => v.id === "H5");
    const alarms = h5?.comparisons.find((c) => c.metric === "false_alarm_hours");
    if (h5 === undefined || alarms === undefined) throw new Error("no H5");
    alarms.difference.value = 10; // a few more false alarms: within the quarter the plan allowed over 74.5
    alarms.difference.ci = { lo: 5, hi: 15 };
    const text = sentence(by(plainPolicyVerdicts(copy, format), "H5"));
    expect(text).toContain("It raised 10.0 more false-alarm hours");
    expect(text).not.toContain("more extra false alarms than we had allowed");
    expect(text).toContain("This check was not met.");
  });
});

describe("a difference whose interval includes zero is never called fewer or more", () => {
  it("says it is too small to tell apart, with the signed range and no size", () => {
    const copy = structuredClone(policy);
    const h5 = copy.verdicts.find((v) => v.id === "H5");
    const missed = h5?.comparisons.find((c) => c.metric === "missed_danger_hours");
    if (h5 === undefined || missed === undefined) throw new Error("no H5");
    missed.difference.value = -2;
    missed.difference.ci = { lo: -10, hi: 6 };
    const text = sentence(by(plainPolicyVerdicts(copy, format), "H5"));
    expect(text).toContain("the difference in danger hours missed is too small to tell apart (likely range -10.0 to 6.0, which includes zero).");
    expect(text).not.toMatch(/missed [\d.]+ (fewer|more) danger hours/);
    expect(text).toContain("the range did not show one"); // the check needed a clear drop in missed hours
  });
});

describe("an incomplete record gets the neutral line and no number", () => {
  const neutral = "The details of this check are under For auditors.";

  it("a missing comparison, a missing interval or a sign that contradicts its interval", () => {
    const missing = structuredClone(policy);
    const h4 = missing.verdicts.find((v) => v.id === "H4");
    if (h4 === undefined) throw new Error("no H4");
    h4.comparisons = h4.comparisons.slice(0, 1);
    const noInterval = structuredClone(policy);
    const first = noInterval.verdicts.find((v) => v.id === "H5")?.comparisons[0];
    if (first === undefined) throw new Error("no H5");
    first.difference.ci = null;
    const contradicts = structuredClone(policy);
    const h4c = contradicts.verdicts.find((v) => v.id === "H4")?.comparisons[0];
    if (h4c === undefined) throw new Error("no H4");
    h4c.difference.value = 50; // a point estimate above zero inside an interval wholly below zero
    for (const [name, sb, id] of [
      ["missing comparison", missing, "H4"],
      ["missing interval", noInterval, "H5"],
      ["sign against interval", contradicts, "H4"],
    ] as const) {
      const verdict = by(plainPolicyVerdicts(sb, format), id);
      expect(verdict.outcome, name).toBeNull();
      expect(sentence(verdict), name).toBe(neutral);
      expect(numbers(sentence(verdict)), name).toEqual([]);
    }
  });

  it("an id with no template, and a comparison between other policies", () => {
    const other = structuredClone(policy);
    const first = other.verdicts[0];
    if (first === undefined) throw new Error("no verdict");
    first.id = "H9";
    expect(sentence(by(plainPolicyVerdicts(other, format), "H9"))).toBe(neutral);
    const swapped = structuredClone(plans);
    const h6 = swapped.verdicts.find((v) => v.id === "H6")?.comparisons[0];
    if (h6 === undefined) throw new Error("no H6");
    h6.baseline = "naive"; // the template reads the comparison against the midday break alone (ban_only), not this one
    expect(sentence(by(plainPlanVerdicts(swapped, format), "H6"))).toBe(neutral);
  });

  it("the synthetic shape fixture (different comparisons) never prints a number in the story layer", () => {
    const fixture = json("tests/fixtures/eval/policy_scoreboard.synthetic.json") as PolicyScoreboard;
    for (const verdict of plainPolicyVerdicts(fixture, format)) {
      expect(sentence(verdict), verdict.id).toBe(neutral);
    }
  });
});

describe("no jargon and no boast in a plain verdict, in any variant", () => {
  const variants: PlainVerdict[] = [
    ...policyVerdicts,
    ...planVerdicts,
    ...plainPolicyVerdicts(
      (() => {
        const copy = structuredClone(policy);
        for (const verdict of copy.verdicts) verdict.outcome = "negative";
        return copy;
      })(),
      format,
    ),
  ];

  it.each(JARGON.filter(([name]) => name !== "export key"))("no %s in any sentence", (_name, pattern) => {
    expect(variants.filter((verdict) => pattern.test(sentence(verdict))).map((verdict) => verdict.id)).toEqual([]);
  });

  it("never says the product beats, wins or is best, and never 'never looked at'", () => {
    for (const verdict of variants) expect(sentence(verdict), verdict.id).not.toMatch(/\bbeats?\b(?! the regulator)|\bwins?\b|best|never looked|calibrated|robust|consistently/i);
  });
});

describe("the catalogue of the four judge pages is free of jargon outside the auditor layer", () => {
  const strings: { key: string; text: string }[] = [];
  const walk = (value: unknown, key: string): void => {
    if (typeof value === "string") strings.push({ key, text: value });
    else if (typeof value === "object" && value !== null) for (const [k, v] of Object.entries(value)) walk(v, `${key}.${k}`);
  };
  for (const page of ["scoreboard", "day", "try", "governance"] as const) walk(messages.judge[page], `judge.${page}`);
  // the catalogue holds placeholders on purpose, and nothing here is an export key (the rendered-page tests scan for those)
  const patterns = JARGON.filter(([name]) => name !== "placeholder" && name !== "export key");

  it("covers a real number of strings (the scan is not vacuous)", () => {
    expect(strings.length).toBeGreaterThan(300);
  });

  it.each(patterns)("no %s in any string", (_name, pattern) => {
    expect(strings.filter(({ text }) => pattern.test(text)).map(({ key, text }) => `${key}: ${text}`)).toEqual([]);
  });
});
