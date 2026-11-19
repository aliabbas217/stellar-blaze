import { RELIEF, type Camera } from "./landing-camera";
import { CLASSES, EDGE, GROUND, IMAGERY_HI, LINE, SKIRT } from "./landing-colour";

/*
 * The slab of the hero: real terrain (a mesh from the elevation grid), real satellite imagery draped on it, and the recorded forecast on top as
 * four flat classes. Plain WebGL1, no library (ported from the approved prototype, "Direction D, Real Earth"). Mesh 80 x 60 terrain vertices +
 * a 552-vertex side skirt + 18 scale-tick vertices = 5,370 per frame, relief x5, one directional light (hillshade, north-west, 45 degrees) baked
 * from the elevation grid into one 512 x 384 texture; the forecast is a 22 x 17 NEAREST texture (R = this hour, G = next hour, mixed in the
 * shader). The station names and the scale ticks are DOM text positioned over the canvas, each with a 1 px leader: text stays text (it is read
 * by assistive technology, takes the page's language and is never mirrored with the page).
 *
 * `createScene` returns null when the browser cannot do it (no WebGL or no derivatives): the caller then keeps the poster. It draws only when
 * something changed (a new hour or camera, a resize), not on every frame.
 */

const GRID_W = 80;
const GRID_H = 60;
const METRES_PER_DEGREE = 111320;
const THICKNESS = 0.14;
const FLOATS = 6; // x y z u v k per vertex
const SHADE_W = 512;
const SHADE_H = 384;
const TEXTURE_W = 2048;
const TEXTURE_H = 1024;
const FIELD_OF_VIEW_DEG = 28;

const clamp = (x: number, a: number, b: number): number => Math.min(b, Math.max(a, x));
const num = (list: ArrayLike<number>, i: number): number => list[i] ?? 0;

export interface SceneGeo {
  readonly bbox: { readonly west: number; readonly south: number; readonly east: number; readonly north: number };
  readonly dem: { readonly w: number; readonly h: number };
  /** The forecast grid's own box and its cell size is `CELL` degrees. */
  readonly cells: { readonly west: number; readonly east: number; readonly south: number; readonly north: number };
}

export interface SceneLabel {
  readonly name: string;
  readonly lat: number;
  readonly lon: number;
  /** The leader line's length in pixels; positive stands above the point, negative below. */
  readonly leader: number;
  /** Anchor the text to the leader's far side (it grows towards the start). */
  readonly end?: boolean;
}

export interface SceneInput {
  readonly canvas: HTMLCanvasElement;
  readonly labelRoot: HTMLElement;
  readonly geo: SceneGeo;
  readonly dem: Int16Array;
  readonly image: CanvasImageSource;
  readonly grid: { readonly rows: number; readonly cols: number; readonly get: (hour: number, row: number, col: number) => number };
  readonly labels: readonly SceneLabel[];
}

export interface Scene {
  readonly vertices: number;
  /** World position of a longitude and latitude on the terrain. */
  readonly ll: (lon: number, lat: number) => { readonly x: number; readonly y: number; readonly z: number };
  readonly set: (hour: number, camera: Camera) => void;
  readonly dispose: () => void;
}

/** The forecast grid's cell size in degrees (the file is the 0.25 degree IFS grid). */
const CELL = 0.25;

function multiply(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let i = 0; i < 4; i++) s += num(a, i * 4 + r) * num(b, c * 4 + i);
      out[c * 4 + r] = s;
    }
  return out;
}

