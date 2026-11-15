import { boxOf, heatLut, isothermSegments, lutOffset, rasterize, type Box, type FieldGrid, type Polyline } from "./field-data";

/*
 * The 2D drawing of the field: one function per frame, no framework. The field is rasterized on a 0.05 degree mesh, coloured
 * through the heat table, scaled onto the canvas with smoothing, and the 1 degree isotherms and the coast are stroked on
 * top. It is also the fallback of the WebGL scene (FieldCanvasGL), so it must stay correct on its own.
 */

/** Stations whose names label the map; latitude and longitude of the airport reference points (ICAO). */
export const STATIONS = {
  OMAA: [24.433, 54.6511],
  OMDB: [25.255, 55.3643],
  OMAL: [24.2617, 55.6092],
  OMFJ: [25.1122, 56.324],
} as const;

export type StationCode = keyof typeof STATIONS;

/** The station names that fit: a phone shows two, a wide screen three (a fourth would sit under the readout card). */
export function labelCodes(width: number): readonly StationCode[] {
  return width < PHONE_MAX_WIDTH ? ["OMAA", "OMFJ"] : ["OMAA", "OMDB", "OMFJ"];
}

/** Below this width the layout is the phone's: the map is centred and fills the width. */
export const PHONE_MAX_WIDTH = 900;

export interface Geometry {
  readonly width: number;
  readonly height: number;
  /** Pixels per degree of latitude. */
  readonly scale: number;
  readonly originX: number;
  readonly originY: number;
  /** cos(latitude of the box centre): a degree of longitude is this much shorter than a degree of latitude. */
  readonly kx: number;
  readonly box: Box;
}

/**
 * Where the map sits in a `width` x `height` stage. On a wide screen the copy owns the start side, so the map is centred on
 * the end side (mirrored in a right-to-left language: the map itself never mirrors, geography has no direction).
 */
export function geometry(width: number, height: number, box: Box, rtl: boolean): Geometry {
  const phone = width < PHONE_MAX_WIDTH;
  const lonSpan = box[2] - box[0];
  const latSpan = box[3] - box[1];
  const kx = Math.cos((((box[1] + box[3]) / 2) * Math.PI) / 180);
  const scale = Math.min((width * (phone ? 0.92 : 0.5)) / (lonSpan * kx), (height * (phone ? 0.86 : 0.62)) / latSpan);
  const centreX = phone ? 0.5 : rtl ? 0.38 : 0.62;
  return { width, height, scale, originX: width * centreX, originY: height * (phone ? 0.5 : 0.44), kx, box };
}

export function project(g: Geometry, lon: number, lat: number): readonly [number, number] {
  const lon0 = (g.box[0] + g.box[2]) / 2;
  const lat0 = (g.box[1] + g.box[3]) / 2;
  return [g.originX + (lon - lon0) * g.kx * g.scale, g.originY - (lat - lat0) * g.scale];
}

export interface Strokes {
  readonly isotherm: string;
  readonly coast: string;
}

export interface Scratch {
  readonly canvas: HTMLCanvasElement;
  readonly image: ImageData;
  readonly nx: number;
  readonly nz: number;
}

export function makeScratch(grid: FieldGrid, step = 0.05): Scratch {
  const [x0, y0, x1, y1] = boxOf(grid);
  const nx = Math.round((x1 - x0) / step) + 1;
  const nz = Math.round((y1 - y0) / step) + 1;
  const canvas = document.createElement("canvas");
  canvas.width = nx;
  canvas.height = nz;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("2D canvas is not available");
  return { canvas, image: context.createImageData(nx, nz), nx, nz };
}

/** Draws the field at `hour` (fractional hours are interpolated) into `ctx`, whose transform maps CSS pixels. */
export function drawField(
  ctx: CanvasRenderingContext2D,
  g: Geometry,
  grid: FieldGrid,
  coast: readonly Polyline[],
  hour: number,
  scratch: Scratch,
  strokes: Strokes,
): void {
  const { nx, nz, values } = rasterize(grid, hour);
  const lut = heatLut();
  const data = scratch.image.data;
  for (let k = 0; k < values.length; k++) {
    const at = lutOffset(values[k] ?? 0);
    data[k * 4] = lut[at] ?? 0;
    data[k * 4 + 1] = lut[at + 1] ?? 0;
    data[k * 4 + 2] = lut[at + 2] ?? 0;
    data[k * 4 + 3] = 255;
  }
  const own = scratch.canvas.getContext("2d");
  if (own === null) return;
  own.putImageData(scratch.image, 0, 0);

  const [west, south, east, north] = g.box;
  const [x0, y0] = project(g, west, north);
  const [x1, y1] = project(g, east, south);
  ctx.clearRect(0, 0, g.width, g.height);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(scratch.canvas, x0, y0, x1 - x0, y1 - y0);

  const segments = isothermSegments(values, nx, nz, 2);
  ctx.strokeStyle = strokes.isotherm;
  ctx.lineWidth = 1;
  ctx.beginPath();
  const px = (i: number): number => x0 + (i / (nx - 1)) * (x1 - x0);
  const pz = (j: number): number => y0 + (j / (nz - 1)) * (y1 - y0);
  for (let k = 0; k + 3 < segments.length; k += 4) {
    ctx.moveTo(px(segments[k] ?? 0), pz(segments[k + 1] ?? 0));
    ctx.lineTo(px(segments[k + 2] ?? 0), pz(segments[k + 3] ?? 0));
  }
  ctx.stroke();

  ctx.strokeStyle = strokes.coast;
  for (const line of coast) {
    ctx.beginPath();
    line.forEach(([lon, lat], i) => {
      const [x, y] = project(g, lon, lat);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
}
