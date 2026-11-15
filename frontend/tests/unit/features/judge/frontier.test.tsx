import { readFileSync } from "node:fs";
import path from "node:path";
import { act, fireEvent, screen } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { DEFAULT_COMMUTE, FrontierPanel, parseCommute, type FrontierPanelProps } from "@/features/judge/FrontierPanel";
import { makeFormat } from "@/features/judge/adapters";
import { frontierStatement } from "@/features/judge/frontier-statement";
import { parseRosterFrontier, type RosterFrontier } from "@/features/judge/roster-frontier";
import { renderWithIntl } from "../../../utils/intl";

/*
 * The commute slider lives in the URL: the position is read from `?commute=`, a change writes it with router.replace, a bad
 * value reads as the default and the default leaves the URL clean. The two framework hooks are replaced by one fake location
 * (the same way tests/unit/lib/url-state.test.tsx does it).
 */

const location = { pathname: "/en/replay", search: "", replace: vi.fn<(href: string, options?: { scroll?: boolean }) => void>() };
const listeners = new Set<() => void>();

function setSearch(search: string): void {
  location.search = search;
  for (const notify of listeners) notify();
}

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
}

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(useSyncExternalStore(subscribe, () => location.search, () => location.search)),
}));

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => location.pathname,
  useRouter: () => ({ replace: location.replace }),
}));

beforeEach(() => {
  location.search = "";
  location.replace.mockReset();
  location.replace.mockImplementation((href) => {
    setSearch(href.includes("?") ? href.slice(href.indexOf("?")) : "");
  });
});

const file = path.resolve(import.meta.dirname, "../../../../data/static/roster_frontier.json");
const data = parseRosterFrontier(JSON.parse(readFileSync(file, "utf8")) as unknown);
const props: FrontierPanelProps = {
  data,
  source: { file: { path: "static/roster_frontier.json", sha256: "b".repeat(64) }, label: "REAL weather + assumed crew", protocol: "recorded analysis" },
};

describe("parseCommute", () => {
  it("accepts the six commutes the analysis ran and nothing else", () => {
    expect(parseCommute("60")).toBe(60);
    for (const bad of [null, "", "7", "abc", "45.5", "120"]) expect(() => parseCommute(bad)).toThrow();
  });
});

describe("FrontierPanel", () => {
  it("test_frontier_commute_in_url: reads the commute from the URL and draws that commute", () => {
    setSearch("?commute=60");
    const { container } = renderWithIntl(<FrontierPanel {...props} />);
    expect(screen.getByRole("slider")).toHaveValue("60");
    expect(container.querySelector("[data-frontier-chart]")?.getAttribute("data-commute")).toBe("60");
    expect(screen.getByText("60 min")).toBeInTheDocument();
  });

  it("reads a missing or bad value as the default", () => {
    setSearch("?commute=7");
    renderWithIntl(<FrontierPanel {...props} />);
    expect(screen.getByRole("slider")).toHaveValue(String(DEFAULT_COMMUTE));
  });

  it("writes a change to the URL with replace and scroll: false, and keeps the default out of it", () => {
    renderWithIntl(<FrontierPanel {...props} />);
    fireEvent.change(screen.getByRole("slider"), { target: { value: "75" } });
    expect(location.replace).toHaveBeenLastCalledWith("/en/replay?commute=75", { scroll: false });
    expect(screen.getByRole("slider")).toHaveValue("75");
    act(() => {
      fireEvent.change(screen.getByRole("slider"), { target: { value: String(DEFAULT_COMMUTE) } });
    });
    expect(location.replace).toHaveBeenLastCalledWith("/en/replay", { scroll: false });
  });

  it("shows the best-roster gain from the file at a commute that has one, with a proof", () => {
    setSearch("?commute=15");
    const { container } = renderWithIntl(<FrontierPanel {...props} />);
    const gate = data.frontier_absolute_gate.find((g) => g.commute_min === 15);
    expect(screen.getByText(`${(Math.round((gate?.avoided_vs_legal_default_ge30 ?? 0) * 1000) / 10).toFixed(1)}%`)).toBeInTheDocument();
    expect(container.querySelectorAll("[data-frontier-readouts] [data-proof-id]")).toHaveLength(2);
  });

  it("says there is no gain where the file has none, instead of showing 0%", () => {
    setSearch("?commute=45");
    const { container } = renderWithIntl(<FrontierPanel {...props} />);
    expect(container.querySelector("[data-frontier-best=none]")).not.toBeNull();
    expect(container.querySelectorAll("[data-frontier-readouts] [data-proof-id]")).toHaveLength(1);
  });

  it("credits the legalisation gain to the law", () => {
    renderWithIntl(<FrontierPanel {...props} />);
    expect(screen.getByText(/This gain belongs to the law, not to Stellar Blaze\./)).toBeInTheDocument();
  });

  it("draws the roster points of the commute chosen and offers them as a table", () => {
    setSearch("?commute=30");
    const { container } = renderWithIntl(<FrontierPanel {...props} />);
    const group = data.pareto_e30_vs_sleep.find((g) => g.commute_min === 30);
    expect(container.querySelectorAll("[data-roster-point]")).toHaveLength(group?.pareto.length ?? -1);
    expect(container.querySelectorAll("[data-frontier-table] tbody tr")).toHaveLength(group?.pareto.length ?? -1);
  });
});

