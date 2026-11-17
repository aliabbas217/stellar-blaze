import { act, fireEvent, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { DayChart, type DayChartLabels } from "@/components/charts/DayChart";
import { SeasonPlayer, PLAY_MS } from "@/components/charts/SeasonPlayer";
import { SeasonRibbon, type RibbonLabels, type SeasonRibbonProps } from "@/components/charts/SeasonRibbon";
import type { Proof } from "@/components/provenance/proof";
import { renderWithIntl } from "../../../utils/intl";

const N = 12;
const days = Array.from({ length: N }, (_, i) => `2026-06-${String(10 + i).padStart(2, "0")}`);

const labels: RibbonLabels = {
  ariaLabel: "Daily peak forecast, 12 days",
  limit: "Heavy-work limit 26.6 °C",
  slot: "Midday break in force, long",
  slotShort: "Midday break",
  peak: "38.0 °C, hottest",
  coolest: "30.0 °C, coolest",
  tableToggle: "Show the daily numbers as a table",
  tableCaption: "Daily peak forecast, one row per day",
  columns: { day: "Day", peak: "Peak", over: "Hours over", inBreak: "Midday break" },
  yes: "Yes",
  no: "No",
};

const ribbon: Omit<SeasonRibbonProps, "upto"> = {
  days,
  dayLabels: days.map((d) => d.slice(5)),
  peaks: [30, 31, 32, 33, 34, 35, 38, 36, 35, 34, 33, 32],
  perDay: [5, 5, 6, 6, 7, 8, 9, 8, 7, 6, 5, 5],
  ban: { fromIndex: 5, toIndex: 11 },
  limitC: 26.6,
  ticks: [
    { index: 0, label: "10 Jun" },
    { index: 11, label: "21 Jun" },
  ],
  labels,
};

const tally = days.map((_, i) => ({ days: i + 1, hours: (i + 1) * 5, inBan: Math.max(0, i - 4) }));

const proof: Proof = {
  what: "x",
  protocol: "recorded forecast",
  protocolHref: null,
  script: "facts.ts:seasonFacts",
  file: "static/omaa_2026_ifs_d1_wbgt_hourly.json",
  fileSha256: "f".repeat(64),
  sourceSha256: null,
  label: "RECORDED",
  modelId: null,
  generatedAt: null,
};

function player(): ReactElement {
  return <SeasonPlayer ribbon={ribbon} tally={tally} limitC={26.6} proofs={{ days: proof, hours: proof, inBan: proof }} />;
}

function mockMotion(reduce: boolean): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: reduce && query.includes("prefers-reduced-motion"),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      onchange: null,
      dispatchEvent: () => false,
    }),
  });
}

describe("SeasonRibbon", () => {
  it("test_ribbon_has_table_alternative", () => {
    const { container } = renderWithIntl(<SeasonRibbon {...ribbon} />);
    expect(screen.getByRole("img", { name: labels.ariaLabel })).toBeInTheDocument();
    const details = container.querySelector("details[data-ribbon-table]");
    expect(details).not.toBeNull();
    expect(within(details as HTMLElement).getByText(labels.tableToggle)).toBeInTheDocument();
    // one row per day, the same numbers as the chart
    const rows = container.querySelectorAll("details tbody tr");
    expect(rows).toHaveLength(N);
    expect(rows[6]?.textContent).toContain("38.0");
    // the scroll container can be reached by keyboard
    expect(container.querySelector("details [role=region]")?.getAttribute("tabindex")).toBe("0");
  });

  it("draws the slot only for the days the break is in force, and none without a ban", () => {
    const { container, rerender } = renderWithIntl(<SeasonRibbon {...ribbon} />);
    expect(container.querySelector("[data-slot]")).not.toBeNull();
    rerender(<SeasonRibbon {...ribbon} ban={null} />);
    expect(container.querySelector("[data-slot]")).toBeNull();
  });

  it("reveals the season up to `upto` and shows the playhead only while it is partial", () => {
    const { container, rerender } = renderWithIntl(<SeasonRibbon {...ribbon} />);
    expect(container.querySelector("[data-playhead]")).toBeNull();
    rerender(<SeasonRibbon {...ribbon} upto={3} />);
    expect(container.querySelector("[data-playhead]")).not.toBeNull();
    expect(container.querySelector("figure")?.getAttribute("data-upto")).toBe("3");
    // the hottest day (index 6) is not revealed yet, so its note is not drawn
    expect(container.querySelector("[data-note=peak]")).toBeNull();
  });

  it("labels the limit once, and no notes when compact", () => {
    const { container } = renderWithIntl(<SeasonRibbon {...ribbon} compact />);
    expect(container.querySelector("[data-limit-label]")).toBeNull();
    expect(container.querySelector("[data-note]")).toBeNull();
  });

  it("paints one band per degree from the heat ramp, and puts no text in the svg", () => {
    const { container } = renderWithIntl(<SeasonRibbon {...ribbon} />);
    expect(container.querySelectorAll("[data-isotherms] rect")).toHaveLength(16);
    expect(container.querySelector("svg text")).toBeNull();
  });
});

