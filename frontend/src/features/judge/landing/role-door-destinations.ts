/*
 * Where each tile of the role door goes. THE one place to change (redesign S2 made it one constant; S7 pointed the crew, safety and review tiles
 * at their entries). Slice S6a will point the worker tile at the worker join flow; until then it opens the phone screen, which has its own
 * first-run entry.
 *
 *   worker  -> /worker           the phone screen; workers never sign in
 *   crew    -> /supervisor/enter the crew lead's role entry (demo only: one tap, no credentials), then the crews screen
 *   safety  -> /hse/enter        the safety officer's role entry, then the safety view
 *   review  -> /tour             the 3-minute tour of the real screens
 *
 * The order is fixed (03 section 2, the prototype front-door.png): site, crew, safety, reviewing. Routes carry no locale prefix.
 */
export type RoleId = "worker" | "crew" | "safety" | "review";

export const ROLE_DOOR_DESTINATIONS = {
  worker: "/worker",
  crew: "/supervisor/enter",
  safety: "/hse/enter",
  review: "/tour",
} as const satisfies Readonly<Record<RoleId, string>>;

export const ROLE_DOOR_ORDER: readonly RoleId[] = ["worker", "crew", "safety", "review"];
