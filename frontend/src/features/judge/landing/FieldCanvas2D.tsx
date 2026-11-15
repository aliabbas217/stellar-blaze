"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { boxOf, type FieldGrid, type Polyline } from "./field-data";
import { drawField, geometry, labelCodes, makeScratch, project, STATIONS, type Geometry, type Scratch } from "./field-draw";
import { StationLabels, type StationLabel } from "./StationLabels";

/*
 * The 2D field: a canvas drawn from the recorded forecast grid, with the station names laid over it as text. It is the poster
 * once the data is in and the fallback of the WebGL scene, so it keeps working alone. The canvas is decorative
 * (`aria-hidden` on the stage): every reading it shows is also DOM text in the readout.
 *
 * The parent moves the day through the handle (`draw(hour)`), not through props: a playing day would otherwise re-render this
 * tree sixty times a second. A resize redraws the last hour.
 */

export interface FieldCanvasHandle {
  /** Draws the day at `hour`; `playing` is true for the frames of a running day (the WebGL scene meters them), false for a seek. */
  draw: (hour: number, playing?: boolean) => void;
}

export interface FieldCanvasProps {
  readonly grid: FieldGrid;
  readonly coast: readonly Polyline[];
  readonly initialHour: number;
  readonly rtl: boolean;
  readonly handleRef: Ref<FieldCanvasHandle>;
}

export function FieldCanvas2D({ grid, coast, initialHour, rtl, handleRef }: FieldCanvasProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const hour = useRef(initialHour);
  const geo = useRef<Geometry | null>(null);
  const scratch = useRef<Scratch | null>(null);
  const strokes = useRef({ isotherm: "", coast: "" });
  const [labels, setLabels] = useState<readonly StationLabel[]>([]);

  const paint = useCallback(() => {
    const el = canvas.current;
    const g = geo.current;
    if (el === null || g === null) return;
    const ctx = el.getContext("2d");
    if (ctx === null) return;
    scratch.current ??= makeScratch(grid);
    const dpr = Math.min(window.devicePixelRatio, 2);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawField(ctx, g, grid, coast, hour.current, scratch.current, strokes.current);
  }, [grid, coast]);

  useImperativeHandle(
    handleRef,
    () => ({
      draw: (value: number) => {
        hour.current = value;
        paint();
      },
    }),
    [paint],
  );

  useEffect(() => {
    const el = canvas.current;
    if (el === null) return;
    const layout = (): void => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w === 0 || h === 0) return;
      const dpr = Math.min(window.devicePixelRatio, 2);
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
      const style = getComputedStyle(el);
      // the strokes come from the theme's own colours: ground for the isotherms (darker than the field), ink for the coast
      const ground = style.getPropertyValue("--ground").trim();
      const ink = style.getPropertyValue("--ink").trim();
      strokes.current = { isotherm: `color-mix(in oklch, ${ground} 45%, transparent)`, coast: `color-mix(in oklch, ${ink} 75%, transparent)` };
      geo.current = geometry(w, h, boxOf(grid), rtl);
      const g = geo.current;
      const codes = labelCodes(w);
      setLabels(
        codes.map((code) => {
          const [lat, lon] = STATIONS[code];
          const [x, y] = project(g, lon, lat);
          return { code, x, y };
        }),
      );
      paint();
    };
    layout();
    const observer = new ResizeObserver(layout);
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [grid, rtl, paint]);

  return (
    <>
      <canvas ref={canvas} data-field-canvas="2d" className="absolute inset-0 size-full" />
      <StationLabels labels={labels} />
    </>
  );
}
