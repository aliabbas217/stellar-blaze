import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { screen } from "@testing-library/react";
import { createTranslator } from "next-intl";
import type { ReactNode } from "react";
import { AuditRows, StoryRows } from "@/components/provenance/ProofRows";
import { proofFromForecast, type Proof } from "@/components/provenance/proof";
import { buildStory, longDate, period, stationName, type ProofStory } from "@/components/provenance/proof-story";
import { makeFormat, toPlanRows, toPolicyRows } from "@/features/judge/adapters";
import { forecastClaims, frontierClaims, rowClaims, type Claim } from "@/features/judge/claims";
import { buildDay } from "@/features/judge/day-view";
import { SEASON_BAN } from "@/features/judge/ban";
import { parseHourlySeries, seasonFacts } from "@/features/judge/facts";
import { HEAVY_WORK_LIMIT_WBGT_C } from "@/features/judge/limit";
import { DATA_MANIFEST } from "@/features/judge/manifest.generated";
import { parseRosterFrontier } from "@/features/judge/roster-frontier";
import { planTableText, policyTableText } from "@/features/judge/table-text";
import { renderWithIntl } from "../../../utils/intl";
import { JARGON } from "../../../utils/jargon";
import { SAMPLE_STORY } from "../../../utils/story";
import messages from "../../../../messages/en.json";

/*
 * "Where this number comes from" (proof-story.ts): the plain story of a number, built from structured fields by fixed templates.
 * Three guarantees are pinned here, on the REAL committed 2026 files and on every claim family:
 *   1. every number in a sentence equals the field it was read from (and, where the submission ledger is on this machine, the ledger's
 *      own value),
 *   2. no sentence carries jargon: a file path or extension, a fingerprint, "protocol", a policy code, theta, "lead 1", an epoch, a
 *      fixture, an ADR number, an export key, or a placeholder (the leak was data-driven, so this runs on data, not only on the catalogue),
 *   3. the auditor rows print only fields that have a value.
 */

vi.mock("server-only", () => ({}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

const { loadEval } = await import("@/features/judge/data");

const root = path.resolve(import.meta.dirname, "../../../..");
const json = (file: string): unknown => JSON.parse(readFileSync(path.join(root, file), "utf8")) as unknown;
const HOURLY = "static/omaa_2026_ifs_d1_wbgt_hourly.json" as const;
const series = parseHourlySeries(json(`data/${HOURLY}`));
const hourly = { series, file: { path: HOURLY, sha256: DATA_MANIFEST[HOURLY].sha256 }, source: DATA_MANIFEST[HOURLY].source };
const data = await loadEval({ dataRoot: path.join(root, "data"), production: true });
if (data.policy === null || data.plans === null || data.day === null || data.record === null || data.frontier === null) throw new Error("the 2026 files are not in data/eval/2026");
const { policy, plans, day, record } = data;
const files = data.files as { policy: NonNullable<typeof data.files.policy>; plans: NonNullable<typeof data.files.plans>; day: NonNullable<typeof data.files.day> };

// ---- rendering: the English catalogue, and a translator that THROWS on a missing key or argument ----

const translate = createTranslator({
  locale: "en",
  messages,
  namespace: "states.proof.story",
  onError: (error) => {
    throw error;
  },
}) as unknown as (key: string, values?: Readonly<Record<string, string>>) => string;

function rows(story: ProofStory): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of story.rows) out[row.id] = row.lines.map((line) => translate(line.key, line.values)).join(" ");
  return out;
}

function sentences(story: ProofStory): string {
  const note = story.note === null ? "" : ` ${translate(story.note.key, story.note.values)}`;
  return `${Object.values(rows(story)).join(" ")}${note}`;
}

// ---- the claims of every family, from the real files and the real adapters ----

