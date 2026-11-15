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

  it("says no roster beats the legal default where the file has none, instead of showing 0%", () => {
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
 * fields (the commute, the threshold, both baselines, every percentage), so these tests read the numbers from the data and
 * compare them with what is rendered; nothing here types a percentage.
 */
describe("FrontierPanel heading, true at every commute of the chart", () => {
  const COMMUTE_VALUES = [15, 30, 45, 60, 75, 90] as const;
  const fmt = makeFormat("en");
  const NO_SHAPE = /no roster shape outruns the heat under law, sleep and commute/;

  function headingAt(frontier: RosterFrontier, commute: number): { heading: string; container: HTMLElement; unmount: () => void } {
    setSearch(`?commute=${String(commute)}`);
    const { container, unmount } = renderWithIntl(<FrontierPanel {...props} data={frontier} />);
    const heading = container.querySelector("[data-frontier-heading]")?.textContent ?? "";
    return { heading, container, unmount };
  }

  it("covers exactly the commutes the export has a gate row for", () => {
    expect(data.frontier_absolute_gate.map((g) => g.commute_min)).toEqual([...COMMUTE_VALUES]);
  });

  it.each(COMMUTE_VALUES)("%i min: says 'no roster shape outruns the heat' only where the export shows zero gain over the legal default", (commute) => {
    const gate = data.frontier_absolute_gate.find((g) => g.commute_min === commute);
    if (gate === undefined) throw new Error("no gate row");
    const legal = fmt.percentOne(data.legalisation_B0_to_B1_mean.ge30);
    const { heading, unmount } = headingAt(data, commute);
    if (gate.avoided_vs_legal_default_ge30 === 0) {
      expect(heading).toMatch(NO_SHAPE);
      expect(heading).toContain(legal);
      // when it says "Beyond N", every commute above N shows zero gain in the export
      const beyond = /^Beyond a (\d+) minute commute/.exec(heading);
      if (beyond !== null) {
        const threshold = Number(beyond[1]);
        expect(commute).toBeGreaterThan(threshold);
        for (const g of data.frontier_absolute_gate.filter((row) => row.commute_min > threshold)) expect(g.avoided_vs_legal_default_ge30).toBe(0);
      } else {
        expect(heading).toContain(`At a ${String(commute)} minute commute`);
      }
    } else {
      // a gain exists here: no claim that roster shape gains nothing, and both numbers are shown as what they are
      expect(heading).not.toMatch(/outruns|no roster shape|gains nothing/);
      expect(heading).toContain(fmt.percentOne(gate.avoided_vs_legal_default_ge30));
      expect(heading).toContain("on top of the legal default");
      expect(heading).toContain("from common practice to the legal default");
      expect(heading).toContain(legal);
    }
    expect(heading).not.toMatch(/does more/);
    unmount();
  });

  it("scopes the sentence to the data: at the default commute it names the last commute with a gain", () => {
    const lastGain = Math.max(...data.frontier_absolute_gate.filter((g) => g.avoided_vs_legal_default_ge30 > 0).map((g) => g.commute_min));
    const { heading } = headingAt(data, 45);
    expect(heading).toContain(`Beyond a ${String(lastGain)} minute commute`);
  });

  it("never types the threshold: when the export's gain moves, the sentence moves with it", () => {
    const moved: RosterFrontier = {
      ...data,
      frontier_absolute_gate: data.frontier_absolute_gate.map((g) =>
        g.commute_min === 30 ? { ...g, avoided_vs_legal_default_ge30: 0.05 } : g.commute_min === 15 ? { ...g, avoided_vs_legal_default_ge30: 0 } : g,
      ),
    };
    // 15 has no gain but 30 has: "beyond 15" would be false, so the sentence is scoped to the commute itself
    expect(headingAt(moved, 15).heading).toMatch(/^At a 15 minute commute, no roster shape outruns/);
    expect(frontierStatement(moved, 45)).toMatchObject({ kind: "none", beyond: 30 });
    expect(headingAt(moved, 45).heading).toMatch(/^Beyond a 30 minute commute, no roster shape outruns/);
    expect(headingAt(moved, 30).heading).not.toMatch(NO_SHAPE);
  });

  it("with no gain at any commute, never says 'beyond'", () => {
    const flat: RosterFrontier = { ...data, frontier_absolute_gate: data.frontier_absolute_gate.map((g) => ({ ...g, avoided_vs_legal_default_ge30: 0 })) };
    for (const commute of COMMUTE_VALUES) expect(headingAt(flat, commute).heading).toMatch(new RegExp(`^At a ${String(commute)} minute commute, no roster shape`));
  });

  it("labels both baselines on the readouts", () => {
    setSearch("?commute=15");
    const { container } = renderWithIntl(<FrontierPanel {...props} />);
    const readouts = container.querySelector("[data-frontier-readouts]")?.textContent ?? "";
    expect(readouts).toContain("on top of the legal default");
    expect(readouts).toContain("from common practice to the legal default");
  });

  it("a commute with no gate row is a missing note, never 'no roster beats the legal default'", () => {
    const partial: RosterFrontier = { ...data, frontier_absolute_gate: data.frontier_absolute_gate.filter((g) => g.commute_min !== 60) };
    const { heading, container } = headingAt(partial, 60);
    expect(heading).toBe("The analysis has no result for a 60 minute commute");
    expect(container.querySelector("[data-frontier-best=missing]")).not.toBeNull();
    expect(container.querySelector("[data-frontier-best=none]")).toBeNull();
    expect(container.textContent).not.toMatch(/No roster beats the legal default/);
    // the legalisation readout does not depend on the commute and stays
    expect(container.querySelector("[data-frontier-readouts] [data-proof-id]")).not.toBeNull();
  });
});
