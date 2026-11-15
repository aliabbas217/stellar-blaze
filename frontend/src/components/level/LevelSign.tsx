import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Pictogram } from "./Pictogram";
import { LevelScale, type LevelKind } from "./LevelScale";
import type { Level } from "./level";

export type { LevelKind };

export interface LevelSignProps {
  /** The level to show; null renders "Site rules" with no marker on the scale (no usable forecast). */
  readonly level: Level | null;
  readonly kind: LevelKind;
  /** hero: the word at 76 px under a four-label scale (worker Today). mini: the word at 22 px, scale without labels. */
  readonly size: "hero" | "mini";
  /**
   * How long the level holds, already worded for the locale ("until 17:00"). A node, so the caller can wrap the clock
   * time in <bdi> (a time inside Arabic-script text must not be reordered): compose it with `t.rich`.
   */
  readonly until?: ReactNode;
  /** What the sign is the level of ("Site level now", "Last known level"), already worded for the locale. */
  readonly kicker: string;
}

// Full class names, never built by interpolation, so Tailwind's scanner finds them.
const MARK: Record<Level, string> = {
  green: "bg-lv-green",
  amber: "bg-lv-amber",
  orange: "bg-lv-orange",
  red: "bg-lv-red",
};

/** The 10 px mark that sits beside a level word. Decorative: the word and the scale carry the level. */
export function LevelMark({ level }: { readonly level: Level }) {
  return <span data-level-mark="" aria-hidden="true" className={`size-2.5 shrink-0 self-center rounded-sign ${MARK[level]}`} />;
}

/*
 * The heights a loading skeleton must reserve. They are written from the SAME two custom properties the sign sets its
 * text with, `--sign-leading-text` and `--sign-leading-word`, which globals.css declares once per language. So the
 * skeleton is as tall as the sign in English, Arabic, Urdu and the Indic languages alike (CLS budget 0.1): nothing here,
 * and nothing in the sign, writes a leading of its own. A line that wraps still grows the sign past its floor; the
 * floor is the one-line height. tests/e2e/kit.spec.ts measures the rendered boxes in en, ar and ur.
 */
const KICKER_LINE = "var(--t-16) * var(--sign-leading-text)";
// The hero's kicker and its "until" share one row (F2 W1, I6), so the row is as tall as the taller of the two: the 18 px "until".
const HEADER_LINE = "var(--t-18) * var(--sign-leading-text)";
const WORD_LINE = {
  // The word's size is a per-language property (globals.css): 76 px, 64 px for Arabic-script words, whose line height is 2.5.
  hero: "var(--sign-word-size) * var(--sign-leading-word)",
  // The mini row also holds the 16 px "until", so its floor is the taller of the two lines.
  mini: "max(var(--t-22) * var(--sign-leading-word), var(--t-16) * var(--sign-leading-text))",
} as const;

/*
 * Arabic-script words are set at line height 2.5 (the marks clip below about 2), which leaves about a line of blank above and
 * below a 64 px word. The hero trims part of it from the layout (a negative block margin on the word row, `--sign-word-trim`:
 * zero in every other language, 0.5 em in ur whose line height is 2.5 and 0.15 em in ar whose line height is 1.8): the line height itself is unchanged and nothing is clipped, the blank just
 * overlaps the gap around the row instead of pushing the lead and the spine down the fold. The ink of the four Urdu level words
 * in the shipped fallback font reaches 53 px above the baseline and 13 px below it at 64 px; the row keeps 1.5 em (96 px).
 */
const WORD_TRIM = "var(--sign-word-trim)";

export const LEVEL_SIGN_HEIGHT = {
  // kicker-and-until row + gap + word row (less the blank trimmed from it) + gap + scale bar + gap + label
  hero: `calc(${HEADER_LINE} + ${KICKER_LINE} + var(--s-3) * 2 + var(--s-2) * 2 + ${WORD_LINE.hero} - ${WORD_TRIM} * 2)`,
  // kicker + gap + word row + gap + scale bar (no labels)
  mini: `calc(${KICKER_LINE} + var(--s-3) * 2 + var(--s-2) + ${WORD_LINE.mini})`,
} as const;

/**
 * The level as a sign: a kicker, the level word, how long it holds, and the four-step scale beneath.
 *
 * Level is never conveyed by color alone (DESIGN.md section 3): the word, the position on the scale and the 10 px mark
 * are all present. There is no filled plate, no shadow and no hatch. A stale or fallback level shows a clock beside
 * the kicker, a dimmer word and a dashed marker, so it is never mistaken for a live one.
 */
export function LevelSign({ level, kind, size, until, kicker }: LevelSignProps) {
  const t = useTranslations("levels");
  const live = kind === "live";
  const word = level === null ? t("siteRules") : t(`name.${level}`);
  // "Site rules" is a phrase, not a level: it is set smaller than a hero level word (journeys, fallback state).
  const wordSize = size === "mini" ? "text-xl" : level === null ? "text-4xl" : "text-(length:--sign-word-size)";
  const kickerLine = (
    <p className={`flex items-center gap-2 text-base leading-(--sign-leading-text) ${live ? "text-ink-3" : "text-ink-2"}`}>
      {live ? null : <Pictogram name="clock" className="size-4" />}
      <span>{kicker}</span>
    </p>
  );

  return (
    <div data-level-sign="" data-kind={kind} data-size={size} className="flex w-full flex-col gap-3">
      {size === "hero" ? (
        // The kicker and how long it holds on ONE row above the word: the sign is a line shorter, which is what lets the lead
        // and the spine rise into the first fold in the longest line heights (Urdu, F2 W1 I6). It wraps, never clips.
        <div className="flex flex-wrap items-baseline justify-between gap-x-3" style={{ minHeight: `calc(${HEADER_LINE})` }}>
          {kickerLine}
          {until === undefined ? null : <p className="text-lg leading-(--sign-leading-text) text-ink-2">{until}</p>}
        </div>
      ) : (
        kickerLine
      )}
      <div
        className={`flex flex-wrap gap-3 ${size === "mini" ? "items-center" : "items-baseline"}`}
        style={{ minHeight: `calc(${WORD_LINE[size]})`, ...(size === "hero" ? { marginBlock: `calc(${WORD_TRIM} * -1)` } : {}) }}
      >
        {level === null ? null : <LevelMark level={level} />}
        <h2
          data-level-word=""
          className={`font-display font-medium tracking-display leading-(--sign-leading-word) ${wordSize} ${live ? "text-ink" : "text-ink-2"}`}
        >
          {word}
        </h2>
        {size === "mini" && until !== undefined ? (
          <span className="text-base leading-(--sign-leading-text) text-ink-2">{until}</span>
        ) : null}
      </div>
      <LevelScale level={level} kind={kind} labels={size === "hero"} />
    </div>
  );
}
