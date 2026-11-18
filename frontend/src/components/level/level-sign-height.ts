/*
 * The one-line floors of the level sign, as CSS length expressions, in a module of their own with no imports. The sign needs them to set
 * its rows, and a loading skeleton needs them to reserve the same height (`states/Skeletons.tsx`): when they lived in LevelSign.tsx, a
 * skeleton on any route pulled the whole sign (the pictogram glyph paths, the scale, the mark: about 1.8 KB gzip) into that route's first
 * load only to read a constant, and the safety view was over its 170 KB ceiling because of it (ADR 0088). LevelSign.tsx re-exports
 * LEVEL_SIGN_HEIGHT, so every existing import keeps working.
 */

/*
 * The heights a loading skeleton must reserve. They are written from the SAME two custom properties the sign sets its
 * text with, `--sign-leading-text` and `--sign-leading-word`, which globals.css declares once per language. So the
 * skeleton is as tall as the sign in English, Arabic, Urdu and the Indic languages alike (CLS budget 0.1): nothing here,
 * and nothing in the sign, writes a leading of its own. A line that wraps still grows the sign past its floor; the
 * floor is the one-line height. tests/e2e/kit.spec.ts measures the rendered boxes in en, ar and ur.
 */
const KICKER_LINE = "var(--t-16) * var(--sign-leading-text)";
// The hero's kicker and its "until" share one row (F2 W1, I6), so the row is as tall as the taller of the two: the 18 px "until".
export const HEADER_LINE = "var(--t-18) * var(--sign-leading-text)";
export const WORD_LINE = {
  // The word's size is a custom property (globals.css, 32 px in every language: the action sentence above it is the largest text of the screen).
  hero: "var(--sign-word-size) * var(--sign-leading-word)",
  // The mini row also holds the 16 px "until", so its floor is the taller of the two lines.
  mini: "max(var(--t-22) * var(--sign-leading-word), var(--t-16) * var(--sign-leading-text))",
} as const;

/*
 * Arabic-script words are set at line height 2.5 (the marks clip below about 2), which leaves about a line of blank above and
 * below the 32 px word. The hero trims part of it from the layout (a negative block margin on the word row, `--sign-word-trim`:
 * zero in every other language, 0.75 em in ur whose line height is 2.5 and 0.15 em in ar whose line height is 1.8): the line height itself is unchanged and nothing is clipped, the blank just
 * overlaps the gap around the row instead of pushing the lead and the spine down the fold. Measured on the Urdu face that ships (Noto
 * Nastaliq Urdu, in Chromium, canvas ink against the DOM baseline; F2 W2): the four level words reach 46 px above the baseline and 13
 * px below it at 64 px, and at 0.75 em the nearest ink is 10 px from the row above or below it (0.5 em leaves 26 px; 0.9 em would
 * touch). The row keeps 64 px of layout height.
 */
export const WORD_TRIM = "var(--sign-word-trim)";

export const LEVEL_SIGN_HEIGHT = {
  // kicker-and-until row + gap + word row (less the blank trimmed from it) + gap + scale bar (12 px, the raised segment) + gap + label
  hero: `calc(${HEADER_LINE} + ${KICKER_LINE} + var(--s-3) * 3 + var(--s-2) + ${WORD_LINE.hero} - ${WORD_TRIM} * 2)`,
  // kicker + gap + word row + gap + scale bar (no labels)
  mini: `calc(${KICKER_LINE} + var(--s-3) * 3 + ${WORD_LINE.mini})`,
} as const;
