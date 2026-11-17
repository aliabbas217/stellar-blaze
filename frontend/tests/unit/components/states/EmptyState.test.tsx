import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
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

const SRC = path.resolve(import.meta.dirname, "../../../../src");

/** Every .tsx or .ts file under a directory. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/** The URL path of every page under src/app/[locale]: route groups "(x)" take no segment. */
function pageRoutes(): string[] {
  const root = path.join(SRC, "app", "[locale]");
  return sourceFiles(root)
    .filter((file) => path.basename(file) === "page.tsx")
    .map((file) => {
      const segments = path
        .relative(root, path.dirname(file))
        .split(path.sep)
        .filter((segment) => segment !== "" && !/^\(.*\)$/.test(segment));
      return `/${segments.join("/")}`;
    });
}

// F1 placeholder pages that stand where a parked view will be. The page exists; the view the guard protects does not. None now: `/hse` left the
// deferred list when the minimal safety view was built (redesign S7).
const PLACEHOLDER_PAGES: readonly string[] = [];

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

  it("offers an optional secondary link, and /worker/alerts (a built route) is allowed", () => {
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

  describe("a link to a deferred view", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    // test_empty_state_primary_not_deferred_route
    it("throws in development and under test, for the primary and for the secondary", () => {
      const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
      for (const route of DEFERRED_ROUTES) {
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
                secondary={{ label: "Go", href: `/en${route}` }}
              />,
            ),
          `secondary ${route}`,
        ).toThrow(/deferred/i);
      }
      quiet.mockRestore();
    });

    it("never throws in production: the action is left out and the rest of the screen stays", () => {
      vi.stubEnv("NODE_ENV", "production");
      const { unmount } = renderWithIntl(
        <EmptyState
          title="Still here"
          reason="r"
          primary={{ label: "One", href: "/worker" }}
          secondary={{ label: "Parked", href: "/admin" }}
        />,
      );
      expect(screen.getByRole("heading", { name: "Still here" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "One" })).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Parked" })).not.toBeInTheDocument();
      unmount();

      // A deferred primary: the secondary takes its place; both deferred: no action row at all.
      const promoted = renderWithIntl(
        <EmptyState
          title="t"
          reason="r"
          primary={{ label: "Parked", href: "/admin" }}
          secondary={{ label: "Built", href: "/worker/alerts" }}
        />,
      );
      expect(screen.queryByRole("link", { name: "Parked" })).not.toBeInTheDocument();
      // the promoted action is the primary tier: the signal fill
      expect(screen.getByRole("link", { name: "Built" }).className).toContain("bg-signal");
      promoted.unmount();

      renderWithIntl(
        <EmptyState
          title="Alone"
          reason="r"
          primary={{ label: "Parked", href: "/admin" }}
          secondary={{ label: "Parked too", href: "/supervisor/qr" }}
        />,
      );
      expect(screen.getByRole("heading", { name: "Alone" })).toBeInTheDocument();
      expect(screen.queryAllByRole("link")).toHaveLength(0);
    });
  });

  describe("the deferred list", () => {
    it("guards every entry, with or without a locale prefix, a query, a hash or a sub-path", () => {
      for (const route of DEFERRED_ROUTES) {
        expect(isDeferredRoute(route), route).toBe(true);
        expect(isDeferredRoute(`/ur${route}`), `/ur${route}`).toBe(true);
        expect(isDeferredRoute(`/en${route}?x=1#y`), route).toBe(true);
        expect(isDeferredRoute(`${route}/child`), `${route}/child`).toBe(true);
      }
    });

    it("does not guard a core route, nor a longer name that starts like a deferred one", () => {
      for (const core of ["/", "/worker", "/worker/alerts", "/supervisor", "/replay", "/en/worker/alerts"]) {
        expect(isDeferredRoute(core), core).toBe(false);
      }
      expect(isDeferredRoute("/en/hse-report")).toBe(false);
      expect(isDeferredRoute("/en/administrators")).toBe(false);
    });

    it("guards no route that exists in src/app (so a built view must leave the list)", () => {
      const routes = pageRoutes();
      // Sanity: the scan finds the F1 pages, so an empty result cannot make this test pass.
      expect(routes).toEqual(expect.arrayContaining(["/worker", "/worker/alerts", "/supervisor", "/hse"]));
      for (const route of DEFERRED_ROUTES) {
        if (PLACEHOLDER_PAGES.includes(route)) continue;
        expect(routes, `${route} is a real page now: remove it from DEFERRED_ROUTES`).not.toContain(route);
      }
    });

    it("is not contradicted by any literal href in a file that renders an EmptyState", () => {
      const users = sourceFiles(SRC).filter(
        (file) =>
          !file.endsWith(path.join("states", "EmptyState.tsx")) && readFileSync(file, "utf8").includes("<EmptyState"),
      );
      // The kit page renders EmptyState, so the scan has something to read.
      expect(users.length).toBeGreaterThan(0);
      for (const file of users) {
        const hrefs = [...readFileSync(file, "utf8").matchAll(/href\s*[:=]\s*\{?\s*["'`](\/[^"'`]*)["'`]/g)].map((m) => m[1] ?? "");
        for (const href of hrefs) expect(isDeferredRoute(href), `${path.relative(SRC, file)}: ${href}`).toBe(false);
      }
    });
  });
});
