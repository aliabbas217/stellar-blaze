/*
 * The two action shapes of the state components, as class lists for a link or a button. Both are at least the 44 px
 * target and use ink, never a level color or the heat ramp: the primary is ink on ground (the desk primary of
 * DESIGN.md components), the secondary is a framed control on the ground. Focus is drawn globally (:focus-visible).
 */
const BASE = "inline-flex min-h-(--target) items-center justify-center rounded-sign px-4 text-base font-medium";

export const ACTION_PRIMARY = `${BASE} bg-ink text-ground hover:bg-ink-2`;
export const ACTION_SECONDARY = `${BASE} border border-edge bg-ground text-ink hover:bg-panel`;
