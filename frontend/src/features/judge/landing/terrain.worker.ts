import { heatLut, isothermEach, lutOffset, makeSampler } from "./field-data";
import { cameraMatrix, heightOf, meshFor, projectToScreen } from "./terrain-math";

/*
 * The landing terrain, drawn in a worker on an OffscreenCanvas so that creating the WebGL context, building the mesh and drawing
 * never block the page's main thread (ADR 0037). Plain WebGL: one small shader program and five buffers, no 3D library. Unlit
 * on purpose (light would change the encoded colour, which is the value); the relief is the field's own height, and the 1 degree
 * isotherms and the coast stand on it. At most 6,000 vertices on a desktop and 1,500 on a phone (terrain-math.ts).
 *
 * Messages in: `init` (the canvas, the grid, the coast already clipped to the box, the station positions), `draw` (hour, orbit
 * angle, size). Messages out: `ready`, `drawn` (with the stations' screen positions: the names stay DOM text on the page), and
 * `fail` (no WebGL, a program that did not link, a lost context, any error): the page then keeps the 2D field.
 */

export interface InitMessage {
  readonly type: "init";
  readonly canvas: OffscreenCanvas;
  readonly lat: readonly number[];
  readonly lon: readonly number[];
  readonly values: Float32Array;
  readonly coast: readonly (readonly (readonly [number, number])[])[];
  readonly mobile: boolean;
  /** `[lat, lon]` of the stations to place. */
  readonly stations: readonly (readonly [number, number])[];
}

export interface DrawMessage {
  readonly type: "draw";
  readonly hour: number;
  readonly azimuth: number;
  /** CSS size of the canvas, and the device pixel ratio (capped by the page: 2, or 1.5 on a phone). */
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
  readonly force: boolean;
}

export type WorkerIn = InitMessage | DrawMessage;
export type WorkerOut =
  | { readonly type: "ready" }
  | { readonly type: "drawn"; readonly labels: readonly (readonly [number, number])[] }
  | { readonly type: "fail"; readonly why: string };

interface Scope {
  postMessage: (message: WorkerOut) => void;
  onmessage: ((event: MessageEvent<WorkerIn>) => void) | null;
}
const scope = self as unknown as Scope;

interface Scene {
  readonly gl: WebGLRenderingContext;
  readonly canvas: OffscreenCanvas;
  readonly mobile: boolean;
  readonly nx: number;
  readonly nz: number;
  readonly sample: (lat: number, lon: number, hour: number) => number;
  readonly worldX: (lon: number) => number;
  readonly worldZ: (lat: number) => number;
  readonly lonAt: (i: number) => number;
  readonly latAt: (j: number) => number;
  readonly latLon: Float32Array;
  readonly position: Float32Array;
  readonly colour: Float32Array;
  readonly values: Float32Array;
  readonly indices: Uint16Array;
  readonly coastLines: readonly (readonly (readonly [number, number])[])[];
  readonly coastCount: number;
  readonly coastPosition: Float32Array;
  readonly iso: Float32Array;
  isoCount: number;
  lastHour: number;
  readonly buffers: { readonly position: WebGLBuffer; readonly colour: WebGLBuffer; readonly index: WebGLBuffer; readonly iso: WebGLBuffer; readonly coast: WebGLBuffer };
  readonly locations: { readonly p: number; readonly c: number; readonly m: WebGLUniformLocation | null; readonly u: WebGLUniformLocation | null };
  readonly stations: readonly (readonly [number, number])[];
}

let scene: Scene | null = null;

const MAX_ISO_SEGMENTS = 24_000;

function fail(why: string): void {
  scope.postMessage({ type: "fail", why });
}

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (shader === null) throw new Error("no shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return shader;
}

