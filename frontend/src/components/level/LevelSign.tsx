import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Pictogram } from "./Pictogram";
import { LevelScale, type LevelKind } from "./LevelScale";
import type { Level } from "./level";
import { HEADER_LINE, LEVEL_SIGN_HEIGHT, WORD_LINE, WORD_TRIM } from "./level-sign-height";

export type { LevelKind };

export interface LevelSignProps {
  /** The level to show; null renders "Site rules" with no marker on the scale (no usable forecast). */
  readonly level: Level | null;
  readonly kind: LevelKind;
  /** hero: the word at 32 px under a four-label scale (worker Today, the alert card). mini: the word at 22 px, scale without labels. */
  readonly size: "hero" | "mini";
  /**
   * How long the level holds, already worded for the locale ("until 17:00"). A node, so the caller can wrap the clock
   * time in <bdi> (a time inside Arabic-script text must not be reordered): compose it with `t.rich`.
   */
  readonly until?: ReactNode;
  /** What the sign is the level of ("Site level now", "Last known level"), already worded for the locale. */
  readonly kicker: string;
  /**
   * A small stamp that sits on the kicker line after the kicker (the Replay stamp of a replayed day). It takes the line's own
   * height, so a sign with a stamp is exactly as tall as one without.
   */
  readonly stamp?: ReactNode;
}

// Full class names, never built by interpolation, so Tailwind's scanner finds them.
const MARK: Record<Level, string> = {
  green: "bg-lv-green",
  amber: "bg-lv-amber",
  orange: "bg-lv-orange",
  red: "bg-lv-red",
};

/** The 14 px mark that sits beside a level word. Decorative: the word and the scale carry the level. */
export function LevelMark({ level }: { readonly level: Level }) {
  return <span data-level-mark="" aria-hidden="true" className={`size-3.5 shrink-0 self-center rounded-sign ${MARK[level]}`} />;
}

export { LEVEL_SIGN_HEIGHT };

/**
 * The level as a sign: a kicker, the level word, how long it holds, and the four-step scale beneath.
 *
 * Level is never conveyed by color alone (DESIGN.md section 3): the word, the position on the scale and the 14 px mark
 * are all present. There is no filled plate, no shadow and no hatch. A stale or fallback level shows a clock beside
 * the kicker, a dimmer word and a dashed marker, so it is never mistaken for a live one.
 */
export function LevelSign({ level, kind, size, until, kicker, stamp }: LevelSignProps) {
  const t = useTranslations("levels");
  const live = kind === "live";
  const word = level === null ? t("siteRules") : t(`name.${level}`);
  // "Site rules" is a phrase, not a level: it is set smaller than a hero level word (journeys, fallback state).
  const wordSize = size === "mini" ? "text-xl" : level === null ? "text-4xl" : "text-(length:--sign-word-size)";
  const kickerLine = (
    <p className={`flex flex-wrap items-center gap-x-2 text-base leading-(--sign-leading-text) ${live ? "text-ink-3" : "text-ink-2"}`}>
      {live ? null : <Pictogram name="clock" className="size-4" />}
      <span>{kicker}</span>
      {stamp}
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
          className={`font-display font-semibold tracking-display leading-(--sign-leading-word) ${wordSize} ${live ? "text-ink" : "text-ink-2"}`}
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
