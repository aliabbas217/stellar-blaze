import type { ReactNode } from "react";

/*
 * The stage of the hero: the box the field is drawn in. It is `data-hero` (the design gate measures its share of the first
 * fold) and, unless it holds the error message, `aria-hidden`: the canvas is a picture, and every reading it shows is text in
 * the readout. On a wide screen it fills the hero and the copy sits over its start side, under a shade that keeps the heading
 * legible; on a phone it is a box of fixed height under the heading. The shade reaches past the copy column (a column of up to 34rem
 * from the start edge): its stops are the larger of the share of the stage and a length, so on a tablet (900 to 1279 px), where the
 * map sits under the copy, the heading, lede and hook stay over a dark ground (Part L1 I5, measured in the report). The server draws it empty (the poster) and the island
 * fills the same box.
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
      className="relative h-90 overflow-hidden max-[899px]:order-2 min-[900px]:absolute min-[900px]:inset-0 min-[900px]:h-auto"
    >
      {children}
      <div aria-hidden="true" className={`pointer-events-none absolute inset-0 ${SHADE_PHONE} ${SHADE_WIDE}`} />
    </div>
  );
}
