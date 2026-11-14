import { screen, within } from "@testing-library/react";
import { LevelSign, LEVEL_SIGN_HEIGHT } from "@/components/level/LevelSign";
import { LEVELS, type Level } from "@/components/level/level";
import { renderWithIntl } from "../../../utils/intl";

const NAMES: Record<Level, string> = { green: "Green", amber: "Amber", orange: "Orange", red: "Red" };

describe("LevelSign", () => {
  // test_level_sign_never_uses_colour_alone
  it.each(LEVELS)("shows %s as a word, a position on the scale and a small mark", (level) => {
    const { container } = renderWithIntl(<LevelSign level={level} kind="live" size="hero" kicker="Site level now" />);
    const sign = container.querySelector("[data-level-sign]") as HTMLElement;

    // the word, as text
    expect(within(sign).getByRole("heading", { level: 2, name: NAMES[level] })).toBeInTheDocument();
    // the position, as an accessible scale
    expect(within(sign).getByRole("img", { name: new RegExp(`^Level \\d of 4, ${NAMES[level]}$`) })).toBeInTheDocument();
    // the mark, present and decorative
    const mark = sign.querySelector("[data-level-mark]");
    expect(mark).not.toBeNull();
    expect(mark).toHaveAttribute("aria-hidden", "true");
  });

  it("is not a filled plate: no shadow, hatch or large radius in the markup", () => {
    const { container } = renderWithIntl(<LevelSign level="red" kind="live" size="hero" kicker="Site level now" />);
    expect(container.innerHTML).not.toMatch(/shadow|hatch|gradient|backdrop|rounded-(md|lg|xl|2xl|3xl|full)/);
  });

  it("renders the kicker and the until text", () => {
    renderWithIntl(<LevelSign level="orange" kind="live" size="hero" kicker="Site level now" until="until 17:00" />);
    expect(screen.getByText("Site level now")).toBeInTheDocument();
    expect(screen.getByText("until 17:00")).toBeInTheDocument();
  });

  it("says Site rules, with no scale marker, when there is no level", () => {
    const { container } = renderWithIntl(<LevelSign level={null} kind="fallback" size="hero" kicker="Forecast expired" />);
    expect(screen.getByRole("heading", { level: 2, name: "Site rules" })).toBeInTheDocument();
    expect(container.querySelector("[data-level-mark]")).toBeNull();
    expect(container.querySelector("[data-segment][data-current]")).toBeNull();
  });

  it("draws a stale sign dashed with a clock beside the kicker, and never as live", () => {
    const { container } = renderWithIntl(<LevelSign level="orange" kind="stale" size="hero" kicker="Last known level" />);
    expect(screen.getByRole("img", { name: "Last known level 3 of 4, Orange" })).toBeInTheDocument();
    expect(container.querySelector("[data-marker='dashed']")).not.toBeNull();
    expect(container.querySelector("[data-pictogram='clock']")).not.toBeNull();
    expect(container.querySelector("[data-level-sign]")).toHaveAttribute("data-kind", "stale");
  });

  it("has no clock for a live sign", () => {
    const { container } = renderWithIntl(<LevelSign level="green" kind="live" size="hero" kicker="Site level now" />);
    expect(container.querySelector("[data-pictogram]")).toBeNull();
  });

  it("sets the word at 76 px for hero and 22 px for mini", () => {
    const hero = renderWithIntl(<LevelSign level="amber" kind="live" size="hero" kicker="k" />);
    expect(hero.container.querySelector("h2")?.className).toContain("text-6xl");
    hero.unmount();
    const mini = renderWithIntl(<LevelSign level="amber" kind="live" size="mini" kicker="k" />);
    expect(mini.container.querySelector("h2")?.className).toContain("text-xl");
  });

  it("publishes the height a skeleton must reserve", () => {
    expect(LEVEL_SIGN_HEIGHT.hero).toMatch(/^calc\(/);
    expect(LEVEL_SIGN_HEIGHT.mini).toMatch(/^calc\(/);
  });
});
