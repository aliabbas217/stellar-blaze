import type { ReactNode } from "react";
import type { Level } from "./level";

/*
 * One pictogram per level, drawn on a 24 unit grid with a 2 unit stroke, mitred
 * joins and square caps so they read as cut signage, not as a friendly icon set.
 * They inherit currentColor, so a pictogram on a level fill takes text-on-level-*.
 * They are decorative: the level numeral and its name always sit next to them.
 *
 * Whether workers read these four shapes as intended is untested. Check them with
 * native-speaker workers before a pilot (docs/research/2026-11-11-frontend-platform.md §8.1).
 */
const PICTOGRAMS: Record<Level, ReactNode> = {
  // green: sun with a check
  green: (
    <>
      <circle cx="12" cy="12" r="6" />
      <path d="M9 12.4 11.2 14.6 15.2 9.8" />
      <path strokeLinecap="butt" d="M12 1V3.5M12 20.5V23M1 12H3.5M20.5 12H23M4.3 4.3 6 6M18 18 19.7 19.7M19.7 4.3 18 6M6 18 4.3 19.7" />
    </>
  ),
  // amber: water drop
  amber: (
    <>
      <path d="M12 2.8 6.5 11.5A6.5 6.5 0 1 0 17.5 11.5Z" />
      <path d="M9 15.2A3.2 3.2 0 0 0 12 18.2" />
    </>
  ),
  // orange: shade canopy on two posts
  orange: (
    <>
      <path d="M2.5 10 6 4.5H18L21.5 10Z" />
      <path d="M6 10V19.5M18 10V19.5M3 19.5H21" />
    </>
  ),
  // red: raised hand
  red: (
    <>
      <path d="M10 21.5 7.5 19V16.5L4.5 13.5 6.3 11.7 7.5 12.9V6.5H10.5V3.5H13.5V5H16.5V8.5H19.5V17.5L16.5 21.5Z" />
      <path d="M10.5 6.5V12M13.5 5V12M16.5 8.5V12" />
    </>
  ),
};

export function LevelPictogram({ level, className }: { level: Level; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {PICTOGRAMS[level]}
    </svg>
  );
}
