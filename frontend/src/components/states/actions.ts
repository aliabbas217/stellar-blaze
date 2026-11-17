/*
 * The control tiers of DESIGN.md section 5.1, as class lists for a link or a button (redesign S4). What you read is cut, what you
 * press is rounded, and the four tiers are told apart by fill, never by size alone:
 *
 *   ACTION_PRIMARY    the one next step on a screen: the signal fill, 52 px (ACTION_PRIMARY_DENSE: 44 px, for dense desk views).
 *   ACTION_SECONDARY  a real alternative: the tonal fill with a 1.5 px edge ring (a boundary, never a hairline box), same sizes.
 *   ACTION_QUIET      a text action ("Skip"): no fill, a 44 px hit area, a 7 % wash on hover.
 *   ACTION_STOP       the emergency action only (Stop work, "I feel unwell"): 56 px, full width, the ONLY solid ink slab on a screen.
 *
 * Every tier has a real default, hover, pressed, focus, busy and disabled state in both themes (DESIGN.md 5.1):
 *   - hover and pressed mix --ink (the Stop slab: --ground) into the fill by the --mix-* tokens; scripts/contrast.mjs measures every mix.
 *     Hover applies only where a pointer hovers (Tailwind wraps it in @media (hover: hover)); pressed moves 1 px down and scales to 0.985
 *     in --dur-press. No colour transition: transform only (DESIGN.md, Motion).
 *   - focus is drawn globally (:focus-visible: 3 px --focus ring, 2 px offset).
 *   - busy is `aria-busy="true"`: the label stays, a 1 em ring spinner follows it, the control drops to 85 % opacity and is NOT disabled
 *     (a disabled control on a first-run screen is a dead end). Do not also render <Spinner> in a primary or a secondary: the ring is theirs.
 *   - disabled (`disabled` or `aria-disabled`) is 50 % opacity and `not-allowed`.
 * Heights are `min-height`, never `height`: Nastaliq at line height 2.5 grows the control instead of clipping. A caller adds layout
 * (`w-full`, `gap-2`, `justify-self-start`) and never a size, a radius or a colour: a second `min-h-*` would race this one in the stylesheet.
 */
const BASE =
  "inline-flex items-center justify-center rounded-ctl font-semibold no-underline select-none transition-transform duration-(--dur-press) active:translate-y-px active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50";

/** The busy state of primary and secondary: label kept, a ring spinner after it, 85 % opacity. */
const BUSY =
  "aria-busy:opacity-85 aria-busy:after:size-[1em] aria-busy:after:flex-none aria-busy:after:animate-spin aria-busy:after:rounded-full aria-busy:after:border-[2.5px] aria-busy:after:border-current aria-busy:after:border-e-transparent aria-busy:after:content-['']";

/** Primary and secondary: 18 px text weight 600, 20 px side padding; the height is the only difference between the two sizes. */
const FIELD = "min-h-(--target-field) gap-2.5 px-5 text-lg";
const DENSE = "min-h-(--target) gap-2.5 px-5 text-lg";

/** The looks (fill, text, hover, pressed) without size or shape: the shadcn Button (components/ui/button.tsx) takes the same three. */
export const LOOK_PRIMARY =
  "bg-signal text-on-signal hover:bg-[color-mix(in_oklch,var(--signal),var(--ink)_var(--mix-primary-hover))] active:bg-[color-mix(in_oklch,var(--signal),var(--ink)_var(--mix-primary-press))]";
export const LOOK_SECONDARY =
  "bg-raised text-ink inset-ring-[1.5px] inset-ring-edge hover:bg-[color-mix(in_oklch,var(--raised),var(--ink)_var(--mix-secondary-hover))] active:bg-[color-mix(in_oklch,var(--raised),var(--ink)_var(--mix-secondary-press))]";

export const ACTION_PRIMARY = `${BASE} ${FIELD} ${LOOK_PRIMARY} ${BUSY}`;
export const ACTION_SECONDARY = `${BASE} ${FIELD} ${LOOK_SECONDARY} ${BUSY}`;
/** The 44 px primary of dense desk views (a table row, a chip-sized action). One per screen, like the 52 px one. */
export const ACTION_PRIMARY_DENSE = `${BASE} ${DENSE} ${LOOK_PRIMARY} ${BUSY}`;
/** The 44 px secondary of dense desk views and of a row of notices. */
export const ACTION_SECONDARY_DENSE = `${BASE} ${DENSE} ${LOOK_SECONDARY} ${BUSY}`;

