"use client";

import { useTranslations } from "next-intl";
import type { StationCode } from "./field-draw";

/*
 * The station names laid over the map (2D canvas and WebGL scene alike): DOM text at positions the drawing computed, so the names
 * are real text in the page's font and never pixels of the canvas. The container never mirrors (`dir="ltr"`): a map has no direction.
 */

export interface StationLabel {
  readonly code: StationCode;
  readonly x: number;
  readonly y: number;
}

export function StationLabels({ labels }: { readonly labels: readonly StationLabel[] }) {
  const t = useTranslations("judge.landing.field");
  return (
    <div className="pointer-events-none absolute inset-0" dir="ltr">
      {labels.map((label) => (
        <span
          key={label.code}
          style={{ left: label.x, top: label.y }}
          className="absolute -translate-x-1/2 -translate-y-full pb-1.5 text-sm whitespace-nowrap text-ink"
        >
          <b className="bg-ground px-1.5 py-0.5 font-medium">{t(`stations.${label.code}`)}</b>
        </span>
      ))}
    </div>
  );
}
