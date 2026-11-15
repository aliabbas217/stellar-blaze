import { HEAVY_WORK_LIMIT_WBGT_C } from "@/features/judge/limit";
import { HEAT_STOPS } from "@/lib/heat/ramp";

/*
 * The landing field, as plain numbers: parsing the two recorded files, sampling the forecast field, the readings the
 * readout states, the isotherms and the colour table. Pure functions with no DOM, so the 2D canvas, the readout, the
 * server (which states the same readout in the first HTML) and the WebGL worker all read the field through the same
 * code, and a number on the canvas can never differ from the number in the text.
 *
 * It must stay small and import no schema library: it ships to the browser on the landing page (client-bundle-graph
 * test: no `zod` reaches a judge client entry), so the files are checked by hand here and by the build on the server.
 *
 * The field file (`public/data/static/uae_ifs025_d1_wbgt_<day>.json`) is the recorded day-1 ECMWF IFS forecast on its
 * 0.25 degree grid with WBGT computed from it: `wbgt_c[lat][lon][hour]`, latitude ascending, 24 local hours. It is a
 * recorded raw forecast, never a scored result. The coast file is Natural Earth outlines (rings of [lon, lat]).
 */

export class FieldDataError extends Error {
  override readonly name = "FieldDataError";
}

export const HOURS = 24;

/** The heavy-work limit the readout compares with and the count of "cells above" uses (`features/judge/limit.ts`). */
export const LIMIT_C = HEAVY_WORK_LIMIT_WBGT_C;

export interface FieldGrid {
  /** Latitudes of the rows, ascending. */
  readonly lat: readonly number[];
  readonly lon: readonly number[];
  /** `values[h * rows * cols + i * cols + j]`: WBGT in degrees C for hour `h`, latitude row `i`, longitude column `j`. */
  readonly values: Float32Array;
  readonly day: string;
  /** The file's own words about where the numbers come from (shown as the proof chip's protocol, script and source). */
  readonly source: string;
  readonly physics: string;
  readonly why: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  if (typeof value !== "string" || value.trim() === "") throw new FieldDataError(`field file: "${key}" is missing or not text`);
  return value;
}

function axis(source: Record<string, unknown>, key: string): number[] {
  const value = source[key];
  if (!Array.isArray(value) || value.length < 2) throw new FieldDataError(`field file: "${key}" must list at least two values`);
  const out = value.map((item): number => {
    if (typeof item !== "number" || !Number.isFinite(item)) throw new FieldDataError(`field file: "${key}" holds a value that is not a finite number`);
    return item;
  });
  for (let i = 1; i < out.length; i++) if ((out[i] ?? 0) <= (out[i - 1] ?? 0)) throw new FieldDataError(`field file: "${key}" must be ascending`);
  return out;
}

/** Parses the field file. Throws `FieldDataError` naming the first problem: a malformed file is never drawn. */
export function parseField(raw: unknown): FieldGrid {
  if (!isRecord(raw)) throw new FieldDataError("field file: not an object");
  const lat = axis(raw, "lat");
  const lon = axis(raw, "lon");
  const hoursLocal = raw.hours_local;
  if (!Array.isArray(hoursLocal) || hoursLocal.length !== HOURS) throw new FieldDataError(`field file: "hours_local" must list ${String(HOURS)} hours`);
  const grid = raw.wbgt_c;
  if (!Array.isArray(grid) || grid.length !== lat.length) throw new FieldDataError('field file: "wbgt_c" must have one row per latitude');
  const rows = lat.length;
  const cols = lon.length;
  const values = new Float32Array(HOURS * rows * cols);
  grid.forEach((row: unknown, i) => {
    if (!Array.isArray(row) || row.length !== cols) throw new FieldDataError(`field file: row ${String(i)} must have one cell per longitude`);
    row.forEach((cell: unknown, j) => {
      if (!Array.isArray(cell) || cell.length !== HOURS) throw new FieldDataError(`field file: cell ${String(i)},${String(j)} must hold ${String(HOURS)} hours`);
      cell.forEach((v: unknown, h) => {
        if (typeof v !== "number" || !Number.isFinite(v)) throw new FieldDataError(`field file: cell ${String(i)},${String(j)} hour ${String(h)} is not a finite number`);
        values[h * rows * cols + i * cols + j] = v;
      });
    });
  });
  return { lat, lon, values, day: text(raw, "day_local"), source: text(raw, "source"), physics: text(raw, "physics"), why: text(raw, "why_this_day") };
}

