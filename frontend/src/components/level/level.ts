/**
 * Heat-risk level vocabulary shared by every screen.
 *
 * The four names are also the suffixes of the design tokens (`bg-lv-amber`, `--lv-red`, ...) and the
 * keys of the push payload `level` field, so they must not be renamed without changing the backend
 * ruleset.
 */
export const LEVELS = ["green", "amber", "orange", "red"] as const;

export type Level = (typeof LEVELS)[number];

export type LevelIndex = 1 | 2 | 3 | 4;

const INDEX: Record<Level, LevelIndex> = {
  green: 1,
  amber: 2,
  orange: 3,
  red: 4,
};

/** Position in ascending severity, 1 (green) to 4 (red). Shown as the level numeral. */
export function levelIndex(level: Level): LevelIndex {
  return INDEX[level];
}

/** The more severe of two levels; the first argument wins a tie. */
export function moreSevere(a: Level, b: Level): Level {
  return levelIndex(b) > levelIndex(a) ? b : a;
}