const format = makeFormat("en");
const identity = ((key: string) => key) as never;
const policyClaims = [
  ...rowClaims(toPolicyRows(policy, 1, { file: files.policy, format, text: policyTableText(identity) })),
  ...rowClaims(toPolicyRows(policy, 2, { file: files.policy, format, text: policyTableText(identity) })),
];
const planClaims = rowClaims(toPlanRows(plans, { file: files.plans, format, text: planTableText(identity) }));
const dayModel = buildDay({ day, dayFile: files.day, hourly, locale: "en", t: identity });
const dayProofs = (dayModel.counters ?? []).flatMap((counter) => (counter.proof === null ? [] : [{ id: counter.id, proof: counter.proof }]));
const facts = seasonFacts(series, SEASON_BAN, HEAVY_WORK_LIMIT_WBGT_C);
const forecast = forecastClaims(
  facts,
  { file: hourly.file, protocol: hourly.source, series, limit: HEAVY_WORK_LIMIT_WBGT_C },
  format,
  { daysOverLimit: "days", hoursOverLimit: "hours", hoursInBreak: "break" },
);
const frontierData = parseRosterFrontier(json("data/static/roster_frontier.json"));
const frontierSet = frontierClaims(
  frontierData,
  { file: { path: "static/roster_frontier.json", sha256: DATA_MANIFEST["static/roster_frontier.json"].sha256 }, label: "REAL weather + assumed crew", protocol: "recorded analysis" },
  format,
  { best: (m) => `best ${String(m)}`, legal: "legal" },
);

/** Every story the product can show, with a name for the failure message. */
function everyStory(): { name: string; story: ProofStory }[] {
  const season = { station: policy.station, seasonStart: policy.season_start, seasonEnd: policy.season_end, nDays: policy.n_days };
  const all: { name: string; story: ProofStory }[] = [
    ...[...policyClaims, ...planClaims, ...forecast, ...frontierSet].map((claim) => ({ name: claim.id, story: claim.proof.story })),
    ...dayProofs.map(({ id, proof }) => ({ name: `day.${id}`, story: proof.story })),
    { name: "rule (scored)", story: dayModel.ruleProof.story },
    { name: "rule (pending)", story: buildStory("rule", { station: "OMAA (Abu Dhabi Intl)", date: null, candidates: null }) },
    { name: "level (demo)", story: proofFromForecast({ site_id: "s", date: "2026-07-01", policy_version: "v", config_version: 1, model_id: null, generated_at: "2026-06-30T14:00:00Z" } as never, "x", { synthetic: true }).story },
    { name: "level (real)", story: buildStory("level", {}) },
    { name: "truth", story: buildStory("truth", { ...season, marginWm2: policy.margin_w_m2, range: { lo: "191.5", hi: "315.5", unit: "hours" } }) },
    { name: "truth (no range, no margin)", story: buildStory("truth", { ...season, marginWm2: null, range: null }) },
    { name: "evaluation", story: buildStory("evaluation", { ...season, amendments: record.amendments.length }) },
    { name: "evaluation (no record)", story: buildStory("evaluation", { ...season, amendments: null }) },
    { name: "verdict", story: buildStory("verdict", season) },
    { name: "field", story: buildStory("field", { day: "2026-09-03" }) },
  ];
  return all;
}

// ---- 1. the numbers ----

const LEDGER = process.env["SB_LEDGER"] ?? "D:/dev/stellar-blaze/docs/submission/numbers.json";
interface LedgerEntry {
  readonly value: number | string;
  readonly lo?: number;
  readonly hi?: number;
}
const ledger: Readonly<Record<string, LedgerEntry>> | null = existsSync(LEDGER)
  ? (JSON.parse(readFileSync(LEDGER, "utf8")) as { entries: Record<string, LedgerEntry> }).entries
  : null;
const entry = (key: string): LedgerEntry => {
  const found = ledger?.[key];
  if (found === undefined) throw new Error(`ledger has no ${key}`);
  return found;
};
const one = (n: number): string => n.toFixed(1);
const claimOf = (claims: readonly Claim[], id: string): Claim => {
  const found = claims.find((claim) => claim.id === id);
  if (found === undefined) throw new Error(`no claim ${id}`);
  return found;
};

