// Landing terrain renderer, run in a worker on an OffscreenCanvas so WebGL context creation, meshing and drawing never
// block the page's main thread (ADR 0037 budget). Plain WebGL: one tiny shader program, no 3D library.
// ≤ 6,000 vertices desktop, ≤ 1,500 phone (ADR 0037 §3); unlit on purpose (light would change the encoded colour,
// i.e. the value); relief comes from height + 1 °C isotherms. Owned by the landing builder, not part of the kit.
import { sampler, RAMP_DARK } from './heat.js';

let gl, S, st;
const LUT0 = 16, LUTS = 0.05, LUT = Array.from({ length: 561 }, (_, k) => RAMP_DARK(LUT0 + k * LUTS));
const ramp = (v) => LUT[Math.max(0, Math.min(560, Math.round((v - LUT0) / LUTS)))];

function init(m) {
  const { canvas, field, coast, mobile, stations } = m;
  gl = canvas.getContext('webgl', { antialias: !mobile, alpha: true, premultipliedAlpha: false, powerPreference: 'high-performance' });
  if (!gl) { postMessage({ type: 'fail', why: 'no WebGL' }); return; }
  S = sampler(field);
  const BOX = [field.lon[0], field.lat[0], field.lon.at(-1), field.lat.at(-1)];
  const LON0 = (BOX[0] + BOX[2]) / 2, LAT0 = (BOX[1] + BOX[3]) / 2, KX = Math.cos(LAT0 * Math.PI / 180);
  const X = (lo) => (lo - LON0) * KX, Z = (la) => -(la - LAT0), HH = (w) => (w - 20) * 0.075;
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, 'attribute vec3 p;attribute vec3 c;uniform mat4 m;varying vec3 v;void main(){gl_Position=m*vec4(p,1.0);v=c;}'));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, 'precision mediump float;varying vec3 v;uniform vec4 u;void main(){gl_FragColor=u.a>0.0?u:vec4(v,1.0);}'));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { postMessage({ type: 'fail', why: 'program' }); return; }
  gl.useProgram(prog);
  gl.enable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.clearColor(0, 0, 0, 0);
  const NX = mobile ? 43 : 85, NZ = mobile ? 33 : 65, NV = NX * NZ;
  const pos = new Float32Array(NV * 3), col = new Float32Array(NV * 3), vals = new Float32Array(NV), LL = [];
  for (let i = 0; i < NV; i++) { const ix = i % NX, iz = Math.floor(i / NX); const lo = BOX[0] + (BOX[2] - BOX[0]) * ix / (NX - 1), la = BOX[3] - (BOX[3] - BOX[1]) * iz / (NZ - 1); LL.push([la, lo]); pos[i * 3] = X(lo); pos[i * 3 + 2] = Z(la); }
  const idx = new Uint16Array((NX - 1) * (NZ - 1) * 6); let k = 0;
  for (let z = 0; z < NZ - 1; z++) for (let x = 0; x < NX - 1; x++) { const a = z * NX + x; idx.set([a, a + NX, a + 1, a + 1, a + NX, a + NX + 1], k); k += 6; }
  const B = { pos: gl.createBuffer(), col: gl.createBuffer(), idx: gl.createBuffer(), iso: gl.createBuffer(), coast: gl.createBuffer() };
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, B.idx); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
  const COASTL = coast.map((l0) => (mobile ? l0.filter((_, i) => i % 3 === 0 || i === l0.length - 1) : l0));
  const nCoast = COASTL.reduce((a, l) => a + (l.length - 1) * 2, 0);
  st = { canvas, mobile, stations, X, Z, HH, NX, NZ, NV, pos, col, vals, LL, idx, B, COASTL, nCoast, coastPos: new Float32Array(nCoast * 3), iso: new Float32Array(24000 * 6), nIso: 0, lastH: -1,
    aP: gl.getAttribLocation(prog, 'p'), aC: gl.getAttribLocation(prog, 'c'), uM: gl.getUniformLocation(prog, 'm'), uU: gl.getUniformLocation(prog, 'u') };
  postMessage({ type: 'ready' });
}