describe("SeasonPlayer", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("test_player_never_autoplays_and_reduced_motion_final_frame", () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    mockMotion(false);
    const { container } = renderWithIntl(player());
    const figure = () => container.querySelector("figure[data-upto]");
    // first paint: the final frame, the final tally, the button offers to play
    expect(figure()?.getAttribute("data-upto")).toBe(String(N - 1));
    expect(screen.getByRole("button", { name: "Play the season" })).not.toHaveAttribute("aria-pressed");
    expect(screen.getByText(String(N * 5))).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(PLAY_MS * 2);
    });
    expect(figure()?.getAttribute("data-upto")).toBe(String(N - 1));
    expect(screen.getByRole("button", { name: "Play the season" })).toBeInTheDocument();
  });

  it("plays from the start, pauses where it is, resumes, and finishes on the final frame", () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    mockMotion(false);
    const { container } = renderWithIntl(player());
    const upto = () => Number(container.querySelector("figure[data-upto]")?.getAttribute("data-upto"));
    fireEvent.click(screen.getByRole("button", { name: "Play the season" }));
    // the label alone carries the state: a changing label plus aria-pressed would be a double toggle
    expect(screen.getByRole("button", { name: "Pause" })).not.toHaveAttribute("aria-pressed");
    act(() => {
      vi.advanceTimersByTime(PLAY_MS / 2);
    });
    expect(upto()).toBeGreaterThan(0);
    expect(upto()).toBeLessThan(N - 1);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    const paused = upto();
    act(() => {
      vi.advanceTimersByTime(PLAY_MS);
    });
    expect(upto()).toBe(paused);
    expect(screen.getByRole("button", { name: "Resume" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    act(() => {
      vi.advanceTimersByTime(PLAY_MS * 2);
    });
    expect(upto()).toBe(N - 1);
    expect(screen.getByRole("button", { name: "Play the season" })).toBeInTheDocument();
  });

  it("a frame stamped before the click (a browser stamps a frame at its START) never moves the season before day 0", () => {
    // The flake of the scoreboard Play e2e: `now - last` was negative, the position went below 0, `days[-1]` was undefined and
    // the date label threw "Invalid time value", which put the whole page on its error boundary.
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => frames.push(callback));
    mockMotion(false);
    const { container } = renderWithIntl(player());
    fireEvent.click(screen.getByRole("button", { name: "Play the season" }));
    act(() => {
      frames.shift()?.(performance.now() - 16);
    });
    expect(container.querySelector("figure[data-upto]")?.getAttribute("data-upto")).toBe("0");
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it("with reduced motion, Play stays on the final frame and says the animation is off", () => {
    mockMotion(true);
    const { container } = renderWithIntl(player());
    fireEvent.click(screen.getByRole("button", { name: "Play the season" }));
    expect(container.querySelector("figure[data-upto]")?.getAttribute("data-upto")).toBe(String(N - 1));
    expect(screen.getByRole("button", { name: "Play the season" })).not.toHaveAttribute("aria-pressed");
    expect(screen.getByText("Animation is off on this device, so the whole season is shown.")).toBeInTheDocument();
  });

  it("is the hero and the page's one primary action, and carries the spine", () => {
    mockMotion(false);
    const { container } = renderWithIntl(player());
    expect(container.querySelectorAll("[data-hero]")).toHaveLength(1);
    expect(container.querySelectorAll("[data-primary]")).toHaveLength(1);
    expect(container.querySelectorAll("[data-spine]")).toHaveLength(1);
  });
});

describe("DayChart", () => {
  const dayLabels: DayChartLabels = {
    ariaLabel: "One day",
    limit: "Heavy-work limit 26.6 °C",
    slot: "Midday break",
    outline: "Midday break by law: not in force until 15 Jun",
    legend: { raw: "Raw forecast", ours: "Ours", truth: "Station truth" },
    peak: "35.0 °C at 13:00",
  };
  const raw: (number | null)[] = Array.from({ length: 24 }, (_, h) => 28 + Math.min(h, 24 - h) / 2);
  const base = { raw, ban: { kind: "in-force", fromHour: 12.5, toHour: 15 } as const, from: 5, to: 20, limitC: 26.6, labels: dayLabels };

  it("test_day_chart_draws_only_series_that_exist", () => {
    const { container, rerender } = renderWithIntl(<DayChart {...base} />);
    expect(container.querySelector("[data-series=raw]")).not.toBeNull();
    expect(container.querySelector("[data-series=ours]")).toBeNull();
    expect(container.querySelector("[data-series=truth]")).toBeNull();
    expect([...container.querySelectorAll("[data-legend-item]")].map((e) => e.getAttribute("data-legend-item"))).toEqual(["raw"]);

    const ours = raw.map((v) => (v === null ? null : { p05: v - 1, p50: v, p95: v + 1 }));
    rerender(<DayChart {...base} ours={ours} truth={raw} />);
    expect(container.querySelector("[data-series=ours]")).not.toBeNull();
    expect(container.querySelector("[data-series=truth]")).not.toBeNull();
    expect(container.querySelectorAll("[data-legend-item]")).toHaveLength(3);
  });

  it("draws no series for an array of missing hours", () => {
    const { container } = renderWithIntl(<DayChart {...base} raw={raw.map(() => null)} truth={raw.map(() => null)} />);
    expect(container.querySelector("[data-series]")).toBeNull();
    expect(container.querySelector("[data-legend-item]")).toBeNull();
  });

  it("breaks a line at a missing hour instead of bridging it", () => {
    const gap = raw.map((v, h) => (h === 12 ? null : v));
    const { container } = renderWithIntl(<DayChart {...base} raw={gap} />);
    expect(container.querySelectorAll("[data-series=raw] polyline")).toHaveLength(2);
  });

  it("draws the slot when the break is in force and a dashed labelled outline when it is not", () => {
    const { container, rerender } = renderWithIntl(<DayChart {...base} />);
    expect(container.querySelector("[data-slot=in-force]")).not.toBeNull();
    rerender(<DayChart {...base} ban={{ kind: "not-in-force", resumesLabel: "15 Jun", outline: { fromHour: 12.5, toHour: 15 } }} />);
    expect(container.querySelector("[data-slot=in-force]")).toBeNull();
    const outline = container.querySelector("[data-slot=outline]");
    expect(outline?.className).toContain("border-dashed");
    // the band is too narrow for the sentence on a phone: the legend names it in words
    expect(outline?.textContent).toBe("");
    expect(container.querySelector("[data-legend-item=outline]")?.textContent).toBe(dayLabels.outline);
  });

  it("draws no slot and no outline when the break has no extent", () => {
    const { container } = renderWithIntl(<DayChart {...base} ban={{ kind: "not-in-force", resumesLabel: null, outline: null }} />);
    expect(container.querySelector("[data-slot]")).toBeNull();
  });
});