/*
 * The heading sentence must be true for the exported data at EVERY commute on the chart. It is generated from the export's own
 * fields (the commute, the sleep gate, the sleep the legal default leaves, the fold counts, every percentage), so these tests
 * read the numbers from the data and compare them with what is rendered; nothing here types a percentage. It must fail when
 * the sentence is untrue or overclaims: a gain attributed to roster shape, a mean passed off as a commute's figure, or a zero
 * gain worded as "tested and equal" where the export says the legal default itself misses the sleep gate.
 */
describe("FrontierPanel heading, true at every commute of the chart", () => {
  const COMMUTE_VALUES = [15, 30, 45, 60, 75, 90] as const;
  const fmt = makeFormat("en");
  const hoursFmt = new Intl.NumberFormat("en-u-nu-latn", { maximumFractionDigits: 2 });
  // Wording that attributes a gain to roster shape, or says the heat cannot be outrun, or names the best roster as the actor.
  const OVERCLAIM = /outruns|no roster shape|gains nothing|the best roster|best roster that/;
  const EXPORT_KEY = /[a-z0-9]+_[a-z0-9_]+|\bB[01]_|b1_|folds_no_change/;

  function headingAt(frontier: RosterFrontier, commute: number): { heading: string; container: HTMLElement; unmount: () => void } {
    setSearch(`?commute=${String(commute)}`);
    const { container, unmount } = renderWithIntl(<FrontierPanel {...props} data={frontier} />);
    const heading = container.querySelector("[data-frontier-heading]")?.textContent ?? "";
    return { heading, container, unmount };
  }

  it("covers exactly the commutes the export has a gate row for", () => {
    expect(data.frontier_absolute_gate.map((g) => g.commute_min)).toEqual([...COMMUTE_VALUES]);
  });

  it.each(COMMUTE_VALUES)("%i min: every number is the export's, the gain is never credited to roster shape, the mean is labelled a mean", (commute) => {
    const gate = data.frontier_absolute_gate.find((g) => g.commute_min === commute);
    if (gate === undefined) throw new Error("no gate row");
    const legal = fmt.percentOne(data.legalisation_B0_to_B1_mean.ge30);
    const gateH = hoursFmt.format(data.assumptions.sleep_gate_h);
    const { heading, container, unmount } = headingAt(data, commute);
    expect(heading.startsWith(`At a ${String(commute)} minute commute the analysis finds`)).toBe(true);
    expect(heading).not.toMatch(OVERCLAIM);
    expect(heading).not.toMatch(EXPORT_KEY);
    // the legalisation figure is a mean over the analysis, never this commute's number
    expect(heading).toContain(`by ${legal} on average in the analysis`);
    if (gate.avoided_vs_legal_default_ge30 > 0) {
      expect(heading).toContain(`finds ${fmt.percentOne(gate.avoided_vs_legal_default_ge30)} fewer hours at 30 °C or more on top of the legal default`);
      expect(heading).toContain(`${gateH} h or more`);
      expect(heading).not.toMatch(/no gain/);
    } else {
      expect(heading).toContain("finds no gain on top of the legal default");
      const note = container.querySelector("[data-frontier-best=none]");
      expect(note?.getAttribute("data-gate-passes")).toBe(String(gate.b1_passes_sleep_gate));
      if (gate.b1_passes_sleep_gate) {
        // tested and equal: said with the export's own counts
        expect(heading).toContain(`in ${String(gate.folds_no_change)} of ${String(gate.folds)} cross-validation folds`);
      } else {
        // the legal default itself misses the gate: never "tested and equal", never a claim about other rosters
        expect(heading).toContain(`leaves ${hoursFmt.format(gate.b1_sleep_h)} h of sleep there, under the ${gateH} h sleep gate`);
        expect(heading).not.toMatch(/cross-validation|folds/);
        expect(note?.textContent).toContain(`${hoursFmt.format(gate.b1_sleep_h)} h of sleep`);
      }
    }
    expect(heading).not.toMatch(/does more/);
    unmount();
  });

  it("the readouts and labels never attribute the gain to a roster either (the heading is not the only text)", () => {
    for (const commute of COMMUTE_VALUES) {
      const { container, unmount } = headingAt(data, commute);
      const readouts = container.querySelector("[data-frontier-readouts]")?.textContent ?? "";
      expect(readouts.length).toBeGreaterThan(0);
      expect(readouts).not.toMatch(OVERCLAIM);
      expect(readouts).toContain("On top of the legal default");
      unmount();
    }
  });

  it("the whole panel prints no export key, at any commute (copy rule: every label comes from messages)", () => {
    for (const commute of COMMUTE_VALUES) {
      const { container, unmount } = headingAt(data, commute);
      const text = container.textContent;
      expect(text).not.toMatch(EXPORT_KEY);
      expect(text).not.toContain("B0_common_practice_non_compliant");
      unmount();
    }
  });

  it("the sentence moves with the data: a gain that appears at another commute is reported there and nowhere else", () => {
    const moved: RosterFrontier = {
      ...data,
      frontier_absolute_gate: data.frontier_absolute_gate.map((g) =>
        g.commute_min === 30 ? { ...g, avoided_vs_legal_default_ge30: 0.05, b1_passes_sleep_gate: true } : g.commute_min === 15 ? { ...g, avoided_vs_legal_default_ge30: 0 } : g,
      ),
    };
    expect(frontierStatement(moved, 30)).toMatchObject({ kind: "gain", gain: 0.05 });
    expect(headingAt(moved, 30).heading).toContain(`finds ${fmt.percentOne(0.05)} fewer hours`);
    expect(headingAt(moved, 15).heading).toContain("finds no gain on top of the legal default");
    expect(headingAt(moved, 45).heading).toContain("finds no gain on top of the legal default");
  });

  it("zero gain with a passing gate is 'not beaten in N of M folds' (from the export's counts); with a failing gate it is the sleep shortfall", () => {
    const edit = (passes: boolean): RosterFrontier => ({
      ...data,
      frontier_absolute_gate: data.frontier_absolute_gate.map((g) =>
        g.commute_min === 45 ? { ...g, avoided_vs_legal_default_ge30: 0, b1_passes_sleep_gate: passes, folds_no_change: 17, folds: 18, b1_sleep_h: 7.1 } : g,
      ),
    });
    expect(headingAt(edit(true), 45).heading).toContain("in 17 of 18 cross-validation folds it was not beaten");
    expect(headingAt(edit(false), 45).heading).toContain("leaves 7.1 h of sleep there, under the 7.5 h sleep gate");
    expect(frontierStatement(edit(false), 45)).toMatchObject({ kind: "no-gain", gatePasses: false, sleepHours: 7.1 });
  });

  it("labels both baselines on the readouts, and calls the legalisation figure an average", () => {
    setSearch("?commute=15");
    const { container } = renderWithIntl(<FrontierPanel {...props} />);
    const readouts = container.querySelector("[data-frontier-readouts]")?.textContent ?? "";
    expect(readouts).toContain("on top of the legal default");
    expect(readouts).toContain("from common practice to the legal default");
    expect(readouts).toContain("on average in the analysis");
  });

  it("a commute with no gate row is a missing note, never 'no gain'", () => {
    const partial: RosterFrontier = { ...data, frontier_absolute_gate: data.frontier_absolute_gate.filter((g) => g.commute_min !== 60) };
    const { heading, container } = headingAt(partial, 60);
    expect(heading).toBe("The analysis has no result for a 60 minute commute");
    expect(container.querySelector("[data-frontier-best=missing]")).not.toBeNull();
    expect(container.querySelector("[data-frontier-best=none]")).toBeNull();
    expect(container.textContent).not.toMatch(/No gain on top of the legal default/);
    // the legalisation readout does not depend on the commute and stays
    expect(container.querySelector("[data-frontier-readouts] [data-proof-id]")).not.toBeNull();
  });
});
