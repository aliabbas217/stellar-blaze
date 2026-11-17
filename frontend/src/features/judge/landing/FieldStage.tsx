import type { ReactNode } from "react";

/*
 * The stage of the hero: the box the field is drawn in. It is `data-hero` (the design gate measures its share of the first
 * fold) and, unless it holds the error message, `aria-hidden`: the canvas is a picture, and every reading it shows is text in
 * the readout. On a wide screen it fills the hero and the copy sits over its start side, under a shade that keeps the heading
 * legible; on a phone it is a box of fixed height under the heading. The shade reaches past the copy column (a column of up to 34rem
 * from the start edge): its stops are the larger of the share of the stage and a length, so on a tablet (900 to 1279 px), where the
 * map sits under the copy, the heading, lede and hook stay over a dark ground (Part L1 I5, measured by tests/e2e/judge-landing-contrast.spec.ts).
 * The shade is drawn after the canvases and BELOW the station names (they are `z-10` inside this stage, which is `isolate`d). From 900 to 1099 px
 * the stage is the first row of the hero (the scrubber and the readout card are the rows under it, never over the map); from 1100 px it
 * fills the hero and the card sits over its end side. The server draws it empty (the poster) and the island fills the same box.
 */
const SHADE_WIDE =
  "min-[900px]:bg-[linear-gradient(90deg,var(--ground)_0%,color-mix(in_oklch,var(--ground)_80%,transparent)_max(34%,32rem),transparent_max(56%,44rem)),linear-gradient(0deg,var(--ground)_0%,transparent_24%)] min-[900px]:rtl:bg-[linear-gradient(270deg,var(--ground)_0%,color-mix(in_oklch,var(--ground)_80%,transparent)_max(34%,32rem),transparent_max(56%,44rem)),linear-gradient(0deg,var(--ground)_0%,transparent_24%)]";
const SHADE_PHONE = "max-[899px]:bg-[linear-gradient(180deg,var(--ground)_0%,transparent_14%,transparent_86%,var(--ground)_100%)]";

export function FieldStage({ children, picture = true, path }: { readonly children?: ReactNode; readonly picture?: boolean; readonly path?: "2d" | "webgl" }) {
  return (
    <div
      data-hero=""
      {...(path === undefined ? {} : { "data-field-path": path })}
      {...(picture ? { "aria-hidden": true } : {})}
      className="relative isolate h-90 overflow-hidden max-[899px]:order-2 min-[900px]:max-[1099px]:col-start-1 min-[900px]:max-[1099px]:row-start-1 min-[900px]:h-auto min-[1100px]:absolute min-[1100px]:inset-0"
    >
      {children}
      <div aria-hidden="true" className={`pointer-events-none absolute inset-0 ${SHADE_PHONE} ${SHADE_WIDE}`} />
    </div>
  );
}
