import { readFileSync } from "node:fs";
import path from "node:path";
import { act, fireEvent, screen } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { DEFAULT_COMMUTE, FrontierPanel, parseCommute, type FrontierPanelProps } from "@/features/judge/FrontierPanel";
import { parseRosterFrontier } from "@/features/judge/roster-frontier";
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