/** `[lon, lat]` points in order. */
export type Polyline = readonly (readonly [number, number])[];

/** The coast file: rings of `[lon, lat]`. */
export function parseCoast(raw: unknown): Polyline[] {
  if (!isRecord(raw) || !Array.isArray(raw.rings)) throw new FieldDataError("coast file: no rings");
  return (raw.rings as unknown[]).map((ring, n): Polyline => {
    const points = isRecord(ring) ? ring.r : undefined;
    if (!Array.isArray(points)) throw new FieldDataError(`coast file: ring ${String(n)} has no points`);
    return points.map((p: unknown): [number, number] => {
      if (!Array.isArray(p) || p.length < 2 || typeof p[0] !== "number" || typeof p[1] !== "number") throw new FieldDataError(`coast file: ring ${String(n)} holds a point that is not [lon, lat]`);
      return [p[0], p[1]];
    });
  });
}

/** `[lon0, lat0, lon1, lat1]`. */
export type Box = readonly [number, number, number, number];

export function boxOf(grid: Pick<FieldGrid, "lat" | "lon">): Box {
  return [grid.lon[0] ?? 0, grid.lat[0] ?? 0, grid.lon[grid.lon.length - 1] ?? 0, grid.lat[grid.lat.length - 1] ?? 0];
}

/** The coast rings cut to the box: runs of points inside it, each at least two points long. */
export function clipCoast(rings: readonly Polyline[], [x0, y0, x1, y1]: Box): Polyline[] {
  const lines: Polyline[] = [];
  for (const ring of rings) {
    let current: [number, number][] = [];
    for (const point of ring) {
      const inside = point[0] >= x0 && point[0] <= x1 && point[1] >= y0 && point[1] <= y1;
      if (inside) current.push([point[0], point[1]]);
      else if (current.length > 0) {
        if (current.length > 1) lines.push(current);
        current = [];
      }
    }
    if (current.length > 1) lines.push(current);
  }
  return lines;
}

/** Bilinear in space, linear in time; the hour wraps (the day is a loop). Clamped to the box. */
export function makeSampler(grid: Pick<FieldGrid, "lat" | "lon" | "values">): (lat: number, lon: number, hour: number) => number {
  const rows = grid.lat.length;
  const cols = grid.lon.length;
  const slice = rows * cols;
  const lat0 = grid.lat[0] ?? 0;
  const lon0 = grid.lon[0] ?? 0;
  const latSpan = (grid.lat[rows - 1] ?? 0) - lat0;
  const lonSpan = (grid.lon[cols - 1] ?? 0) - lon0;
  const v = grid.values;
  return (lat, lon, hour) => {
    const fy = ((lat - lat0) / latSpan) * (rows - 1);
    const fx = ((lon - lon0) / lonSpan) * (cols - 1);
    const y0 = Math.max(0, Math.min(rows - 2, Math.floor(fy)));
    const x0 = Math.max(0, Math.min(cols - 2, Math.floor(fx)));
    const ty = Math.min(1, Math.max(0, fy - y0));
    const tx = Math.min(1, Math.max(0, fx - x0));
    const h0 = ((Math.floor(hour) % HOURS) + HOURS) % HOURS;
    const h1 = (h0 + 1) % HOURS;
    const th = hour - Math.floor(hour);
    const at = (y: number, x: number): number => (v[h0 * slice + y * cols + x] ?? 0) * (1 - th) + (v[h1 * slice + y * cols + x] ?? 0) * th;
    return (at(y0, x0) * (1 - tx) + at(y0, x0 + 1) * tx) * (1 - ty) + (at(y0 + 1, x0) * (1 - tx) + at(y0 + 1, x0 + 1) * tx) * ty;
  };
}

export interface HotPoint {
  readonly value: number;
  readonly lat: number;
  readonly lon: number;
}

