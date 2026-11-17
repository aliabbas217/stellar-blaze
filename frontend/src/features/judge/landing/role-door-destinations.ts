/*
 * Where each tile of the role door goes. THE one place to change: slice S7 (the role entries and the guided tour) repoints these four
 * routes (worker to its first-run entry, crew lead and safety officer to their entries, the reviewer to /tour) and touches nothing else.
 *
 * Until then (redesign S2) each door opens the screen that already exists for that person:
 *   worker  -> /worker      the phone screen; workers never sign in
 *   crew    -> /supervisor  the crews and the plan
 *   safety  -> /hse         the site-wide overview
 *   review  -> /replay      the scoreboard (the evidence), until the tour is built
 *
 * The order is fixed (03 section 2, the prototype front-door.png): site, crew, safety, reviewing. Routes carry no locale prefix.
 */
export type RoleId = "worker" | "crew" | "safety" | "review";

export const ROLE_DOOR_DESTINATIONS = {
  worker: "/worker",
  crew: "/supervisor",
  safety: "/hse",
  review: "/replay",
} as const satisfies Readonly<Record<RoleId, string>>;

export const ROLE_DOOR_ORDER: readonly RoleId[] = ["worker", "crew", "safety", "review"];
