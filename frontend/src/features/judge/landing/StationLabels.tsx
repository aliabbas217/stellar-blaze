"use client";

import { useTranslations } from "next-intl";
import { useEffect, useImperativeHandle, useLayoutEffect, useRef, type Ref } from "react";
import { refreshAvoidance } from "./label-avoid";
import type { StationCode } from "./field-draw";

/*
 * The station names laid over the map (2D canvas and WebGL scene alike): DOM text at positions the drawing computed, so the names
 * are real text in the page's font and never pixels of the canvas. The container never mirrors (`dir="ltr"`): a map has no direction.
 * A name is lifted above the stage's shade (`z-10`: the shade is for the copy, and a name under it read grey) and has a text halo in
 * the ground colour (stroke painted under the fill), not a filled plate: the field's rule is no filled shapes behind text.
 */

export interface StationLabel {
  readonly code: StationCode;
  readonly x: number;
  readonly y: number;
}

/** `containerRef`: the WebGL scene moves the names itself, frame by frame, through the DOM (no React state per frame). */
export function StationLabels({ labels, containerRef }: { readonly labels: readonly StationLabel[]; readonly containerRef?: Ref<HTMLDivElement> }) {
  const t = useTranslations("judge.landing.field");
  const own = useRef<HTMLDivElement>(null);
  // the WebGL scene moves the names itself, frame by frame, and needs the element
  useImperativeHandle(containerRef, () => own.current as HTMLDivElement, []);
  // A name is never drawn under the readout card or a line of the copy (label-avoid.ts): decided when the names are placed ...
  useLayoutEffect(() => {
    if (own.current !== null) refreshAvoidance(own.current);
  }, [labels]);
  // ... and again when the layout moves under them (a resize, the fonts arriving, the readout card growing: the stage, the hero and the card are observed).
  useEffect(() => {
    const el = own.current;
    if (el === null) return;
    const stage = el.closest("[data-hero]");
    if (!(stage instanceof HTMLElement)) return;
    const again = (): void => {
      refreshAvoidance(el);
    };
    const observer = new ResizeObserver(again);
    observer.observe(stage);
    const hero = stage.closest("[data-landing-hero]");
    if (hero !== null) observer.observe(hero);
    // the readout card is what grows (a longer sentence wraps to another line and the card rises over the east names)
    const card = hero?.querySelector("[data-field-readout]");
    if (card !== null && card !== undefined) observer.observe(card);
    // (jsdom has no font loading API: the type says there always is one)
    const fonts = Reflect.get(document, "fonts") as FontFaceSet | undefined;
    if (fonts !== undefined) void fonts.ready.then(again);
    return () => {
      observer.disconnect();
    };
  }, []);
  return (
    <div ref={own} className="pointer-events-none absolute inset-0 z-10" dir="ltr">
      {labels.map((label) => (
        <span
          key={label.code}
          data-station-label={label.code}
          data-contrast="label"
          data-contrast-name="station"
          style={{ left: label.x, top: label.y }}
          className="absolute -translate-x-1/2 -translate-y-full pb-1.5 text-sm whitespace-nowrap text-ink"
        >
          <b className="font-medium [paint-order:stroke_fill] [-webkit-text-stroke:0.22em_var(--ground)]">{t(`stations.${label.code}`)}</b>
        </span>
      ))}
    </div>
  );
}
