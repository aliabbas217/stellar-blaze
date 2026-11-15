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

/** ADR 0037 section 3: at most 6,000 vertices on a desktop and 1,500 on a phone. 85 x 65 = 5,525 and 43 x 33 = 1,419. */
export const MESH = { desktop: { nx: 85, nz: 65 }, phone: { nx: 43, nz: 33 } } as const satisfies Record<string, MeshSize>;

export const MAX_VERTICES = { desktop: 6000, phone: 1500 } as const;

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

export interface CameraOptions {
  readonly mobile: boolean;
  /** Orbit angle in radians (the desktop scene turns slowly while the day plays). */
  readonly azimuth: number;
  readonly aspect: number;
}

const TARGET = [0, 0.55, 0.1] as const;

/** The model-view-projection matrix of the scene. */
export function cameraMatrix({ mobile, azimuth, aspect }: CameraOptions): Mat {
  const radius = mobile ? 8.4 : 11.2;
  const tilt = mobile ? 0.98 : 0.74;
  const eye = [
    Math.sin(azimuth - 0.35) * radius * Math.cos(tilt),
    TARGET[1] + radius * Math.sin(tilt),
    TARGET[2] + Math.cos(azimuth - 0.35) * radius * Math.cos(tilt),
  ] as const;
  // On a desktop the copy owns the start side: the scene is shifted toward the end side in clip space.
  const shift = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, mobile ? 0 : 0.3, mobile ? 0 : 0.08, 0, 1]);
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

/** ADR 0037 section 4: below 30 frames per second for 2 seconds, the scene gives way to the 2D field. */
export const FPS_FLOOR = 30;
export const FPS_WINDOW_MS = 2000;
/** A gap this long between two frames is a pause (nothing was being drawn), not a slow frame. */
export const PAUSE_MS = 250;

export class FpsMonitor {
  #last: number | null = null;
  #slowMs = 0;

  /** Call once per frame of a PLAYING day with the frame's timestamp (ms). True when the scene should be given up. */
  tick(nowMs: number): boolean {
    const last = this.#last;
    this.#last = nowMs;
    if (last === null) return false;
    const dt = nowMs - last;
    if (dt >= PAUSE_MS) {
      this.#slowMs = 0;
      return false;
    }
    this.#slowMs = dt > 1000 / FPS_FLOOR ? this.#slowMs + dt : 0;
    return this.#slowMs >= FPS_WINDOW_MS;
  }

  /** Forget the last frame (the day stopped playing): the next tick starts a new run. */
  reset(): void {
    this.#last = null;
    this.#slowMs = 0;
  }
}
