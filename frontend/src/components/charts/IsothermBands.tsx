import { heatColor } from "@/lib/heat/ramp";
import { VIEW_W, VMAX, VMIN, yOf, num } from "./chart-geometry";

/**
 * The hypsometric layer of the season ribbon: one band per degree between `VMIN` and `VMAX`, painted with the night heat
 * ramp and clipped to the silhouette `areaPath`, with a thin contour at every whole degree (the 5 degree ones a little
 * stronger), as a contour map reads. Heat colour on data only: this is the only place the ribbon uses it. The judge
 * surfaces are night only, so the ramp is the night one.
 *
 * `clipId` must be unique on the page (the caller makes it from `useId`).
 */
export function IsothermBands({ areaPath, clipId }: { readonly areaPath: string; readonly clipId: string }) {
  const bands: number[] = [];
  for (let k = VMIN; k < VMAX; k += 1) bands.push(k);
  return (
    <>
      <defs>
        <clipPath id={clipId}>
          <path d={areaPath} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`} data-isotherms="">
        {bands.map((k) => (
          // +0.5 closes the hairline gap that two antialiased neighbours leave.
          <rect key={k} x={0} y={num(yOf(k + 1))} width={VIEW_W} height={num(yOf(k) - yOf(k + 1) + 0.5)} fill={heatColor(k + 0.5, "night")} />
        ))}
        {bands.slice(1).map((k) => (
          <line
            key={k}
            x1={0}
            x2={VIEW_W}
            y1={num(yOf(k))}
            y2={num(yOf(k))}
            stroke="var(--ground-deep)"
            strokeOpacity={k % 5 === 0 ? 0.7 : 0.35}
            strokeWidth={k % 5 === 0 ? 1 : 0.75}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </g>
    </>
  );
}