/** The hottest grid cell at a whole hour (ties keep the first, scanning latitude rows then longitude columns). */
export function hottestAt(grid: FieldGrid, hour: number): HotPoint {
  const rows = grid.lat.length;
  const cols = grid.lon.length;
  const base = (((Math.floor(hour) % HOURS) + HOURS) % HOURS) * rows * cols;
  let best = -Infinity;
  let at = 0;
  for (let k = 0; k < rows * cols; k++) {
    const value = grid.values[base + k] ?? -Infinity;
    if (value > best) {
      best = value;
      at = k;
    }
  }
  return { value: best, lat: grid.lat[Math.floor(at / cols)] ?? 0, lon: grid.lon[at % cols] ?? 0 };
}

export interface FieldReading {
  readonly hour: number;
  /** The hottest cell of the forecast grid. */
  readonly hottest: HotPoint;
  /** The station's own forecast series at that hour (it is not a grid cell: a separate series of the same model). */
  readonly station: number;
  readonly cells: number;
  readonly cellsAbove: number;
}

/** The index of the hottest hour of a 24-value day. */
export function peakHourOf(day: readonly number[]): number {
  let best = 0;
  day.forEach((value, h) => {
    if (value > (day[best] ?? -Infinity)) best = h;
  });
  return best;
}

/** What the readout states at a whole hour: the same numbers the canvas is drawn from. */
export function readingAt(grid: FieldGrid, station: readonly number[], hour: number): FieldReading {
  const h = ((Math.floor(hour) % HOURS) + HOURS) % HOURS;
  const cells = grid.lat.length * grid.lon.length;
  let cellsAbove = 0;
  for (let k = 0; k < cells; k++) if ((grid.values[h * cells + k] ?? 0) > HEAVY_WORK_LIMIT_WBGT_C) cellsAbove++;
  return { hour: h, hottest: hottestAt(grid, h), station: station[h] ?? NaN, cells, cellsAbove };
}

export interface Raster {
  readonly nx: number;
  readonly nz: number;
  /** `values[j * nx + i]`: row 0 is the northern edge, column 0 the western. */
  readonly values: Float32Array;
}

/** The field at `hour` on a regular lat/lon mesh of `step` degrees (north first), the values the 2D canvas colours. */
export function rasterize(grid: FieldGrid, hour: number, step = 0.05): Raster {
  const [x0, y0, x1, y1] = boxOf(grid);
  const nx = Math.round((x1 - x0) / step) + 1;
  const nz = Math.round((y1 - y0) / step) + 1;
  const at = makeSampler(grid);
  const values = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    const lat = y1 - j * step;
    for (let i = 0; i < nx; i++) values[j * nx + i] = at(lat, x0 + i * step, hour);
  }
  return { nx, nz, values };
}

/**
 * Isotherms every whole degree by marching squares over cells `step` nodes wide, one call of `onSegment(x1, y1, x2, y2, level)` per
 * segment with the points in node units (column, row) and the temperature of the line. A node that sits exactly on a level has no
 * crossing on the edges that end there (the product is zero): the lines of a real, noisy field never rely on it.
 */
export function isothermEach(
  values: Float32Array,
  nx: number,
  nz: number,
  step: number,
  onSegment: (x1: number, y1: number, x2: number, y2: number, level: number) => void,
): void {
  for (let j = 0; j + step < nz; j += step) {
    for (let i = 0; i + step < nx; i += step) {
      const a = values[j * nx + i] ?? 0;
      const b = values[j * nx + i + step] ?? 0;
      const c = values[(j + step) * nx + i + step] ?? 0;
      const d = values[(j + step) * nx + i] ?? 0;
      const lo = Math.ceil(Math.min(a, b, c, d));
      const hi = Math.floor(Math.max(a, b, c, d));
      for (let level = lo; level <= hi; level++) {
        const hits: number[] = [];
        const edge = (xa: number, ya: number, xb: number, yb: number, va: number, vb: number): void => {
          if ((va - level) * (vb - level) < 0) {
            const t = (level - va) / (vb - va);
            hits.push(xa + (xb - xa) * t, ya + (yb - ya) * t);
          }
        };
        edge(i, j, i + step, j, a, b);
        edge(i + step, j, i + step, j + step, b, c);
        edge(i + step, j + step, i, j + step, c, d);
        edge(i, j + step, i, j, d, a);
        // two crossings: one segment; four (a saddle): two
        for (let k = 0; k + 3 < hits.length; k += 4) onSegment(hits[k] ?? 0, hits[k + 1] ?? 0, hits[k + 2] ?? 0, hits[k + 3] ?? 0, level);
      }
    }
  }
}

