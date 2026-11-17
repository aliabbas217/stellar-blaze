import { ACTION_SECONDARY_DENSE } from "@/components/states/actions";
import { num, VIEW_H, VIEW_W } from "./chart-geometry";

/*
 * The roster frontier at one commute: every roster shape the analysis tried is a point, sleep on x (more is further
 * right) and heat exposure on y (summer hours at WBGT 30 or more per scheduled hour; higher is worse). The staircase is the
 * set of best rosters (the Pareto front), the sleep gate is a dashed vertical, and the two reference rosters are marked:
 * the legal default and the common practice one. The chart reads only the recorded analysis (`RosterFrontier`); nothing
 * on it is a scored 2026 result. Same construction as the other charts (chart-geometry.ts): SVG marks, DOM text.
 */

export const COMMUTES = [15, 30, 45, 60, 75, 90] as const;
export type Commute = (typeof COMMUTES)[number];

/**
 * What the chart reads of the roster analysis, as a structural type: shared code must not import a feature (ADR 0009 section 7),
 * so this names the fields it uses and the feature's `RosterFrontier` is assignable to it.
 */
export interface FrontierData {
  readonly assumptions: { readonly sleep_gate_h: number };
  readonly pareto_e30_vs_sleep: readonly {
    readonly commute_min: number;
    readonly pareto: readonly { readonly roster: string; readonly sleep_h: number; readonly e30_per_h: number }[];
    readonly B0: { readonly sleep_h: number; readonly e30_per_h: number };
    readonly B1: { readonly sleep_h: number; readonly e30_per_h: number };
  }[];
}

export interface FrontierLabels {
  readonly ariaLabel: string;
  readonly xAxis: string;
  readonly yAxis: string;
  readonly gate: string;
  readonly legal: string;
  readonly common: string;
  readonly tableToggle: string;
  readonly tableCaption: string;
  readonly columns: { readonly roster: string; readonly sleep: string; readonly exposure: string };
}

export interface FrontierChartProps {
  readonly data: FrontierData;
  readonly commuteMin: Commute;
  readonly labels: FrontierLabels;
  /** Formats a number of hours of sleep for display (Western digits). */
  readonly formatHours: (hours: number) => string;
}

/** The axis range over EVERY commute, so the axes do not jump while the slider moves. */
function domain(data: FrontierData): { sleep: [number, number]; exposure: [number, number] } {
  const sleeps: number[] = [];
  const exposures: number[] = [];
  for (const group of data.pareto_e30_vs_sleep) {
    for (const point of [...group.pareto, group.B0, group.B1]) {
      sleeps.push(point.sleep_h);
      exposures.push(point.e30_per_h);
    }
  }
  const lo = (values: number[], step: number) => Math.floor(Math.min(...values) / step) * step;
  const hi = (values: number[], step: number) => Math.ceil(Math.max(...values) / step) * step;
  return { sleep: [lo(sleeps, 0.5), hi(sleeps, 0.5)], exposure: [lo(exposures, 10), hi(exposures, 10)] };
}

