import { readdirSync } from "node:fs";
import path from "node:path";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { StoryNav } from "@/components/shell/StoryNav";
import { STORY_STEPS } from "@/components/shell/story-steps";
import { isDeferredRoute } from "@/components/states/deferred-routes";
import { renderWithIntl } from "../../utils/intl";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, className, ...rest }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className} {...rest}>
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

describe("StoryNav", () => {
  it("marks the current step and links the built ones; an unbuilt step is text, not a link", () => {
    renderWithIntl(<StoryNav current="scoreboard" />);
    const nav = screen.getByRole("navigation", { name: "Story" });
    expect(within(nav).getByText("Step 2 of 5: Scoreboard")).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Scoreboard" })).toHaveAttribute("aria-current", "step");
    expect(within(nav).getByRole("link", { name: "The problem" })).toHaveAttribute("href", "/");
    expect(within(nav).queryByRole("link", { name: "One day" })).toBeNull();
    expect(within(nav).getByText("One day")).toBeInTheDocument();
  });

  it("goes back to the previous built step and forward to the next built step, skipping the unbuilt one", () => {
    renderWithIntl(<StoryNav current="scoreboard" />);
    expect(screen.getByRole("link", { name: "Back: The problem" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Next: Proof" })).toHaveAttribute("href", "/replay/proof/forecast.hours_over_limit");
  });

  it("has no Next on the last step and no Back on the first", () => {
    const { unmount } = renderWithIntl(<StoryNav current="product" />);
    expect(screen.queryByRole("link", { name: /^Next:/ })).toBeNull();
    expect(screen.getByRole("link", { name: "Back: Proof" })).toBeInTheDocument();
    unmount();
    renderWithIntl(<StoryNav current="problem" />);
    expect(screen.queryByRole("link", { name: /^Back:/ })).toBeNull();
  });

  it("has 48 px targets on every link and button", () => {
    const { container } = renderWithIntl(<StoryNav current="scoreboard" />);
    for (const target of container.querySelectorAll("a, button")) expect(target.className, target.textContent).toContain("min-h-12");
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
