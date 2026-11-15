/*
 * The five steps of the judge story, in reading order: the problem, the scoreboard, one day, the proof, the product.
 * `href` is a route without the locale prefix. `built` says whether the route exists yet: a step whose view is not built
 * is shown as plain text and skipped by Back and Next, so the story never links to a page that is not there (the same rule as
 * the deferred-route guard of the empty states). When a view lands, its step flips to `built: true` in the same change;
 * tests/unit/shell/StoryNav.test.tsx fails if a flag and the route files disagree, in either direction.
 */
export type StoryStepId = "problem" | "scoreboard" | "day" | "proof" | "product";

export interface StoryStep {
  readonly id: StoryStepId;
  readonly href: string;
  /** Typed as a boolean (not the literal of the current data): a step flips when its view lands, and consumers must still handle both. */
  readonly built: boolean;
}

export const STORY_STEPS: readonly StoryStep[] = [
  { id: "problem", href: "/", built: true },
  { id: "scoreboard", href: "/replay", built: true },
  { id: "day", href: "/replay/day", built: true },
  // The proof step opens the sheet of a number every build has: the season count from the recorded forecast.
  { id: "proof", href: "/replay/proof/forecast.hours_over_limit", built: true },
  { id: "product", href: "/worker", built: true },
];