describe("buildStory: every number equals its source field (the committed 2026 files)", () => {
  it("a policy cell: the season, the days, the likely range and the margin are the file's own", () => {
    const row = policy.leads[0]?.rows.find((r) => r.policy === "P3_protect");
    if (row === undefined || row.missed_danger_hours.ci === null) throw new Error("no row");
    const said = rows(claimOf(policyClaims, "policy.p3.missed_danger_hours").proof.story);
    expect(said["about"]).toBe(`Abu Dhabi airport, 15 May to 30 September 2026, working hours. ${String(policy.n_days)} days.`);
    expect(said["shows"]).toContain(`Likely range ${one(row.missed_danger_hours.ci.lo)} to ${one(row.missed_danger_hours.ci.hi)} hours.`);
    expect(said["doesNotShow"]).toContain(`(${String(policy.margin_w_m2)} W/m²)`);
    expect(said["madeBy"]).toContain("protective setting");
    expect(said["madeBy"]).toContain("about 24 hours ahead");
  });

  it("every policy cell's range is the table's own interval, formatted the same way, and lead 2 says its own forecast time", () => {
    // the scoreboard shows the headline lead (1) and the strict sensitivity lead (2); the file also holds report-only leads
    for (const lead of policy.leads.filter((l) => l.lead_days === 1 || l.lead_days === 2)) {
      const ids = lead.rows.flatMap((row) => (["missed_danger_hours", "false_alarm_hours", "pod", "far"] as const).map((metric) => ({ row, metric })));
      for (const { row, metric } of ids) {
        const m = row[metric];
        const slug = row.policy === "P3_protect" ? "p3" : row.policy.toLowerCase();
        const id = `policy.${lead.lead_days === 1 ? "" : "lead2."}${slug}.${metric}`;
        const claim = policyClaims.find((c) => c.id === id);
        if (claim === undefined) continue; // a metric with no denominator is "not computed": it has no claim, so no story
        const said = rows(claim.proof.story);
        const share = metric === "pod" || metric === "far";
        const fmt = (v: number): string => (share ? format.percent(v) : format.one(v));
        const point = m.ci !== null && m.ci.lo === m.ci.hi && m.ci.lo === m.value;
        if (m.ci === null || (row.policy === "P0" && point)) expect(said["shows"], id).not.toContain("Likely range");
        else expect(said["shows"], id).toContain(`Likely range ${fmt(m.ci.lo)} to ${fmt(m.ci.hi)}${share ? "." : " hours."}`);
        if (row.policy !== "P0") expect(said["madeBy"], id).toContain(lead.lead_days === 1 ? "about 24 hours ahead" : "by 18:00 Gulf time the evening before");
      }
    }
  });

  it("a plan cell: the plan file's own days and crew size, and its likely range in minutes", () => {
    const said = rows(claimOf(planClaims, "plan.rule_corrected.violation_minutes_per_season").proof.story);
    expect(said["about"]).toBe(`Abu Dhabi airport, 15 May to 30 September 2026. ${String(plans.n_days)} days, one simulated crew of ${String(plans.headcount)} doing heavy work.`);
    const row = plans.rows.find((r) => r.plan === "rule_corrected");
    if (row === undefined || row.violation_minutes_per_season.ci === null) throw new Error("no plan row");
    expect(said["shows"]).toContain(`Likely range ${format.whole(row.violation_minutes_per_season.ci.lo)} to ${format.whole(row.violation_minutes_per_season.ci.hi)} minutes.`);
    // the missed-protection range is shown in minutes, as the table does (5-minute ticks times 5)
    const missed = plans.rows.find((r) => r.plan === "rule_corrected")?.missed_protection_ticks.ci;
    if (missed === null || missed === undefined) throw new Error("no ticks interval");
    expect(rows(claimOf(planClaims, "plan.rule_corrected.missed_protection_ticks").proof.story)["shows"]).toContain(
      `Likely range ${format.whole(missed.lo * 5)} to ${format.whole(missed.hi * 5)} minutes.`,
    );
  });

  it("a day counter: the day, the hours and the candidates are the day file's own", () => {
    const ours = dayProofs.find((entryOf) => entryOf.id === "ours");
    const high = dayProofs.find((entryOf) => entryOf.id === "high");
    if (ours === undefined || high === undefined) throw new Error("no counters");
    const said = rows(ours.proof.story);
    expect(said["about"]).toBe(
      `Abu Dhabi airport, 14 June 2026: one day chosen by a fixed rule from the station's records alone, before we looked at our own results. ${String(day.candidates)} days were considered.`,
    );
    expect(said["shows"]).toBe(`How many of that day's dangerous hours this way of warning caught: ${String(day.p3_hits)} of ${String(day.high_hours)}.`);
    expect(rows(high.proof.story)["howCounted"]).not.toMatch(/\d/);
    expect(rows(dayModel.ruleProof.story)["about"]).toBe(`Abu Dhabi airport, 14 June 2026. ${String(day.candidates)} days were considered.`);
  });

  it("a forecast count: the recorded series' own first day, last day, day count and the limit", () => {
    const first = series.days[0] ?? "";
    const last = series.days[series.days.length - 1] ?? "";
    const said = rows(claimOf(forecast, "forecast.hours_over_limit").proof.story);
    expect(said["about"]).toBe(`Abu Dhabi airport, ${period(first, last)}, working hours. ${String(series.days.length)} days.`);
    expect(said["howCounted"]).toContain(`above ${String(HEAVY_WORK_LIMIT_WBGT_C)} °C`);
    const inBreak = rows(claimOf(forecast, "forecast.hours_in_break").proof.story);
    expect(inBreak["howCounted"]).toContain(`(${SEASON_BAN.start} to ${SEASON_BAN.end})`);
    expect(claimOf(forecast, "forecast.hours_over_limit").proof.story.note?.key).toBe("note.recordedCount");
  });

  it("a frontier readout: the commute and the sleep gate are the file's own, and it is not a scored result", () => {
    const gate = frontierData.frontier_absolute_gate.find((g) => g.avoided_vs_legal_default_ge30 > 0);
    if (gate === undefined) throw new Error("no gain row");
    const best = claimOf(frontierSet, `frontier.best.ge30.commute_${String(gate.commute_min)}`).proof.story;
    expect(rows(best)["about"]).toContain(`${String(gate.commute_min)} minutes`);
    expect(rows(best)["howCounted"]).toContain(`${String(frontierData.assumptions.sleep_gate_h)} hours or more`);
    expect(best.note?.key).toBe("note.analysis");
    expect(claimOf(frontierSet, "frontier.legalisation.ge30").proof.story.note?.key).toBe("note.analysis");
  });

  it("the truth, the evaluation and the verdict stories carry the file's season, the margin and the amendment count", () => {
    const season = { station: policy.station, seasonStart: policy.season_start, seasonEnd: policy.season_end, nDays: policy.n_days };
    const truth = rows(buildStory("truth", { ...season, marginWm2: policy.margin_w_m2, range: { lo: "191.5", hi: "315.5", unit: "hours" } }));
    expect(truth["howCounted"]).toContain(`${String(policy.margin_w_m2)} W/m²`);
    expect(truth["shows"]).toContain("Likely range 191.5 to 315.5 hours.");
    expect(rows(buildStory("evaluation", { ...season, amendments: record.amendments.length }))["howCounted"]).toContain(`${String(record.amendments.length)} in all`);
    expect(rows(buildStory("evaluation", { ...season, amendments: null }))["howCounted"]).not.toContain("in all");
    expect(rows(buildStory("verdict", season))["about"]).toContain(`${String(policy.n_days)} days`);
  });

  it("a level story says what the level is and carries no number, no site id, no policy or configuration", () => {
    const text = sentences(buildStory("level", {}));
    expect(text).not.toMatch(/\d|policy|config|site-/i);
  });

  it("formats dates and names the station without printing its code", () => {
    expect(longDate("2026-06-14")).toBe("14 June 2026");
    expect(period("2026-05-15", "2026-09-30")).toBe("15 May to 30 September 2026");
    expect(period("2025-12-01", "2026-01-31")).toBe("1 December 2025 to 31 January 2026");
    expect(stationName("OMAA")).toBe("Abu Dhabi airport");
    expect(stationName("XXXX")).toBe("the weather station");
    expect(() => longDate("14/06/2026")).toThrow(RangeError);
  });
});

