import { readFileSync } from "node:fs";
import path from "node:path";
import { act, fireEvent, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { isDeferredRoute } from "@/components/states/deferred-routes";
import { parseHourlySeries, seasonFacts } from "@/features/judge/facts";
import { SEASON_BAN } from "@/features/judge/ban";
import { HEAVY_WORK_LIMIT_WBGT_C } from "@/features/judge/limit";
import { DATA_MANIFEST } from "@/features/judge/manifest.generated";
import { parseCoast, parseField, readingAt } from "@/features/judge/landing/field-data";
import { FieldIsland } from "@/features/judge/landing/FieldIsland";
import { readoutText } from "@/features/judge/landing/FieldReadout";
import { LandingView } from "@/features/judge/landing/LandingView";
import { renderWithIntl } from "../../../../utils/intl";

/*
 * The landing page on the REAL committed files: the hero's first HTML (skip link first, the h1, one primary action, the
 * hook from the scored file), chapter 1's counts with their proofs, chapter 2's table and verdicts, the live island's
 * keyboard and motion rules, and the claim-rule scan over everything the page says.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(), usePathname: () => "/en" }));
vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/en",
  useRouter: () => ({ replace: vi.fn() }),
  Link: ({ href, children, className, ...rest }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className} {...rest}>
      {children}
    </a>
  ),
}));

const { loadEval } = await import("@/features/judge/data");
const { loadFieldHero } = await import("@/features/judge/landing/field-server");

const root = path.resolve(import.meta.dirname, "../../../../..");
const json = (file: string): unknown => JSON.parse(readFileSync(path.join(root, file), "utf8")) as unknown;
const HOURLY = "static/omaa_2026_ifs_d1_wbgt_hourly.json" as const;
const hourly = {
  series: parseHourlySeries(json(`data/${HOURLY}`)),
  file: { path: HOURLY, sha256: DATA_MANIFEST[HOURLY].sha256 },
  source: DATA_MANIFEST[HOURLY].source,
};
const data = await loadEval({ dataRoot: path.join(root, "data"), production: true });
const field = await loadFieldHero(hourly, path.join(root, "data"));
const grid = parseField(json("public/data/static/uae_ifs025_d1_wbgt_2026-09-03.json"));
const coast = parseCoast(json("public/data/static/coast.json"));
if (data.policy === null) throw new Error("the 2026 Warnings file is not in data/eval/2026");
const policy = data.policy;
const facts = seasonFacts(hourly.series, SEASON_BAN, HEAVY_WORK_LIMIT_WBGT_C);

/** What the architect's claim rules forbid on any scoreboard, landing, day or proof surface (English), plus the landing's own. */
const FORBIDDEN = /calibrated|catches 90|fewer alerts than|best overall|highest CSI|beats every|beats ADOSH|robust|consistently|improved over static|untouched|tamper-proof|restricted members|immediately|\b58\s?%/i;
const EXPORT_KEY = /\b[a-z]+(?:_[a-z0-9]+)+\b/;

const view = (dataOverride = data) => renderWithIntl(<LandingView field={field} hourly={hourly} data={dataOverride} dir="ltr" />);

describe("the landing page", () => {
  it("test_first_focusable_is_skip_link: the first tabbable element is 'Skip to the scoreboard', to /replay", () => {
    const { container } = view();
    const first = container.querySelector<HTMLElement>("a[href], button, [tabindex='0'], input, select, summary");
    expect(first?.textContent).toBe("Skip to the scoreboard");
    expect(first?.getAttribute("href")).toBe("/replay");
  });

  it("has the h1 from the messages, one primary action and a secondary that walks to the problem", () => {
    const { container } = view();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Heat that stops work, forecast about 24 hours ahead.");
    const primary = container.querySelectorAll("[data-primary]");
    expect(primary).toHaveLength(1);
    expect(primary[0]).toHaveTextContent("See the scoreboard");
    expect(primary[0]?.getAttribute("href")).toBe("/replay");
    expect(screen.getByRole("link", { name: "Walk me through it" })).toHaveAttribute("href", "#problem");
    expect(container.querySelector("#problem")).not.toBeNull();
    expect(container.querySelector("[data-hero]")).not.toBeNull();
  });

  it("states the readout at the peak hour in the first HTML, with the station value, the limit and the proof", () => {
    const { container } = view();
    const readout = container.querySelector("[data-field-readout]");
    const expected = readoutText(readingAt(grid, field.omaa, field.peakHour));
    expect(field.peakHour).toBe(14);
    expect(readout).toHaveTextContent(`Hottest point on the forecast grid at ${expected.hour}`);
    expect(readout?.querySelector("[data-readout-hottest]")).toHaveTextContent(`${expected.hottest}°C`);
    expect(readout?.querySelector("[data-readout-station]")).toHaveTextContent(`${expected.station} °C`);
    expect(readout).toHaveTextContent("26.6 °C");
    expect(readout).toHaveTextContent("not as the day we scored");
    expect(within(readout as HTMLElement).getByRole("button", { name: /^Proof for The forecast heat field/ })).toBeInTheDocument();
  });

  it("the hook is the station's danger-hour count read from the scored file, with its definition and a proof (never typed, never the 58 percent)", () => {
    const { container } = view();
    const metric = policy.leads.find((lead) => lead.lead_days === 1)?.truth_danger_hours;
    if (metric?.ci == null) throw new Error("fixture: no interval");
    const hook = container.querySelector("[data-hook]");
    expect(hook).toHaveTextContent(metric.value.toFixed(1));
    expect(hook).toHaveTextContent(`${metric.ci.lo.toFixed(1)} to ${metric.ci.hi.toFixed(1)}, 95% interval`);
    expect(hook).toHaveTextContent(policy.working_hours_utc);
    expect(hook).toHaveTextContent(`${String(policy.margin_w_m2)} W/m² is an assumption`);
    expect(within(hook as HTMLElement).getByRole("button", { name: /Proof for/ })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/58/);
  });

  it("drops the hook, not the page, when there is no scored file", () => {
    const { container } = view(null as never);
    expect(container.querySelector("[data-hook]")).toBeNull();
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });

  it("test_problem_counts_have_proofs: the three counts are the season facts of the file, each with a proof chip", () => {
    const { container } = view();
    const counts = container.querySelector("[data-problem-counts]") as HTMLElement;
    expect(facts.over).toBe(1624);
    expect(facts.inBan).toBe(279);
    expect(facts.daysOver).toBe(139);
    for (const [id, value] of [["hours", facts.over], ["inBan", facts.inBan], ["days", facts.daysOver]] as const) {
      const item = counts.querySelector(`[data-count="${id}"]`) as HTMLElement;
      expect(item, id).not.toBeNull();
      expect(item).toHaveTextContent(value.toLocaleString("en-US"));
      expect(within(item).getByRole("button", { name: /^Proof for/ }), id).toBeInTheDocument();
    }
    expect(counts).toHaveTextContent(`of ${facts.n.toLocaleString("en-US")} working hours`);
    // the counts are labelled as the recorded raw forecast before correction, never as hours that were over a limit
    expect(container.querySelector("[data-season-caption]")).toHaveTextContent("Recorded raw forecast, before correction. These are not hours that were actually over the limit");
    expect(counts).toHaveTextContent("raw forecast");
  });

  it("the calendar has a table alternative whose rows add up to the same counts", () => {
    const { container } = view();
    const table = container.querySelector("[data-calendar-table] table") as HTMLElement;
    const rows = [...table.querySelectorAll("tbody tr")].map((row) => [...row.querySelectorAll("td")].map((cell) => Number(cell.textContent.replaceAll(",", ""))));
    expect(rows.length).toBeGreaterThanOrEqual(5);
    expect(rows.reduce((sum, row) => sum + (row[0] ?? 0), 0)).toBe(facts.n);
    expect(rows.reduce((sum, row) => sum + (row[1] ?? 0), 0)).toBe(facts.over);
    expect(rows.reduce((sum, row) => sum + (row[2] ?? 0), 0)).toBe(facts.inBan);
    const chart = container.querySelector("[data-calendar] svg[role=img]");
    expect(chart?.getAttribute("aria-label")).toContain(`${facts.over.toLocaleString("en-US")} of ${facts.n.toLocaleString("en-US")} hours are above the 26.6 °C heavy-work limit`);
    // non-vacuous: the break is cut in for exactly the days it is in force
    expect(container.querySelector("[data-calendar] .fill-slot")).not.toBeNull();
  });

  it("chapter 2 shows all four ways to warn (P3 at both thetas), the baseline labelled, and the run's verdicts verbatim", () => {
    const { container } = view();
    const table = container.querySelector("#scoreboard table[data-scoreboard]") as HTMLElement;
    for (const row of ["P0", "P1", "P2", "P3_protect", "P3_balanced"]) expect(table.querySelector(`[data-row="${row}"]`), row).not.toBeNull();
    expect(table).toHaveTextContent("Baseline: ban only");
    expect(table.querySelector('[data-row="P3_protect"] th')).toHaveTextContent("Stellar Blaze");
    const missed = policy.leads.find((lead) => lead.lead_days === 1)?.rows.find((row) => row.policy === "P1")?.missed_danger_hours.value;
    expect(table.querySelector('[data-row="P1"]')).toHaveTextContent((missed ?? NaN).toFixed(1));
    for (const id of ["H4", "H5"]) {
      const verdict = policy.verdicts.find((v) => v.id === id);
      expect(verdict, id).toBeDefined();
      expect(container.querySelector(`[data-verdict-id="${id}"]`)?.textContent).toContain(verdict?.text);
    }
    // the unfavourable verdict is shown beside the favourable one
    expect(container.querySelector('[data-verdict-id="H5"]')).toHaveTextContent("not supported");
    expect(screen.getByRole("link", { name: "Open the scoreboard" })).toHaveAttribute("href", "/replay");
  });

  it("links only to routes that exist, never to a deferred view", () => {
    const { container } = view();
    const hrefs = [...container.querySelectorAll("a[href]")].map((a) => a.getAttribute("href") ?? "");
    expect(hrefs.length).toBeGreaterThan(8);
    const built = new Set(["/", "/replay", "/replay/day", "/replay/try", "/replay/governance", "/supervisor", "/worker", "#problem", "#main-content"]);
    for (const href of hrefs) {
      if (href.startsWith("/replay/proof/")) continue;
      expect(built.has(href), href).toBe(true);
      expect(isDeferredRoute(href), href).toBe(false);
    }
  });

  it("says nothing the claim rules forbid and renders no export key as copy", () => {
    const { container } = view();
    const text = container.textContent;
    expect(text.length).toBeGreaterThan(2000);
    expect(text).not.toMatch(FORBIDDEN);
    expect(text).not.toMatch(EXPORT_KEY);
    const messages = JSON.stringify((JSON.parse(readFileSync(path.join(root, "messages/en.json"), "utf8")) as { judge: { landing: unknown } }).judge.landing);
    expect(messages).not.toMatch(FORBIDDEN);
    expect(messages).not.toMatch(/[–—]/);
  });
});

describe("the live field island", () => {
  const panel = {
    day: field.grid.day,
    dayLabel: "Thu 3 Sep 2026",
    omaa: field.omaa,
    peakHour: field.peakHour,
    ban: { kind: "in-force", fromHour: 12.5, toHour: 15 } as const,
    proof: {
      what: "The forecast heat field",
      protocol: "p",
      protocolHref: null,
      script: "s",
      file: "static/uae.json",
      fileSha256: "ab",
      sourceSha256: null,
      label: "RECORDED",
      modelId: null,
      generatedAt: null,
    } as const,
    highestOfSeason: true,
    dir: "ltr",
  } as const;

  function stubBrowser(reduced: boolean): { raf: ReturnType<typeof vi.fn> } {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe(): void {}
        disconnect(): void {}
      },
    );
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: reduced && query.includes("reduce"), addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    const raf = vi.fn(() => 1);
    vi.stubGlobal("requestAnimationFrame", raf);
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    return { raf };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const island = () => renderWithIntl(<FieldIsland panel={panel} data={{ grid, coast }} />);

  it("test_scrubber_keyboard_and_values_in_dom: arrows, Home and End move a slider whose values are text", () => {
    stubBrowser(true);
    island();
    const slider = screen.getByRole("slider");
    expect(slider).toHaveAttribute("aria-valuemin", "0");
    expect(slider).toHaveAttribute("aria-valuemax", "23");
    expect(slider).toHaveAttribute("aria-valuenow", "14");
    expect(slider.getAttribute("aria-valuetext")).toBe(`14:00: hottest point ${readoutText(readingAt(grid, field.omaa, 14)).hottest} degrees, Abu Dhabi airport ${field.omaa[14]?.toFixed(1) ?? ""}`);
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(slider).toHaveAttribute("aria-valuenow", "15");
    // test_readout_text_equals_canvas_values: the readout names the hour's own hottest cell
    expect(document.querySelector("[data-readout-hottest]")).toHaveTextContent(`${readoutText(readingAt(grid, field.omaa, 15)).hottest}°C`);
    expect(document.querySelector("[data-when-hour]")).toHaveTextContent("15:00");
    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    expect(slider).toHaveAttribute("aria-valuenow", "13");
    fireEvent.keyDown(slider, { key: "Home" });
    expect(slider).toHaveAttribute("aria-valuenow", "0");
    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    expect(slider).toHaveAttribute("aria-valuenow", "23");
    fireEvent.keyDown(slider, { key: "End" });
    expect(slider).toHaveAttribute("aria-valuenow", "23");
    expect(document.querySelector("[data-readout-where]")).toHaveTextContent(/^\d\d\.\d\d N \d\d\.\d\d E$/);
  });

  it("test_reduced_motion_no_autoplay: rests on the peak hour, starts no animation and offers no Play button", () => {
    const { raf } = stubBrowser(true);
    island();
    expect(raf).not.toHaveBeenCalled();
    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuenow", "14");
    expect(screen.queryByRole("button", { name: /Play the day|Pause the day/ })).toBeNull();
    expect(document.querySelector("[data-field-readout]")).toHaveAttribute("aria-live", "polite");
  });

  it("plays the day once on its own without reduced motion, silent for screen readers while it plays, and Pause stops it", () => {
    const { raf } = stubBrowser(false);
    island();
    expect(raf).toHaveBeenCalled();
    expect(document.querySelector("[data-field-readout]")).toHaveAttribute("aria-live", "off");
    act(() => {
      screen.getByRole("button", { name: "Pause the day" }).click();
    });
    expect(screen.getByRole("button", { name: "Play the day" })).toBeInTheDocument();
    expect(document.querySelector("[data-field-readout]")).toHaveAttribute("aria-live", "polite");
  });

  it("test_readout_text_equals_canvas_values: every hour's readout equals the reading the canvas is drawn from", () => {
    stubBrowser(true);
    island();
    const slider = screen.getByRole("slider");
    for (let hour = 0; hour < 24; hour++) {
      fireEvent.keyDown(slider, { key: "Home" });
      for (let step = 0; step < hour; step++) fireEvent.keyDown(slider, { key: "ArrowRight" });
      const text = readoutText(readingAt(grid, field.omaa, hour));
      expect(document.querySelector("[data-readout-hottest]")).toHaveTextContent(`${text.hottest}°C`);
      expect(document.querySelector("[data-readout-cells]")).toHaveTextContent(`${text.cells} of ${text.cellsTotal}`);
    }
  });
});