export function FrontierChart({ data, commuteMin, labels, formatHours }: FrontierChartProps) {
  const group = data.pareto_e30_vs_sleep.find((g) => g.commute_min === commuteMin);
  const { sleep, exposure } = domain(data);
  const x = (h: number) => ((h - sleep[0]) / (sleep[1] - sleep[0])) * 100;
  const y = (v: number) => (1 - (v - exposure[0]) / (exposure[1] - exposure[0])) * 100;
  const gate = data.assumptions.sleep_gate_h;

  const front = [...(group?.pareto ?? [])].sort((a, b) => a.sleep_h - b.sleep_h);
  const path = front.map((p) => `${num((x(p.sleep_h) / 100) * VIEW_W)},${num((y(p.e30_per_h) / 100) * VIEW_H)}`).join(" ");

  const sleepTicks: number[] = [];
  for (let h = Math.ceil(sleep[0]); h <= sleep[1]; h += 1) sleepTicks.push(h);
  const exposureTicks: number[] = [];
  for (let v = exposure[0]; v <= exposure[1]; v += 10) exposureTicks.push(v);

  return (
    <figure className="m-0 flex flex-col gap-3" data-frontier-chart="" data-commute={commuteMin}>
      <p className="text-sm text-ink-3">{labels.yAxis}</p>
      <div role="img" aria-label={labels.ariaLabel} dir="ltr" className="relative h-72 w-full text-ink sm:h-96">
        <div aria-hidden className="absolute bottom-14 start-0 top-3 w-10 text-xs text-ink-3">
          {exposureTicks.map((v) => (
            <span key={v} className="absolute end-0 -translate-y-1/2 tabular-nums" style={{ top: `${num(y(v))}%` }}>
              {v}
            </span>
          ))}
        </div>

        <div className="absolute bottom-14 start-12 end-3 top-3 border-b border-s border-edge">
          <svg aria-hidden viewBox={`0 0 ${String(VIEW_W)} ${String(VIEW_H)}`} preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
            {exposureTicks.map((v) => (
              <line key={v} x1={0} x2={VIEW_W} y1={num((y(v) / 100) * VIEW_H)} y2={num((y(v) / 100) * VIEW_H)} stroke="var(--hair)" vectorEffect="non-scaling-stroke" />
            ))}
            <line
              x1={num((x(gate) / 100) * VIEW_W)}
              x2={num((x(gate) / 100) * VIEW_W)}
              y1={0}
              y2={VIEW_H}
              stroke="var(--ink-2)"
              strokeDasharray="6 5"
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
            />
            {front.length > 1 ? (
              <polyline points={path} fill="none" stroke="var(--viz-ours)" strokeWidth={2} vectorEffect="non-scaling-stroke" data-frontier-line="" />
            ) : null}
          </svg>

          <span className="absolute bottom-1 whitespace-nowrap text-end text-sm text-ink-2" style={{ right: `calc(${num(100 - x(gate))}% + 0.5rem)` }}>
            {labels.gate}
          </span>

          {front.map((p) => (
            <span
              key={p.roster}
              data-roster-point=""
              aria-hidden
              className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-viz-ours bg-ground"
              style={{ left: `${num(x(p.sleep_h))}%`, top: `${num(y(p.e30_per_h))}%` }}
            />
          ))}

          {group === undefined
            ? null
            : (
                [
                  { key: "legal", point: group.B1, text: labels.legal, mark: "bg-ink" },
                  { key: "common", point: group.B0, text: labels.common, mark: "border-2 border-ink bg-ground" },
                ] as const
              ).map(({ key, point, text, mark }) => (
                <span key={key} data-baseline={key} aria-hidden>
                  <span
                    className={`absolute size-3 -translate-x-1/2 -translate-y-1/2 rotate-45 ${mark}`}
                    style={{ left: `${num(x(point.sleep_h))}%`, top: `${num(y(point.e30_per_h))}%` }}
                  />
                  <span
                    className="absolute -translate-y-1/2 whitespace-nowrap text-end text-sm text-ink"
                    style={{ right: `calc(${num(100 - x(point.sleep_h))}% + 0.75rem)`, top: `${num(y(point.e30_per_h))}%` }}
                  >
                    {text}
                  </span>
                </span>
              ))}
        </div>

        <div aria-hidden className="absolute bottom-8 start-12 end-3 h-6 text-xs text-ink-3">
          {sleepTicks.map((h) => (
            <span key={h} className="absolute top-1 -translate-x-1/2 tabular-nums" style={{ left: `${num(x(h))}%` }}>
              {formatHours(h)}
            </span>
          ))}
        </div>
        <p aria-hidden className="absolute bottom-0 start-12 end-3 text-center text-sm text-ink-3">
          {labels.xAxis}
        </p>
      </div>

      <details className="text-ink-2" data-frontier-table="">
        <summary className={`${ACTION_SECONDARY_DENSE} cursor-pointer`}>
          {labels.tableToggle}
        </summary>
        <div
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scroll container must be reachable by keyboard (WCAG 2.1.1)
          tabIndex={0}
          role="region"
          aria-label={labels.tableCaption}
          className="mt-3 max-h-80 overflow-auto rounded-sign border border-hair"
        >
          <table className="w-full border-collapse text-start text-sm">
            <caption className="sr-only">{labels.tableCaption}</caption>
            <thead className="sticky top-0 bg-panel text-ink-2">
              <tr>
                <th scope="col" className="px-3 py-2 text-start font-medium">
                  {labels.columns.roster}
                </th>
                <th scope="col" className="px-3 py-2 text-end font-medium">
                  {labels.columns.sleep}
                </th>
                <th scope="col" className="px-3 py-2 text-end font-medium">
                  {labels.columns.exposure}
                </th>
              </tr>
            </thead>
            <tbody>
              {front.map((p) => (
                <tr key={p.roster} className="border-t border-hair">
                  <th scope="row" className="px-3 py-1.5 text-start font-normal text-ink">
                    <bdi>{p.roster}</bdi>
                  </th>
                  <td className="px-3 py-1.5 text-end tabular-nums text-ink">{formatHours(p.sleep_h)}</td>
                  <td className="px-3 py-1.5 text-end tabular-nums text-ink">{p.e30_per_h.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
