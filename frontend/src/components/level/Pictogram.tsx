import type { ReactNode } from "react";

/*
 * The Qaylula pictogram set (DESIGN.md section 9): solid silhouettes on a 24 unit grid in currentColor, ISO 7010
 * grammar, no faces, no emoji. At most four to a screen is a convention, not enforced here. They sit beside words and
 * are decorative unless given a `label`.
 *
 * Whether workers read these shapes as intended is untested: they stay labelled "untested" until a comprehension test
 * reaches 85 percent correct with at most 5 percent critical confusion (ANSI criterion; docs/design/v2/research/friction.md
 * section 6). "I feel unwell" is a plain medical cross, never a phone with a cross.
 */

export const PICTOGRAM_NAMES = ["shade", "water", "buddy", "cross", "speaker", "handset", "clock", "sun", "moon"] as const;

export type PictogramName = (typeof PICTOGRAM_NAMES)[number];

const SHAPES: Record<PictogramName, ReactNode> = {
  // a person standing under a canopy on two posts
  shade: (
    <>
      <path fill="currentColor" d="M.75 8.25 12 2.25l11.25 6v1.9H.75z" />
      <path fill="currentColor" d="M2.25 10.5h2v12h-2zM19.75 10.5h2v12h-2z" />
      <circle fill="currentColor" cx="12" cy="12.5" r="2" />
      <path fill="currentColor" d="M9.6 15.4h4.8v4.2h-1.1v2.9h-1.1V19.6h-.4v2.9h-1.1V19.6H9.6z" />
    </>
  ),
  // a water drop with a highlight cut out
  water: (
    <path
      fill="currentColor"
      fillRule="evenodd"
      d="M12 2.25c3.4 4.6 6.75 8.4 6.75 12.5a6.75 6.75 0 0 1-13.5 0C5.25 10.65 8.6 6.85 12 2.25zM8.1 14.6a3.9 3.9 0 0 0 3.2 3.9l.2-1.8a2.2 2.2 0 0 1-1.6-2.1z"
    />
  ),
  // two people side by side
  buddy: (
    <>
      <circle fill="currentColor" cx="7.5" cy="5" r="2.5" />
      <circle fill="currentColor" cx="16.5" cy="5" r="2.5" />
      <path
        fill="currentColor"
        d="M4 9h7v7H9.8v6.5H6.2V16H4zM13 9h7v7h-1.8v6.5h-3.6V16H13z"
      />
    </>
  ),
  // the plain medical cross
  cross: <path fill="currentColor" d="M9 2h6v7h7v6h-7v7H9v-7H2V9h7z" />,
  // a speaker with two sound arcs
  speaker: (
    <>
      <path fill="currentColor" d="M3 9h4l5-4v14l-5-4H3z" />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="square"
        d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12"
      />
    </>
  ),
  // a telephone handset
  handset: (
    <path
      fill="currentColor"
      d="M3.5 5.2C3.5 4.3 4.2 3.5 5.1 3.5h3.1l1.7 4.3-2.1 1.4c1.1 2.2 2.9 4 5.1 5.1l1.4-2.1 4.3 1.7v3.1c0 .9-.8 1.6-1.7 1.6C9.7 20.6 3.5 14.4 3.5 5.2z"
    />
  ),
  // a clock face: ring and two hands
  clock: (
    <>
      <circle fill="none" stroke="currentColor" strokeWidth="2.25" cx="12" cy="12" r="9" />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2.25"
        strokeLinecap="square"
        strokeLinejoin="miter"
        d="M12 6.5v5.9l3.8 2.4"
      />
    </>
  ),
  // the sun: a disc and eight rays
  sun: (
    <>
      <circle fill="currentColor" cx="12" cy="12" r="4.8" />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2.25"
        strokeLinecap="square"
        d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3M4.6 4.6l2.1 2.1M17.3 17.3l2.1 2.1M4.6 19.4l2.1-2.1M17.3 6.7l2.1-2.1"
      />
    </>
  ),
  // the moon: a crescent
  moon: <path fill="currentColor" d="M15.75 2.25a9.75 9.75 0 1 0 6 17.4A9 9 0 0 1 15.75 2.25z" />,
};

export interface PictogramProps {
  readonly name: PictogramName;
  /** Gives the pictogram an accessible name. Without it the pictogram is decorative and hidden from assistive technology. */
  readonly label?: string;
  /** Sizing and color utilities. The default is 24 px (size-6); it inherits the text color. */
  readonly className?: string;
}

export function Pictogram({ name, label, className = "size-6" }: PictogramProps) {
  const labelled = label !== undefined;
  return (
    <svg
      viewBox="0 0 24 24"
      data-pictogram={name}
      className={`shrink-0 ${className}`}
      focusable="false"
      {...(labelled ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      {SHAPES[name]}
    </svg>
  );
}
