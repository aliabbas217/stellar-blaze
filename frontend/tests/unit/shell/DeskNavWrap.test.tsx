import { screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { DeskShell } from "@/components/shell/DeskShell";
import { renderWithIntl } from "../../utils/intl";

/*
 * Audit M5, then S13 (defect G): at 390 px the desk header's menu was a sideways scroller that clipped "Try a plan" and "Governance" off
 * screen (first behind nothing, then behind an end marker). It now takes its own full-width row on a phone and WRAPS onto a second row, so
 * every item is on screen at once and nothing scrolls sideways. Every item stays a link in source order, so the keyboard order is the
 * visual order. jsdom does no layout: the wrap is pinned as the classes, and the real widths are checked in the browser.
 */

vi.mock("next/navigation", () => ({ usePathname: () => "/en/replay" }));
vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/replay",
  getPathname: ({ href, locale }: { href: string; locale: string }) => `/${locale}${href}`,
  Link: ({ href, children, ...props }: { href: string; children: ReactNode; transitionTypes?: string[]; prefetch?: boolean }) => (
    // transitionTypes and prefetch are for the router, not the DOM.
    <a href={`/en${href}`} {...Object.fromEntries(Object.entries(props).filter(([key]) => key !== "transitionTypes" && key !== "prefetch"))}>
      {children}
    </a>
  ),
}));

const ITEMS = [
  { href: "/", label: "The story" },
  { href: "/replay", label: "Scoreboard" },
  { href: "/replay/day", label: "One day" },
  { href: "/replay/try", label: "Try a plan" },
  { href: "/replay/governance", label: "Governance" },
  { href: "/supervisor", label: "For crews" },
];

function renderShell() {
  const view = renderWithIntl(
    <DeskShell items={ITEMS}>
      <main>page</main>
    </DeskShell>,
  );
  return { ...view, nav: screen.getByRole("navigation", { name: "Main" }) };
}

describe("DeskShell menu wraps instead of scrolling", () => {
  it("test_every_item_is_a_link_in_source_order: nothing is dropped on a narrow screen, and the keyboard order is the visual order", () => {
    const { nav } = renderShell();

    expect(within(nav).getAllByRole("link").map((link) => link.textContent)).toEqual(ITEMS.map((item) => item.label));
  });

  it("the list wraps and the menu never becomes a sideways scroller or carries an end marker", () => {
    const { container, nav } = renderShell();

    expect(within(nav).getByRole("list").className).toContain("flex-wrap");
    expect(nav.className).not.toMatch(/overflow-x-(auto|scroll)/);
    expect(container.querySelector("[data-nav-more]")).toBeNull();
  });
});
