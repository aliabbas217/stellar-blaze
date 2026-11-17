import { heatLut, isothermEach, lutOffset, makeSampler } from "./field-data";
import { cameraMatrix, COAST_STRIDE, decimateCoast, heightOf, isoVertexCap, IsoLines, meshFor, projectToScreen } from "./terrain-math";

/*
 * The landing terrain, drawn in a worker on an OffscreenCanvas so that creating the WebGL context, building the mesh and drawing
 * never block the page's main thread (ADR 0037). Plain WebGL: one small shader program and five buffers, no 3D library. Unlit
 * on purpose (light would change the encoded colour, which is the value); the relief is the field's own height, and the 1 degree
 * isotherms and the coast stand on it. At most 6,000 vertices on a desktop and 1,500 on a phone, counted over the mesh, the
 * isotherm lines and the coast lines together (terrain-math.ts: lines are indexed, so a point where two segments meet is one vertex).
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
  /** Right-to-left page: the copy is on the right, so the scene sits on the left. */
  readonly rtl: boolean;
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
  readonly rtl: boolean;
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
  /** Vertices of the coast (one per point) and indices of its line list (two per segment). */
  readonly coastPosition: Float32Array;
  readonly coastIndexCount: number;
  readonly iso: IsoLines;
  readonly isoPosition: Float32Array;
  lastHour: number;
  readonly buffers: {
    readonly position: WebGLBuffer;
    readonly colour: WebGLBuffer;
    readonly index: WebGLBuffer;
    readonly iso: WebGLBuffer;
    readonly isoIndex: WebGLBuffer;
    readonly coast: WebGLBuffer;
    readonly coastIndex: WebGLBuffer;
  };
  readonly locations: { readonly p: number; readonly c: number; readonly m: WebGLUniformLocation | null; readonly u: WebGLUniformLocation | null };
  readonly stations: readonly (readonly [number, number])[];
}

let scene: Scene | null = null;

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
  const { canvas, mobile, rtl, stations } = message;
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
  const buffers = { position: make(), colour: make(), index: make(), iso: make(), isoIndex: make(), coast: make(), coastIndex: make() };
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.index);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
  // A phone draws every fourth coast point: the outline is the same at a quarter of the vertices (terrain-math.ts).
  const coastLines = decimateCoast(message.coast, COAST_STRIDE[mobile ? "phone" : "desktop"]);
  const coastPoints = coastLines.reduce((sum, line) => sum + line.length, 0);
  const coastIndex = new Uint16Array(coastLines.reduce((sum, line) => sum + (line.length - 1) * 2, 0));
  let ci = 0;
  let base = 0;
  for (const line of coastLines) {
    for (let i = 0; i < line.length - 1; i++) {
      coastIndex[ci++] = base + i;
      coastIndex[ci++] = base + i + 1;
    }
    base += line.length;
  }
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.coastIndex);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, coastIndex, gl.STATIC_DRAW);
  // the isotherms get what is left of the vertex budget after the mesh and the coast (a guard: the real field never reaches it)
  const isoCap = isoVertexCap(mobile, coastPoints);
  scene = {
    gl,
    canvas,
    mobile,
    rtl,
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
    coastPosition: new Float32Array(coastPoints * 3),
    coastIndexCount: coastIndex.length,
    iso: new IsoLines(isoCap),
    isoPosition: new Float32Array(isoCap * 3),
    lastHour: -1,
    buffers,
    locations: { p: gl.getAttribLocation(program, "p"), c: gl.getAttribLocation(program, "c"), m: gl.getUniformLocation(program, "m"), u: gl.getUniformLocation(program, "u") },
    stations,
  };
  scope.postMessage({ type: "ready" });
}

/** Rebuilds the surface, its colours, the isotherms and the coast for `hour`. */
function update(s: Scene, hour: number): void {
  const { gl, nx, nz, position, colour, values, latLon, iso, isoPosition, buffers } = s;
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
  iso.reset();
  isothermEach(values, nx, nz, 1, (x1, y1, x2, y2, level) => {
    iso.add(x1, y1, x2, y2, level);
  });
  for (let v = 0; v < iso.vertices; v++) {
    isoPosition[v * 3] = s.worldX(s.lonAt(iso.xy[v * 2] ?? 0));
    isoPosition[v * 3 + 1] = heightOf(iso.level[v] ?? 0) + 0.004;
    isoPosition[v * 3 + 2] = s.worldZ(s.latAt(iso.xy[v * 2 + 1] ?? 0));
  }
  let q = 0;
  for (const line of s.coastLines) {
    for (const [lo, la] of line) {
      s.coastPosition[q++] = s.worldX(lo);
      s.coastPosition[q++] = heightOf(s.sample(la, lo, hour)) + 0.01;
      s.coastPosition[q++] = s.worldZ(la);
    }
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.position);
  gl.bufferData(gl.ARRAY_BUFFER, position, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.colour);
  gl.bufferData(gl.ARRAY_BUFFER, colour, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.iso);
  gl.bufferData(gl.ARRAY_BUFFER, isoPosition.subarray(0, Math.max(3, iso.vertices * 3)), gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.isoIndex);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, iso.index.subarray(0, Math.max(2, iso.segments * 2)), gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.coast);
  gl.bufferData(gl.ARRAY_BUFFER, s.coastPosition, gl.DYNAMIC_DRAW);
}

function draw(message: DrawMessage): void {
  const s = scene;
  if (s === null) return;
  const { gl, canvas, mobile, rtl, buffers, locations } = s;
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
  const matrix = cameraMatrix({ mobile, rtl, azimuth, aspect: width / height });
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
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.isoIndex);
  gl.drawElements(gl.LINES, s.iso.segments * 2, gl.UNSIGNED_SHORT, 0);
  gl.uniform4f(locations.u, 0.043, 0.055, 0.078, 1);
  attribute(buffers.coast, locations.p);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.coastIndex);
  gl.drawElements(gl.LINES, s.coastIndexCount, gl.UNSIGNED_SHORT, 0);
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
