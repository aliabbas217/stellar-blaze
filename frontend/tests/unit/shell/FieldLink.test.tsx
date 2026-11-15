import { screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { FieldLink } from "@/components/shell/FieldLink";
import { WorkerDock } from "@/components/shell/WorkerDock";
import { EmptyState } from "@/components/states/EmptyState";
import { renderWithIntl } from "../../utils/intl";

/*
 * No link on a field surface prefetches (F2 Part 0, I2): a prefetch is written to the service worker's prefetch cache just
 * when a worker may be removing their data, and ships the target route's script. FieldLink is the one component that
 * carries that rule, so the tests read the `prefetch` prop that reaches the locale Link from every field surface.
 */

vi.mock("next/navigation", () => ({ usePathname: () => "/en/worker" }));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, prefetch, className }: { href: string; children: ReactNode; prefetch?: boolean; className?: string }) => (
    // The router would receive `prefetch`; the DOM gets it as an attribute so the test can read what was passed down.
    <a href={href} className={className} data-prefetch={prefetch === undefined ? "default" : String(prefetch)}>
      {children}
    </a>
  ),
}));

describe("FieldLink", () => {
  it("test_field_link_never_prefetches: it passes prefetch=false to the locale Link", () => {
    renderWithIntl(<FieldLink href="/worker/alerts">Alerts</FieldLink>);
    expect(screen.getByRole("link", { name: "Alerts" })).toHaveAttribute("data-prefetch", "false");
  });

  it("keeps the rest of the props (a view transition type, a class) and cannot be told to prefetch", () => {
    // @ts-expect-error `prefetch` is not a prop of FieldLink: the type refuses it, and it is overridden at run time anyway.
    renderWithIntl(<FieldLink href="/worker" prefetch className="cls">Today</FieldLink>);
    const link = screen.getByRole("link", { name: "Today" });
    expect(link).toHaveClass("cls");
    expect(link).toHaveAttribute("data-prefetch", "false");
  });

  it("EmptyState's links do not prefetch", () => {
    renderWithIntl(
      <EmptyState
        title="Nothing here"
        reason="Because."
        primary={{ label: "Primary", href: "/worker/alerts" }}
        secondary={{ label: "Secondary", href: "/worker" }}
      />,
    );
    expect(screen.getByRole("link", { name: "Primary" })).toHaveAttribute("data-prefetch", "false");
    expect(screen.getByRole("link", { name: "Secondary" })).toHaveAttribute("data-prefetch", "false");
  });

  it("every link of the worker dock does not prefetch", () => {
    renderWithIntl(<WorkerDock />);
    const links = screen.getAllByRole("link");
    expect(links.length).toBeGreaterThanOrEqual(3);
    for (const link of links) expect(link).toHaveAttribute("data-prefetch", "false");
  });
});
