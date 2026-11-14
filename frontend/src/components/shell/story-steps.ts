/*
 * The five steps of the judge story, in reading order: the problem, the scoreboard, one day, the proof, the product.
 * `href` is a route without the locale prefix. `built` says whether the route exists yet: a step whose view is not built
 * is shown as plain text and skipped by Back and Next, so the story never links to a page that is not there (the same rule as
 * the deferred-route guard of the empty states). When a view lands, its step flips to `built: true` in the same change;
 * tests/unit/shell/StoryNav.test.tsx fails if a flag and the route files disagree, in either direction.
 */
export const STORY_STEPS = [
  { id: "problem", href: "/", built: true },
  { id: "scoreboard", href: "/replay", built: true },
  { id: "day", href: "/replay/day", built: false },
  // The proof step opens the sheet of a number every build has: the season count from the recorded forecast.
  { id: "proof", href: "/replay/proof/forecast.hours_over_limit", built: true },
  { id: "product", href: "/worker", built: true },
] as const;

export type StoryStepId = (typeof STORY_STEPS)[number]["id"];
