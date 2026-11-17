import type { BanState } from "@/components/spine/ban-state";
import { num, topPct, VIEW_H, VIEW_W, yOf } from "./chart-geometry";

/*
 * One day: local hours on x, WBGT on y. Three series, and each is drawn ONLY when it exists (a missing series is never a
 * flat line or an empty legend entry, journeys D2): the raw forecast (dashed grey), our corrected forecast (the 5th to
 * 95th percentile band and the median, in the one UI colour) and the station truth (solid, ink). The heavy-work limit is
 * a dashed line labelled once. The midday break is drawn below the ground as the recessed slot when it is in force, and
 * as a dashed, labelled outline when it is not (a desk axis; the replay day is inside the season).
 *
 * Same construction as the season ribbon (chart-geometry.ts): SVG marks in a stretched viewBox, DOM text and markers in
 * percentages, strings handed in by the caller already worded. All series are indexed by local hour (0 to 23); a null
 * is a missing hour and leaves a gap.
 */

export interface DayQuantiles {
  readonly p05: number | null;
  readonly p50: number | null;
  readonly p95: number | null;
}

export interface DayChartLabels {
  readonly ariaLabel: string;
  readonly limit: string;
  /** In-force slot: "Midday break". */
  readonly slot: string;
  /** Not in force: "Midday break by law: not in force until 15 Jun". */
  readonly outline: string;
  readonly legend: { readonly raw: string; readonly ours: string; readonly truth: string };
  /** Note on the raw forecast's highest hour, or null to draw none. */
  readonly peak: string | null;
}

export interface DayChartProps {
  readonly raw: readonly (number | null)[];
  readonly ours?: readonly (DayQuantiles | null)[];
  readonly truth?: readonly (number | null)[];
  readonly ban: BanState;
  /** First and last local hour on the axis. */
  readonly from: number;
  readonly to: number;
  readonly limitC: number;
  readonly labels: DayChartLabels;
}

const Y_TICKS = [28, 32, 36, 40] as const;

function xOfHour(hour: number, from: number, to: number): number {
  return ((hour - from) / (to - from)) * VIEW_W;
}

function pctOfHour(hour: number, from: number, to: number): number {
  return (xOfHour(hour, from, to) / VIEW_W) * 100;
}

function finite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Consecutive hours that have a value, as separate runs: a missing hour breaks the line. */
function runs<T>(hours: readonly number[], at: (hour: number) => T | null): { hour: number; value: T }[][] {
  const out: { hour: number; value: T }[][] = [];
  let current: { hour: number; value: T }[] = [];
  for (const hour of hours) {
    const value = at(hour);
    if (value === null) {
      if (current.length > 0) out.push(current);
      current = [];
    } else {
      current.push({ hour, value });
    }
  }
  if (current.length > 0) out.push(current);
  return out;
}

const hourLabel = (hour: number): string => `${String(hour).padStart(2, "0")}:00`;

