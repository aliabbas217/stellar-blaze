// Shared, data-only helpers for the three v2 direction stills.
// Every number drawn by the directions comes from ../../prototype/data/*.json (real Open-Meteo IFS 0.25 day-1
// forecasts, WBGT computed with the backend's Liljegren module). Nothing here invents a value.

export const DATA = new URL('../data/', import.meta.url);

export const STATIONS = {
  OMAA: [24.433, 54.6511, 'Abu Dhabi Intl'],
  OMAD: [24.4283, 54.4581, 'Al Bateen'],
  OMAL: [24.2617, 55.6092, 'Al Ain'],
  OMDB: [25.255, 55.3643, 'Dubai Intl'],
  OMDW: [24.8861, 55.1722, 'Al Maktoum'],
  OMFJ: [25.1122, 56.324, 'Fujairah'],
  OMSJ: [25.3286, 55.5172, 'Sharjah'],
  OMRK: [25.613, 55.939, 'Ras Al Khaimah'],
};

export async function loadJSON(name) {
  const r = await fetch(new URL(name, DATA));
  if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
  return r.json();
}

// ---- colour: OKLCH -> sRGB (Björn Ottosson's matrices) -------------------------------------------
export function oklchToRgb(L, C, h) {
  const a = C * Math.cos((h * Math.PI) / 180), b = C * Math.sin((h * Math.PI) / 180);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return lin.map((x) => {
    const v = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(Math.max(x, 0), 1 / 2.4) - 0.055;
    return Math.min(1, Math.max(0, v));
  });
}

// A ramp is a list of [value, L, C, h] with hue UNWRAPPED (e.g. 375 = 15) so interpolation never sweeps
// backwards through green/cyan; interpolation happens in OKLCH so lightness stays monotonic
// (monotonic lightness is what keeps a ramp readable in greyscale and for colour-vision deficiency).
export function makeRamp(stops) {
  return (v) => {
    if (v <= stops[0][0]) return oklchToRgb(stops[0][1], stops[0][2], stops[0][3]);
    for (let i = 1; i < stops.length; i++) {
      if (v <= stops[i][0]) {
        const [v0, L0, C0, h0] = stops[i - 1], [v1, L1, C1, h1] = stops[i];
        const t = (v - v0) / (v1 - v0);
        return oklchToRgb(L0 + (L1 - L0) * t, C0 + (C1 - C0) * t, h0 + (h1 - h0) * t);
      }
    }
    const s = stops[stops.length - 1];
    return oklchToRgb(s[1], s[2], s[3]);
  };
}

// Dark-ground ramp (inferno family, re-derived in OKLCH): low = dark, high = bright.
export const RAMP_DARK = makeRamp([
  [26, 0.24, 0.06, 285], [30, 0.36, 0.13, 330], [33, 0.5, 0.17, 375],
  [35.5, 0.64, 0.18, 398], [38, 0.79, 0.16, 425], [40.5, 0.95, 0.08, 460],
]);
// Light-ground ramp (YlOrRd family, re-derived in OKLCH): low = pale, high = dark.
export const RAMP_LIGHT = makeRamp([
  [26, 0.96, 0.04, 95], [30, 0.88, 0.1, 80], [33, 0.76, 0.15, 58],
  [35.5, 0.63, 0.18, 38], [38, 0.5, 0.17, 25], [40.5, 0.36, 0.12, 20],
]);

export const css = ([r, g, b]) => `rgb(${(r * 255) | 0} ${(g * 255) | 0} ${(b * 255) | 0})`;

// ---- field sampling -------------------------------------------------------------------------------
// field.wbgt_c is [lat][lon][hour]; bilinear in space, linear in time (fractional hour).
export function sampler(field) {
  const { lat, lon, wbgt_c: W } = field;
  const nla = lat.length, nlo = lon.length;
  return (la, lo, hour) => {
    const fy = ((la - lat[0]) / (lat[nla - 1] - lat[0])) * (nla - 1);
    const fx = ((lo - lon[0]) / (lon[nlo - 1] - lon[0])) * (nlo - 1);
    const y0 = Math.max(0, Math.min(nla - 2, Math.floor(fy))), x0 = Math.max(0, Math.min(nlo - 2, Math.floor(fx)));
    const ty = Math.min(1, Math.max(0, fy - y0)), tx = Math.min(1, Math.max(0, fx - x0));
    const h0 = Math.floor(hour) % 24, h1 = (h0 + 1) % 24, th = hour - Math.floor(hour);
    const at = (y, x) => W[y][x][h0] * (1 - th) + W[y][x][h1] * th;
    return (at(y0, x0) * (1 - tx) + at(y0, x0 + 1) * tx) * (1 - ty) + (at(y0 + 1, x0) * (1 - tx) + at(y0 + 1, x0 + 1) * tx) * ty;
  };
}

export function fieldMax(field, hour) {
  let best = { v: -Infinity, la: 0, lo: 0 };
  field.wbgt_c.forEach((row, i) => row.forEach((cell, j) => {
    if (cell[hour] > best.v) best = { v: cell[hour], la: field.lat[i], lo: field.lon[j] };
  }));
  return best;
}

// Coast rings clipped to a lon/lat box; returns polylines (arrays of [lon, lat]).
export function clipCoast(coast, [x0, y0, x1, y1]) {
  const lines = [];
  for (const { r } of coast.rings) {
    let cur = [];
    for (const p of r) {
      const inside = p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1;
      if (inside) cur.push(p);
      else if (cur.length) { if (cur.length > 1) lines.push(cur); cur = []; }
    }
    if (cur.length > 1) lines.push(cur);
  }
  return lines;
}

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
export function hasWebGL() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); }
  catch { return false; }
}
export const hh = (h) => String(Math.floor(h) % 24).padStart(2, '0') + ':00';
