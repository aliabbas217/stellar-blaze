import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

  it("puts a stamp on the kicker line, after the kicker: no extra row, so the sign is as tall as one without (Part S0)", () => {
    const { container } = renderWithIntl(
      <LevelSign level="orange" kind="live" size="hero" kicker="Site level now" stamp={<span data-test-stamp="">Replay</span>} until="until 17:00" />,
    );
    const kickerLine = (container.querySelector("[data-test-stamp]") as HTMLElement).parentElement as HTMLElement;

    expect(kickerLine.tagName).toBe("P");
    expect(kickerLine).toHaveTextContent("Site level nowReplay");
    expect(kickerLine.nextElementSibling).toHaveTextContent("until 17:00");
  });

  it("takes the until text as a node, so the caller can isolate the clock time with bdi", () => {
    for (const size of ["hero", "mini"] as const) {
      const { container, unmount } = renderWithIntl(
        <LevelSign level="orange" kind="live" size={size} kicker="k" until={<>until <bdi>17:00</bdi></>} />,
      );
      expect(container.querySelector("bdi")).toHaveTextContent("17:00");
      unmount();
    }
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

  it("sets the hero word from the one size property (32 px) and the mini word at 22 px; the mark beside it is 14 px", () => {
    const hero = renderWithIntl(<LevelSign level="amber" kind="live" size="hero" kicker="k" />);
    expect(hero.container.querySelector("h2")?.className).toContain("text-(length:--sign-word-size)");
    expect(hero.container.querySelector("[data-level-mark]")).toHaveClass("size-3.5");
    hero.unmount();
    const mini = renderWithIntl(<LevelSign level="amber" kind="live" size="mini" kicker="k" />);
    expect(mini.container.querySelector("h2")?.className).toContain("text-xl");
  });

  it("publishes the height a skeleton must reserve", () => {
    expect(LEVEL_SIGN_HEIGHT.hero).toMatch(/^calc\(/);
    expect(LEVEL_SIGN_HEIGHT.mini).toMatch(/^calc\(/);
  });

  it("sets the hero word at 32 px in every language, from one property both the sign and its skeleton read (redesign S5: it was 76 px, 64 px in Arabic script)", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles/globals.css"), "utf8");
    const sizeOf = (selector: string): string | undefined =>
      new RegExp(String.raw`:lang\(${selector}\)[^{]*\{[^}]*--sign-word-size:\s*([^;]+);`).exec(css)?.[1];
    for (const code of ["en", "ar", "ur", "hi", "bn", "ne"]) expect(sizeOf(code), code).toBe("var(--t-32)");
    expect(LEVEL_SIGN_HEIGHT.hero).toContain("var(--sign-word-size)");
    expect(LEVEL_SIGN_HEIGHT.hero).not.toMatch(/--t-(64|76)/);
  });

  it("puts the kicker and the 'until' on one row above the word, never below it (hero)", () => {
    const { container } = renderWithIntl(<LevelSign level="amber" kind="live" size="hero" kicker="Site level now" until="until 17:00" />);
    const sign = container.querySelector("[data-level-sign]") as HTMLElement;
    const row = screen_row(sign);
    expect(row.textContent).toContain("Site level now");
    expect(row.textContent).toContain("until 17:00");
    // Order in the sign: the row, the word, the scale. Nothing sits between the word and the scale any more.
    const children = [...sign.children];
    expect(children.indexOf(row)).toBe(0);
    expect(children.indexOf(sign.querySelector("h2")?.parentElement as HTMLElement)).toBe(1);
  });
});

function screen_row(sign: HTMLElement): HTMLElement {
  return sign.children[0] as HTMLElement;
}
