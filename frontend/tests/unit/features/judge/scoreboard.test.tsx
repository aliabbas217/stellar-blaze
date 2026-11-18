import { readFileSync } from "node:fs";
import path from "node:path";
import { screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { DATA_MANIFEST } from "@/features/judge/manifest.generated";
import type { EvalData } from "@/features/judge/data";
import { parseHourlySeries } from "@/features/judge/facts";
import { parseRosterFrontier } from "@/features/judge/roster-frontier";
import { ScoreboardView, type ScoreboardViewProps } from "@/features/judge/ScoreboardView";
import { renderWithIntl } from "../../../utils/intl";
import type { PlanScoreboard, PolicyScoreboard } from "@/features/judge/adapters";

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

const root = path.resolve(import.meta.dirname, "../../../..");
const json = (file: string): unknown => JSON.parse(readFileSync(path.join(root, file), "utf8")) as unknown;

const HOURLY = "static/omaa_2026_ifs_d1_wbgt_hourly.json" as const;
const hourly: ScoreboardViewProps["hourly"] = {
  series: parseHourlySeries(json(`data/${HOURLY}`)),
  file: { path: HOURLY, sha256: DATA_MANIFEST[HOURLY].sha256 },
  source: DATA_MANIFEST[HOURLY].source,
};
const frontier = parseRosterFrontier(json("data/static/roster_frontier.json"));
const policy = json("tests/fixtures/eval/policy_scoreboard.synthetic.json") as PolicyScoreboard;
const plans = json("tests/fixtures/eval/plan_scoreboard.synthetic.json") as PlanScoreboard;

const files = (name: string) => ({ path: `eval/2026/${name}.json`, sha256: "c".repeat(64) });
const ideal: EvalData = {
  policy,
  plans,
  day: null,
  frontier,
  source: "2026",
  record: null,
  files: { policy: files("policy_scoreboard"), plans: files("plan_scoreboard"), day: null, frontier: { path: "static/roster_frontier.json", sha256: "d".repeat(64) } },
};
const empty: EvalData = { policy: null, plans: null, day: null, frontier, source: "none", record: null, files: { policy: null, plans: null, day: null, frontier: ideal.files.frontier } };

const frontierSource = { label: "REAL weather + assumed crew", protocol: "recorded analysis" } as const;

function view(data: EvalData | null, extra: Partial<ScoreboardViewProps> = {}, locale: "en" | "ar" = "en") {
  return renderWithIntl(<ScoreboardView data={data} hourly={hourly} frontierSource={frontierSource} {...extra} />, { locale });
}

describe("ScoreboardView", () => {
  it("test_empty_state_shows_banner_not_cells", () => {
    const { container } = view(empty);
    // one banner per table, never one per cell
    const banners = container.querySelectorAll("[role=status]");
    const text = [...banners].map((b) => b.textContent);
    expect(text.filter((t) => t.includes("Warnings, summer 2026"))).toHaveLength(1);
    expect(text.filter((t) => t.includes("Plans, summer 2026"))).toHaveLength(1);
    // ### in every number cell of both tables (4 policies x 4 + 3 plans x 4), no number and no proof inside a table
    expect(container.querySelectorAll("table[data-scoreboard=pending] [aria-label='not scored yet']")).toHaveLength(16 + 12);
    expect(container.querySelectorAll("table [data-proof-id]")).toHaveLength(0);
    // the actionable empty state, linking to a number that does have a proof
    expect(screen.getByRole("link", { name: "See where a number comes from" })).toHaveAttribute("href", "/replay/proof/forecast.hours_over_limit");
    // the outcome sentence waits for the scored run
    expect(screen.getByText("Not available until the scored run has produced its results.")).toBeInTheDocument();
  });

  it("test_warnings_rows_in_order_ours_last", () => {
    const { container } = view(ideal);
    const rows = [...container.querySelectorAll("#warnings > table tbody tr")];
    expect(rows.map((r) => r.getAttribute("data-row"))).toEqual(["P0", "P1", "P2", "P3_protect", "P3_balanced"]);
    expect(rows.map((r) => r.getAttribute("aria-current"))).toEqual([null, null, null, "true", "true"]);
    expect(within(rows[0] as HTMLElement).getByText("Midday break only")).toBeInTheDocument();
    expect(within(rows[3] as HTMLElement).getByText("Stellar Blaze, protective setting")).toBeInTheDocument();
    // every number has a proof chip: 4 per row
    expect(container.querySelectorAll("#warnings > table tbody [data-proof-id]")).toHaveLength(5 * 4);
  });

  it("test_headline_says_24_hours_ahead_not_evening_before", () => {
    const { container } = view(ideal);
    const text = container.textContent;
    expect(text).toContain("about 24 hours ahead");
    expect(text).toContain("Held-out 2026: every choice was fixed on 2024 and 2025 data");
    // the lead-2 stamp ("issued by 18:00 the evening before") may be carried for lead 2 only: never in the headline, the lede or the facts line
    const header = container.querySelector("header")?.textContent ?? "";
    expect(header).not.toMatch(/evening before/i);
    expect(container.querySelector("[data-lead=\"2\"]")?.textContent ?? "").toMatch(/evening before/i);
  });

  it("merges the plans the file names as identical into one row, and marks ours", () => {
    const { container } = view(ideal);
    const rows = [...container.querySelectorAll("#plans tbody tr")];
    expect(rows.map((r) => r.getAttribute("data-row"))).toEqual(["merged", "rule_raw", "rule_corrected"]);
    expect(screen.getByText("Midday break only (working every minute of the shift outside the break, on the legal roster)")).toBeInTheDocument();
    expect(rows[2]?.getAttribute("aria-current")).toBe("true");
    expect(container.querySelectorAll("#plans tbody [data-proof-id]")).toHaveLength(3 * 4);
  });

  it("shows a plain outcome sentence with its proof, never the runner's sentence, and says plainly when a check has no template", () => {
    const { container } = view(ideal);
    const primary = policy.verdicts.find((v) => v.primary);
    // the shape fixture's comparisons are not the ones a template reads (H4 against the fixed rule only), so the story layer carries the
    // neutral line and no number; the runner's own sentence is in the proof's auditor layer, not on the page
    const verdict = container.querySelector("[data-verdict=written]");
    expect(verdict?.textContent).toContain("The details of this check are under For auditors.");
    expect(container.textContent).not.toContain(primary?.text ?? "x");
    expect(verdict?.querySelector("[data-proof-id]")).not.toBeNull();
  });

  it("shows a notice instead of the Plans table when only the Plans file is missing", () => {
    const { container } = view({ ...ideal, plans: null, files: { ...ideal.files, plans: null } });
    expect(screen.getByText("The Plans table is not on this page yet")).toBeInTheDocument();
    expect(container.querySelector("#plans table")).toBeNull();
    expect(container.querySelectorAll("#warnings tbody [data-proof-id]").length).toBeGreaterThan(0);
  });

  it("carries the DEV 2025 stamp for development numbers and none for the held-out run", () => {
    const { unmount } = view({ ...ideal, source: "dev-2025" });
    expect(screen.getAllByText("DEV 2025").length).toBeGreaterThan(0);
    unmount();
    view(ideal);
    expect(screen.queryByText("DEV 2025")).toBeNull();
  });

  it("repeats the stamp on the Verdict, Warnings and Plans headings for dev and shape data, and not for the held-out run", () => {
    for (const source of ["dev-2025", "synthetic-shape"] as const) {
      const { container, unmount } = view({ ...ideal, source });
      // the page head, the Verdict, the Warnings heading and the Plans heading each carry one
      expect(screen.getAllByText("DEV 2025")).toHaveLength(4);
      for (const id of ["warnings", "plans"]) expect(container.querySelector(`#${id}`)?.textContent).toContain("DEV 2025");
      expect(container.querySelector("[data-verdict]")?.textContent).toContain("DEV 2025");
      unmount();
    }
    const { container } = view(ideal);
    expect(container.textContent).not.toContain("DEV 2025");
  });

  it("states the held-out claim only for the 2026 run (or before any run), never beside a dev or shape stamp", () => {
    const held = /Held-out 2026: every choice was fixed on 2024 and 2025 data/;
    for (const source of ["dev-2025", "synthetic-shape"] as const) {
      const { container, unmount } = view({ ...ideal, source });
      expect(container.textContent).not.toMatch(held);
      unmount();
    }
    const { container, unmount } = view(ideal);
    expect(container.textContent).toMatch(held);
    unmount();
    expect(view(empty).container.textContent).toMatch(held);
  });

  it("on a read failure keeps the static season and says so in words, with a way to try again", () => {
    const { container } = view(null, { failed: true });
    expect(container.querySelector("[data-ribbon]")).not.toBeNull();
    expect(screen.getByText("The scoreboard file could not be read")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Try again" })).toHaveAttribute("href", "/replay");
    expect(container.querySelector("table[data-scoreboard]")).toBeNull();
    expect(container.textContent).not.toMatch(/request id/i);
  });

  it("puts the one hero, the one primary action and the spine on the page", () => {
    const { container } = view(ideal);
    expect(container.querySelectorAll("[data-hero]")).toHaveLength(1);
    expect(container.querySelectorAll("[data-primary]")).toHaveLength(1);
    expect(container.querySelectorAll("[data-spine]")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Play the season" })).toBeInTheDocument();
  });

  it("words the season dates day first with Sep, not Sept, and thins the month ticks on a phone", () => {
    const { container } = view(ideal);
    const text = container.textContent;
    expect(text).toContain("15 May to 30 Sep");
    expect(text).not.toContain("Sept");
    const ticks = [...container.querySelectorAll("[data-ribbon] .text-ink-3 > span")].filter((t) => !/^\d+$/.test(t.textContent));
    expect(ticks.map((t) => t.textContent)).toEqual(["15 May", "Jun", "Jul", "Aug", "Sep", "30 Sep"]);
    // Jun and Aug are the minor ticks: hidden below 640 px so the labels do not run into each other
    expect(ticks.filter((t) => t.className.includes("max-sm:hidden")).map((t) => t.textContent)).toEqual(["Jun", "Aug"]);
  });

  it("shows the season counts from the recorded forecast, with a proof each", () => {
    const { container } = view(ideal);
    const tally = container.querySelector("[data-tally]");
    expect(within(tally as HTMLElement).getByText("1,624")).toBeInTheDocument();
    expect(within(tally as HTMLElement).getByText("279")).toBeInTheDocument();
    expect(tally?.querySelectorAll("[data-proof-id]")).toHaveLength(3);
  });

  it("has the frontier section with its sentence, and the story footer for this step", () => {
    view(ideal);
    // the heading is generated from the export at the slider's commute (default 45): see frontier.test.tsx for every commute
    expect(screen.getByRole("heading", { name: /^At a 45 minute commute the analysis finds no gain on top of the legal default\./ })).toBeInTheDocument();
    expect(document.getElementById("frontier")).not.toBeNull();
    expect(screen.getByRole("link", { name: "The evidence" })).toHaveAttribute("aria-current", "step");
  });

  it("uses no ADR, B2, B3 or HANDOFF jargon and no em or en dash in the English copy", () => {
    const { container } = view(ideal);
    const text = container.textContent;
    expect(text).not.toMatch(/ADR \d|HANDOFF|\bB[123]\b/);
    expect(text).not.toMatch(/[–—]/);
  });

  it("prints no data-export key anywhere (copy rule: every visible label comes from messages, never a snake_case key)", () => {
    for (const data of [ideal, empty]) {
      const { container, unmount } = view(data);
      const text = container.textContent.replaceAll(/https?:\S+/g, "");
      expect(text).not.toMatch(/[a-z][a-z0-9]*_[a-z0-9_]+/);
      expect(text).not.toMatch(/B[01]_|P[0-3]_|folds_no_change|b1_passes/);
      unmount();
    }
  });

  it("keeps Western digits in Arabic", () => {
    const { container } = view(ideal, {}, "ar");
    const tally = container.querySelector("[data-tally]")?.textContent ?? "";
    expect(tally).toMatch(/1,624/);
    expect(container.textContent).not.toMatch(/[٠-٩۰-۹]/);
  });
});
