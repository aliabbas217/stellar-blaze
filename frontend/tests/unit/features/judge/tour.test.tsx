import { readdirSync } from "node:fs";
import path from "node:path";
import { screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { createTranslator } from "next-intl";
import { ROLE_DOOR_DESTINATIONS, ROLE_DOOR_ORDER } from "@/features/judge/landing/role-door-destinations";
import { DEMO_CONTROLS_HREF, TOUR_STEP_IDS, TOUR_STEPS } from "@/features/judge/tour-steps";
import { isDeferredRoute } from "@/components/states/deferred-routes";
import en from "../../../../messages/en.json";
import { renderWithIntl } from "../../../utils/intl";

/*
 * The 3-minute tour (redesign S7): seven stops in a fixed order, each linking to a real screen, with one plain sentence each and a "Where from"
 * only where a proof sheet exists. And the role door's four destinations: each is a real page, none is a parked view.
 */

vi.mock("next-intl/server", async () => {
  const { createTranslator: create } = await import("next-intl");
  const messages = (await import("../../../../messages/en.json")).default;
  return {
    getTranslations: (namespace: string) => Promise.resolve(create({ locale: "en", messages, namespace } as never)),
    getLocale: () => Promise.resolve("en"),
  };
});
vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/en/tour",
  Link: ({ href, children, prefetch, ...props }: { href: string; children: ReactNode; prefetch?: boolean; className?: string }) => (
    <a href={`/en${href}`} data-prefetch={String(prefetch)} {...props}>
      {children}
    </a>
  ),
}));

const SRC = path.resolve(import.meta.dirname, "../../../../src");

function pageFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? pageFiles(full) : entry.name === "page.tsx" ? [full] : [];
  });
}

/** The URL pattern of every page under src/app/[locale]: route groups take no segment, `[claim]` stands for any one segment. */
const PAGE_PATTERNS = (() => {
  const root = path.join(SRC, "app", "[locale]");
  return pageFiles(root).map((file) => {
    const segments = path
      .relative(root, path.dirname(file))
      .split(path.sep)
      .filter((segment) => segment !== "" && !/^\(.*\)$/.test(segment))
      .map((segment) => (/^\[.+\]$/.test(segment) ? "[^/]+" : segment.replace(/[.*+?^${}()|\\]/g, "\\$&")));
    return new RegExp(`^/${segments.join("/")}$`);
  });
})();

