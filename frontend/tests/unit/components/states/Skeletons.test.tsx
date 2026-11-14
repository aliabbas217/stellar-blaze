import { render } from "@testing-library/react";
import { LevelSign, LEVEL_SIGN_HEIGHT } from "@/components/level/LevelSign";
import { LevelSignSkeleton, Skeleton, TableRowsSkeleton } from "@/components/states/Skeletons";
import { renderWithIntl } from "../../../utils/intl";

describe("Skeletons", () => {
  it("a block takes exactly the height it is given", () => {
    const { container } = render(<Skeleton height="4.5rem" />);
    expect((container.firstElementChild as HTMLElement).style.height).toBe("4.5rem");
  });

  it("is hidden from assistive technology", () => {
    const { container } = render(<Skeleton height="1rem" />);
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });

  /*
   * test_skeleton_heights_match_final. jsdom does no layout, so what it can prove is the mechanism: the skeleton and the
   * sign are driven by the SAME language-aware custom properties (declared per language in globals.css, pinned by
   * tests/unit/styles/sign-leading.test.ts) and by no leading of their own. The rendered equality, in en, ar and ur,
   * is the Playwright test "the level sign skeleton is as tall as the sign" in tests/e2e/kit.spec.ts.
   */
  describe.each(["hero", "mini"] as const)("the %s level sign", (size) => {
    it("skeleton height is computed from the sign's two leading properties and nothing else", () => {
      const { container } = render(<LevelSignSkeleton size={size} />);
      const height = (container.firstElementChild as HTMLElement).style.height;
      expect(height).toBe(LEVEL_SIGN_HEIGHT[size]);
      expect(height).toContain("var(--sign-leading-text)");
      expect(height).toContain("var(--sign-leading-word)");
      // No fixed English leading: those are what made the skeleton wrong in Urdu and Arabic.
      expect(height).not.toMatch(/--leading-|--sign-leading-(?!text|word)/);
      expect(height).not.toMatch(/\d(px|rem)\b/);
    });

    it("the sign sets every text line from those same properties, never a leading of its own", () => {
      const { container } = renderWithIntl(
        <LevelSign level="green" kind="live" size={size} kicker="k" until={<bdi>17:00</bdi>} />,
      );
      const html = container.innerHTML;
      expect(html).not.toMatch(/leading-(solid|none|tight|snug|normal|relaxed|loose)\b|line-height/);
      // kicker + until, plus the four scale labels on the hero sign
      const text = container.querySelectorAll("[class*='leading-(--sign-leading-text)']");
      expect(text.length).toBe(size === "hero" ? 6 : 2);
      const word = container.querySelector("h2");
      expect(word?.className).toContain("leading-(--sign-leading-word)");
    });
  });

  it("a table skeleton is rows times the row height", () => {
    const { container } = render(<TableRowsSkeleton rows={3} rowHeight="3rem" />);
    const rows = container.querySelectorAll("[data-skeleton-row]");
    expect(rows).toHaveLength(3);
    for (const row of rows) expect((row as HTMLElement).style.height).toBe("3rem");
  });
});
