import { screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MY_DATA_TAB_ENABLED, WorkerDock } from "@/components/shell/WorkerDock";
import { renderWithIntl } from "../../utils/intl";

/*
 * The worker dock: "I feel unwell" is a safety action and never waits (F2 global constraints). It is always rendered,
 * never inside a form, never disabled, whatever the page, the connection or the tab.
 */

let pathname = "/en/worker";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: { href: string; children: ReactNode; transitionTypes?: string[]; prefetch?: boolean }) => (
    // transitionTypes and prefetch are for the router, not the DOM.
    <a href={`/en${href}`} {...Object.fromEntries(Object.entries(props).filter(([key]) => key !== "transitionTypes" && key !== "prefetch"))}>
      {children}
    </a>
  ),
}));

afterEach(() => {
  pathname = "/en/worker";
  vi.restoreAllMocks();
});

describe("WorkerDock", () => {
  it("test_dock_has_emergency_link_always: the unwell link is on every worker page, offline too, and is never disabled or in a form", () => {
    for (const path of ["/en/worker", "/en/worker/alerts", "/en/worker/alert"]) {
      pathname = path;
      vi.spyOn(navigator, "onLine", "get").mockReturnValue(path !== "/en/worker/alerts");
      const { container, unmount } = renderWithIntl(<WorkerDock />);

      const link = within(container).getByRole("link", { name: /I feel unwell/ });
      expect(link).toHaveAttribute("href", "/en/worker/unwell");
      expect(link).toHaveAttribute("data-emergency");
      expect(link).not.toHaveAttribute("aria-disabled");
      expect(link.closest("form")).toBeNull();
      expect(container.querySelectorAll("[data-emergency]")).toHaveLength(1);
      unmount();
    }
  });

  it("test_dock_shows_back_to_today_here: on the unwell sheet the dock offers Back to Today in place of I feel unwell", () => {
    pathname = "/en/worker/unwell";
    const { container } = renderWithIntl(<WorkerDock />);
    expect(screen.queryByRole("link", { name: /I feel unwell/ })).not.toBeInTheDocument();
    const back = screen.getByRole("link", { name: "Back to Today" });
    expect(back).toHaveAttribute("href", "/en/worker");
    expect(back).not.toHaveAttribute("aria-disabled");
    expect(back.closest("form")).toBeNull();
    expect(back.className).toMatch(/min-h-/);
    // The sheet has its own emergency call: the dock adds no second [data-emergency].
    expect(container.querySelectorAll("[data-emergency]")).toHaveLength(0);
  });

  it("the unwell link comes back on the sheet's neighbours, and Back to Today appears only on the sheet", () => {
    for (const path of ["/en/worker", "/en/worker/alerts", "/en/worker/alert", "/en/worker/unwell-ish"]) {
      pathname = path;
      const { unmount } = renderWithIntl(<WorkerDock />);
      expect(screen.getByRole("link", { name: /I feel unwell/ })).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Back to Today" })).not.toBeInTheDocument();
      unmount();
    }
  });

  it("offers Today and Alerts, and marks the current one", () => {
    pathname = "/en/worker/alerts";
    renderWithIntl(<WorkerDock />);
    const tabs = screen.getByRole("navigation", { name: "Worker navigation" });
    expect(within(tabs).getByRole("link", { name: "Alerts" })).toHaveAttribute("aria-current", "page");
    expect(within(tabs).getByRole("link", { name: "Today" })).not.toHaveAttribute("aria-current");
  });

  it("Today is current on the exact worker route", () => {
    pathname = "/en/worker";
    renderWithIntl(<WorkerDock />);
    expect(screen.getByRole("link", { name: "Today" })).toHaveAttribute("aria-current", "page");
  });

  it("Today is not current on a route below the worker route", () => {
    pathname = "/en/worker/unwell";
    renderWithIntl(<WorkerDock />);
    expect(screen.getByRole("link", { name: "Today" })).not.toHaveAttribute("aria-current");
  });

  it("the My data tab stays out until Task 21 flips MY_DATA_TAB_ENABLED", () => {
    expect(MY_DATA_TAB_ENABLED).toBe(false);
    renderWithIntl(<WorkerDock />);
    expect(screen.queryByRole("link", { name: "My data" })).not.toBeInTheDocument();
  });

  it("shows My data when it is enabled", () => {
    renderWithIntl(<WorkerDock myDataEnabled />);
    expect(screen.getByRole("link", { name: "My data" })).toHaveAttribute("href", "/en/worker/data");
  });

  it("targets are 44 px or more by construction and the dock respects the safe area", () => {
    const { container } = renderWithIntl(<WorkerDock />);
    expect(screen.getByRole("link", { name: /I feel unwell/ }).className).toMatch(/min-h-/);
    expect(container.innerHTML).toContain("safe-area-inset-bottom");
  });
});