function isRealPage(href: string): boolean {
  const bare = (href.split(/[?#]/, 1)[0] ?? "").replace(/\/$/, "") || "/";
  return PAGE_PATTERNS.some((pattern) => pattern.test(bare));
}

describe("the route scan itself", () => {
  it("finds the pages it is asked about and rejects one that does not exist (so the checks below cannot pass vacuously)", () => {
    for (const real of ["/", "/worker", "/supervisor", "/hse", "/tour", "/start", "/replay/governance", "/replay/proof/policy.p3.missed_danger_hours"]) {
      expect(isRealPage(real), real).toBe(true);
    }
    for (const missing of ["/nowhere", "/supervisor/roster", "/hse/week"]) expect(isRealPage(missing), missing).toBe(false);
  });
});

describe("the tour", () => {
  it("has seven stops in the order the story is told (One day before Try a plan before the refusal, audit M4), each with title and sentence in the catalogue", () => {
    expect(TOUR_STEPS.map((step) => step.id)).toEqual(["story", "worker", "crew", "day", "try", "boundary", "scoreboard"]);
    expect(TOUR_STEPS.find((step) => step.id === "try")?.href).toBe("/replay/try");
    expect([...TOUR_STEP_IDS]).toEqual(TOUR_STEPS.map((step) => step.id));
    const steps = en.judge.tour.steps as Record<string, { title: string; text: string }>;
    expect(Object.keys(steps).sort()).toEqual([...TOUR_STEP_IDS].sort());
    for (const id of TOUR_STEP_IDS) {
      expect(steps[id]?.title.length, id).toBeGreaterThan(0);
      expect(steps[id]?.text.length, id).toBeGreaterThan(0);
    }
  });

  it("links every stop, its Where from and the demo controls to a page that exists, never a parked one", () => {
    const targets = [...TOUR_STEPS.flatMap((step) => [step.href, ...(step.proof === undefined ? [] : [step.proof])]), DEMO_CONTROLS_HREF];
    expect(targets.length).toBeGreaterThanOrEqual(7);
    for (const href of targets) {
      expect(isRealPage(href), href).toBe(true);
      expect(isDeferredRoute(href), href).toBe(false);
    }
  });

  it("gives a Where from only to the story, whose proof sheet exists, and no stop a made-up one", () => {
    expect(TOUR_STEPS.filter((step) => step.proof !== undefined).map((step) => step.id)).toEqual(["story"]);
    expect(TOUR_STEPS[0]?.proof).toMatch(/^\/replay\/proof\/policy\./);
  });

  it("renders as numbered stops with a link each, the chrome in the page language and the stop sentences in English blocks", async () => {
    const { default: TourPage } = await import("@/app/[locale]/tour/page");
    const { container } = renderWithIntl(await TourPage());

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(en.judge.tour.title);
    const items = [...container.querySelectorAll<HTMLElement>("[data-tour-step]")];
    expect(items.map((item) => item.dataset["tourStep"])).toEqual([...TOUR_STEP_IDS]);
    const list = screen.getByRole("list");
    expect(within(list).getAllByRole("listitem")).toHaveLength(7);
    items.forEach((item, index) => {
      expect(item).toHaveTextContent(String(index + 1));
      const open = within(item).getByRole("link", { name: en.judge.tour.open });
      expect(open).toHaveAttribute("href", `/en${TOUR_STEPS[index]?.href ?? ""}`);
      const words = item.querySelector<HTMLElement>("[lang=en]");
      expect(words).not.toBeNull();
    });
    expect(container.querySelectorAll("[data-where-from]")).toHaveLength(1);
    expect(screen.getByRole("link", { name: en.judge.tour.controlsLink })).toHaveAttribute("href", `/en${DEMO_CONTROLS_HREF}`);
  });

  it("writes none of the unledgered numbers and no digit of its own beyond the step numbers", async () => {
    const { default: TourPage } = await import("@/app/[locale]/tour/page");
    const { container } = renderWithIntl(await TourPage());
    const text = container.textContent;
    for (const banned of ["1,624", "279", "139", "370 of 374"]) expect(text).not.toContain(banned);
    // The only digits are the seven step numbers and the "3" of "3-minute".
    expect(text.replace(/3-minute/g, "").match(/\d/g)?.join("")).toBe("1234567");
  });
});

describe("the role door destinations (one constant)", () => {
  it("send the worker to the phone screen, the crew lead and the officer to their entries and the reviewer to the tour", () => {
    expect(ROLE_DOOR_DESTINATIONS).toEqual({ worker: "/worker", crew: "/supervisor/enter", safety: "/hse/enter", review: "/tour" });
    expect([...ROLE_DOOR_ORDER]).toEqual(["worker", "crew", "safety", "review"]);
  });

  it("are all real pages and none a parked view", () => {
    for (const role of ROLE_DOOR_ORDER) {
      const href = ROLE_DOOR_DESTINATIONS[role];
      expect(isRealPage(href), href).toBe(true);
      expect(isDeferredRoute(href), href).toBe(false);
    }
  });

  it("have the tour tile worded as a 3-minute tour in every language, not the old wording", async () => {
    for (const locale of ["en", "ar", "ur", "hi", "bn", "ne"] as const) {
      const messages = ((await import(`../../../../messages/${locale}.json`)) as { default: typeof en }).default;
      const line = messages.judge.landing.door.review.line;
      expect(line, locale).toContain("3");
      if (locale !== "en") expect(line, locale).not.toBe(en.judge.landing.door.review.line);
    }
    expect(en.judge.landing.door.review.line).toBe("A 3-minute tour, then try anything.");
    expect(createTranslator({ locale: "en", messages: en, namespace: "judge.landing.door" })("review.line")).toBe("A 3-minute tour, then try anything.");
  });
});