function viewMatrix(camera: Camera, aspect: number, distance: number): Float32Array {
  const { az, el, t, sx } = camera;
  const e = [t[0] + Math.sin(az) * distance * Math.cos(el), t[1] + distance * Math.sin(el), t[2] + Math.cos(az) * distance * Math.cos(el)] as const;
  const f = 1 / Math.tan((FIELD_OF_VIEW_DEG * Math.PI) / 360);
  const near = 0.2;
  const far = 40;
  const P = new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, -sx, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0]);
  let zx = e[0] - t[0];
  let zy = e[1] - t[1];
  let zz = e[2] - t[2];
  let l = Math.hypot(zx, zy, zz);
  zx /= l;
  zy /= l;
  zz /= l;
  let xx = zz;
  let xz = -zx;
  l = Math.hypot(xx, xz);
  xx /= l;
  xz /= l;
  const yx = zy * xz;
  const yy = zz * xx - zx * xz;
  const yz = -zy * xx;
  const V = new Float32Array([xx, yx, zx, 0, 0, yy, zy, 0, xz, yz, zz, 0, -(xx * e[0] + xz * e[2]), -(yx * e[0] + yy * e[1] + yz * e[2]), -(zx * e[0] + zy * e[1] + zz * e[2]), 1]);
  return multiply(P, V);
}

function compile(gl: WebGLRenderingContext, vertex: string, fragment: string): WebGLProgram {
  const shader = (type: number, source: string): WebGLShader => {
    const s = gl.createShader(type);
    if (s === null) throw new Error("no shader");
    gl.shaderSource(s, source);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader failed");
    return s;
  };
  const program = gl.createProgram();
  gl.attachShader(program, shader(gl.VERTEX_SHADER, vertex));
  gl.attachShader(program, shader(gl.FRAGMENT_SHADER, fragment));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "link failed");
  return program;
}

const VERTEX = "attribute vec3 aP;attribute vec2 aT;attribute float aK;uniform mat4 uM;varying vec2 vT;varying float vK;void main(){vT=aT;vK=aK;gl_Position=uM*vec4(aP,1.0);}";
const FRAGMENT =
  "#extension GL_OES_standard_derivatives : enable\nprecision highp float;varying vec2 vT;varying float vK;" +
  "uniform sampler2D uSat,uShade,uCells;uniform vec4 uXf,uCol[4];uniform vec2 uGrid;uniform float uF;uniform vec3 uLo,uHi,uSkirt,uLine;" +
  "float cls(vec2 c){if(c.x<0.0||c.y<0.0||c.x>=uGrid.x||c.y>=uGrid.y)return 0.0;vec2 t=texture2D(uCells,(c+0.5)/uGrid).rg;float v=mix(t.r,t.g,uF)*25.5+20.0;" +
  "return step(26.599,v)+step(29.999,v)+step(32.999,v)+step(35.999,v);}" +
  "void main(){if(vK>0.5){gl_FragColor=vec4(uSkirt*vK,1.0);return;}" +
  "vec2 sh=texture2D(uShade,vT).ra;float lum=texture2D(uSat,vT).r;float lit=clamp(0.2+0.8*sh.x/0.7071,0.0,1.3);vec3 s=mix(uLo,uHi,lum*lit);" +
  "vec2 c=vec2(vT.x*uXf.x+uXf.y,vT.y*uXf.z+uXf.w);vec2 ci=floor(c),f=fract(c),w=fwidth(c);float k=cls(ci);float land=max(step(0.5,sh.y),step(0.1,lum));" +
  "if(k>0.5&&land>0.5){vec4 q=k<1.5?uCol[0]:k<2.5?uCol[1]:k<3.5?uCol[2]:uCol[3];s=mix(s,q.rgb*(0.55+0.95*clamp(lum*lit,0.0,1.0)),q.a);" +
  "float l=0.0;float a=cls(ci+vec2(-1.,0.));if(a<k)l=max(l,step(f.x,w.x));a=cls(ci+vec2(1.,0.));if(a<k)l=max(l,step(1.0-f.x,w.x));" +
  "a=cls(ci+vec2(0.,-1.));if(a<k)l=max(l,step(f.y,w.y));a=cls(ci+vec2(0.,1.));if(a<k)l=max(l,step(1.0-f.y,w.y));s=mix(s,uLine,l);}" +
  "gl_FragColor=vec4(s,1.0);}";
const LINE_VERTEX = "attribute vec3 p;uniform mat4 m;void main(){gl_Position=m*vec4(p,1.0);}";
const LINE_FRAGMENT = "precision mediump float;uniform vec4 c;void main(){gl_FragColor=c;}";