function init(message: InitMessage): void {
  const { canvas, mobile, stations } = message;
  const gl = canvas.getContext("webgl", { antialias: !mobile, alpha: true, premultipliedAlpha: false, powerPreference: "high-performance" });
  if (gl === null) {
    fail("no WebGL");
    return;
  }
  canvas.addEventListener("webglcontextlost", () => {
    fail("context lost");
  });
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, "attribute vec3 p;attribute vec3 c;uniform mat4 m;varying vec3 v;void main(){gl_Position=m*vec4(p,1.0);v=c;}"));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, "precision mediump float;varying vec3 v;uniform vec4 u;void main(){gl_FragColor=u.a>0.0?u:vec4(v,1.0);}"));
  gl.linkProgram(program);
  if (!(gl.getProgramParameter(program, gl.LINK_STATUS) as boolean)) {
    fail("program");
    return;
  }
  gl.useProgram(program);
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);

  const { lat, lon } = message;
  const west = lon[0] ?? 0;
  const east = lon[lon.length - 1] ?? 0;
  const south = lat[0] ?? 0;
  const north = lat[lat.length - 1] ?? 0;
  const kx = Math.cos((((south + north) / 2) * Math.PI) / 180);
  const worldX = (lo: number): number => (lo - (west + east) / 2) * kx;
  const worldZ = (la: number): number => -(la - (south + north) / 2);
  const { nx, nz } = meshFor(mobile);
  const count = nx * nz;
  const lonAt = (i: number): number => west + ((east - west) * i) / (nx - 1);
  const latAt = (j: number): number => north - ((north - south) * j) / (nz - 1);
  const position = new Float32Array(count * 3);
  const latLon = new Float32Array(count * 2);
  for (let k = 0; k < count; k++) {
    const i = k % nx;
    const j = Math.floor(k / nx);
    latLon[k * 2] = latAt(j);
    latLon[k * 2 + 1] = lonAt(i);
    position[k * 3] = worldX(lonAt(i));
    position[k * 3 + 2] = worldZ(latAt(j));
  }
  const indices = new Uint16Array((nx - 1) * (nz - 1) * 6);
  let at = 0;
  for (let z = 0; z < nz - 1; z++) {
    for (let x = 0; x < nx - 1; x++) {
      const a = z * nx + x;
      indices.set([a, a + nx, a + 1, a + 1, a + nx, a + nx + 1], at);
      at += 6;
    }
  }
  const make = (): WebGLBuffer => {
    return gl.createBuffer();
  };
  const buffers = { position: make(), colour: make(), index: make(), iso: make(), coast: make() };
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.index);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
  // A phone draws every third coast point: the outline is the same at a third of the vertices.
  const coastLines = message.coast.map((line) => (mobile ? line.filter((_, i) => i % 3 === 0 || i === line.length - 1) : line));
  const coastCount = coastLines.reduce((sum, line) => sum + (line.length - 1) * 2, 0);
  scene = {
    gl,
    canvas,
    mobile,
    nx,
    nz,
    sample: makeSampler({ lat, lon, values: message.values }),
    worldX,
    worldZ,
    lonAt,
    latAt,
    latLon,
    position,
    colour: new Float32Array(count * 3),
    values: new Float32Array(count),
    indices,
    coastLines,
    coastCount,
    coastPosition: new Float32Array(coastCount * 3),
    iso: new Float32Array(MAX_ISO_SEGMENTS * 6),
    isoCount: 0,
    lastHour: -1,
    buffers,
    locations: { p: gl.getAttribLocation(program, "p"), c: gl.getAttribLocation(program, "c"), m: gl.getUniformLocation(program, "m"), u: gl.getUniformLocation(program, "u") },
    stations,
  };
  scope.postMessage({ type: "ready" });
}

