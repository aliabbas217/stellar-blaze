import { memo, useId } from "react";
import { IsothermBands } from "./IsothermBands";
import { leftPct, num, topPct, VIEW_H, VIEW_W, xOfIndex, yOf } from "./chart-geometry";

/*
 * The season ribbon: the daily peak forecast of every day of the season as a hypsometric silhouette (one band per
 * degree, a contour at each), the heavy-work limit dashed and labelled once, and the midday break as the recessed slot
 * cut below the ground for exactly the days it is in force. It is the hero of the scoreboard and the landing's proof.
 *
 * No chart library: the marks are SVG, the text is DOM (see chart-geometry.ts). Every string arrives in `labels`
 * already worded and formatted by the caller, so this component has no hook and no locale: it renders the same on the
 * server and inside the client player. The chart is `role="img"` with an `aria-label`, and the same numbers are one tap
 * away as a table (a native <details>, no script).
 */

export interface RibbonLabels {
  readonly ariaLabel: string;
  /** "Heavy-work limit 26.6 °C", drawn once on the dashed line. */
  readonly limit: string;
  readonly slot: string;
  readonly slotShort: string;
  /** The note on the hottest day, or null to draw none. */
  readonly peak: string | null;
  /** The note on the coolest day, or null to draw none. */
  readonly coolest: string | null;
  readonly tableToggle: string;
  readonly tableCaption: string;
  readonly columns: { readonly day: string; readonly peak: string; readonly over: string; readonly inBreak: string };
  readonly yes: string;
  readonly no: string;
}

export interface RibbonTick {
  readonly index: number;
  readonly label: string;
  /** Hidden below 640 px, where the labels would run into each other. */
  readonly minor?: boolean;
}

export interface SeasonRibbonProps {
  /** ISO dates, one per day. */
  readonly days: readonly string[];
  /** The same days, worded for the reader ("Tue 4 Aug"): used in the table. */
  readonly dayLabels: readonly string[];
  /** The highest forecast of each day, degrees C. */
  readonly peaks: readonly number[];
  /** Working hours over the limit, per day (the table's third column). */
  readonly perDay: readonly number[];
  /** First and last day the midday break is in force, or null when it is in force on none of them. */
  readonly ban: { readonly fromIndex: number; readonly toIndex: number } | null;
  readonly limitC: number;
  /** Index of the last day drawn (the player reveals the season day by day). Default: all of them. */
  readonly upto?: number;
  /** A smaller ribbon with no notes and no limit label, for a place where it is a picture of the season. */
  readonly compact?: boolean;
  readonly ticks: readonly RibbonTick[];
  readonly labels: RibbonLabels;
}

const Y_TICKS = [28, 32, 36, 40] as const;

/** The height of the full-size ribbon box. The route's loading skeleton uses the same classes, so it is the final height by construction. */
export const RIBBON_HEIGHT = "h-80 sm:h-96";

function argExtreme(values: readonly number[], pick: (a: number, b: number) => number): number {
  return values.indexOf(values.reduce((a, b) => pick(a, b)));
}

/** Plot box inside the figure: room on the left for the y ticks, below for the slot and the month ticks. */
const PLOT = "absolute left-10 right-3";

