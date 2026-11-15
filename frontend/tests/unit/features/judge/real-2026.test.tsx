import { readFileSync } from "node:fs";
import path from "node:path";
import { screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { makeFormat, toPlanRows, toPolicyRows } from "@/features/judge/adapters";
import { rowClaims } from "@/features/judge/claims";
import { buildDay, hitsBy } from "@/features/judge/day-view";
import { DayView } from "@/features/judge/DayView";
import { parseHourlySeries } from "@/features/judge/facts";
import { DATA_MANIFEST } from "@/features/judge/manifest.generated";
import { ScoreboardView } from "@/features/judge/ScoreboardView";
import { ProofRows } from "@/components/provenance/ProofRows";
import { planTableText, policyTableText } from "@/features/judge/table-text";
import { renderWithIntl } from "../../../utils/intl";

/*
 * The REAL held-out 2026 files (data/eval/2026, copied by scripts/sync-eval-data.mjs from the B3 run) through the real screens.
 * What is pinned: the verdict sentences are the files' own, the truth stays mixed on screen (nothing a verdict does not say),
 * the plan cut always comes with its rest cost, a metric with no denominator is "not computed" and never a zero, the label and
 * the lock reach the proof, and no screen carries a phrase the architect's claim rules forbid.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/en/replay",
  useRouter: () => ({ replace: vi.fn() }),
  Link: ({ href, children, className, ...rest }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className} {...rest}>
      {children}
    </a>
  ),
}));

const { loadEval } = await import("@/features/judge/data");

const root = path.resolve(import.meta.dirname, "../../../..");
const json = (file: string): unknown => JSON.parse(readFileSync(path.join(root, file), "utf8")) as unknown;
const HOURLY = "static/omaa_2026_ifs_d1_wbgt_hourly.json" as const;
const hourly = {
  series: parseHourlySeries(json(`data/${HOURLY}`)),
  file: { path: HOURLY, sha256: DATA_MANIFEST[HOURLY].sha256 },
  source: DATA_MANIFEST[HOURLY].source,
};
const frontierSource = { label: "REAL weather + assumed crew", protocol: "recorded analysis" } as const;

/** What the architect's claim rules forbid on any scoreboard, landing, day or proof surface (English). */
const FORBIDDEN = /calibrated|catches 90|fewer alerts than|best overall|highest CSI|beats every|beats ADOSH|robust|consistently|improved over static|untouched/i;

const data = await loadEval({ dataRoot: path.join(root, "data"), production: true });
if (data.policy === null || data.plans === null || data.day === null || data.record === null) throw new Error("the 2026 files are not in data/eval/2026");
const { policy, plans, day, record } = data;

describe("the 2026 data the build ships", () => {
  it("production reads only data/eval/2026: every file is the held-out run's, with the lock the run started under", () => {
    expect(data.source).toBe("2026");
    for (const info of [data.files.policy, data.files.plans, data.files.day]) {
      expect(info?.path).toMatch(/^eval\/2026\//);
      expect(info?.evaluation?.lockSha256).toBe(record.lock_sha256);
    }
    expect(record.lock_sha256).toMatch(/^d9b9130a[0-9a-f]{56}$/);
    expect(policy.evaluation_set).toBe("scored_2026");
    expect(day.date).toBe("2026-06-14");
    // the record names exactly these bytes
    expect(record.files["policy_scoreboard.json"]?.sha256).toBe(data.files.policy?.sha256);
    expect(record.files["plan_scoreboard.json"]?.sha256).toBe(data.files.plans?.sha256);
    expect(record.files["demo_day.json"]?.sha256).toBe(data.files.day?.sha256);
  });

  it("is committed with LF endings", () => {
    for (const name of ["policy_scoreboard", "plan_scoreboard", "demo_day", "evaluation_record"]) {
      expect(readFileSync(path.join(root, "data/eval/2026", `${name}.json`)).includes(13), name).toBe(false);
    }
  });
});

describe("ScoreboardView on the real 2026 data", () => {
  const view = () =>
    renderWithIntl(<ScoreboardView data={data} hourly={hourly} frontierSource={frontierSource} />);

  it("test_verdict_text_is_rendered_verbatim_from_the_file: every sentence the runner wrote, none composed, H5 not hidden", () => {
    const { container } = view();
    const text = container.textContent;
    for (const verdict of [...policy.verdicts, ...plans.verdicts]) {
      expect(text, verdict.id).toContain(verdict.text);
    }
    // the file says H5 is not supported: that sentence is on the page
    const h5 = policy.verdicts.find((verdict) => verdict.id === "H5");
    expect(h5?.outcome).toBe("negative");
    expect(text).toContain("H5 not supported at lead 1 (secondary)");
    // the lead-2 stamp is carried only under the lead-2 table, where the file's own sentence allows it
    expect(container.querySelector("[data-lead='2']")?.textContent).toContain("issued by 18:00 GST the evening before");
  });

  it("shows all four policies and P3 at both thetas, at lead 1 and at lead 2, each number with an interval", () => {
    const { container } = view();
    for (const [selector, lead] of [["#warnings > table", 1], ["#warnings [data-lead='2'] table", 2]] as const) {
      const rows = [...container.querySelectorAll(`${selector} tbody tr`)];
      expect(rows.map((r) => r.getAttribute("data-row")), `lead ${String(lead)}`).toEqual(["P0", "P1", "P2", "P3_protect", "P3_balanced"]);
    }
    const p3 = container.querySelector("#warnings > table [data-row=P3_protect]")?.textContent ?? "";
    // POD with its interval and no target claim: 0.80..0.82 of danger hours at lead 1
    const lead1 = policy.leads.find((lead) => lead.lead_days === 1)?.rows.find((row) => row.policy === "P3_protect");
    expect(lead1?.pod.value).toBeCloseTo(0.8, 1);
    expect(p3).toContain("95% interval");
  });

  it("test_not_computed_rows_never_show_zero: the false-alarm share of the policy that never warns is 'not computed'", () => {
    const { container } = view();
    const p0 = container.querySelector("#warnings > table [data-row=P0]") as HTMLElement;
    // the file writes far.value 0 with n 0 and no interval for ban only
    const far = policy.leads.find((lead) => lead.lead_days === 1)?.rows.find((row) => row.policy === "P0")?.far;
    expect(far).toMatchObject({ value: 0, n: 0, ci: null });
    const cells = [...p0.querySelectorAll("td")];
    expect(cells.at(-1)?.querySelector("[data-not-computed]")?.textContent).toBe("not computed");
    expect(cells.at(-1)?.textContent).not.toMatch(/0\s?%/);
    // the real zeros (it warns nothing: 0 false-alarm hours over 1064 scored hours) stay numbers with proof
    expect(cells[1]?.querySelector("[data-proof-id]")).not.toBeNull();
  });

  it("test_plans_comparison_shows_both_numbers: the violation cut always beside the rest cost, over 138 scored days", () => {
    const { container } = view();
    const sentence = container.querySelector("[data-plans-tradeoff]")?.textContent ?? "";
    const row = (name: string) => plans.rows.find((r) => r.plan === name);
    const fmt = makeFormat("en").whole;
    expect(plans.n_days).toBe(138);
    for (const value of [
      row("ban_only")?.violation_minutes_per_season.value,
      row("rule_corrected")?.violation_minutes_per_season.value,
      row("rule_corrected")?.rest_minutes_added_vs_naive.value,
      row("rule_raw")?.rest_minutes_added_vs_naive.value,
    ]) {
      expect(sentence).toContain(fmt(value ?? Number.NaN));
    }
    expect(sentence).toContain("33,875");
    expect(sentence).toContain("2,140");
    expect(sentence).toContain("31,680");
    expect(sentence).toContain("13,560");
    expect(sentence).toContain("138 scored days");
    expect(sentence).toContain("simulated crew");
    // the table keeps the rest column next to the violation column
    expect(container.querySelector("#plans")?.textContent).toContain("Rest minutes added per worker-season");
  });

  it("labels the evaluation held-out and pre-registered, ban only as a baseline, and keeps the site and crew honesty lines", () => {
    const { container } = view();
    const text = container.textContent;
    expect(text).toContain("Held-out 2026, every choice fixed on 2024-2025 data");
    expect(container.querySelector("[data-evaluation]")?.textContent).toContain("under a protocol locked before the run");
    expect(text).toContain("Baseline: ban only");
    expect(text).toContain("Abu Dhabi airport only (OMAA), one summer the models had not seen.");
    expect(text).toContain("Simulated crew, real weather.");
    expect(text).not.toMatch(/DEV 2025|###/);
    expect(container.querySelector("[data-scoreboard=pending]")).toBeNull();
    // the H4 result is not a stable one: the page says so by naming the prior run, never "robust"
    expect(container.querySelector("[data-verdict-caption]")?.textContent).toBe(
      "Supported on 2026 (pre-registered). On the 2025 development run, the prior run, this check was not supported.",
    );
  });

  it("prints no export key and no forbidden claim", () => {
    const { container } = view();
    const text = container.textContent;
    expect(text).not.toMatch(FORBIDDEN);
    expect(text).not.toMatch(/\b[a-z]+_[a-z0-9]+(?:_[a-z0-9]+)*\b|B0_|P3_/);
  });

  it("test_label_and_lock_hash_through_the_proof_chip: REAL for warnings, REAL weather + assumed crew for plans, the lock in the drawer rows", () => {
    const format = makeFormat("en");
    const files = data.files;
    const t = ((key: string) => key) as never;
    const policyProof = rowClaims(toPolicyRows(policy, 1, { file: files.policy as NonNullable<typeof files.policy>, format, text: policyTableText(t) }))[0]?.proof;
    const planProof = rowClaims(toPlanRows(plans, { file: files.plans as NonNullable<typeof files.plans>, format, text: planTableText(t) }))[0]?.proof;
    expect(policyProof?.label).toBe("REAL");
    expect(planProof?.label).toBe("REAL weather + assumed crew");
    for (const proof of [policyProof, planProof]) {
      expect(proof?.evaluation).toEqual({ lockSha256: record.lock_sha256, protocolCommit: record.protocol_commit });
      expect(proof?.file).toMatch(/^eval\/2026\//);
    }
    if (policyProof === undefined) throw new Error("no proof");
    renderWithIntl(<ProofRows proof={policyProof} />);
    expect(screen.getByText("Pre-registration")).toBeInTheDocument();
    expect(screen.getByText(record.lock_sha256)).toBeInTheDocument();
    expect(screen.getByText(record.protocol_commit)).toBeInTheDocument();
    expect(screen.getByText("REAL")).toBeInTheDocument();
  });
});

describe("DayView on the real 2026 day", () => {
  it("draws the day the file says, with five counters (both thetas) each with a proof, and no pending copy", () => {
    const { container } = renderWithIntl(<DayView data={data} hourly={hourly} />);
    expect(container.querySelector("[data-day-shown=scored]")?.textContent).toContain("Sun 14 Jun");
    expect(container.querySelector("h1")?.textContent).toBe("One day, hour by hour, chosen by a rule before we looked");
    const ids = [...container.querySelectorAll("[data-counter-id]")].map((el) => el.getAttribute("data-counter-id"));
    expect(ids).toEqual(["high", "outside", "raw", "ours", "balanced"]);
    for (const el of container.querySelectorAll("[data-counter-id]")) expect(el.querySelector("[data-proof-id]")).not.toBeNull();
    const counter = (id: string) => container.querySelector(`[data-counter-id=${id}]`)?.textContent ?? "";
    expect(counter("high")).toContain("7.0");
    expect(counter("raw")).toContain("5.0");
    expect(counter("ours")).toContain("6.0");
    expect(counter("balanced")).toContain("5.0");
    const text = container.textContent;
    expect(text).not.toMatch(/added by the scoring run|###|DEV 2025/);
    expect(text).not.toMatch(FORBIDDEN);
  });

  it("counts the balanced threshold the way the file counts its own two fields", () => {
    expect(hitsBy(day, "P2")).toBe(day.raw_hits);
    expect(hitsBy(day, "P3_protect")).toBe(day.p3_hits);
    expect(hitsBy(day, "P3_balanced")).toBe(5);
  });

  it("the pending state keeps the neutral heading: the rule claim belongs to the scored day (Part G3 I2)", () => {
    const { container } = renderWithIntl(<DayView data={{ ...data, day: null, files: { ...data.files, day: null } }} hourly={hourly} />);
    expect(container.querySelector("h1")?.textContent).toBe("One day, hour by hour");
    expect(container.textContent).not.toContain("chosen by a rule before we looked");
  });
});

describe("no forbidden phrase anywhere in the English catalogue", () => {
  it("scans every string of messages/en.json", () => {
    const strings: string[] = [];
    const walk = (value: unknown): void => {
      if (typeof value === "string") strings.push(value);
      else if (typeof value === "object" && value !== null) Object.values(value).forEach(walk);
    };
    walk(json("messages/en.json"));
    expect(strings.filter((s) => FORBIDDEN.test(s))).toEqual([]);
  });

  it("the day builder's counters are the five claim ids the proof sheet serves", () => {
    const model = buildDay({ day, dayFile: data.files.day, hourly, locale: "en", t: ((key: string) => key) as never });
    expect(model.counters?.map((c) => c.proof?.claim)).toEqual(["day.high", "day.outside", "day.raw", "day.ours", "day.balanced"]);
  });
});