function update(hour) {
  const { NX, NZ, NV, pos, col, vals, LL, HH, iso, B, COASTL, coastPos, X, Z } = st;
  for (let i = 0; i < NV; i++) { const v = S(LL[i][0], LL[i][1], hour), c = ramp(v); vals[i] = v; pos[i * 3 + 1] = HH(v); col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2]; }
  let nIso = 0;
  for (let z = 0; z < NZ - 1; z++) for (let x = 0; x < NX - 1; x++) {
    const a = z * NX + x, b = a + 1, c = a + NX + 1, d = a + NX, va = vals[a], vb = vals[b], vc = vals[c], vd = vals[d];
    for (let L = Math.ceil(Math.min(va, vb, vc, vd)); L <= Math.floor(Math.max(va, vb, vc, vd)); L++) { let n = 0; const o = nIso * 6;
      const e = (i, j, vi, vj) => { if (n < 2 && (vi - L) * (vj - L) < 0) { const t = (L - vi) / (vj - vi), q = o + n * 3; iso[q] = pos[i * 3] + (pos[j * 3] - pos[i * 3]) * t; iso[q + 1] = HH(L) + 0.004; iso[q + 2] = pos[i * 3 + 2] + (pos[j * 3 + 2] - pos[i * 3 + 2]) * t; n++; } };
      e(a, b, va, vb); e(b, c, vb, vc); e(c, d, vc, vd); e(d, a, vd, va);
      if (n === 2 && nIso < 23999) nIso++; } }
  st.nIso = nIso;
  let q = 0; for (const l of COASTL) for (let i = 0; i < l.length - 1; i++) for (const [lo, la] of [l[i], l[i + 1]]) { coastPos[q++] = X(lo); coastPos[q++] = HH(S(la, lo, hour)) + 0.01; coastPos[q++] = Z(la); }
  gl.bindBuffer(gl.ARRAY_BUFFER, B.pos); gl.bufferData(gl.ARRAY_BUFFER, pos, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, B.col); gl.bufferData(gl.ARRAY_BUFFER, col, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, B.iso); gl.bufferData(gl.ARRAY_BUFFER, iso.subarray(0, Math.max(6, nIso * 6)), gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, B.coast); gl.bufferData(gl.ARRAY_BUFFER, coastPos, gl.DYNAMIC_DRAW);
}

// column-major 4x4 maths; framing as the three.js version it replaces (fov 32 desktop / 44 phone, view offset on desktop)
const mul = (a, b) => { const o = new Float32Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let i = 0; i < 4; i++) s += a[i * 4 + r] * b[c * 4 + i]; o[c * 4 + r] = s; } return o; };
const persp = (fov, asp, n, f) => { const t = 1 / Math.tan(fov * Math.PI / 360); return new Float32Array([t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, 2 * f * n / (n - f), 0]); };
function look(e, t) {
  let zx = e[0] - t[0], zy = e[1] - t[1], zz = e[2] - t[2]; let l = Math.hypot(zx, zy, zz); zx /= l; zy /= l; zz /= l;
  let xx = zz, xz = -zx; const xy = 0; l = Math.hypot(xx, xz); xx /= l; xz /= l; // x = up(+y) cross z
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  return new Float32Array([xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0, -(xx * e[0] + xy * e[1] + xz * e[2]), -(yx * e[0] + yy * e[1] + yz * e[2]), -(zx * e[0] + zy * e[1] + zz * e[2]), 1]);
}

function draw({ hour, az, W, H, dpr, force }) {
  if (!st) return;
  const { canvas, mobile, B, aP, aC, uM, uU, idx } = st;
  const cw = Math.round(W * dpr), ch = Math.round(H * dpr);
  if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; force = true; }
  if (Math.abs(hour - st.lastH) > (mobile ? 0.25 : 0.05) || force) { update(hour); st.lastH = hour; } else if (mobile) { postMessage({ type: 'drawn' }); return; }
  const r = mobile ? 8.4 : 11.2, tilt = mobile ? 0.98 : 0.74, target = [0, 0.55, 0.1];
  const eye = [Math.sin(az - 0.35) * r * Math.cos(tilt), target[1] + r * Math.sin(tilt), target[2] + Math.cos(az - 0.35) * r * Math.cos(tilt)];
  const shift = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, mobile ? 0 : 0.4, mobile ? 0 : 0.08, 0, 1]);
  const M = mul(shift, mul(persp(mobile ? 44 : 32, W / H, 0.1, 100), look(eye, target)));
  const attr = (b, loc) => { gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0); };
  gl.viewport(0, 0, cw, ch); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); gl.uniformMatrix4fv(uM, false, M);
  gl.uniform4f(uU, 0, 0, 0, -1); attr(B.pos, aP); attr(B.col, aC); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, B.idx); gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_SHORT, 0);
  gl.disableVertexAttribArray(aC); gl.vertexAttrib3f(aC, 0, 0, 0);
  gl.uniform4f(uU, 0, 0, 0, 0.32); attr(B.iso, aP); gl.drawArrays(gl.LINES, 0, st.nIso * 2);
  gl.uniform4f(uU, 0.043, 0.055, 0.078, 1); attr(B.coast, aP); gl.drawArrays(gl.LINES, 0, st.nCoast);
  // station label positions back to the page (DOM text stays on the main thread)
  const labels = st.stations.map(([la, lo]) => { const x = st.X(lo), y = st.HH(S(la, lo, hour)) + 0.02, z = st.Z(la);
    const px = M[0] * x + M[4] * y + M[8] * z + M[12], py = M[1] * x + M[5] * y + M[9] * z + M[13], pw = M[3] * x + M[7] * y + M[11] * z + M[15];
    return [(px / pw * 0.5 + 0.5) * W, (-py / pw * 0.5 + 0.5) * H]; });
  postMessage({ type: 'drawn', labels });
}

onmessage = ({ data }) => {
  try { if (data.type === 'init') init(data); else if (data.type === 'draw') draw(data); }
  catch (err) { postMessage({ type: 'fail', why: String(err) }); }
};
