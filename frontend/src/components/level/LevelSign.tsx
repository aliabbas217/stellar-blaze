import { useTranslations } from "next-intl";
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
  /** How long the level holds, already worded for the locale ("until 17:00"). */
  readonly until?: string;
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
 * The heights a loading skeleton must reserve, written from the same tokens the sign is built from, so the sign
 * replaces its skeleton without a layout shift (CLS budget 0.1). They are the English heights: Arabic-script text has a
 * taller line (tokens.css --leading-ar, --leading-ur), and the sign is allowed to grow for it, never to shrink.
 * tests/e2e/kit.spec.ts measures the rendered boxes.
 */
const LINE_16 = "var(--t-16) * var(--leading-body)";
// The hero's "until" sits on its own line, reserved whether or not there is one, so the scale never moves.
const UNTIL_ROW = "var(--t-22) * var(--leading-body)";
const WORD_ROW = {
  hero: "var(--t-76) * var(--leading-solid)",
  mini: "var(--t-22) * var(--leading-body)",
} as const;

// The word row is a floor, so a taller line in another script can grow it but a short word never collapses it.
const LEVEL_WORD_ROW = {
  hero: `calc(${WORD_ROW.hero})`,
  mini: `calc(${WORD_ROW.mini})`,
} as const;

export const LEVEL_SIGN_HEIGHT = {
  // kicker + gap + word row + gap + until row + gap + scale bar + gap + label
  hero: `calc(${LINE_16} * 2 + var(--s-3) * 3 + var(--s-2) * 2 + ${WORD_ROW.hero} + ${UNTIL_ROW})`,
  // kicker + gap + word row + gap + scale bar (no labels)
  mini: `calc(${LINE_16} + var(--s-3) * 2 + var(--s-2) + ${WORD_ROW.mini})`,
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
      <p className={`flex items-center gap-2 text-base ${live ? "text-ink-3" : "text-ink-2"}`}>
        {live ? null : <Pictogram name="clock" className="size-4" />}
        <span>{kicker}</span>
      </p>
      <div className="flex flex-wrap items-baseline gap-3" style={{ minHeight: LEVEL_WORD_ROW[size] }}>
        {level === null ? null : <LevelMark level={level} />}
        <h2
          className={`font-display font-medium tracking-display [:lang(en)_&]:leading-solid ${wordSize} ${live ? "text-ink" : "text-ink-2"}`}
        >
          {word}
        </h2>
        {size === "mini" && until !== undefined ? <span className="text-base text-ink-2">{until}</span> : null}
      </div>
      {size === "hero" ? (
        <p className="text-xl text-ink-2" style={{ minHeight: `calc(${UNTIL_ROW})` }}>
          {until}
        </p>
      ) : null}
      <LevelScale level={level} kind={kind} labels={size === "hero"} />
    </div>
  );
}