describe.runIf(ledger !== null)("buildStory against the submission ledger (numbers.json on this machine)", () => {
  it("the file the ledger was made from is the committed file (so a story equal to the file is equal to the ledger)", () => {
    const sources = (JSON.parse(readFileSync(LEDGER, "utf8")) as { source_file_sha256: Record<string, string> }).source_file_sha256;
    expect(sources["policy_scoreboard.json"]).toBe(files.policy.sha256);
    expect(sources["plan_scoreboard.json"]).toBe(files.plans.sha256);
    expect(sources["demo_day.json"]).toBe(files.day.sha256);
  });

  it("the scoreboard story says the ledger's days, season, interval and margin", () => {
    const said = rows(claimOf(policyClaims, "policy.p3.missed_danger_hours").proof.story);
    const interval = entry("warn.l1.P3_protect.missed_danger_hours");
    expect(said["about"]).toContain(`${String(entry("warn.days").value)} days`);
    expect(said["about"]).toContain("15 May to 30 September 2026");
    expect(entry("season.start").value).toBe("2026-05-15");
    expect(entry("season.end").value).toBe("2026-09-30");
    expect(said["shows"]).toContain(`Likely range ${one(interval.lo ?? NaN)} to ${one(interval.hi ?? NaN)} hours.`);
    expect(said["doesNotShow"]).toContain(`(${String(entry("warn.margin_w_m2").value)} W/m²)`);
  });

  it("the day story says the ledger's hits, high hours, date and candidates", () => {
    const said = rows(dayProofs.find((p) => p.id === "ours")?.proof.story ?? SAMPLE_STORY);
    expect(said["shows"]).toContain(`${String(entry("demo.p3_hits").value)} of ${String(entry("demo.high_hours").value)}`);
    expect(said["about"]).toContain("14 June 2026");
    expect(entry("demo.date").value).toBe("2026-06-14");
    expect(said["about"]).toContain(`${String(entry("demo.candidates").value)} days were considered`);
    const raw = rows(dayProofs.find((p) => p.id === "raw")?.proof.story ?? SAMPLE_STORY);
    expect(raw["shows"]).toContain(`${String(entry("demo.raw_hits").value)} of ${String(entry("demo.high_hours").value)}`);
    const p1 = rows(dayProofs.find((p) => p.id === "p1")?.proof.story ?? SAMPLE_STORY);
    expect(p1["shows"]).toContain(`${String(entry("demo.p1_hits").value)} of ${String(entry("demo.high_hours").value)}`);
  });

  it("the plan story says the ledger's days and crew size; the truth range is the ledger's", () => {
    const said = rows(claimOf(planClaims, "plan.rule_corrected.violation_minutes_per_season").proof.story);
    expect(said["about"]).toContain(`${String(entry("plan.days").value)} days`);
    expect(said["about"]).toContain(`crew of ${String(entry("crew.size").value)}`);
    const truth = entry("warn.l1.truth_danger_hours");
    expect(`${one(truth.lo ?? NaN)} to ${one(truth.hi ?? NaN)}`).toBe("191.5 to 315.5");
  });

  it("the evaluation story says the ledger's amendment count", () => {
    expect(entry("run.amendments").value).toBe(record.amendments.length);
  });
});

