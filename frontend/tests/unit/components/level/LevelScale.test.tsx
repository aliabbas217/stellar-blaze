import { screen } from "@testing-library/react";
import { LevelScale } from "@/components/level/LevelScale";
import { LEVELS, levelIndex, type Level } from "@/components/level/level";
import { renderWithIntl } from "../../../utils/intl";

const NAMES: Record<Level, string> = { green: "Green", amber: "Amber", orange: "Orange", red: "Red" };

function segments(): HTMLElement[] {
  return Array.from(screen.getByRole("img").querySelectorAll<HTMLElement>("[data-segment]"));
}

describe("LevelScale", () => {
  // test_level_scale_aria_and_marker
  it.each(LEVELS)("names %s by position and word, and marks exactly that segment", (level) => {
    renderWithIntl(<LevelScale level={level} kind="live" />);
    expect(screen.getByRole("img", { name: `Level ${String(levelIndex(level))} of 4, ${NAMES[level]}` })).toBeInTheDocument();

    const current = segments().filter((s) => s.hasAttribute("data-current"));
    expect(current).toHaveLength(1);
    expect(segments().indexOf(current[0] as HTMLElement)).toBe(levelIndex(level) - 1);
    expect(current[0]).toHaveAttribute("data-marker", "solid");
  });

  it("always draws four segments", () => {
    renderWithIntl(<LevelScale level="amber" kind="live" />);
    expect(segments()).toHaveLength(4);
  });

  it("says 'Last known level' when stale", () => {
    renderWithIntl(<LevelScale level="orange" kind="stale" />);
    expect(screen.getByRole("img", { name: "Last known level 3 of 4, Orange" })).toBeInTheDocument();
  });

  it("has no marker and says so when there is no level", () => {
    renderWithIntl(<LevelScale level={null} kind="fallback" />);
    expect(screen.getByRole("img", { name: "No level, the site rules apply" })).toBeInTheDocument();
    expect(segments().filter((s) => s.hasAttribute("data-current"))).toHaveLength(0);
    expect(screen.getByRole("img").querySelector("[data-marker]")).toBeNull();
  });

  // test_stale_marker_is_dashed_not_hatched
  it.each(["stale", "fallback"] as const)("draws the %s marker dashed, never hatched", (kind) => {
    const { container } = renderWithIntl(<LevelScale level="red" kind={kind} />);
    const marker = segments().find((s) => s.hasAttribute("data-current"));
    expect(marker).toHaveAttribute("data-marker", "dashed");
    const markerBar = marker?.querySelector("[data-bar]");
    expect(markerBar?.className).toContain("border-dashed");
    // No hatch anywhere in the markup: no gradient, no stripe utility, no hatch word.
    expect(container.innerHTML).not.toMatch(/gradient|hatch|stripe/i);
  });

  it("shows the four level names as visible labels by default", () => {
    renderWithIntl(<LevelScale level="green" kind="live" />);
    for (const name of Object.values(NAMES)) expect(screen.getByText(name)).toBeInTheDocument();
  });

  it("can drop the labels (the mini sign), keeping the accessible name", () => {
    renderWithIntl(<LevelScale level="green" kind="live" labels={false} />);
    expect(screen.queryByText("Amber")).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Level 1 of 4, Green" })).toBeInTheDocument();
  });
});
