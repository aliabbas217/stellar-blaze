import { readFileSync } from "node:fs";
import path from "node:path";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import {
  makeFormat,
  toPlanRows,
  toPolicyRows,
  type AdapterContext,
  type PlanScoreboard,
  type PolicyScoreboard,
  type TableText,
} from "@/features/judge/adapters";
import { forecastClaims, frontierClaims, rowClaims, type Claim } from "@/features/judge/claims";
import { seasonFacts } from "@/features/judge/facts";
import { parseHourlySeries } from "@/features/judge/facts";
import { SEASON_BAN } from "@/features/judge/ban";
import { HEAVY_WORK_LIMIT_WBGT_C } from "@/features/judge/limit";
import { ProofSheet } from "@/features/judge/ProofSheet";
import { parseRosterFrontier } from "@/features/judge/roster-frontier";
import { banWindow } from "@/mocks/fixtures";
import { server } from "@/mocks/node";
import { renderWithIntl } from "../../../utils/intl";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, className, ...rest }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className} {...rest}>
      {children}
    </a>
  ),
}));

const root = path.resolve(import.meta.dirname, "../../../..");
const json = (file: string): unknown => JSON.parse(readFileSync(path.join(root, file), "utf8")) as unknown;

const format = makeFormat("en");
const text: TableText = {
  row: (id) => ({ label: id, sub: "" }),
  what: (metric, row) => `${metric}, ${row}`,
  interval: (lo, hi) => `${lo} to ${hi}`,
  unit: (metric) => `unit of ${metric}`,
};
const ctx = (name: string): AdapterContext => ({ file: { path: `eval/2026/${name}.json`, sha256: "e".repeat(64) }, format, text });
const policy = json("tests/fixtures/eval/policy_scoreboard.synthetic.json") as PolicyScoreboard;
const plans = json("tests/fixtures/eval/plan_scoreboard.synthetic.json") as PlanScoreboard;
const series = parseHourlySeries(json("data/static/omaa_2026_ifs_d1_wbgt_hourly.json"));
const frontier = parseRosterFrontier(json("data/static/roster_frontier.json"));

const all: Claim[] = [
  ...rowClaims(toPolicyRows(policy, 1, ctx("policy_scoreboard"))),
  ...rowClaims(toPlanRows(plans, ctx("plan_scoreboard"))),
  ...forecastClaims(
    seasonFacts(series, SEASON_BAN, HEAVY_WORK_LIMIT_WBGT_C),
    { file: { path: "static/omaa_2026_ifs_d1_wbgt_hourly.json", sha256: "f".repeat(64) }, protocol: "recorded forecast" },
    format,
    { daysOverLimit: "days", hoursOverLimit: "hours", hoursInBreak: "break" },
  ),
  ...frontierClaims(
    frontier,
    { file: { path: "static/roster_frontier.json", sha256: "a".repeat(64) }, label: "REAL weather + assumed crew", protocol: "recorded analysis" },
    format,
    { best: (m) => `best ${String(m)}`, legal: "legal" },
  ),
];

describe("the protocol line of the timeline comes from the evaluation record", () => {
  it("names the commit of the record, not a typed one", () => {
    const claim = all.find((c) => c.id === "policy.p3.missed_danger_hours");
    if (claim === undefined) throw new Error("no claim");
    const evaluation = {
      lockSha256: "a".repeat(64),
      protocolCommit: "abcdef0123456789abcdef0123456789abcdef01",
      amendments: [{ path: "docs/research/x-amendment-1.md", commit: "1".repeat(40), sha256: "2".repeat(64) }],
      freeze: { path: "docs/research/x-freeze.md", commit: "3".repeat(40), sha256: "4".repeat(64) },
    };
    const withRecord: Claim = { ...claim, proof: { ...claim.proof, evaluation } };
    renderWithIntl(<ProofSheet claim={withRecord} source="2026" />);
    expect(screen.getByText("The pre-registration, commit abcdef0, before 2026 was scored.")).toBeInTheDocument();
    expect(screen.getByText("x-amendment-1.md (1111111)")).toBeInTheDocument();
    expect(screen.getByText("x-freeze.md (3333333)")).toBeInTheDocument();
  });
});