export const LOOK_QUIET = "text-ink-2 hover:bg-[color-mix(in_oklab,var(--ink)_var(--mix-quiet-hover),transparent)] hover:text-ink";
export const ACTION_QUIET = `${BASE} min-h-(--target) gap-2 px-3 text-lg ${LOOK_QUIET}`;

/** Stop work and "I feel unwell". Always carries a glyph; never `disabled`; the page decides where it is fixed. */
export const ACTION_STOP = `${BASE} min-h-(--target-stop) w-full gap-3 px-5 text-20 bg-ink text-ground hover:bg-[color-mix(in_oklch,var(--ink),var(--ground)_var(--mix-stop-hover))] active:bg-[color-mix(in_oklch,var(--ink),var(--ground)_var(--mix-stop-press))]`;

/*
 * Selection controls (DESIGN.md 5.1). A chip is a 44 px pill; the selected one (`aria-pressed="true"` for a toggle,
 * `aria-current="true"` for a link to the current language) is a filled ink pill with a check mark and weight 600, so selection never
 * relies on colour. A chip carries no padding or font size: the caller sets `px-*` and `text-*` (a header chip is 14 px, a language chip 16 px).
 * The check is a rotated two-sided border on ::before, physical (a check does not mirror in right-to-left).
 * The tab bar is a segmented pill: SEGMENTS is the track, SEGMENT one tab in it; the current one (`aria-current="page"`) takes the
 * raised fill and the 1.5 px edge ring. The class lists are written out in full: Tailwind finds a class by its literal text.
 */
export const CHIP =
  "inline-flex min-h-(--target) flex-none items-center justify-center gap-1.5 rounded-pill bg-panel font-medium text-ink-2 no-underline select-none inset-ring-[1.5px] inset-ring-hair transition-transform duration-(--dur-press) active:scale-[0.985] aria-pressed:bg-ink aria-pressed:font-semibold aria-pressed:text-ground aria-pressed:inset-ring-0 aria-pressed:before:h-[0.35em] aria-pressed:before:w-[0.6em] aria-pressed:before:-translate-y-px aria-pressed:before:-rotate-45 aria-pressed:before:border-b-[2.5px] aria-pressed:before:border-l-[2.5px] aria-pressed:before:border-current aria-pressed:before:content-[''] aria-[current=true]:bg-ink aria-[current=true]:font-semibold aria-[current=true]:text-ground aria-[current=true]:inset-ring-0 aria-[current=true]:before:h-[0.35em] aria-[current=true]:before:w-[0.6em] aria-[current=true]:before:-translate-y-px aria-[current=true]:before:-rotate-45 aria-[current=true]:before:border-b-[2.5px] aria-[current=true]:before:border-l-[2.5px] aria-[current=true]:before:border-current aria-[current=true]:before:content-['']";

export const SEGMENTS = "flex gap-1 rounded-pill bg-panel p-1";
export const SEGMENT =
  "flex min-h-(--target) flex-1 items-center justify-center rounded-pill px-3 text-base font-medium text-ink-3 no-underline aria-[current=page]:bg-raised aria-[current=page]:font-semibold aria-[current=page]:text-ink aria-[current=page]:inset-ring-[1.5px] aria-[current=page]:inset-ring-edge";

/**
 * A link in a row of page tabs (the desk header, the story steps): a pill, no track, the current one raised with the edge ring like
 * SEGMENT. Text size and weight come from the caller's row (a header is 14 px, a story step 16 px).
 */
export const NAV_TAB =
  "inline-flex min-h-(--target) items-center rounded-pill px-3 text-ink-2 no-underline hover:text-ink aria-[current=page]:bg-raised aria-[current=page]:font-semibold aria-[current=page]:text-ink aria-[current=page]:inset-ring-[1.5px] aria-[current=page]:inset-ring-edge aria-[current=step]:bg-raised aria-[current=step]:font-semibold aria-[current=step]:text-ink aria-[current=step]:inset-ring-[1.5px] aria-[current=step]:inset-ring-edge";