export function SeasonRibbon({ days, dayLabels, peaks, perDay, ban, limitC, upto, compact = false, ticks, labels }: SeasonRibbonProps) {
  const clipId = useId().replace(/[^A-Za-z0-9_-]/g, "");
  const n = peaks.length;
  const last = Math.min(Math.max(upto ?? n - 1, 0), n - 1);
  const peakIndex = argExtreme(peaks, Math.max);
  const coolIndex = argExtreme(peaks, Math.min);

  const points = peaks.slice(0, last + 1).map((value, i) => `${num(xOfIndex(i, n))},${num(yOf(value))}`);
  const areaPath = `M0,${String(VIEW_H)} L${points.join(" L")} L${num(xOfIndex(last, n))},${String(VIEW_H)} Z`;

  // The slot spans whole days: half a day either side of the first and last day of the season of the break.
  const half = n > 1 ? 0.5 : 0;
  const slotFrom = ban === null ? 0 : Math.max(0, leftPct(ban.fromIndex - half, n));
  const slotTo = ban === null ? 0 : Math.min(100, leftPct(ban.toIndex + half, n));
  const showNotes = !compact;
  const top = compact ? "top-3" : "top-14";

  return (
    <figure className="m-0 flex flex-col gap-3" data-ribbon="" data-upto={last}>
      <div
        role="img"
        aria-label={labels.ariaLabel}
        dir="ltr"
        className={`relative w-full text-ink ${compact ? "h-52" : RIBBON_HEIGHT}`}
      >
        {/* y axis: the values every 4 degrees, recessive */}
        <div aria-hidden className={`absolute left-0 w-9 ${top} bottom-16 text-xs text-ink-3`}>
          {Y_TICKS.map((v) => (
            <span key={v} className="absolute end-0 -translate-y-1/2 tabular-nums" style={{ top: `${num(topPct(v))}%` }}>
              {v}
            </span>
          ))}
        </div>

        <div className={`${PLOT} ${top} bottom-16`}>
          <svg
            aria-hidden
            viewBox={`0 0 ${String(VIEW_W)} ${String(VIEW_H)}`}
            preserveAspectRatio="none"
            className="absolute inset-0 size-full overflow-visible"
          >
            <IsothermBands areaPath={areaPath} clipId={clipId} />
            <line
              x1={0}
              x2={VIEW_W}
              y1={num(yOf(limitC))}
              y2={num(yOf(limitC))}
              stroke="var(--ink-2)"
              strokeDasharray="6 5"
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
              data-limit-line=""
            />
            <line x1={0} x2={VIEW_W} y1={VIEW_H} y2={VIEW_H} stroke="var(--edge)" vectorEffect="non-scaling-stroke" />
            {last < n - 1 ? (
              <line
                x1={num(xOfIndex(last, n))}
                x2={num(xOfIndex(last, n))}
                y1={0}
                y2={VIEW_H}
                stroke="var(--ink)"
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
                data-playhead=""
              />
            ) : null}
          </svg>

          {!compact ? (
            <span
              className="absolute end-1 -translate-y-full pb-1 text-sm text-ink"
              style={{ top: `${num(topPct(limitC))}%` }}
              data-limit-label=""
            >
              {labels.limit}
            </span>
          ) : null}

          {showNotes && labels.peak !== null && last >= peakIndex ? (
            <Note index={peakIndex} n={n} value={peaks[peakIndex] ?? limitC} text={labels.peak} kind="peak" />
          ) : null}
          {showNotes && labels.coolest !== null && last >= coolIndex ? (
            <Note index={coolIndex} n={n} value={peaks[coolIndex] ?? limitC} text={labels.coolest} kind="coolest" />
          ) : null}
        </div>

        {ban === null ? null : (
          <div className={`${PLOT} bottom-8 h-6`}>
            <div
              data-slot=""
              className="absolute inset-y-0 flex items-center justify-center overflow-hidden border-x border-edge bg-slot px-1 text-xs text-ink-2"
              style={{ left: `${num(slotFrom)}%`, width: `${num(slotTo - slotFrom)}%` }}
            >
              <span className="truncate max-sm:hidden">{labels.slot}</span>
              <span className="truncate sm:hidden">{labels.slotShort}</span>
            </div>
          </div>
        )}

        <div aria-hidden className={`${PLOT} bottom-0 h-6 text-xs text-ink-3`}>
          {ticks.map((tick, k) => (
            <span
              key={tick.index}
              className={`absolute top-1 whitespace-nowrap ${tick.minor === true ? "max-sm:hidden " : ""}${k === 0 ? "" : tick.index === n - 1 ? "-translate-x-full" : "-translate-x-1/2"}`}
              style={{ left: `${num(leftPct(tick.index, n))}%` }}
            >
              {tick.label}
            </span>
          ))}
        </div>
      </div>

      <RibbonTable days={days} dayLabels={dayLabels} peaks={peaks} perDay={perDay} ban={ban} labels={labels} />
    </figure>
  );
}

