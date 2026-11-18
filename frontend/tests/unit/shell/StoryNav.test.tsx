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
    const { container } = renderWithIntl(<StoryNav current="evidence" />);
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

  it("keeps the five steps in the story order (A2): the problem, the product, the evidence, one day, the boundary, and no proof step", () => {
    expect(STORY_STEPS.map((s) => s.id)).toEqual(["problem", "product", "evidence", "day", "boundary"]);
  });

  it("sends the product step to the worker screen until the tour exists, and only that step is an app step", () => {
    expect(STORY_STEPS.find((s) => s.id === "product")).toMatchObject({ href: "/worker", frame: "app" });
    expect(STORY_STEPS.filter((s) => s.frame === "app").map((s) => s.id)).toEqual(["product"]);
  });

  it("every judge step is a page that renders the story footer (the footer names its own step)", () => {
    // The boundary is the last step and has a footer (Back, no Next): the old story ended on a worker screen with no way on.
    const judge = STORY_STEPS.filter((s) => s.frame === "judge").map((s) => s.id);
    expect(judge).toEqual(["problem", "evidence", "day", "boundary"]);
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
    renderWithIntl(<StoryNav current="evidence" />);
    const nav = screen.getByRole("navigation", { name: "Story" });
    expect(within(nav).getByText("Step 3 of 5: The evidence")).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "The evidence" })).toHaveAttribute("aria-current", "step");
    expect(within(nav).getByRole("link", { name: "The product" })).toHaveAttribute("href", "/worker");
    expect(within(nav).getByRole("link", { name: "The boundary" })).toHaveAttribute("href", "/replay/governance");
    expect(within(nav).queryByRole("link", { name: "Proof" })).toBeNull();
    expect(within(nav).getByRole("link", { name: "The problem" })).toHaveAttribute("href", "/");
    expect(within(nav).getByRole("link", { name: "One day" })).toHaveAttribute("href", "/replay/day");
  });

  it("an unbuilt step is text, not a link, and Back and Next skip it", () => {
    withUnbuilt("day", () => {
      renderWithIntl(<StoryNav current="evidence" />);
      const nav = screen.getByRole("navigation", { name: "Story" });
      expect(within(nav).queryByRole("link", { name: "One day" })).toBeNull();
      expect(within(nav).getByText("One day")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Back: The problem" })).toHaveAttribute("href", "/");
      expect(screen.getByRole("link", { name: "Next: The boundary" })).toHaveAttribute("href", "/replay/governance");
    });
  });

  it("goes back to the previous step and forward to the next one, passing over the worker app (it has no story footer, so Back and Next never send a reader there)", () => {
    renderWithIntl(<StoryNav current="evidence" />);
    expect(screen.getByRole("link", { name: "Back: The problem" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Next: One day" })).toHaveAttribute("href", "/replay/day");
  });

  it("the first step goes on to the evidence, not into the worker app", () => {
    renderWithIntl(<StoryNav current="problem" />);
    expect(screen.getByRole("link", { name: "Next: The evidence" })).toHaveAttribute("href", "/replay");
    expect(screen.queryByRole("link", { name: "Next: The product" })).toBeNull();
  });

  it("the last step, the boundary, has Back to the day and no Next; the first has no Back", () => {
    const { unmount } = renderWithIntl(<StoryNav current="boundary" />);
    expect(screen.queryByRole("link", { name: /^Next:/ })).toBeNull();
    expect(screen.getByRole("link", { name: "Back: One day" })).toHaveAttribute("href", "/replay/day");
    unmount();
    renderWithIntl(<StoryNav current="problem" />);
    expect(screen.queryByRole("link", { name: /^Back:/ })).toBeNull();
  });

  it("has 44 px or larger targets on every link and button (min-h-(--target) or min-h-(--target-field))", () => {
    const { container } = renderWithIntl(<StoryNav current="evidence" />);
    for (const target of container.querySelectorAll("a, button")) expect(target.className, target.textContent).toMatch(/min-h-\(--target(-field)?\)/);
  });

  it("copies the link of the page without its query and says so", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    renderWithIntl(<StoryNav current="evidence" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy link to this step" }));
    await waitFor(() => {
      expect(screen.getByText("Link copied")).toBeInTheDocument();
    });
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}${window.location.pathname}`);
  });

  it("says when the link could not be copied", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: () => Promise.reject(new Error("denied")) } });
    renderWithIntl(<StoryNav current="evidence" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy link to this step" }));
    await waitFor(() => {
      expect(screen.getByText("Could not copy the link")).toBeInTheDocument();
    });
  });
});
