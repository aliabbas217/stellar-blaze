import { useTranslations } from "next-intl";
import { LEVELS, levelIndex, type Level } from "./level";

/**
 * How a level reached the screen. "live" is a current forecast; "stale" is the last known one (the forecast is old or
 * the phone is offline); "fallback" is the site rules standing in because there is no usable forecast. A stale or
 * fallback level is never drawn as live (journeys P6, plan Review Focus 6).
 */
export type LevelKind = "live" | "stale" | "fallback";

export interface LevelScaleProps {
  readonly level: Level | null;
  readonly kind: LevelKind;
  /** Print the four level names under the segments (the hero sign). The mini sign drops them; the accessible name stays. */
  readonly labels?: boolean;
}

// Full class names, never built by interpolation, so Tailwind's scanner finds them. The level colors are marks only:
// the thin segment, never a plate (DESIGN.md section 3).
const FILL: Record<Level, string> = {
  green: "bg-lv-green",
  amber: "bg-lv-amber",
  orange: "bg-lv-orange",
  red: "bg-lv-red",
};

const DASH: Record<Level, string> = {
  green: "border-lv-green",
  amber: "border-lv-amber",
  orange: "border-lv-orange",
  red: "border-lv-red",
};

/**
 * The four-step scale beneath a level word: four segments 6 px tall, the current one raised to 12 px and marked.
 *
 * A live level is a solid marker. A stale or fallback level is a dashed outline of the same size: the marker says
 * "last known", not "now". It is dashed by border style, never by a gradient: DESIGN.md forbids a hatch anywhere.
 * With no level there is no marker at all, and the accessible name says why.
 */
export function LevelScale({ level, kind, labels = true }: LevelScaleProps) {
  const t = useTranslations("levels");
  const label =
    level === null ? t("scale.none") : t(`scale.${kind}`, { index: levelIndex(level), name: t(`name.${level}`) });

  return (
    <div role="img" aria-label={label} className="grid w-full grid-cols-4 gap-1">
      {LEVELS.map((segment) => {
        const current = segment === level;
        const dashed = current && kind !== "live";
        return (
          <div
            key={segment}
            data-segment={segment}
            {...(current ? { "data-current": "", "data-marker": dashed ? "dashed" : "solid" } : {})}
            className="flex flex-col gap-2"
          >
            {/* One fixed-height row, so the raised marker never moves the labels (no layout shift between levels). */}
            <div className="flex h-3 items-center">
              <span
                data-bar=""
                className={
                  current
                    ? dashed
                      ? `h-3 w-full border-2 border-dashed ${DASH[segment]}`
                      : `h-3 w-full ${FILL[segment]}`
                    : "h-1.5 w-full bg-hair"
                }
              />
            </div>
            {labels ? (
              <span className={`text-base leading-(--sign-leading-text) ${current ? "font-medium text-ink" : "text-ink-3"}`}>
                {t(`name.${segment}`)}
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
