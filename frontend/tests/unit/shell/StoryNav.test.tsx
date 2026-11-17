import { readdirSync } from "node:fs";
import path from "node:path";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { StoryNav } from "@/components/shell/StoryNav";
import { STORY_STEPS, type StoryStep } from "@/components/shell/story-steps";
import { isDeferredRoute } from "@/components/states/deferred-routes";
import { renderWithIntl } from "../../utils/intl";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, className, prefetch, ...rest }: { href: string; children: ReactNode; className?: string; prefetch?: boolean }) => (
    // The router would receive `prefetch`; the DOM gets it as an attribute so a test can read what was passed down.
    <a href={href} className={className} data-prefetch={prefetch === undefined ? "default" : String(prefetch)} {...rest}>
      {children}
    </a>
  ),
}));

const APP = path.resolve(import.meta.dirname, "../../../src/app/[locale]");

/** The URL pattern of every page under src/app/[locale]: route groups "(x)" take no segment, "[x]" matches anything. */
function pagePatterns(dir = APP, prefix = ""): RegExp[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      const segment = entry.name.startsWith("(") ? "" : `/${entry.name.startsWith("[") ? "[^/]+" : entry.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`;
      return pagePatterns(path.join(dir, entry.name), `${prefix}${segment}`);
    }
    return entry.name === "page.tsx" ? [new RegExp(`^${prefix === "" ? "/" : prefix}$`)] : [];
  });
}

describe("StoryNav prefetch", () => {
  it("no link prefetches: a prefetched route's script would count against this page's JS budget", () => {
    const { container } = renderWithIntl(<StoryNav current="proof" />);
    const links = [...container.querySelectorAll("a")];
    expect(links.length).toBeGreaterThan(2);
    for (const link of links) expect(link.getAttribute("data-prefetch")).toBe("false");
  });
});

describe("StoryNav steps", () => {
  const patterns = pagePatterns();

  it("flags a step built exactly when its route exists, so the story never links to a missing page", () => {
    for (const step of STORY_STEPS) {
      const exists = patterns.some((pattern) => pattern.test(step.href));
      expect(step.built, `${step.id} (${step.href})`).toBe(exists);
    }
  });

  it("never links to a deferred view", () => {
    for (const step of STORY_STEPS) expect(isDeferredRoute(step.href), step.href).toBe(false);
  });

  it("keeps the five steps in the story order", () => {
    expect(STORY_STEPS.map((s) => s.id)).toEqual(["problem", "scoreboard", "day", "proof", "product"]);
  });
});

/** Runs `body` with the step `id` flagged unbuilt (the real flag flips when its view lands; the behaviour must hold for either value). */
function withUnbuilt(id: StoryStep["id"], body: () => void): void {
  const steps = STORY_STEPS as StoryStep[];
  const at = steps.findIndex((step) => step.id === id);
  const original = steps[at];
  if (original === undefined) throw new Error(id);
  steps[at] = { ...original, built: false };
  try {
    body();
  } finally {
    steps[at] = original;
  }
}

describe("StoryNav", () => {
  it("marks the current step and links the built ones", () => {
    renderWithIntl(<StoryNav current="scoreboard" />);
    const nav = screen.getByRole("navigation", { name: "Story" });
    expect(within(nav).getByText("Step 2 of 5: Scoreboard")).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Scoreboard" })).toHaveAttribute("aria-current", "step");
    expect(within(nav).getByRole("link", { name: "The problem" })).toHaveAttribute("href", "/");
    expect(within(nav).getByRole("link", { name: "One day" })).toHaveAttribute("href", "/replay/day");
  });

  it("an unbuilt step is text, not a link, and Back and Next skip it", () => {
    withUnbuilt("day", () => {
      renderWithIntl(<StoryNav current="scoreboard" />);
      const nav = screen.getByRole("navigation", { name: "Story" });
      expect(within(nav).queryByRole("link", { name: "One day" })).toBeNull();
      expect(within(nav).getByText("One day")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Back: The problem" })).toHaveAttribute("href", "/");
      expect(screen.getByRole("link", { name: "Next: Proof" })).toHaveAttribute("href", "/replay/proof/forecast.hours_over_limit");
    });
  });

  it("goes back to the previous step and forward to the next one", () => {
    renderWithIntl(<StoryNav current="scoreboard" />);
    expect(screen.getByRole("link", { name: "Back: The problem" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Next: One day" })).toHaveAttribute("href", "/replay/day");
  });

  it("has no Next on the last step and no Back on the first", () => {
    const { unmount } = renderWithIntl(<StoryNav current="product" />);
    expect(screen.queryByRole("link", { name: /^Next:/ })).toBeNull();
    expect(screen.getByRole("link", { name: "Back: Proof" })).toBeInTheDocument();
    unmount();
    renderWithIntl(<StoryNav current="problem" />);
    expect(screen.queryByRole("link", { name: /^Back:/ })).toBeNull();
  });

  it("has 44 px or larger targets on every link and button (min-h-(--target) or min-h-(--target-field))", () => {
    const { container } = renderWithIntl(<StoryNav current="scoreboard" />);
    for (const target of container.querySelectorAll("a, button")) expect(target.className, target.textContent).toMatch(/min-h-\(--target(-field)?\)/);
  });

  it("copies the link of the page without its query and says so", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    renderWithIntl(<StoryNav current="scoreboard" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy link to this step" }));
    await waitFor(() => {
      expect(screen.getByText("Link copied")).toBeInTheDocument();
    });
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}${window.location.pathname}`);
  });

  it("says when the link could not be copied", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: () => Promise.reject(new Error("denied")) } });
    renderWithIntl(<StoryNav current="scoreboard" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy link to this step" }));
    await waitFor(() => {
      expect(screen.getByText("Could not copy the link")).toBeInTheDocument();
    });
  });
});