// ---- 2. no jargon, anywhere a story can reach the reader ----

describe("the jargon detectors see what they claim to (an empty result means something)", () => {
  it.each([
    ["file extension", "static/omaa_2026_ifs_d1_wbgt_hourly.json"],
    ["path", "src/features/judge/facts.ts:seasonFacts"],
    ["SHA", "SHA-256 of the file"],
    ["fingerprint", "017b0690d06df649f150d2b12e3845b12cce22410f4e2f82a7b4c7625eb00921"],
    ["protocol", "Protocol line"],
    ["theta", "theta 0.30"],
    ["policy code", "P3, protective"],
    ["hypothesis id", "H4 supported"],
    ["lead N", "at lead 1"],
    ["epoch", "new epoch 3"],
    ["fixture", "a synthetic fixture"],
    ["ADR", "see ADR 0058"],
    ["export key", "missed_danger_hours"],
    ["placeholder", "Not recorded"],
    ["policy=config=", "policy=ae-heat-2026.1 config=3"],
    ["function name", "get_site_forecast_today"],
  ])("flags a %s", (name, text) => {
    const pattern = JARGON.find(([n]) => n === name)?.[1];
    expect(pattern?.test(text)).toBe(true);
  });

  it("does not flag plain words that merely contain the letters (share, shape, forecast)", () => {
    for (const text of ["the share of danger hours", "a shape", "Abu Dhabi airport, 15 May to 30 September 2026, working hours. 139 days."]) {
      expect(JARGON.some(([, pattern]) => pattern.test(text)), text).toBe(false);
    }
  });
});