export function DayChart({ raw, ours, truth, ban, from, to, limitC, labels }: DayChartProps) {
  const hours = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const rawAt = (h: number): number | null => (finite(raw[h]) ? (raw[h] ?? null) : null);
  const truthAt = (h: number): number | null => (truth !== undefined && finite(truth[h]) ? (truth[h] ?? null) : null);
  const oursAt = (h: number): { p05: number; p50: number; p95: number } | null => {
    const q = ours?.[h];
    return q !== null && q !== undefined && finite(q.p05) && finite(q.p50) && finite(q.p95) ? { p05: q.p05, p50: q.p50, p95: q.p95 } : null;
  };

  const rawRuns = runs(hours, rawAt);
  const truthRuns = runs(hours, truthAt);
  const oursRuns = runs(hours, oursAt);
  const hasRaw = rawRuns.length > 0;
  const hasTruth = truthRuns.length > 0;
  const hasOurs = oursRuns.length > 0;

  const point = (hour: number, value: number): string => `${num(xOfHour(hour, from, to))},${num(yOf(value))}`;

  const rawPeak = hours.reduce<number | null>((best, h) => (rawAt(h) !== null && (best === null || (rawAt(h) ?? 0) > (rawAt(best) ?? 0)) ? h : best), null);
  const flip = rawPeak !== null && pctOfHour(rawPeak, from, to) > 55;

  const slot = ban.kind === "in-force" ? ban : null;
  const outline = ban.kind === "not-in-force" ? ban.outline : null;
  const box = slot ?? outline;

  return (
    <figure className="m-0 flex flex-col gap-3" data-day-chart="">
      <div role="img" aria-label={labels.ariaLabel} dir="ltr" className="relative h-80 w-full text-ink sm:h-96">
        <div aria-hidden className="absolute bottom-16 start-0 top-10 w-9 text-xs text-ink-3">
          {Y_TICKS.map((v) => (
            <span key={v} className="absolute end-0 -translate-y-1/2 tabular-nums" style={{ top: `${num(topPct(v))}%` }}>
              {v}
            </span>
          ))}
        </div>

        <div className="absolute bottom-16 start-10 end-3 top-10">
          <svg aria-hidden viewBox={`0 0 ${String(VIEW_W)} ${String(VIEW_H)}`} preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
            {Y_TICKS.map((v) => (
              <line key={v} x1={0} x2={VIEW_W} y1={num(yOf(v))} y2={num(yOf(v))} stroke="var(--hair)" vectorEffect="non-scaling-stroke" />
            ))}
            {box === null
              ? null
              : [box.fromHour, box.toHour].map((h) => (
                  <line
                    key={h}
                    x1={num(xOfHour(h, from, to))}
                    x2={num(xOfHour(h, from, to))}
                    y1={0}
                    y2={VIEW_H}
                    stroke="var(--edge)"
                    strokeDasharray="1 4"
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
            <line
              x1={0}
              x2={VIEW_W}
              y1={num(yOf(limitC))}
              y2={num(yOf(limitC))}
              stroke="var(--ink-2)"
              strokeDasharray="6 5"
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
            />
            <line x1={0} x2={VIEW_W} y1={VIEW_H} y2={VIEW_H} stroke="var(--edge)" vectorEffect="non-scaling-stroke" />

            {hasOurs ? (
              <g data-series="ours">
                {oursRuns.map((run) => (
                  <g key={run[0]?.hour}>
                    <polygon
                      points={[...run.map(({ hour, value }) => point(hour, value.p95)), ...[...run].reverse().map(({ hour, value }) => point(hour, value.p05))].join(" ")}
                      fill="var(--viz-ours)"
                      fillOpacity={0.22}
                    />
                    <polyline
                      points={run.map(({ hour, value }) => point(hour, value.p50)).join(" ")}
                      fill="none"
                      stroke="var(--viz-ours)"
                      strokeWidth={2.5}
                      vectorEffect="non-scaling-stroke"
                    />
                  </g>
                ))}
              </g>
            ) : null}
            {hasRaw ? (
              <g data-series="raw">
                {rawRuns.map((run) => (
                  <polyline
                    key={run[0]?.hour}
                    points={run.map(({ hour, value }) => point(hour, value)).join(" ")}
                    fill="none"
                    stroke="var(--viz-raw)"
                    strokeWidth={2}
                    strokeDasharray="7 5"
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
              </g>
            ) : null}
            {hasTruth ? (
              <g data-series="truth">
                {truthRuns.map((run) => (
                  <polyline
                    key={run[0]?.hour}
                    points={run.map(({ hour, value }) => point(hour, value)).join(" ")}
                    fill="none"
                    stroke="var(--viz-truth)"
                    strokeWidth={2.5}
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
              </g>
            ) : null}
          </svg>

          <span className="absolute start-1 pt-1 text-sm text-ink" style={{ top: `${num(topPct(limitC))}%` }}>
            {labels.limit}
          </span>

          {hasRaw && labels.peak !== null && rawPeak !== null ? (
            <span
              data-note="peak"
              dir="auto"
              className={`absolute max-w-[60%] -translate-y-full pb-2 text-sm leading-snug text-ink ${flip ? "text-end" : "text-start"}`}
              style={{
                top: `${num(topPct(rawAt(rawPeak) ?? limitC))}%`,
                ...(flip ? { right: `calc(${num(100 - pctOfHour(rawPeak, from, to))}% + 0.25rem)` } : { left: `calc(${num(pctOfHour(rawPeak, from, to))}% + 0.25rem)` }),
              }}
            >
              {labels.peak}
            </span>
          ) : null}
        </div>

        {box === null ? null : (
          <div className="absolute bottom-8 start-10 end-3 h-6">
            <div
              data-slot={slot === null ? "outline" : "in-force"}
              className={`absolute inset-y-0 flex items-center justify-center overflow-hidden px-1 text-xs text-ink-2 ${
                slot === null ? "border border-dashed border-edge" : "border-x border-edge bg-slot"
              }`}
              style={{
                left: `${num(pctOfHour(box.fromHour, from, to))}%`,
                width: `${num(pctOfHour(box.toHour, from, to) - pctOfHour(box.fromHour, from, to))}%`,
              }}
            >
              {slot === null ? null : <span className="text-center leading-3">{labels.slot}</span>}
            </div>
          </div>
        )}

        <div aria-hidden className="absolute bottom-0 start-10 end-3 h-6 text-xs text-ink-3">
          {hours.map((h, i) => (
            <span
              key={h}
              className={`absolute top-1 -translate-x-1/2 whitespace-nowrap tabular-nums ${i % 3 === 0 ? "" : "max-sm:hidden"} ${i % 2 === 0 ? "" : "sm:hidden"}`}
              style={{ left: `${num(pctOfHour(h, from, to))}%` }}
            >
              {hourLabel(h)}
            </span>
          ))}
        </div>
      </div>

      <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink-2" data-legend="">
        {hasRaw ? <LegendItem kind="raw" text={labels.legend.raw} /> : null}
        {hasOurs ? <LegendItem kind="ours" text={labels.legend.ours} /> : null}
        {hasTruth ? <LegendItem kind="truth" text={labels.legend.truth} /> : null}
        {slot === null && box !== null ? <LegendItem kind="outline" text={labels.outline} /> : null}
      </ul>
    </figure>
  );
}

function LegendItem({ kind, text }: { readonly kind: "raw" | "ours" | "truth" | "outline"; readonly text: string }) {
  const sample =
    kind === "raw"
      ? "border-t-2 border-dashed border-viz-raw"
      : kind === "ours"
        ? "h-1 rounded-sign bg-viz-ours"
        : kind === "outline"
          ? "h-3 border border-dashed border-edge"
          : "border-t-[3px] border-viz-truth";
  return (
    <li data-legend-item={kind} className="flex items-center gap-2">
      <span aria-hidden className={`inline-block w-6 ${sample}`} />
      <span>{text}</span>
    </li>
  );
}
