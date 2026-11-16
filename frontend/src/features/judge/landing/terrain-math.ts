/*
 * The pure parts of the WebGL terrain, shared by the worker that draws it and the tests: the mesh size (the vertex budget of
 * ADR 0037), the relief, the camera, the screen position of a world point (so the station names stay DOM text on the page), and
 * the frame-rate monitor that gives the scene up for the 2D field. No DOM, no GL: everything here runs under test.
 *
 * Ported from docs/design/v2/prototype/assets/terrain-worker.js (framing: fov 32 on a desktop with the scene shifted to the end
 * side, 44 on a phone, centred), with the same numbers.
 */

export interface MeshSize {
  readonly nx: number;
  readonly nz: number;
}

/**
 * ADR 0037 section 3: at most 6,000 vertices on a desktop and 1,500 on a phone, counted over EVERYTHING one frame sends to the
 * GPU: the terrain mesh, the isotherm lines and the coast lines (`isoVertexCap` leaves the lines what the mesh and the coast do not use). The forecast field is a 22 x 17 grid, so a
 * mesh of 65 x 49 (desktop) or 27 x 21 (phone) is finer than it (about 8.5 and 1.5 times its nodes).
 */
export const MESH = { desktop: { nx: 65, nz: 49 }, phone: { nx: 27, nz: 21 } } as const satisfies Record<string, MeshSize>;

export const MAX_VERTICES = { desktop: 6000, phone: 1500 } as const;

/** Every how many points of a coast line one is kept: a phone draws every fourth (the outline is the same at a quarter of the vertices). */
export const COAST_STRIDE = { desktop: 1, phone: 4 } as const;

/**
 * What is left of the vertex budget for the isotherm lines after the mesh and the coast lines (a guard: the real field never reaches
 * it, `IsoLines.dropped` says so). The worker caps its isotherms with this very function and the budget test imports it, so the cap
 * is written once.
 */
export function isoVertexCap(mobile: boolean, coastVertices: number): number {
  const mesh = meshFor(mobile);
  return Math.max(2, MAX_VERTICES[mobile ? "phone" : "desktop"] - vertexCount(mesh) - coastVertices);
}

/** The coast lines a scene draws: the points kept by the stride (always the last point of a line), lines of fewer than 2 points dropped. */
export function decimateCoast<T>(lines: readonly (readonly T[])[], stride: number): T[][] {
  return lines
    .map((line) => line.filter((_, i) => i % stride === 0 || i === line.length - 1))
    .filter((line) => line.length >= 2);
}

/**
 * The isotherm segments of one frame as an indexed line list. Marching squares gives each segment its own two endpoints, but
 * neighbouring segments of one line meet on a cell edge: endpoints that fall on the same spot of the same level are ONE vertex,
 * which halves the vertices the frame sends (a closed line of n segments is n vertices, not 2n). `xy` holds mesh coordinates
 * (column, row) so the worker maps them to the world with its own functions.
 */
export class IsoLines {
  readonly xy: Float32Array;
  readonly level: Float32Array;
  readonly index: Uint16Array;
  vertices = 0;
  segments = 0;
  /** Segments dropped because the vertex cap was reached (0 on the real field: the cap is a guard, not a decimator). */
  dropped = 0;
  readonly #seen = new Map<number, number>();

  constructor(readonly maxVertices: number) {
    this.xy = new Float32Array(maxVertices * 2);
    this.level = new Float32Array(maxVertices);
    this.index = new Uint16Array(maxVertices * 2);
  }

  reset(): void {
    this.vertices = 0;
    this.segments = 0;
    this.dropped = 0;
    this.#seen.clear();
  }

  #vertex(x: number, y: number, level: number): number {
    // a sixty-fourth of a mesh cell is the same spot; levels are whole degrees (16 to 46 here, under 64 for any WBGT)
    const key = (Math.round(x * 64) * 8192 + Math.round(y * 64)) * 64 + (level & 63);
    const known = this.#seen.get(key);
    if (known !== undefined) return known;
    const at = this.vertices++;
    this.xy[at * 2] = x;
    this.xy[at * 2 + 1] = y;
    this.level[at] = level;
    this.#seen.set(key, at);
    return at;
  }

  add(x1: number, y1: number, x2: number, y2: number, level: number): void {
    if (this.vertices + 2 > this.maxVertices) {
      this.dropped++;
      return;
    }
    this.index[this.segments * 2] = this.#vertex(x1, y1, level);
    this.index[this.segments * 2 + 1] = this.#vertex(x2, y2, level);
    this.segments++;
  }
}

export function meshFor(mobile: boolean): MeshSize {
  return mobile ? MESH.phone : MESH.desktop;
}

export function vertexCount(mesh: MeshSize): number {
  return mesh.nx * mesh.nz;
}

/** Relief: the surface stands 0.075 units for every degree above 20 C WBGT. */
export const HEIGHT_PER_DEGREE = 0.075;
export const HEIGHT_FROM_C = 20;

export function heightOf(wbgtC: number): number {
  return (wbgtC - HEIGHT_FROM_C) * HEIGHT_PER_DEGREE;
}

type Mat = Float32Array;