describe("the plain story never leaks jargon (rendered, on every family and variant)", () => {
  const stories = everyStory();

  it("covers every family at least once, and every policy, metric and lead of the real file", () => {
    expect(new Set(stories.map(({ story }) => story.family))).toEqual(
      new Set(["policy", "plan", "day", "rule", "forecast", "frontier", "level", "truth", "evaluation", "verdict", "field"]),
    );
    const policyCells = stories.filter(({ story }) => story.family === "policy");
    expect(policyCells.length).toBeGreaterThanOrEqual(5 * 4 + 5 * 4 - 8); // two leads, 4 metrics, 5 and 4 rows, less the not-computed ones
    expect(stories.filter(({ story }) => story.family === "day")).toHaveLength(6);
  });

  it.each(JARGON)("no %s in any rendered sentence", (_name, pattern) => {
    const hits = stories.filter(({ story }) => pattern.test(sentences(story))).map(({ name }) => name);
    expect(hits).toEqual([]);
  });

  it("every story has a 'made by' line and a non-empty 'it does not show' line (the limit is never empty)", () => {
    for (const { name, story } of stories) {
      const said = rows(story);
      expect(said["madeBy"]?.trim(), name).toBeTruthy();
      expect(said["doesNotShow"]?.trim(), name).toBeTruthy();
    }
  });

  it("every number in a sentence is a number the builder was given, or a documented template constant", () => {
    // the template constants: the forecast lead and its time (24 hours, 18:00), the held-out years and the heat-stress mark of the analysis (30)
    const CONSTANT = new Set(["24", "18", "00", "2024", "2025", "2026", "30"]);
    const numbers = (text: string): string[] => text.match(/\d+(?:\.\d+)?/g) ?? [];
    for (const { name, story } of stories) {
      const given = new Set(story.rows.flatMap((row) => row.lines.flatMap((line) => Object.values(line.values ?? {}).flatMap(numbers))));
      for (const line of story.note === null ? [] : [story.note]) Object.values(line.values ?? {}).flatMap(numbers).forEach((n) => given.add(n));
      for (const n of numbers(sentences(story))) expect(given.has(n) || CONSTANT.has(n), `${name}: ${n}`).toBe(true);
    }
  });

  it("the story catalogue itself is free of jargon too (outside the auditor layer)", () => {
    const strings: string[] = [];
    const walk = (value: unknown): void => {
      if (typeof value === "string") strings.push(value);
      else if (typeof value === "object" && value !== null) Object.values(value).forEach(walk);
    };
    walk((messages.states.proof as { story: unknown }).story);
    const catalogue = JARGON.filter(([name]) => name !== "placeholder" && name !== "export key");
    for (const text of strings) for (const [name, pattern] of catalogue) expect(pattern.test(text), `${name}: ${text}`).toBe(false);
  });

  it("the rendered drawer and sheet story (stamp, rows, note, footnote) carry none of it either", () => {
    const proofs: Proof[] = [...policyClaims, ...planClaims, ...forecast, ...frontierSet].map((claim) => claim.proof);
    for (const proof of [...proofs.slice(0, 3), ...proofs.slice(-3), ...dayProofs.map((p) => p.proof)]) {
      const { container, unmount } = renderWithIntl(<StoryRows proof={proof} />);
      const text = container.textContent;
      for (const [name, pattern] of JARGON.filter(([n]) => n !== "export key")) expect(pattern.test(text), `${name}: ${proof.what}`).toBe(false);
      unmount();
    }
  });
});

// ---- 3. no empty field in the auditor rows ----

describe("AuditRows prints only fields that have a value", () => {
  const empty: Proof = {
    what: "x",
    story: SAMPLE_STORY,
    protocol: "",
    protocolHref: null,
    script: null,
    file: "",
    fileSha256: null,
    sourceSha256: null,
    label: "RECORDED",
    modelId: null,
    generatedAt: null,
  };

  it("a record with every nullable field empty prints no 'Not recorded' and no empty row", () => {
    const { container } = renderWithIntl(<AuditRows proof={empty} />);
    expect(container.textContent).not.toContain("Not recorded");
    const terms = [...container.querySelectorAll("dt")];
    const details = [...container.querySelectorAll("dd")];
    expect(terms.length).toBe(details.length);
    for (const dd of details) expect(dd.textContent.trim(), dd.outerHTML).not.toBe("");
    for (const gone of ["Protocol line", "Script", "Result file", "SHA-256", "Model", "Generated"]) expect(screen.queryByText(gone)).toBeNull();
    // the label is always known: it is the one row left
    expect(terms.map((dt) => dt.textContent)).toEqual(["Label"]);
  });

  it("a full record prints every row it has, and a scored one adds the policy code, threshold and the lock", () => {
    const claim = claimOf(policyClaims, "policy.p3.missed_danger_hours");
    const proof: Proof = { ...claim.proof, audit: { ...claim.proof.audit, verdicts: ["H4 supported at lead 1: example"] } };
    const { container } = renderWithIntl(<AuditRows proof={proof} />);
    const names = [...container.querySelectorAll("dt")].map((dt) => dt.textContent);
    expect(names).toEqual(expect.arrayContaining(["Protocol line", "Script", "Result file", "SHA-256", "Label", "Policy code and threshold", "Verdict sentences, exactly as the scoring run wrote them", "Pre-registration", "Model", "Generated"]));
    expect(container.textContent).toContain("P3, protective, theta 0.3");
    expect(container.textContent).toContain("H4 supported at lead 1: example");
  });
});