describe("claims", () => {
  it("have unique stable ids, each with a proof that names its own sheet", () => {
    const ids = all.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const claim of all) expect(claim.proof.claim, claim.id).toBe(claim.id);
    expect(ids).toContain("policy.p3.missed_danger_hours");
    expect(ids).toContain("forecast.hours_over_limit");
    expect(ids).toContain("plan.naive.violation_minutes_per_season");
    expect(ids).toContain("frontier.legalisation.ge30");
    // a best-claim exists only where the export shows a gain: a zero (and every gate-failing commute) has no proof page
    const gains = frontier.frontier_absolute_gate.filter((g) => g.avoided_vs_legal_default_ge30 > 0).map((g) => `frontier.best.ge30.commute_${String(g.commute_min)}`);
    expect(gains.length).toBeGreaterThan(0);
    expect(ids.filter((id) => id.startsWith("frontier.best.ge30.commute_"))).toEqual(gains);
    for (const gate of frontier.frontier_absolute_gate.filter((g) => !g.b1_passes_sleep_gate)) {
      expect(ids, `gate-failing ${String(gate.commute_min)} min`).not.toContain(`frontier.best.ge30.commute_${String(gate.commute_min)}`);
    }
  });

  it("takes the recorded ban window from the contract's own, never a drifted copy", () => {
    const api = banWindow("2026-07-01");
    expect(SEASON_BAN).toEqual({ season_start: api.season_start, season_end: api.season_end, start: api.start, end: api.end });
  });
});

