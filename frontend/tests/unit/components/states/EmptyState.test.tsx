import { screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { EmptyState } from "@/components/states/EmptyState";
import { DEFERRED_ROUTES, isDeferredRoute } from "@/components/states/deferred-routes";
import { renderWithIntl } from "../../../utils/intl";

// The locale-aware Link needs the Next.js app router; only the href it is given matters here.
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

describe("EmptyState", () => {
  it("is never blank: a title, a reason and a primary action that is a link", () => {
    renderWithIntl(
      <EmptyState title="No shift today" reason="Tomorrow 06:00 to 18:00." primary={{ label: "See tomorrow", href: "/worker" }} />,
    );
    expect(screen.getByRole("heading", { name: "No shift today" })).toBeInTheDocument();
    expect(screen.getByText("Tomorrow 06:00 to 18:00.")).toBeInTheDocument();
    const primary = screen.getByRole("link", { name: "See tomorrow" });
    expect(primary.getAttribute("href")).toMatch(/\/worker$/);
  });

  it("offers an optional secondary link", () => {
    renderWithIntl(
      <EmptyState
        title="t"
        reason="r"
        primary={{ label: "One", href: "/worker" }}
        secondary={{ label: "Two", href: "/worker/alerts" }}
      />,
    );
    expect(screen.getByRole("link", { name: "Two" }).getAttribute("href")).toMatch(/\/worker\/alerts$/);
  });

  it("shows the level word and mark when a level is given", () => {
    const { container } = renderWithIntl(
      <EmptyState title="t" reason="r" level="amber" primary={{ label: "One", href: "/worker" }} />,
    );
    expect(screen.getByText("Amber")).toBeInTheDocument();
    expect(container.querySelector("[data-level-mark]")).not.toBeNull();
  });

  // test_empty_state_primary_not_deferred_route
  it("refuses a primary or secondary link to a deferred view", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    for (const route of DEFERRED_ROUTES) {
      expect(isDeferredRoute(route), route).toBe(true);
      expect(
        () => renderWithIntl(<EmptyState title="t" reason="r" primary={{ label: "Go", href: route }} />),
        `primary ${route}`,
      ).toThrow(/deferred/i);
      expect(
        () =>
          renderWithIntl(
            <EmptyState
              title="t"
              reason="r"
              primary={{ label: "Go", href: "/worker" }}
              secondary={{ label: "Go", href: route }}
            />,
          ),
        `secondary ${route}`,
      ).toThrow(/deferred/i);
    }
    quiet.mockRestore();
  });

  it("knows a deferred route with a locale prefix, a query or a hash, and not a core one", () => {
    expect(isDeferredRoute("/ur/hse")).toBe(true);
    expect(isDeferredRoute("/en/supervisor/roster?x=1")).toBe(true);
    expect(isDeferredRoute("/en/worker/join#sheet")).toBe(true);
    expect(isDeferredRoute("/en/worker")).toBe(false);
    expect(isDeferredRoute("/en/worker/alerts")).toBe(false);
    expect(isDeferredRoute("/en/supervisor")).toBe(false);
  });

  it("does not mistake a longer name for a deferred one", () => {
    expect(isDeferredRoute("/en/hse-report")).toBe(false);
    expect(isDeferredRoute("/en/administrators")).toBe(false);
  });
});
