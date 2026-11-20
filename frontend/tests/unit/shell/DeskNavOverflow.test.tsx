import { act, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { DeskShell } from "@/components/shell/DeskShell";
import { renderWithIntl } from "../../utils/intl";

/*
 * Audit M5: at 390 px the desk header's menu is a scroller 201 px wide that showed "The story" and "Scoreboard" and nothing said more
 * followed, so "Try a plan" and "Governance" were invisible. The menu now takes its own full-width row on a phone and, while there is
 * more to scroll to, shows a flat end marker (a chevron on a solid chip: DESIGN.md has no gradient or shadow to fade with). Every item
 * stays a link in source order, so the keyboard order is the visual order. jsdom does no layout, so the scroller's measurements are set by
 * hand here; the real widths are measured in the browser (see the commit's report).
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

function measure(nav: HTMLElement, sizes: { scrollWidth: number; clientWidth: number; scrollLeft?: number }): void {
  Object.defineProperty(nav, "scrollWidth", { configurable: true, value: sizes.scrollWidth });
  Object.defineProperty(nav, "clientWidth", { configurable: true, value: sizes.clientWidth });
  nav.scrollLeft = sizes.scrollLeft ?? 0;
}

function renderShell() {
  const view = renderWithIntl(
    <DeskShell items={ITEMS}>
      <main>page</main>
    </DeskShell>,
  );
  return { ...view, nav: screen.getByRole("navigation", { name: "Main" }) };
}

describe("DeskShell menu overflow cue", () => {
  it("test_every_item_is_a_link_in_source_order: nothing is dropped on a narrow screen, and the keyboard order is the visual order", () => {
    const { nav } = renderShell();

    expect(within(nav).getAllByRole("link").map((link) => link.textContent)).toEqual(ITEMS.map((item) => item.label));
  });

  it("test_cue_shows_while_more_is_off_screen: the end marker appears when the menu is wider than its box, aria-hidden, and never takes a tap", () => {
    const { container, nav } = renderShell();
    expect(container.querySelector("[data-nav-more]")).toBeNull();

    act(() => {
      measure(nav, { scrollWidth: 572, clientWidth: 358 });
      nav.dispatchEvent(new Event("scroll"));
    });

    const cue = container.querySelector("[data-nav-more]");
    expect(cue).not.toBeNull();
    expect(cue).toHaveAttribute("aria-hidden", "true");
    expect(cue?.className).toContain("pointer-events-none");
    // a link is never made unreachable by it: the cue is a sibling of the menu, not a link and not focusable
    expect(cue?.querySelector("a, button, [tabindex]")).toBeNull();
  });

  it("the cue goes away at the end of the scroll and stays away when the menu fits (a wide screen)", () => {
    const { container, nav } = renderShell();

    act(() => {
      measure(nav, { scrollWidth: 572, clientWidth: 358, scrollLeft: 214 });
      nav.dispatchEvent(new Event("scroll"));
    });
    expect(container.querySelector("[data-nav-more]")).toBeNull();

    act(() => {
      measure(nav, { scrollWidth: 560, clientWidth: 560 });
      nav.dispatchEvent(new Event("scroll"));
    });
    expect(container.querySelector("[data-nav-more]")).toBeNull();
  });

  it("works for a right-to-left page: a negative scrollLeft at the start still reads as 'more to come', and the far end reads as done", () => {
    const { container, nav } = renderShell();

    act(() => {
      measure(nav, { scrollWidth: 572, clientWidth: 358, scrollLeft: 0 });
      nav.dispatchEvent(new Event("scroll"));
    });
    expect(container.querySelector("[data-nav-more]")).not.toBeNull();

    act(() => {
      measure(nav, { scrollWidth: 572, clientWidth: 358, scrollLeft: -214 });
      nav.dispatchEvent(new Event("scroll"));
    });
    expect(container.querySelector("[data-nav-more]")).toBeNull();
  });

  it("the menu takes its own full-width row below the sm breakpoint, and the header may wrap (the cue needs the width)", () => {
    const { container, nav } = renderShell();
    const header = container.querySelector("header") as HTMLElement;

    expect(header.className).toContain("flex-wrap");
    const cell = nav.parentElement as HTMLElement;
    expect(cell.className).toMatch(/basis-full/);
    expect(cell.className).toMatch(/sm:basis-0/);
    expect(cell.className).toMatch(/order-last/);
    expect(cell.className).toMatch(/sm:order-none/);
  });
});