describe("ProofSheet", () => {
  it("test_unknown_claim_is_the_empty_state", () => {
    const { container } = renderWithIntl(<ProofSheet claim={null} source="2026" />);
    expect(screen.getByRole("heading", { name: "No provenance recorded for this number" })).toBeInTheDocument();
    expect(screen.getByText("No provenance recorded for this number. It is not shown as a result.")).toBeInTheDocument();
    // a way forward: a number that has proof (a route that exists), and the scoreboard
    expect(screen.getByRole("link", { name: "Open a number that has proof" })).toHaveAttribute("href", "/replay/proof/forecast.hours_over_limit");
    expect(screen.getByRole("link", { name: "Back to the scoreboard" })).toHaveAttribute("href", "/replay");
    // no number, no proof rows, no recount
    expect(container.querySelector("[data-sheet-number]")).toBeNull();
    expect(screen.queryByRole("button", { name: /Recount/ })).toBeNull();
  });

  it("shows the number large, the proof rows, the four-step timeline and a back link", () => {
    const claim = all.find((c) => c.id === "policy.p3.missed_danger_hours");
    if (claim === undefined) throw new Error("no claim");
    const { container } = renderWithIntl(<ProofSheet claim={claim} source="2026" />);
    expect(within(container.querySelector("[data-sheet-number]") as HTMLElement).getByText(claim.value)).toBeInTheDocument();
    expect([...container.querySelectorAll("[data-timeline] li")].map((li) => li.getAttribute("data-step"))).toEqual([
      "forecast",
      "protocol",
      "run",
      "shown",
    ]);
    expect(screen.getByText("About 24 hours ahead of each day, by the ECMWF model.")).toBeInTheDocument();
    // these claims carry no evaluation record: the sheet does not say a protocol was committed before a held-out run
    expect(screen.getByText("The pre-registration. This is a development run: it is not the held-out result.")).toBeInTheDocument();
    expect(screen.getByText("The single scoring run wrote this file.")).toBeInTheDocument();
    expect(screen.getByText(claim.proof.protocol)).toBeInTheDocument();
    expect(screen.getByText(claim.proof.file)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to the scoreboard" })).toHaveAttribute("href", "/replay");
    expect(container.querySelector("[data-primary]")).toBeNull();
  });

  it("does not call a forecast count a scored result, and does not claim a protocol for it", () => {
    const claim = all.find((c) => c.id === "forecast.hours_over_limit");
    if (claim === undefined) throw new Error("no claim");
    renderWithIntl(<ProofSheet claim={claim} source="2026" />);
    expect(screen.getByText("No scoring protocol: this count is made from the recorded forecast file.")).toBeInTheDocument();
    expect(screen.getByText("Not a scoring run: nothing here is scored.")).toBeInTheDocument();
    expect(screen.queryByText("The single scoring run wrote this file.")).toBeNull();
  });

  it("says a development run is not the result", () => {
    const claim = all.find((c) => c.id === "policy.p3.missed_danger_hours");
    if (claim === undefined) throw new Error("no claim");
    renderWithIntl(<ProofSheet claim={claim} source="dev-2025" />);
    expect(screen.getByText("The 2025 development run wrote this file. It is not the result.")).toBeInTheDocument();
    expect(screen.getByText("DEV 2025")).toBeInTheDocument();
  });

  it("says a made-up shape file is not a scoring run, in its own words, and not that the 2025 run wrote it", () => {
    const claim = all.find((c) => c.id === "policy.p3.missed_danger_hours");
    if (claim === undefined) throw new Error("no claim");
    renderWithIntl(<ProofSheet claim={claim} source="synthetic-shape" />);
    expect(screen.getByText("Not a scoring run: a script wrote this file with made-up numbers, only to check the layout.")).toBeInTheDocument();
    expect(screen.queryByText(/The 2025 development run wrote this file/)).toBeNull();
    expect(screen.getByText("DEV 2025")).toBeInTheDocument();
  });

  it("prints what the number counts beside it, so the number is never bare", () => {
    const claim = all.find((c) => c.id === "policy.p3.missed_danger_hours");
    if (claim === undefined) throw new Error("no claim");
    expect(claim.unit).toBe("unit of missed_danger_hours");
    const { container } = renderWithIntl(<ProofSheet claim={claim} source="2026" />);
    expect(within(container.querySelector("[data-sheet-number]") as HTMLElement).getByText("unit of missed_danger_hours")).toBeInTheDocument();
  });

  it("an unreadable result file is its own state, with its own message, not 'no provenance recorded'", () => {
    const { container } = renderWithIntl(<ProofSheet claim={null} source="none" unreadable />);
    expect(container.querySelector("[data-sheet-state=unreadable]")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "The file behind this number could not be read" })).toBeInTheDocument();
    expect(screen.queryByText(/No provenance recorded/)).toBeNull();
    expect(screen.getByRole("link", { name: "Back to the scoreboard" })).toHaveAttribute("href", "/replay");
    expect(container.querySelector("[data-sheet-number]")).toBeNull();
  });

  it("an unknown number stays the empty state, and is told apart from an unreadable file", () => {
    const { container } = renderWithIntl(<ProofSheet claim={null} source="2026" />);
    expect(container.querySelector("[data-sheet-state=empty]")).not.toBeNull();
    expect(container.querySelector("[data-sheet-state=unreadable]")).toBeNull();
  });

  it("test_sheet_recount_button_reports_match: hashes the served file and reports Matches, then a changed file", async () => {
    const body = "stellar blaze";
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
    const sha = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    server.use(http.get("*/data/static/recount-sample.json", () => HttpResponse.text(body)));
    const base = all.find((c) => c.id === "forecast.hours_over_limit");
    if (base === undefined) throw new Error("no claim");
    const claim: Claim = { ...base, proof: { ...base.proof, file: "static/recount-sample.json", fileSha256: sha } };
    const { unmount } = renderWithIntl(<ProofSheet claim={claim} source="2026" />);
    await userEvent.click(screen.getByRole("button", { name: "Recount in this browser" }));
    await waitFor(() => {
      expect(screen.getByText("Matches")).toBeInTheDocument();
    });
    unmount();
    renderWithIntl(<ProofSheet claim={{ ...claim, proof: { ...claim.proof, fileSha256: "0".repeat(64) } }} source="2026" />);
    await userEvent.click(screen.getByRole("button", { name: "Recount in this browser" }));
    await waitFor(() => {
      expect(screen.getByText("Does not match: report this")).toBeInTheDocument();
    });
  });

  it("offers no recount for a file that is not published, and says why", () => {
    const claim = all.find((c) => c.id === "policy.p3.missed_danger_hours");
    if (claim === undefined) throw new Error("no claim");
    renderWithIntl(<ProofSheet claim={{ ...claim, proof: { ...claim.proof, file: "eval/dev/policy_scoreboard.2025.json" } }} source="dev-2025" />);
    expect(screen.queryByRole("button", { name: "Recount in this browser" })).toBeNull();
    expect(screen.getByText("This file is not published here, so it cannot be recounted.")).toBeInTheDocument();
  });
});
