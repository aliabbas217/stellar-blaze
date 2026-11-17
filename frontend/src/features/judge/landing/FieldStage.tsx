import type { ReactNode } from "react";

/*
 * The stage of the field: the box the field is drawn in, at its final size (the poster the server draws and the island that replaces it
 * fill the same box, so nothing moves). Since the redesign (S2, D7) the field is not the backdrop of the whole hero: it is a box of its own
 * beside the phone, with its caption under it, so the map is always laid out as the phone layout of field-draw.ts (centred, 92 % of the
 * width): the box is never as wide as the 900 px the wide layout assumes, whatever the viewport. A fade into the ground at the top and the
 * bottom lets the blurred poster and the sharp canvas meet the page. It is `aria-hidden` unless it holds the error message: the canvas is a
 * picture, the caption says what it is, and the slider carries the reading as text. `data-field-stage` is how the station names and the
 * tests find the box; `data-field-path` says which drawing is showing.
 */
export function FieldStage({ children, picture = true, path }: { readonly children?: ReactNode; readonly picture?: boolean; readonly path?: "2d" | "webgl" }) {
  return (
    <div
      data-field-stage=""
      {...(path === undefined ? {} : { "data-field-path": path })}
      {...(picture ? { "aria-hidden": true } : {})}
      className="relative isolate h-72 overflow-hidden rounded-card bg-ground min-[900px]:h-80 min-[1100px]:h-[27rem]"
    >
      {children}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,var(--ground)_0%,transparent_14%,transparent_86%,var(--ground)_100%)]" />
    </div>
  );
}