/** Rebuilds the surface, its colours, the isotherms and the coast for `hour`. */
function update(s: Scene, hour: number): void {
  const { gl, nx, nz, position, colour, values, latLon, iso, buffers } = s;
  const lut = heatLut();
  for (let k = 0; k < values.length; k++) {
    const v = s.sample(latLon[k * 2] ?? 0, latLon[k * 2 + 1] ?? 0, hour);
    const at = lutOffset(v);
    values[k] = v;
    position[k * 3 + 1] = heightOf(v);
    colour[k * 3] = (lut[at] ?? 0) / 255;
    colour[k * 3 + 1] = (lut[at + 1] ?? 0) / 255;
    colour[k * 3 + 2] = (lut[at + 2] ?? 0) / 255;
  }
  let count = 0;
  isothermEach(values, nx, nz, 1, (x1, y1, x2, y2, level) => {
    if (count >= MAX_ISO_SEGMENTS - 1) return;
    const o = count * 6;
    const lift = heightOf(level) + 0.004;
    iso[o] = s.worldX(s.lonAt(x1));
    iso[o + 1] = lift;
    iso[o + 2] = s.worldZ(s.latAt(y1));
    iso[o + 3] = s.worldX(s.lonAt(x2));
    iso[o + 4] = lift;
    iso[o + 5] = s.worldZ(s.latAt(y2));
    count++;
  });
  s.isoCount = count;
  let q = 0;
  for (const line of s.coastLines) {
    for (let i = 0; i < line.length - 1; i++) {
      for (const point of [line[i], line[i + 1]]) {
        const [lo, la] = point ?? [0, 0];
        s.coastPosition[q++] = s.worldX(lo);
        s.coastPosition[q++] = heightOf(s.sample(la, lo, hour)) + 0.01;
        s.coastPosition[q++] = s.worldZ(la);
      }
    }
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.position);
  gl.bufferData(gl.ARRAY_BUFFER, position, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.colour);
  gl.bufferData(gl.ARRAY_BUFFER, colour, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.iso);
  gl.bufferData(gl.ARRAY_BUFFER, iso.subarray(0, Math.max(6, count * 6)), gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.coast);
  gl.bufferData(gl.ARRAY_BUFFER, s.coastPosition, gl.DYNAMIC_DRAW);
}

function draw(message: DrawMessage): void {
  const s = scene;
  if (s === null) return;
  const { gl, canvas, mobile, buffers, locations } = s;
  const { hour, azimuth, width, height, dpr } = message;
  let force = message.force;
  const pixelWidth = Math.round(width * dpr);
  const pixelHeight = Math.round(height * dpr);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    force = true;
  }
  // A phone re-meshes every quarter hour; a desktop every three minutes of the replay day.
  if (force || Math.abs(hour - s.lastHour) > (mobile ? 0.25 : 0.05)) {
    update(s, hour);
    s.lastHour = hour;
  }
  const matrix = cameraMatrix({ mobile, azimuth, aspect: width / height });
  const attribute = (buffer: WebGLBuffer, location: number): void => {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 3, gl.FLOAT, false, 0, 0);
  };
  gl.viewport(0, 0, pixelWidth, pixelHeight);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.uniformMatrix4fv(locations.m, false, matrix);
  gl.uniform4f(locations.u, 0, 0, 0, -1);
  attribute(buffers.position, locations.p);
  attribute(buffers.colour, locations.c);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.index);
  gl.drawElements(gl.TRIANGLES, s.indices.length, gl.UNSIGNED_SHORT, 0);
  gl.disableVertexAttribArray(locations.c);
  gl.vertexAttrib3f(locations.c, 0, 0, 0);
  gl.uniform4f(locations.u, 0, 0, 0, 0.32);
  attribute(buffers.iso, locations.p);
  gl.drawArrays(gl.LINES, 0, s.isoCount * 2);
  gl.uniform4f(locations.u, 0.043, 0.055, 0.078, 1);
  attribute(buffers.coast, locations.p);
  gl.drawArrays(gl.LINES, 0, s.coastCount);
  const labels = s.stations.map(([la, lo]) => projectToScreen(matrix, s.worldX(lo), heightOf(s.sample(la, lo, hour)) + 0.02, s.worldZ(la), width, height));
  scope.postMessage({ type: "drawn", labels });
}

scope.onmessage = ({ data }) => {
  try {
    if (data.type === "init") init(data);
    else draw(data);
  } catch (error) {
    fail(String(error));
  }
};