/** Column-major 4 x 4 product a * b. */
export function mul(a: Mat, b: Mat): Mat {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let sum = 0;
      for (let i = 0; i < 4; i++) sum += (a[i * 4 + r] ?? 0) * (b[c * 4 + i] ?? 0);
      out[c * 4 + r] = sum;
    }
  }
  return out;
}

export function perspective(fovDeg: number, aspect: number, near: number, far: number): Mat {
  const t = 1 / Math.tan((fovDeg * Math.PI) / 360);
  return new Float32Array([t / aspect, 0, 0, 0, 0, t, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0]);
}

export function lookAt(eye: readonly [number, number, number], target: readonly [number, number, number]): Mat {
  let zx = eye[0] - target[0];
  let zy = eye[1] - target[1];
  let zz = eye[2] - target[2];
  let l = Math.hypot(zx, zy, zz);
  zx /= l;
  zy /= l;
  zz /= l;
  let xx = zz;
  let xz = -zx;
  const xy = 0;
  l = Math.hypot(xx, xz);
  xx /= l;
  xz /= l;
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;
  return new Float32Array([xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0, -(xx * eye[0] + xy * eye[1] + xz * eye[2]), -(yx * eye[0] + yy * eye[1] + yz * eye[2]), -(zx * eye[0] + zy * eye[1] + zz * eye[2]), 1]);
}

/**
 * Where the map's centre sits across the stage on a wide screen, as a fraction of its width: the copy owns the start side, so the
 * map is centred on the end side (mirrored in a right-to-left language: the map itself never mirrors, geography has no direction).
 * One constant for the 2D canvas and the WebGL scene.
 */
export const MAP_CENTRE_END = 0.62;

export function mapCentreX(rtl: boolean): number {
  return rtl ? 1 - MAP_CENTRE_END : MAP_CENTRE_END;
}

/** The scene's shift along clip-space x (clip space spans 2 units across the stage): the same centre as the 2D canvas. */
export function sceneShiftX(rtl: boolean): number {
  return (mapCentreX(rtl) - 0.5) * 2;
}

export interface CameraOptions {
  readonly mobile: boolean;
  /** Right-to-left page: the copy is on the right, so the scene shifts to the left. */
  readonly rtl?: boolean;
  /** Orbit angle in radians (the desktop scene turns slowly while the day plays). */
  readonly azimuth: number;
  readonly aspect: number;
}

const TARGET = [0, 0.55, 0.1] as const;

/** The model-view-projection matrix of the scene. */
export function cameraMatrix({ mobile, azimuth, aspect, rtl = false }: CameraOptions): Mat {
  const radius = mobile ? 8.4 : 11.2;
  const tilt = mobile ? 0.98 : 0.74;
  const eye = [
    Math.sin(azimuth - 0.35) * radius * Math.cos(tilt),
    TARGET[1] + radius * Math.sin(tilt),
    TARGET[2] + Math.cos(azimuth - 0.35) * radius * Math.cos(tilt),
  ] as const;
  // On a desktop the copy owns the start side: the scene is shifted toward the end side in clip space.
  const shift = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, mobile ? 0 : sceneShiftX(rtl), mobile ? 0 : 0.08, 0, 1]);
  return mul(shift, mul(perspective(mobile ? 44 : 32, aspect, 0.1, 100), lookAt(eye, TARGET)));
}

/** CSS-pixel position of a world point under `matrix` in a `width` x `height` canvas. */
export function projectToScreen(matrix: Mat, x: number, y: number, z: number, width: number, height: number): readonly [number, number] {
  const m = matrix;
  const cx = (m[0] ?? 0) * x + (m[4] ?? 0) * y + (m[8] ?? 0) * z + (m[12] ?? 0);
  const cy = (m[1] ?? 0) * x + (m[5] ?? 0) * y + (m[9] ?? 0) * z + (m[13] ?? 0);
  const cw = (m[3] ?? 0) * x + (m[7] ?? 0) * y + (m[11] ?? 0) * z + (m[15] ?? 0);
  return [((cx / cw) * 0.5 + 0.5) * width, ((-cy / cw) * 0.5 + 0.5) * height];
}

/**
 * ADR 0037 section 4: below 30 frames per second for 2 seconds, the scene gives way to the 2D field. What is measured is how long
 * the WORKER took for each frame it was asked for (request to answer), never the page's animation frames and never the gap between
 * two answers: a gap can be a pause (the page asked for nothing: a hidden tab, a frozen scene) and so cannot tell a slow GPU from
 * an idle one, whereas the time a request waited for its answer is the GPU's own, however slow it is (3 frames per second included).
 */
export const FPS_FLOOR = 30;
export const FPS_WINDOW_MS = 2000;

export class FpsMonitor {
  #slowMs = 0;

  /**
   * Call once per frame the worker finished while the day PLAYS, with how long that frame took from request to answer (ms).
   * True when the frames have been slower than 30 per second for 2 seconds on end (the sum of the slow frames' own time).
   */
  tick(frameMs: number): boolean {
    this.#slowMs = frameMs > 1000 / FPS_FLOOR ? this.#slowMs + frameMs : 0;
    return this.#slowMs >= FPS_WINDOW_MS;
  }

  /** The day stopped playing, or the page was hidden: the next frame starts a new run. */
  reset(): void {
    this.#slowMs = 0;
  }
}