interface Placed {
  readonly el: HTMLElement;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export function createScene(o: SceneInput): Scene | null {
  const context = o.canvas.getContext("webgl", { antialias: true, alpha: false });
  if (context === null || context.getExtension("OES_standard_derivatives") === null) return null;
  const gl: WebGLRenderingContext = context;
  const aniso = gl.getExtension("EXT_texture_filter_anisotropic");
  const { bbox: B, dem: D, cells: CW } = o.geo;
  const kx = Math.cos((((B.south + B.north) / 2) * Math.PI) / 180);
  const lonC = (B.west + B.east) / 2;
  const latC = (B.south + B.north) / 2;
  const wx = (lon: number): number => (lon - lonC) * kx;
  const wz = (lat: number): number => -(lat - latC);
  const demAt = (u: number, v: number): number => {
    const x = clamp(u * (D.w - 1), 0, D.w - 1);
    const y = clamp(v * (D.h - 1), 0, D.h - 1);
    const x0 = Math.min(D.w - 2, Math.floor(x));
    const y0 = Math.min(D.h - 2, Math.floor(y));
    const tx = x - x0;
    const ty = y - y0;
    const d = (yy: number, xx: number): number => num(o.dem, yy * D.w + xx);
    return Math.max(0, (d(y0, x0) * (1 - tx) + d(y0, x0 + 1) * tx) * (1 - ty) + (d(y0 + 1, x0) * (1 - tx) + d(y0 + 1, x0 + 1) * tx) * ty);
  };
  const yOf = (metres: number): number => (metres * RELIEF) / METRES_PER_DEGREE;

  // ---- terrain mesh (x y z u v k), then the skirt
  const ring: [number, number, number][] = [];
  const terrain = GRID_W * GRID_H;
  const total = terrain + 2 * (2 * (GRID_W + GRID_H) - 4);
  const vb = new Float32Array(total * FLOATS);
  const index: number[] = [];
  for (let i = 0; i < GRID_H; i++)
    for (let j = 0; j < GRID_W; j++) {
      const u = j / (GRID_W - 1);
      const v = i / (GRID_H - 1);
      const q = (i * GRID_W + j) * FLOATS;
      vb[q] = wx(B.west + u * (B.east - B.west));
      vb[q + 1] = yOf(demAt(u, v));
      vb[q + 2] = wz(B.north - v * (B.north - B.south));
      vb[q + 3] = u;
      vb[q + 4] = v;
      vb[q + 5] = 0;
    }
  for (let i = 0; i < GRID_H - 1; i++)
    for (let j = 0; j < GRID_W - 1; j++) {
      const a = i * GRID_W + j;
      const b = a + 1;
      const c = a + GRID_W;
      index.push(a, c, b, b, c, c + 1);
    }
  for (let j = 0; j < GRID_W; j++) ring.push([GRID_H - 1, j, 1.0]); // south (front)
  for (let i = GRID_H - 2; i >= 0; i--) ring.push([i, GRID_W - 1, 0.8]); // east
  for (let j = GRID_W - 2; j >= 0; j--) ring.push([0, j, 0.7]); // north
  for (let i = 1; i < GRID_H - 1; i++) ring.push([i, 0, 0.9]); // west
  const top: number[] = [];
  const bottom: number[] = [];
  ring.forEach((r, n) => {
    const s = (r[0] * GRID_W + r[1]) * FLOATS;
    const t = (terrain + n) * FLOATS;
    const b = (terrain + ring.length + n) * FLOATS;
    for (const [q, y] of [
      [t, num(vb, s + 1)],
      [b, -THICKNESS],
    ] as const) {
      vb[q] = num(vb, s);
      vb[q + 1] = y;
      vb[q + 2] = num(vb, s + 2);
      vb[q + 3] = num(vb, s + 3);
      vb[q + 4] = num(vb, s + 4);
      vb[q + 5] = r[2];
    }
    top.push(terrain + n);
    bottom.push(terrain + ring.length + n);
  });
  for (let n = 0; n < ring.length; n++) {
    const m = (n + 1) % ring.length;
    index.push(num(top, n), num(bottom, n), num(top, m), num(top, m), num(bottom, n), num(bottom, m));
  }
  const indices = new Uint16Array(index);
  const loops = new Uint16Array(top.concat(bottom));

  // ---- scale ticks outside the slab: every whole degree of longitude on the south edge and of latitude on the west edge
  const westEdge = wx(B.west);
  const southEdge = wz(B.south);
  const tickLines: number[] = [];
  const known: Placed[] = [];
  const addLabel = (kind: string, text: string, x: number, y: number, z: number, leader = 0, end = false): void => {
    const el = document.createElement("span");
    el.className = `lbl ${kind}`;
    if (leader !== 0) {
      const line = document.createElement("i");
      line.className = "ld";
      line.style.height = `${String(Math.abs(leader))}px`;
      if (leader > 0) line.style.bottom = "0";
      else line.style.top = "0";
      el.append(line);
    }
    const tx = document.createElement("b");
    tx.className = end ? "tx r" : "tx";
    tx.textContent = text;
    if (leader > 0) tx.style.bottom = `${String(leader)}px`;
    else if (leader < 0) tx.style.top = `${String(-leader)}px`;
    el.append(tx);
    o.labelRoot.append(el);
    known.push({ el, x, y, z });
  };
  for (let lo = Math.ceil(B.west); lo <= B.east; lo++) {
    tickLines.push(wx(lo), 0, southEdge, wx(lo), 0, southEdge + 0.07);
    addLabel("tk", `${String(lo)}°E`, wx(lo), 0, southEdge + 0.07);
  }
  for (let la = Math.ceil(B.south); la <= B.north; la++) {
    tickLines.push(westEdge, 0, wz(la), westEdge - 0.07, 0, wz(la));
    addLabel("tk y", `${String(la)}°N`, westEdge - 0.07, 0, wz(la));
  }
  for (const s of o.labels) {
    addLabel("st", s.name, wx(s.lon), yOf(demAt((s.lon - B.west) / (B.east - B.west), (B.north - s.lat) / (B.north - B.south))), wz(s.lat), s.leader, s.end === true);
  }
  const vertices = total + tickLines.length / 3;

  // ---- GPU buffers and textures
  const buffer = (target: number, data: ArrayBufferView): WebGLBuffer => {
    const b = gl.createBuffer();
    gl.bindBuffer(target, b);
    gl.bufferData(target, data, gl.STATIC_DRAW);
    return b;
  };
  const bVertices = buffer(gl.ARRAY_BUFFER, vb);
  const bIndices = buffer(gl.ELEMENT_ARRAY_BUFFER, indices);
  const bLoops = buffer(gl.ELEMENT_ARRAY_BUFFER, loops);
  const bTicks = buffer(gl.ARRAY_BUFFER, new Float32Array(tickLines));
  const makeTexture = (w: number, h: number, format: number, data: ArrayBufferView | null, filter: number): WebGLTexture => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, format, w, h, 0, format, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter === gl.NEAREST ? gl.NEAREST : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  // imagery: stretched onto a power-of-two canvas (uv is the whole box, so the stretch cancels) so it can have mipmaps and anisotropy
  const stretch = document.createElement("canvas");
  stretch.width = TEXTURE_W;
  stretch.height = TEXTURE_H;
  const stretchContext = stretch.getContext("2d");
  if (stretchContext === null) return null;
  stretchContext.imageSmoothingQuality = "high";
  stretchContext.drawImage(o.image, 0, 0, TEXTURE_W, TEXTURE_H);
  const tImage = makeTexture(TEXTURE_W, TEXTURE_H, gl.RGBA, null, gl.LINEAR_MIPMAP_LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, stretch);
  gl.generateMipmap(gl.TEXTURE_2D);
  if (aniso !== null) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, Number(gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT))));
  // hillshade (one light, north-west, 45 degrees) and the land flag, baked from the elevation grid at 4x its resolution
  const shade = new Uint8Array(SHADE_W * SHADE_H * 2);
  const heights = new Float32Array(SHADE_W * SHADE_H);
  const mx = ((B.east - B.west) * METRES_PER_DEGREE * kx) / SHADE_W;
  const my = ((B.north - B.south) * METRES_PER_DEGREE) / SHADE_H;
  for (let y = 0; y < SHADE_H; y++) for (let x = 0; x < SHADE_W; x++) heights[y * SHADE_W + x] = demAt((x + 0.5) / SHADE_W, (y + 0.5) / SHADE_H);
  const hAt = (x: number, y: number): number => num(heights, y * SHADE_W + x);
  for (let y = 0; y < SHADE_H; y++)
    for (let x = 0; x < SHADE_W; x++) {
      const e = hAt(Math.min(SHADE_W - 1, x + 1), y);
      const w = hAt(Math.max(0, x - 1), y);
      const n = hAt(x, Math.max(0, y - 1));
      const s = hAt(x, Math.min(SHADE_H - 1, y + 1));
      const nx = (-RELIEF * (e - w)) / (2 * mx);
      const nz = (-RELIEF * (s - n)) / (2 * my);
      const l = Math.hypot(nx, 1, nz);
      const d = Math.max(0, (-0.5 * nx + 0.7071 - 0.5 * nz) / l);
      const p = (y * SHADE_W + x) * 2;
      shade[p] = Math.round(d * 255);
      shade[p + 1] = hAt(x, y) > 0.5 ? 255 : 0;
    }
  const tShade = makeTexture(SHADE_W, SHADE_H, gl.LUMINANCE_ALPHA, shade, gl.LINEAR);
  const gr = o.grid;
  const cells = new Uint8Array(gr.cols * gr.rows * 4);
  const tCells = makeTexture(gr.cols, gr.rows, gl.RGBA, cells, gl.NEAREST);

  // ---- programs
  const prog = compile(gl, VERTEX, FRAGMENT);
  const lineProg = compile(gl, LINE_VERTEX, LINE_FRAGMENT);
  const U = (n: string): WebGLUniformLocation | null => gl.getUniformLocation(prog, n);
  const loc = { aP: gl.getAttribLocation(prog, "aP"), aT: gl.getAttribLocation(prog, "aT"), aK: gl.getAttribLocation(prog, "aK"), uM: U("uM"), uSat: U("uSat"), uShade: U("uShade"), uCells: U("uCells"), uXf: U("uXf"), uCol: U("uCol[0]"), uGrid: U("uGrid"), uF: U("uF"), uLo: U("uLo"), uHi: U("uHi"), uSkirt: U("uSkirt"), uLine: U("uLine") };
  const line = { p: gl.getAttribLocation(lineProg, "p"), m: gl.getUniformLocation(lineProg, "m"), c: gl.getUniformLocation(lineProg, "c") };

  const state = { f: 0, h0: -1, camera: null as Camera | null };
  let queued = 0;
  let live = true;

  function upload(h0: number): void {
    for (let i = 0; i < gr.rows; i++)
      for (let j = 0; j < gr.cols; j++) {
        const p = ((gr.rows - 1 - i) * gr.cols + j) * 4;
        cells[p] = clamp(Math.round((gr.get(h0, i, j) - 20) * 10), 0, 255);
        cells[p + 1] = clamp(Math.round((gr.get((h0 + 1) % 24, i, j) - 20) * 10), 0, 255);
      }
    gl.bindTexture(gl.TEXTURE_2D, tCells);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gr.cols, gr.rows, gl.RGBA, gl.UNSIGNED_BYTE, cells);
    state.h0 = h0;
  }

  function draw(): void {
    const camera = state.camera;
    if (!live || camera === null) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = o.canvas.clientWidth;
    const h = o.canvas.clientHeight;
    if (w === 0 || h === 0) return;
    if (o.canvas.width !== Math.round(w * dpr) || o.canvas.height !== Math.round(h * dpr)) {
      o.canvas.width = Math.round(w * dpr);
      o.canvas.height = Math.round(h * dpr);
    }
    gl.viewport(0, 0, o.canvas.width, o.canvas.height);
    const m = viewMatrix(camera, w / h, camera.dist);
    gl.clearColor(GROUND[0], GROUND[1], GROUND[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(prog);
    gl.uniformMatrix4fv(loc.uM, false, m);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tImage);
    gl.uniform1i(loc.uSat, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, tShade);
    gl.uniform1i(loc.uShade, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, tCells);
    gl.uniform1i(loc.uCells, 2);
    gl.uniform4f(loc.uXf, (B.east - B.west) / CELL, (B.west - CW.west) / CELL, (B.north - B.south) / CELL, (CW.north - B.north) / CELL);
    gl.uniform2f(loc.uGrid, gr.cols, gr.rows);
    gl.uniform1f(loc.uF, state.f);
    gl.uniform4fv(loc.uCol, new Float32Array(CLASSES.flatMap((c) => [...c])));
    gl.uniform3fv(loc.uLo, GROUND);
    gl.uniform3fv(loc.uHi, IMAGERY_HI);
    gl.uniform3fv(loc.uSkirt, SKIRT);
    gl.uniform3fv(loc.uLine, LINE);
    gl.bindBuffer(gl.ARRAY_BUFFER, bVertices);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bIndices);
    for (const [l, n, offset] of [
      [loc.aP, 3, 0],
      [loc.aT, 2, 3],
      [loc.aK, 1, 5],
    ] as const) {
      gl.enableVertexAttribArray(l);
      gl.vertexAttribPointer(l, n, gl.FLOAT, false, FLOATS * 4, offset * 4);
    }
    gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_SHORT, 0);
    gl.disableVertexAttribArray(loc.aT);
    gl.disableVertexAttribArray(loc.aK);
    gl.useProgram(lineProg);
    gl.uniformMatrix4fv(line.m, false, m);
    gl.enableVertexAttribArray(line.p);
    gl.uniform4fv(line.c, EDGE);
    gl.bindBuffer(gl.ARRAY_BUFFER, bVertices);
    gl.vertexAttribPointer(line.p, 3, gl.FLOAT, false, FLOATS * 4, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bLoops);
    gl.drawElements(gl.LINE_LOOP, ring.length, gl.UNSIGNED_SHORT, 0);
    gl.drawElements(gl.LINE_LOOP, ring.length, gl.UNSIGNED_SHORT, ring.length * 2);
    gl.bindBuffer(gl.ARRAY_BUFFER, bTicks);
    gl.vertexAttribPointer(line.p, 3, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.LINES, 0, tickLines.length / 3);
    for (const e of known) {
      const cw = num(m, 3) * e.x + num(m, 7) * e.y + num(m, 11) * e.z + num(m, 15);
      const px = ((num(m, 0) * e.x + num(m, 4) * e.y + num(m, 8) * e.z + num(m, 12)) / cw * 0.5 + 0.5) * w;
      const py = (-(num(m, 1) * e.x + num(m, 5) * e.y + num(m, 9) * e.z + num(m, 13)) / cw * 0.5 + 0.5) * h;
      const on = cw > 0 && px > 24 && px < w - 24 && py > 24 && py < h - 12;
      e.el.style.visibility = on ? "visible" : "hidden";
      if (on) e.el.style.transform = `translate(${px.toFixed(1)}px,${py.toFixed(1)}px)`;
    }
  }

  const request = (): void => {
    if (queued !== 0 || !live) return;
    queued = requestAnimationFrame(() => {
      queued = 0;
      draw();
    });
  };
  const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(request);
  resize?.observe(o.canvas);

  return {
    vertices,
    ll: (lon, lat) => ({ x: wx(lon), y: yOf(demAt((lon - B.west) / (B.east - B.west), (B.north - lat) / (B.north - B.south))), z: wz(lat) }),
    set(hour, camera) {
      const h0 = Math.floor(hour) % 24;
      if (h0 !== state.h0) upload(h0);
      state.f = hour - Math.floor(hour);
      state.camera = camera;
      request();
    },
    dispose() {
      live = false;
      if (queued !== 0) cancelAnimationFrame(queued);
      resize?.disconnect();
      for (const { el } of known) el.remove();
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
