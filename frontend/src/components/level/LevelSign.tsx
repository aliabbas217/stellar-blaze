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
const UNTIL_LINE = "var(--t-22) * var(--sign-leading-text)";
const WORD_LINE = {
  hero: "var(--t-76) * var(--sign-leading-word)",
  // The mini row also holds the 16 px "until", so its floor is the taller of the two lines.
  mini: "max(var(--t-22) * var(--sign-leading-word), var(--t-16) * var(--sign-leading-text))",
} as const;

export const LEVEL_SIGN_HEIGHT = {
  // kicker + gap + word row + gap + until row + gap + scale bar + gap + label
  hero: `calc(${KICKER_LINE} * 2 + var(--s-3) * 3 + var(--s-2) * 2 + ${WORD_LINE.hero} + ${UNTIL_LINE})`,
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
  const wordSize = size === "mini" ? "text-xl" : level === null ? "text-4xl" : "text-6xl";

  return (
    <div data-level-sign="" data-kind={kind} data-size={size} className="flex w-full flex-col gap-3">
      <p className={`flex items-center gap-2 text-base leading-(--sign-leading-text) ${live ? "text-ink-3" : "text-ink-2"}`}>
        {live ? null : <Pictogram name="clock" className="size-4" />}
        <span>{kicker}</span>
      </p>
      <div
        className={`flex flex-wrap gap-3 ${size === "mini" ? "items-center" : "items-baseline"}`}
        style={{ minHeight: `calc(${WORD_LINE[size]})` }}
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
      {size === "hero" ? (
        <p className="text-xl leading-(--sign-leading-text) text-ink-2" style={{ minHeight: `calc(${UNTIL_LINE})` }}>
          {until}
        </p>
      ) : null}
      <LevelScale level={level} kind={kind} labels={size === "hero"} />
    </div>
  );
}