/** The same lines as flat `[x1, y1, x2, y2, ...]`, for the 2D canvas. */
export function isothermSegments(values: Float32Array, nx: number, nz: number, step = 2): Float32Array {
  const out: number[] = [];
  isothermEach(values, nx, nz, step, (x1, y1, x2, y2) => {
    out.push(x1, y1, x2, y2);
  });
  return Float32Array.from(out);
}

// ---------- colour: the night ramp as 8-bit RGB (the field is data, so it takes the heat ramp) ----------

type Rgb = readonly [number, number, number];

/** OKLCH to sRGB 0..1 (Bjorn Ottosson's matrices): the prototype's `oklchToRgb`, which `lib/heat/ramp.ts` also ports. */
function oklchToRgb(l: number, c: number, h: number): [number, number, number] {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l1 = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m1 = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s1 = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [4.0767416621 * l1 - 3.3077115913 * m1 + 0.2309699292 * s1, -1.2684380046 * l1 + 2.6097574011 * m1 - 0.3413193965 * s1, -0.0041960863 * l1 - 0.7034186147 * m1 + 1.707614701 * s1];
  const gamma = (x: number): number => Math.min(1, Math.max(0, x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(Math.max(x, 0), 1 / 2.4) - 0.055));
  return [gamma(lin[0] ?? 0), gamma(lin[1] ?? 0), gamma(lin[2] ?? 0)];
}

/** The night heat ramp at `wbgtC` as 8-bit sRGB. Same stops as `heatColor(v, "night")`; values past the ends take the end colour. */
export function heatRgb(wbgtC: number): Rgb {
  const stops = HEAT_STOPS.night;
  const first = stops[0];
  const last = stops[stops.length - 1];
  if (first === undefined || last === undefined) throw new Error("heat ramp has no stops");
  let rgb: [number, number, number];
  if (wbgtC <= first[0]) rgb = oklchToRgb(first[1], first[2], first[3]);
  else if (wbgtC >= last[0]) rgb = oklchToRgb(last[1], last[2], last[3]);
  else {
    let k = 1;
    while (k < stops.length - 1 && wbgtC > (stops[k]?.[0] ?? Infinity)) k++;
    const [v0, l0, c0, h0] = stops[k - 1] ?? first;
    const [v1, l1, c1, h1] = stops[k] ?? last;
    const t = (wbgtC - v0) / (v1 - v0);
    rgb = oklchToRgb(l0 + (l1 - l0) * t, c0 + (c1 - c0) * t, h0 + (h1 - h0) * t);
  }
  return [Math.round(rgb[0] * 255), Math.round(rgb[1] * 255), Math.round(rgb[2] * 255)];
}

/** The table starts at 16 degrees and steps 0.05: redraws never redo the colour maths. */
export const LUT_FROM = 16;
export const LUT_STEP = 0.05;
export const LUT_SIZE = 561;

let lut: Uint8ClampedArray | null = null;

/** `LUT_SIZE` RGB triples of the night ramp, built once. Read with `lutOffset(v)`. */
export function heatLut(): Uint8ClampedArray {
  if (lut === null) {
    const table = new Uint8ClampedArray(LUT_SIZE * 3);
    for (let k = 0; k < LUT_SIZE; k++) table.set(heatRgb(LUT_FROM + k * LUT_STEP), k * 3);
    lut = table;
  }
  return lut;
}

export function lutOffset(wbgtC: number): number {
  return Math.max(0, Math.min(LUT_SIZE - 1, Math.round((wbgtC - LUT_FROM) / LUT_STEP))) * 3;
}

/** The clock label of an hour: `14:00`. Western digits whatever the language. */
export function hourLabel(hour: number): string {
  return `${String(((Math.floor(hour) % HOURS) + HOURS) % HOURS).padStart(2, "0")}:00`;
}
