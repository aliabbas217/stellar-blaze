import { render } from "@testing-library/react";
import { LEVEL_SIGN_HEIGHT } from "@/components/level/LevelSign";
import { LevelSignSkeleton, Skeleton, TableRowsSkeleton } from "@/components/states/Skeletons";

describe("Skeletons", () => {
  it("a block takes exactly the height it is given", () => {
    const { container } = render(<Skeleton height="4.5rem" />);
    expect((container.firstElementChild as HTMLElement).style.height).toBe("4.5rem");
  });

  it("is hidden from assistive technology", () => {
    const { container } = render(<Skeleton height="1rem" />);
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });

  // test_skeleton_heights_match_final: the contract. The rendered-box proof, in a browser and in both themes, is
  // tests/e2e/kit.spec.ts ("the level sign skeleton is as tall as the sign").
  it.each(["hero", "mini"] as const)("the %s level sign skeleton reserves the height the final sign publishes", (size) => {
    const { container } = render(<LevelSignSkeleton size={size} />);
    expect((container.firstElementChild as HTMLElement).style.height).toBe(LEVEL_SIGN_HEIGHT[size]);
  });

  it("a table skeleton is rows times the row height", () => {
    const { container } = render(<TableRowsSkeleton rows={3} rowHeight="3rem" />);
    const rows = container.querySelectorAll("[data-skeleton-row]");
    expect(rows).toHaveLength(3);
    for (const row of rows) expect((row as HTMLElement).style.height).toBe("3rem");
  });
});
