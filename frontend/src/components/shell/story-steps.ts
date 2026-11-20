/*
 * The six steps of the judge story, in reading order (redesign 2026-11, A2; audit M4 added the validator): the problem, the product, the
 * evidence, one day, try a plan, the boundary. Try a plan is the interactive step: the reader writes a roster and the independent
 * checker answers, between watching one day and meeting the refusal. The evidence is the payoff, so it comes after a person has met the product (it used to come first and the product last).
 * There is no "proof" step: the proof sheet is reached from any number's "Where from" chip, never from the story's own path.
 * `href` is a route without the locale prefix. `built` says whether the route exists yet: a step whose view is not built
 * is shown as plain text and skipped by Back and Next, so the story never links to a page that is not there (the same rule as
 * the deferred-route guard of the empty states). When a view lands, its step flips to `built: true` in the same change;
 * tests/unit/shell/StoryNav.test.tsx fails if a flag and the route files disagree, in either direction.
 *
 * The product step opens the worker screen until the guided tour exists (slice S7: change that one href, and nothing else here).
 * The last step, the boundary, is the end of the path and carries Back. The product step is a worker screen, which is not a judge page and
 * carries no story footer: it is an `app` step, shown in the step list and linked from the landing, but Back and Next pass over it, so a
 * reader following the path is never sent to a page with no way on (the dead end the redesign audit found: step 5 was the worker app).
 * When the tour exists it is a judge page: flip its `frame` to "judge" in the same change.
 */
export type StoryStepId = "problem" | "product" | "evidence" | "day" | "try" | "boundary";

export interface StoryStep {
  readonly id: StoryStepId;
  readonly href: string;
  /** judge: a page with the story footer (on the path). app: a product screen without it (Back and Next pass over it). */
  readonly frame: "judge" | "app";
  /** Typed as a boolean (not the literal of the current data): a step flips when its view lands, and consumers must still handle both. */
  readonly built: boolean;
}

export const STORY_STEPS: readonly StoryStep[] = [
  { id: "problem", href: "/", frame: "judge", built: true },
  { id: "product", href: "/worker", frame: "app", built: true },
  { id: "evidence", href: "/replay", frame: "judge", built: true },
  { id: "day", href: "/replay/day", frame: "judge", built: true },
  { id: "try", href: "/replay/try", frame: "judge", built: true },
  { id: "boundary", href: "/replay/governance", frame: "judge", built: true },
];