/** A direct annotation: a dot on the day, a thin leader to the text. DOM-positioned in percentages of the plot box. */
function Note({
  index,
  n,
  value,
  text,
  kind,
}: {
  readonly index: number;
  readonly n: number;
  readonly value: number;
  readonly text: string;
  readonly kind: "peak" | "coolest";
}) {
  const x = leftPct(index, n);
  const y = topPct(value);
  const flip = x > 50;
  const peak = kind === "peak";
  return (
    <>
      <span
        aria-hidden
        className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink"
        style={{ left: `${num(x)}%`, top: `${num(y)}%` }}
      />
      <span
        aria-hidden
        className={`absolute w-px bg-ink-2 ${peak ? "" : "max-sm:hidden"}`}
        style={
          peak
            ? { left: `${num(x)}%`, top: "-2.5rem", height: `calc(${num(y)}% + 2.5rem)` }
            : { left: `${num(x)}%`, top: "0.5rem", height: `calc(${num(y)}% - 0.5rem)` }
        }
      />
      <span
        aria-hidden
        dir="auto"
        data-note={kind}
        className={`absolute max-w-[75%] text-sm leading-snug text-ink ${peak ? "" : "max-sm:hidden"} ${flip ? "text-end" : "text-start"}`}
        style={{
          ...(flip ? { right: `calc(${num(100 - x)}% + 0.5rem)` } : { left: `calc(${num(x)}% + 0.5rem)` }),
          top: peak ? "-3rem" : "0.25rem",
        }}
      >
        {text}
      </span>
    </>
  );
}

interface TableProps {
  readonly days: readonly string[];
  readonly dayLabels: readonly string[];
  readonly peaks: readonly number[];
  readonly perDay: readonly number[];
  readonly ban: { readonly fromIndex: number; readonly toIndex: number } | null;
  readonly labels: RibbonLabels;
}

/**
 * The ribbon's table alternative: one row per day, behind a native disclosure. Memoized: the player re-renders the ribbon
 * every animation frame, and the 139 rows do not change with it.
 */
const RibbonTable = memo(function RibbonTable({ days, dayLabels, peaks, perDay, ban, labels }: TableProps) {
  return (
    <details className="group text-ink-2" data-ribbon-table="">
      <summary className="inline-flex min-h-(--target) cursor-pointer items-center rounded-sign border border-edge px-4 text-base text-ink hover:bg-panel">
        {labels.tableToggle}
      </summary>
      {/* keyboard-focusable scroll container: 139 rows do not fit a phone */}
      <div
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scroll container must be reachable by keyboard (WCAG 2.1.1)
        tabIndex={0}
        role="region"
        aria-label={labels.tableCaption}
        className="mt-3 max-h-96 overflow-auto rounded-sign border border-hair"
      >
        <table className="w-full border-collapse text-start text-sm">
          <caption className="sr-only">{labels.tableCaption}</caption>
          <thead className="sticky top-0 bg-panel text-ink-2">
            <tr>
              <th scope="col" className="px-3 py-2 text-start font-medium">
                {labels.columns.day}
              </th>
              <th scope="col" className="px-3 py-2 text-end font-medium">
                {labels.columns.peak}
              </th>
              <th scope="col" className="px-3 py-2 text-end font-medium">
                {labels.columns.over}
              </th>
              <th scope="col" className="px-3 py-2 text-start font-medium">
                {labels.columns.inBreak}
              </th>
            </tr>
          </thead>
          <tbody>
            {days.map((day, i) => (
              <tr key={day} className="border-t border-hair">
                <th scope="row" className="px-3 py-1.5 text-start font-normal text-ink">
                  <time dateTime={day}>{dayLabels[i] ?? day}</time>
                </th>
                <td className="px-3 py-1.5 text-end tabular-nums text-ink">{(peaks[i] ?? 0).toFixed(1)}</td>
                <td className="px-3 py-1.5 text-end tabular-nums text-ink">{perDay[i] ?? 0}</td>
                <td className="px-3 py-1.5 text-ink-2">
                  {ban !== null && i >= ban.fromIndex && i <= ban.toIndex ? labels.yes : labels.no}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
});
